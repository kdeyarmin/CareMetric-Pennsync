import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transpileTs } from '../../tools-transpile-ts.mjs';

// getUserActivityLog and analyzeNursePerformance were restored on 2026-10-08.
// Their authority is the built-in admin or a service-owned agency
// administrator (withTrustedClaims), and an agency administrator only ever
// reaches members of their own agency. These cases drive the handlers with a
// fake SDK and pin that boundary.

async function loadHandler(name, client) {
  let source = await readFile(new URL(`../functions/${name}/entry.ts`, import.meta.url), 'utf8');
  source = source.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    'const createClientFromRequest = globalThis.__activityScopeMakeClient;',
  );
  const tempPath = join(tmpdir(), `activity-scope-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(tempPath, transpileTs(source).outputText);
  let handler;
  globalThis.__activityScopeMakeClient = () => client;
  globalThis.Deno = { serve: (candidate) => { handler = candidate; }, env: { get: () => undefined } };
  try {
    await import(`${pathToFileURL(tempPath).href}?v=${Date.now()}`);
  } finally {
    await unlink(tempPath).catch(() => {});
  }
  return handler;
}

const post = (body) => new Request('https://app/fn', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

function membership(overrides) {
  return {
    id: `m-${overrides.user_id}`,
    agency_id: 'agency-a',
    user_id: 'u',
    membership_key: `${overrides.agency_id || 'agency-a'}:${overrides.user_id}`,
    user_email_normalized: 'u@example.test',
    tenant_role: 'clinician',
    status: 'active',
    version: 1,
    created_by_user_id: 'owner',
    last_transition_by_user_id: 'owner',
    last_transition_by_email_normalized: 'owner@example.test',
    last_transition_at: '2026-09-01T00:00:00.000Z',
    last_transition_reason: 'Activated',
    activated_at: '2026-09-01T00:00:00.000Z',
    revoked_at: null,
    revocation_reason: null,
    ...overrides,
  };
}

const MEMBERSHIPS = [
  membership({ user_id: 'admin-a', user_email_normalized: 'admin@a.test', tenant_role: 'agency_admin' }),
  membership({ user_id: 'nurse-a', user_email_normalized: 'nurse@a.test' }),
  membership({ user_id: 'nurse-b', agency_id: 'agency-b', membership_key: 'agency-b:nurse-b', user_email_normalized: 'nurse@b.test' }),
];
const AGENCIES = [
  { id: 'agency-a', agency_name: 'Agency A', status: 'active' },
  { id: 'agency-b', agency_name: 'Agency B', status: 'active' },
];
const ACTIVITY = [
  { id: 'e1', created_date: new Date().toISOString(), user_email: 'nurse@a.test', action: 'page_visit',
    details: { page: 'Dashboard', patient_name: 'Ada Lovelace', patient_id: 'p1', count: 3 } },
  { id: 'e2', created_date: new Date().toISOString(), user_email: 'nurse@b.test', action: 'page_visit' },
];

function matches(row, query) {
  return Object.entries(query).every(([key, value]) => {
    if (value && typeof value === 'object' && Array.isArray(value.$in)) return value.$in.includes(row[key]);
    return row[key] === value;
  });
}

function makeClient(me, extra = {}) {
  const reads = [];
  const table = (name, rows) => ({
    filter: async (query) => { reads.push([name, query]); return rows.filter((row) => matches(row, query)); },
    list: async () => { reads.push([name, 'list']); return rows; },
  });
  const users = [
    { id: 'admin-a', email: 'admin@a.test', full_name: 'Admin A', role: 'user' },
    { id: 'nurse-a', email: 'nurse@a.test', full_name: 'Nurse A', role: 'user',
      work_phone_number: '+12155550100', personal_cell_e164: '+12155550199' },
    { id: 'nurse-b', email: 'nurse@b.test', full_name: 'Nurse B', role: 'user' },
  ];
  const entities = {
    AgencyMembership: table('AgencyMembership', MEMBERSHIPS),
    Agency: table('Agency', AGENCIES),
    User: table('User', users),
    UserActivity: table('UserActivity', ACTIVITY),
    CallLog: table('CallLog', extra.CallLog || []),
    SmsMessage: table('SmsMessage', extra.SmsMessage || []),
    SmsConsent: table('SmsConsent', extra.SmsConsent || []),
    TrainingRecommendation: table('TrainingRecommendation', []),
    ComplianceAudit: table('ComplianceAudit', []),
    Visit: table('Visit', []),
    Incident: table('Incident', []),
  };
  return {
    reads,
    client: {
      auth: { me: async () => me },
      asServiceRole: {
        entities,
        integrations: { Core: { InvokeLLM: async () => ({ overall_summary: 'ok' }) } },
      },
    },
  };
}

const AGENCY_ADMIN = { id: 'admin-a', email: 'admin@a.test', role: 'user', is_active: true };
const NURSE = { id: 'nurse-a', email: 'nurse@a.test', role: 'user', is_active: true };
const CLAIMED_ADMIN = { id: 'nurse-a', email: 'nurse@a.test', role: 'user', account_type: 'agency_admin', is_active: true };

test('getUserActivityLog scopes an agency administrator to their own agency', async () => {
  const { client } = makeClient(AGENCY_ADMIN);
  const handler = await loadHandler('getUserActivityLog', client);

  const report = await handler(post({ mode: 'report' }));
  assert.equal(report.status, 200);
  const body = await report.json();
  assert.equal(body.scope, 'agency');
  assert.deepEqual(body.activity.map((row) => row.id), ['e1'], 'the other agency\'s activity is absent');
  assert.deepEqual(body.activity[0].details, { page: 'Dashboard', count: 3 }, 'identifying details are dropped');
  assert.deepEqual(body.members.map((row) => row.email).sort(), ['admin@a.test', 'nurse@a.test']);

  const inside = await handler(post({ target_user_email: 'nurse@a.test' }));
  assert.equal(inside.status, 200);
  const outside = await handler(post({ target_user_email: 'nurse@b.test' }));
  assert.equal(outside.status, 403);
});

test('getUserActivityLog refuses a nurse and a self-claimed agency_admin', async () => {
  for (const me of [NURSE, CLAIMED_ADMIN]) {
    const { client, reads } = makeClient(me);
    const handler = await loadHandler('getUserActivityLog', client);
    const response = await handler(post({ mode: 'report' }));
    assert.equal(response.status, 403);
    assert.equal(reads.filter(([name]) => name === 'UserActivity').length, 0);
  }
});

test('analyzeNursePerformance: roster and targets stay inside the agency administrator\'s agency', async () => {
  const { client } = makeClient(AGENCY_ADMIN);
  const handler = await loadHandler('analyzeNursePerformance', client);

  const roster = await handler(post({ action: 'roster' }));
  assert.equal(roster.status, 200);
  assert.deepEqual((await roster.json()).nurses.map((row) => row.email).sort(), ['admin@a.test', 'nurse@a.test']);

  assert.equal((await handler(post({ nurse_email: 'nurse@a.test' }))).status, 200);
  assert.equal((await handler(post({ nurse_email: 'nurse@b.test' }))).status, 403);
});

test('analyzeNursePerformance: a nurse gets no roster and is always answered about themselves', async () => {
  const { client, reads } = makeClient(NURSE);
  const handler = await loadHandler('analyzeNursePerformance', client);
  assert.equal((await handler(post({ action: 'roster' }))).status, 403);

  const response = await handler(post({ nurse_email: 'nurse@b.test' }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).nurse_email, 'nurse@a.test');
  const activityReads = reads.filter(([name]) => name === 'UserActivity').map(([, query]) => query);
  assert.deepEqual(activityReads, [{ user_email: 'nurse@a.test' }]);
});

test('getUserActivityLog phone mode: one agency\'s texting and calling metadata, masked, with no bodies', async () => {
  const now = new Date().toISOString();
  const extra = {
    SmsMessage: [
      // Stamped to agency A by its line.
      { id: 's1', created_date: now, agency_id: 'agency-a', direction: 'outbound', status: 'delivered',
        nurse_email: 'nurse@a.test', from_number: '+12155550100', to_number: '+12155551234', body: 'Your visit is at 3pm', patient_id: 'p1' },
      // An inbound text on agency A's line that no staff member was attributed.
      { id: 's2', created_date: now, agency_id: 'agency-a', direction: 'inbound', status: 'received',
        nurse_email: null, from_number: '+12155551234', to_number: '+12155550100', body: 'Thanks' },
      // A member of agency A, but this text went out on agency B's line.
      { id: 's3', created_date: now, agency_id: 'agency-b', direction: 'outbound', status: 'sent',
        nurse_email: 'nurse@a.test', from_number: '+16105550100', to_number: '+16105559876', body: 'B text' },
      // Legacy unstamped row from an agency A member.
      { id: 's4', created_date: now, direction: 'outbound', status: 'failed',
        nurse_email: 'nurse@a.test', from_number: '+12155550100', to_number: '+12155554321', body: 'old' },
      // Agency B's own text.
      { id: 's5', created_date: now, agency_id: 'agency-b', direction: 'outbound', status: 'sent',
        nurse_email: 'nurse@b.test', from_number: '+16105550100', to_number: '+16105559876', body: 'B only' },
    ],
    CallLog: [
      { id: 'c1', created_date: now, direction: 'outbound', status: 'completed', nurse_email: 'nurse@a.test',
        from_number: '+12155550100', to_number: '+12155551234', displayed_number: '+12155550100', duration_seconds: 65 },
      { id: 'c2', created_date: now, direction: 'inbound', status: 'completed', nurse_email: 'nurse@b.test',
        from_number: '+16105559876', to_number: '+16105550100' },
    ],
    SmsConsent: [
      { id: 'k1', agency_id: 'agency-a', consent_key: 'telnyx:sec:prof:agency-a:+12155551234', phone_e164: '+12155551234',
        consent_status: 'opted_in', captured_at: now },
      { id: 'k2', agency_id: 'agency-b', consent_key: 'telnyx:sec:prof:agency-b:+16105559876', phone_e164: '+16105559876',
        consent_status: 'opted_out', captured_at: now },
    ],
  };
  const { client } = makeClient(AGENCY_ADMIN, extra);
  const handler = await loadHandler('getUserActivityLog', client);
  const response = await handler(post({ mode: 'phone', days: 30 }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.scope, 'agency');
  assert.deepEqual(body.texts.map((row) => row.id).sort(), ['s1', 's2', 's4'],
    'stamped rows follow their agency; only unstamped rows fall back to the member address');
  assert.deepEqual(body.calls.map((row) => row.id), ['c1']);
  assert.deepEqual(body.consents.map((row) => row.consent_status), ['opted_in']);
  const serialized = JSON.stringify(body);
  for (const secret of ['Your visit', 'Thanks', '+12155551234', '2155551234', 'agency-a:+1', 'p1']) {
    assert.equal(serialized.includes(secret), false, `${secret} must not leave the server`);
  }
  assert.equal(body.texts.find((row) => row.id === 's1').to_masked, '(•••) •••-1234');
  assert.equal(body.texts.find((row) => row.id === 's1').body_length, 'Your visit is at 3pm'.length);
  assert.match(body.consents[0].consent_key, /^k\d+$/);
  const nurse = body.members.find((row) => row.email === 'nurse@a.test');
  assert.deepEqual(nurse, { email: 'nurse@a.test', full_name: 'Nurse A', has_work_number: true, has_personal_cell: true });
  assert.equal(body.members.some((row) => row.email === 'nurse@b.test'), false);

  for (const me of [NURSE, CLAIMED_ADMIN]) {
    const refused = makeClient(me, extra);
    const refusedHandler = await loadHandler('getUserActivityLog', refused.client);
    const answer = await refusedHandler(post({ mode: 'phone' }));
    assert.equal(answer.status, 403);
    assert.equal(refused.reads.filter(([name]) => ['SmsMessage', 'CallLog', 'SmsConsent'].includes(name)).length, 0);
  }
});
