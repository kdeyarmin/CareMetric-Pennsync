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

function makeClient(me) {
  const reads = [];
  const table = (name, rows) => ({
    filter: async (query) => { reads.push([name, query]); return rows.filter((row) => matches(row, query)); },
    list: async () => { reads.push([name, 'list']); return rows; },
  });
  const users = [
    { id: 'admin-a', email: 'admin@a.test', full_name: 'Admin A', role: 'user' },
    { id: 'nurse-a', email: 'nurse@a.test', full_name: 'Nurse A', role: 'user' },
    { id: 'nurse-b', email: 'nurse@b.test', full_name: 'Nurse B', role: 'user' },
  ];
  const entities = {
    AgencyMembership: table('AgencyMembership', MEMBERSHIPS),
    Agency: table('Agency', AGENCIES),
    User: table('User', users),
    UserActivity: table('UserActivity', ACTIVITY),
    CallLog: table('CallLog', []),
    SmsMessage: table('SmsMessage', []),
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
