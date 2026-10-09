import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transpileTs } from '../../tools-transpile-ts.mjs';

// scheduleSms was released on 2026-10-08. These cases drive the handler with
// a stateful fake SDK and pin what replaced the owner-only gate: an active
// membership, a sending line taken from the service-owned binding in the
// caller's agency, the scoped consent ledger, and patient access by
// membership plus care-team assignment.

const ENTRY_URL = new URL('../functions/scheduleSms/entry.ts', import.meta.url);
const AGENCY = 'agency_a';
const WORK = '+12155550100';
const PATIENT_PHONE = '+13125550182';

function makeBinding(overrides = {}) {
  const destination = overrides.destination_e164 || WORK;
  const binding = {
    id: 'binding_1',
    binding_key: `telnyx:integration_1:${destination}`,
    provider: 'telnyx',
    integration_secret_id: 'integration_1',
    destination_e164: destination,
    provider_number_id: 'telnyx_number_1',
    phone_number_id: 'phone_number_1',
    agency_id: AGENCY,
    messaging_profile_id: 'MP1',
    sms_inbound_enabled: true,
    sms_outbound_enabled: true,
    voice_inbound_enabled: false,
    fax_inbound_enabled: false,
    status: 'active',
    source: 'manual',
    created_by_user_id: 'user_owner',
    created_by_user_email_normalized: 'owner@example.com',
    created_at: '2026-09-01T00:00:01.000Z',
    activated_at: '2026-09-01T00:00:01.000Z',
    last_transition_by_user_id: 'user_owner',
    last_transition_by_email_normalized: 'owner@example.com',
    last_transition_at: '2026-09-01T00:00:01.000Z',
    last_transition_reason: 'Reviewed initial binding',
    last_transition_action: 'bind',
    last_transition_request_id: 'request_1',
    version: 1,
    ...overrides,
  };
  binding.last_transition_request_key = `${binding.binding_key}:${binding.last_transition_request_id}`;
  return binding;
}

function optIn(binding = makeBinding()) {
  return {
    id: 'consent_1',
    consent_key: `telnyx:integration_1:MP1:${AGENCY}:${PATIENT_PHONE}`,
    provider: 'telnyx',
    integration_secret_id: 'integration_1',
    messaging_profile_id: 'MP1',
    agency_id: AGENCY,
    destination_binding_id: binding.id,
    destination_binding_key: binding.binding_key,
    destination_e164: binding.destination_e164,
    patient_id: null,
    phone_e164: PATIENT_PHONE,
    consent_status: 'opted_in',
    consent_source: 'manual_opt_in',
    captured_by: 'nurse@example.com',
    captured_at: '2026-09-02T00:00:00.000Z',
    provider_event_id: null,
    provider_message_id: null,
    provider_event_occurred_at: null,
  };
}

function membership(userId, email, role = 'clinician') {
  return {
    id: `m_${userId}`, agency_id: AGENCY, user_id: userId, membership_key: `${AGENCY}:${userId}`,
    user_email_normalized: email, tenant_role: role, status: 'active', version: 1,
    created_by_user_id: 'user_owner', last_transition_by_user_id: 'user_owner',
    last_transition_by_email_normalized: 'owner@example.com', last_transition_at: '2026-09-01T00:00:00.000Z',
    last_transition_reason: 'Activated', activated_at: '2026-09-01T00:00:00.000Z',
    revoked_at: null, revocation_reason: null,
  };
}

function makeClient(me, seed = {}) {
  const data = {
    IntegrationSecret: [{ id: 'integration_1', provider: 'telnyx', api_key: 'KEYtest', messaging_profile_id: 'MP1', is_active: true }],
    TelecomDestinationBinding: [makeBinding()],
    SmsConsent: [optIn()],
    AgencyMembership: [membership('nurse_1', 'nurse@example.com')],
    Agency: [{ id: AGENCY, agency_name: 'Penn Home Health', status: 'active' }],
    Patient: [{ id: 'patient_1', agency_id: AGENCY, phone: PATIENT_PHONE, created_by_user_id: 'someone_else' }],
    PatientCareTeamAssignment: [],
    ScheduledSms: [],
    UserActivity: [],
    ...seed,
  };
  const matches = (row, query = {}) => Object.entries(query).every(([key, value]) => row?.[key] === value);
  const entities = new Proxy({}, {
    get: (_target, name) => ({
      filter: async (query = {}, _sort, limit = 5000) => (data[name] || []).filter((row) => matches(row, query)).slice(0, limit),
      list: async () => data[name] || [],
      create: async (row) => {
        const created = { id: `${String(name)}_${(data[name] || []).length + 1}`, ...row };
        (data[name] ||= []).push(created);
        return created;
      },
      update: async (id, patch) => ({ id, ...patch }),
    }),
  });
  return { data, client: { auth: { me: async () => me }, entities, asServiceRole: { entities } } };
}

async function loadHandler(client) {
  let source = await readFile(ENTRY_URL, 'utf8');
  source = source.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    'const createClientFromRequest = globalThis.__scheduleSmsMakeClient;',
  );
  const tempPath = join(tmpdir(), `schedule-sms-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(tempPath, transpileTs(source).outputText);
  let handler;
  globalThis.__scheduleSmsMakeClient = () => client;
  globalThis.Deno = { serve: (candidate) => { handler = candidate; }, env: { get: () => undefined } };
  try {
    await import(`${pathToFileURL(tempPath).href}?v=${Date.now()}`);
  } finally {
    await unlink(tempPath).catch(() => {});
  }
  return handler;
}

const NURSE = { id: 'nurse_1', email: 'nurse@example.com', role: 'user', is_active: true, work_phone_number: '(215) 555-0100', full_name: 'Nora Nurse' };
const sendAt = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
const post = (body) => new Request('https://app/functions/scheduleSms', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

test('an assigned clinician schedules from the bound agency line, linked to the chart', async () => {
  const { client, data } = makeClient(NURSE, {
    PatientCareTeamAssignment: [{ id: 'a1', agency_id: AGENCY, patient_id: 'patient_1', user_id: 'nurse_1', user_email_normalized: 'nurse@example.com', status: 'active' }],
  });
  const handler = await loadHandler(client);
  const response = await handler(post({ to_number: PATIENT_PHONE, body: 'Visit tomorrow at 10', send_at: sendAt(), patient_id: 'patient_1' }));
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(data.ScheduledSms.length, 1);
  const row = data.ScheduledSms[0];
  assert.equal(row.from_number, WORK, 'the stored line is the binding destination, not the typed profile value');
  assert.equal(row.nurse_email, 'nurse@example.com');
  assert.equal(row.patient_id, 'patient_1');
  assert.doesNotMatch(JSON.stringify(data.UserActivity), /Visit tomorrow/, 'the body never reaches the audit row');
});

test('without a care-team assignment a clinician cannot link the chart', async () => {
  const { client, data } = makeClient(NURSE);
  const handler = await loadHandler(client);
  const response = await handler(post({ to_number: PATIENT_PHONE, body: 'x', send_at: sendAt(), patient_id: 'patient_1' }));
  assert.equal(response.status, 403);
  assert.equal(data.ScheduledSms.length, 0);
});

test('an agency manager may link any chart in their agency, but not another agency\'s', async () => {
  const managerMembership = membership('nurse_1', 'nurse@example.com', 'manager');
  const { client, data } = makeClient(NURSE, {
    AgencyMembership: [managerMembership],
    Patient: [
      { id: 'patient_1', agency_id: AGENCY, phone: PATIENT_PHONE },
      { id: 'patient_b', agency_id: 'agency_b', phone: '+13125550199' },
    ],
  });
  const handler = await loadHandler(client);
  assert.equal((await handler(post({ to_number: PATIENT_PHONE, body: 'x', send_at: sendAt(), patient_id: 'patient_1' }))).status, 200);
  assert.equal((await handler(post({ to_number: PATIENT_PHONE, body: 'x', send_at: sendAt(), patient_id: 'patient_b' }))).status, 400,
    'a chart whose phone does not match the destination is refused');
  assert.equal(data.ScheduledSms.length, 1);

  const other = makeClient(NURSE, {
    AgencyMembership: [managerMembership],
    Patient: [{ id: 'patient_b', agency_id: 'agency_b', phone: PATIENT_PHONE }],
  });
  const otherHandler = await loadHandler(other.client);
  assert.equal((await otherHandler(post({ to_number: PATIENT_PHONE, body: 'x', send_at: sendAt(), patient_id: 'patient_b' }))).status, 403,
    'a chart in another agency is never linked, even with a matching phone');
  assert.equal(other.data.ScheduledSms.length, 0);
});

test('no membership, no bound line, or no consent refuses before any row is written', async () => {
  let fixture = makeClient(NURSE, { AgencyMembership: [] });
  let handler = await loadHandler(fixture.client);
  let response = await handler(post({ to_number: PATIENT_PHONE, body: 'x', send_at: sendAt() }));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, 'agency_membership_required');

  fixture = makeClient({ ...NURSE, work_phone_number: '+12155550999' });
  handler = await loadHandler(fixture.client);
  response = await handler(post({ to_number: PATIENT_PHONE, body: 'x', send_at: sendAt() }));
  assert.equal(response.status, 503, 'a work number that is not an active agency line cannot send');

  fixture = makeClient(NURSE, { SmsConsent: [] });
  handler = await loadHandler(fixture.client);
  response = await handler(post({ to_number: PATIENT_PHONE, body: 'x', send_at: sendAt() }));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).reason, 'consent_required');

  for (const f of [fixture]) assert.equal(f.data.ScheduledSms.length, 0);
});

test('a nurse with no work number uses the agency\'s single outbound line', async () => {
  const { client, data } = makeClient({ ...NURSE, work_phone_number: '' });
  const handler = await loadHandler(client);
  const response = await handler(post({ to_number: PATIENT_PHONE, body: 'x', send_at: sendAt() }));
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(data.ScheduledSms[0].from_number, WORK);
});
