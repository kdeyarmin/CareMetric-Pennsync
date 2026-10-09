import { after, before, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transpileTs } from '../../tools-transpile-ts.mjs';

// sendSms (text now) and startMaskedCall (call through the work number) were
// released to every agency member on 2026-10-08, on the authority scheduleSms
// already used. These cases drive both handlers with a stateful fake SDK and
// pin what replaced the owner-only gates: an active service-owned membership
// decided before the body is read, a sending line that is an active
// TelecomDestinationBinding in the caller's agency, the scoped consent ledger
// (texts), and chart access through callerMayAccessPatient.

// sendSms also enforces the TCPA quiet-hours window in the recipient's area
// code, from the wall clock. Every case here is about authority, so pin a
// daytime instant (noon in Chicago, the patient's 312 number) for the whole
// file: a success must not depend on when the suite runs, and a refusal must
// mean what its case says rather than "it is night". Only Date is mocked.
const DAYTIME = Date.parse('2026-10-08T17:00:00.000Z');
before(() => mock.timers.enable({ apis: ['Date'], now: DAYTIME }));
after(() => mock.timers.reset());

const AGENCY = 'agency_a';
const WORK = '+12155550100';
const CELL = '+12155550111';
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
    voice_inbound_enabled: true,
    voice_connection_id: 'VC1',
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
    consent_key: `telnyx:integration_1:MP1:${binding.agency_id}:${PATIENT_PHONE}`,
    provider: 'telnyx',
    integration_secret_id: 'integration_1',
    messaging_profile_id: 'MP1',
    agency_id: binding.agency_id,
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

function membership(userId, email, role = 'clinician', agencyId = AGENCY) {
  return {
    id: `m_${userId}_${agencyId}`, agency_id: agencyId, user_id: userId, membership_key: `${agencyId}:${userId}`,
    user_email_normalized: email, tenant_role: role, status: 'active', version: 1,
    created_by_user_id: 'user_owner', last_transition_by_user_id: 'user_owner',
    last_transition_by_email_normalized: 'owner@example.com', last_transition_at: '2026-09-01T00:00:00.000Z',
    last_transition_reason: 'Activated', activated_at: '2026-09-01T00:00:00.000Z',
    revoked_at: null, revocation_reason: null,
  };
}

const ASSIGNMENT = { id: 'a1', agency_id: AGENCY, patient_id: 'patient_1', user_id: 'nurse_1', user_email_normalized: 'nurse@example.com', status: 'active' };

function makeClient(me, seed = {}) {
  const calls = [];
  const data = {
    IntegrationSecret: [{ id: 'integration_1', provider: 'telnyx', api_key: 'KEYtest', messaging_profile_id: 'MP1', voice_connection_id: 'VC1', is_active: true }],
    TelecomDestinationBinding: [makeBinding()],
    SmsConsent: [optIn()],
    AgencyMembership: [membership('nurse_1', 'nurse@example.com')],
    Agency: [
      { id: AGENCY, agency_name: 'Penn Home Health', status: 'active' },
      { id: 'agency_b', agency_name: 'Other Agency', status: 'active' },
    ],
    AgencySettings: [],
    Patient: [{ id: 'patient_1', agency_id: AGENCY, phone: PATIENT_PHONE, created_by_user_id: 'someone_else' }],
    PatientCareTeamAssignment: [],
    SmsMessage: [],
    CallLog: [],
    UserActivity: [],
    ...seed,
  };
  const matches = (row, query = {}) => Object.entries(query).every(([key, value]) => row?.[key] === value);
  const entities = new Proxy({}, {
    get: (_target, nameValue) => {
      const name = String(nameValue);
      return {
        filter: async (query = {}, _sort, limit = 5000) => {
          calls.push(['filter', name]);
          return (data[name] || []).filter((row) => matches(row, query)).slice(0, limit);
        },
        list: async () => data[name] || [],
        create: async (row) => {
          calls.push(['create', name]);
          const created = { id: `${name}_${(data[name] || []).length + 1}`, ...row };
          (data[name] ||= []).push(created);
          return created;
        },
        update: async (id, patch) => {
          const row = (data[name] || []).find((candidate) => candidate.id === id);
          if (row) Object.assign(row, patch);
          return { id, ...patch };
        },
      };
    },
  });
  return { data, calls, client: { auth: { me: async () => me }, entities, asServiceRole: { entities } } };
}

async function loadHandler(name, client, { fetchCalls = [] } = {}) {
  let source = await readFile(new URL(`../functions/${name}/entry.ts`, import.meta.url), 'utf8');
  source = source.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    'const createClientFromRequest = globalThis.__patientTelecomMakeClient;',
  );
  const tempPath = join(tmpdir(), `patient-telecom-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(tempPath, transpileTs(source).outputText);
  let handler;
  globalThis.__patientTelecomMakeClient = () => client;
  const env = { OUTBOUND_DELIVERY_RELEASE: 'enabled-v1', SUPER_ADMIN_EMAIL: 'owner@example.com' };
  globalThis.Deno = { serve: (candidate) => { handler = candidate; }, env: { get: (key) => env[key] } };
  globalThis.fetch = async (url, init = {}) => {
    fetchCalls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
    return Response.json(String(url).endsWith('/v2/calls')
      ? { data: { call_control_id: 'cc_1' } }
      : { data: { id: 'provider_msg_1', to: [{ status: 'queued' }] } });
  };
  try {
    await import(`${pathToFileURL(tempPath).href}?v=${Date.now()}`);
  } finally {
    await unlink(tempPath).catch(() => {});
  }
  return handler;
}

const NURSE = {
  id: 'nurse_1', email: 'nurse@example.com', role: 'user', is_active: true,
  work_phone_number: '(215) 555-0100', personal_cell_e164: CELL, full_name: 'Nora Nurse',
};
const post = (name, body) => new Request(`https://app/functions/${name}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

test('sendSms: an assigned clinician texts the chart now from the bound line, stamped with its provenance', async () => {
  const fixture = makeClient(NURSE, { PatientCareTeamAssignment: [ASSIGNMENT] });
  const fetchCalls = [];
  const handler = await loadHandler('sendSms', fixture.client, { fetchCalls });
  const response = await handler(post('sendSms', { to_number: PATIENT_PHONE, body: 'See you at 10', patient_id: 'patient_1' }));
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(fixture.data.SmsMessage.length, 1);
  const row = fixture.data.SmsMessage[0];
  assert.equal(row.from_number, WORK, 'the line is the binding destination, not the typed profile value');
  assert.equal(row.nurse_email, 'nurse@example.com');
  assert.equal(row.patient_id, 'patient_1');
  assert.equal(row.agency_id, AGENCY);
  assert.equal(row.destination_binding_id, 'binding_1');
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].body.from, WORK);
  assert.equal(fetchCalls[0].body.to, PATIENT_PHONE);
  assert.doesNotMatch(JSON.stringify(fixture.data.UserActivity), /See you at 10/, 'the body never reaches the audit row');
});

test('sendSms: without chart access, or across agencies, nothing is linked or sent', async () => {
  let fixture = makeClient(NURSE);
  let fetchCalls = [];
  let handler = await loadHandler('sendSms', fixture.client, { fetchCalls });
  let response = await handler(post('sendSms', { to_number: PATIENT_PHONE, body: 'x', patient_id: 'patient_1' }));
  assert.equal(response.status, 403, 'an unassigned clinician cannot link the chart');
  assert.equal(fixture.data.SmsMessage.length, 0);
  assert.equal(fetchCalls.length, 0);

  // A chart with the same number in another agency is never linked, even for
  // that agency's manager.
  fixture = makeClient(NURSE, {
    AgencyMembership: [membership('nurse_1', 'nurse@example.com', 'manager')],
    Patient: [{ id: 'patient_b', agency_id: 'agency_b', phone: PATIENT_PHONE }],
  });
  fetchCalls = [];
  handler = await loadHandler('sendSms', fixture.client, { fetchCalls });
  response = await handler(post('sendSms', { to_number: PATIENT_PHONE, body: 'x', patient_id: 'patient_b' }));
  assert.equal(response.status, 403);
  assert.equal(fixture.data.SmsMessage.length, 0);
  assert.equal(fetchCalls.length, 0);
});

test('sendSms: membership is decided before the body; unbound lines, foreign lines and missing consent refuse', async () => {
  let fixture = makeClient(NURSE, { AgencyMembership: [] });
  let handler = await loadHandler('sendSms', fixture.client);
  const unread = new Request('https://app/functions/sendSms', { method: 'POST', body: '{"to_number":' });
  let response = await handler(unread);
  assert.equal(response.status, 403, 'a non-member is refused before the (malformed) body is parsed');
  assert.equal((await response.json()).code, 'agency_membership_required');
  assert.deepEqual(fixture.calls.filter(([op, name]) => op === 'filter' && name !== 'AgencyMembership' && name !== 'Agency'), []);

  // Self-editable account_type / agency_id on the profile authorize nothing.
  fixture = makeClient({ ...NURSE, account_type: 'agency_admin', agency_id: AGENCY, is_manager: true }, { AgencyMembership: [] });
  handler = await loadHandler('sendSms', fixture.client);
  assert.equal((await handler(post('sendSms', { to_number: PATIENT_PHONE, body: 'x' }))).status, 403);

  fixture = makeClient({ ...NURSE, work_phone_number: '+12155550999' });
  handler = await loadHandler('sendSms', fixture.client);
  response = await handler(post('sendSms', { to_number: PATIENT_PHONE, body: 'x' }));
  assert.equal(response.status, 503, 'a work number that is not an active agency line cannot send');

  fixture = makeClient(NURSE, {
    TelecomDestinationBinding: [makeBinding({ agency_id: 'agency_b' })],
    SmsConsent: [optIn(makeBinding({ agency_id: 'agency_b' }))],
  });
  handler = await loadHandler('sendSms', fixture.client);
  response = await handler(post('sendSms', { to_number: PATIENT_PHONE, body: 'x' }));
  assert.equal(response.status, 403, 'a work number bound to another agency is refused');

  fixture = makeClient(NURSE, { SmsConsent: [] });
  handler = await loadHandler('sendSms', fixture.client);
  response = await handler(post('sendSms', { to_number: PATIENT_PHONE, body: 'x' }));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).reason, 'consent_required');
  assert.equal(fixture.data.SmsMessage.length, 0);
});

test('sendSms: a member with no work number uses the agency\'s single outbound line', async () => {
  const fixture = makeClient({ ...NURSE, work_phone_number: '' });
  const handler = await loadHandler('sendSms', fixture.client);
  const response = await handler(post('sendSms', { to_number: PATIENT_PHONE, body: 'x' }));
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(fixture.data.SmsMessage[0].from_number, WORK);
  assert.equal(fixture.data.SmsMessage[0].patient_id, null, 'an unassigned chart is not linked by phone');
});

test('startMaskedCall: an assigned clinician calls the chart through the bound work line', async () => {
  const fixture = makeClient(NURSE, { PatientCareTeamAssignment: [ASSIGNMENT] });
  const fetchCalls = [];
  const handler = await loadHandler('startMaskedCall', fixture.client, { fetchCalls });
  const response = await handler(post('startMaskedCall', { patient_id: 'patient_1' }));
  assert.equal(response.status, 200, await response.clone().text());
  const call = fetchCalls.find((entry) => entry.url === 'https://api.telnyx.com/v2/calls');
  assert.ok(call, 'the call is originated');
  assert.equal(call.body.to, CELL, 'the caller\'s own cell rings first');
  assert.equal(call.body.from, WORK, 'the patient sees the bound work line');
  const state = JSON.parse(Buffer.from(call.body.client_state, 'base64').toString('utf8'));
  assert.equal(state.bridge_to, PATIENT_PHONE, 'the patient number comes from the chart, not the request');
  assert.equal(fixture.data.CallLog[0].patient_id, 'patient_1');
});

test('startMaskedCall: no chart access, a foreign chart, an unbound line or no membership places no call', async () => {
  for (const [label, me, seed, body, status] of [
    ['unassigned clinician', NURSE, {}, { patient_id: 'patient_1' }, 403],
    ['number that belongs to an unassigned chart', NURSE, {}, { to_number: PATIENT_PHONE }, 403],
    ['chart in another agency', NURSE, {
      AgencyMembership: [membership('nurse_1', 'nurse@example.com', 'manager')],
      Patient: [{ id: 'patient_b', agency_id: 'agency_b', phone: PATIENT_PHONE }],
    }, { patient_id: 'patient_b' }, 403],
    ['work number not bound', { ...NURSE, work_phone_number: '+12155550999' }, { PatientCareTeamAssignment: [ASSIGNMENT] }, { patient_id: 'patient_1' }, 503],
    ['work number bound to another agency', NURSE, {
      PatientCareTeamAssignment: [ASSIGNMENT],
      TelecomDestinationBinding: [makeBinding({ agency_id: 'agency_b' })],
    }, { patient_id: 'patient_1' }, 403],
    ['no membership', NURSE, { AgencyMembership: [] }, { patient_id: 'patient_1' }, 403],
  ]) {
    const fixture = makeClient(me, seed);
    const fetchCalls = [];
    const handler = await loadHandler('startMaskedCall', fixture.client, { fetchCalls });
    const response = await handler(post('startMaskedCall', body));
    assert.equal(response.status, status, label);
    assert.equal(fetchCalls.length, 0, `${label}: no provider request`);
    assert.equal(fixture.data.CallLog.length, 0, `${label}: no call log`);
  }
});
