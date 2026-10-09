import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transpileTs } from '../../tools-transpile-ts.mjs';

/**
 * What an SMS send records about its outcome, run against each function's real
 * handler with a stateful fake Base44 client and a mocked Telnyx:
 *   - the failure_reason every writer stores leads with the HTTP status and
 *     Telnyx's error code (the redrive policy decides on them);
 *   - an accepted send is stored, and answered, as what Telnyx said (queued);
 *   - a scheduled send carries the provenance sendSms stamps.
 */

const RELEASED = { OUTBOUND_DELIVERY_RELEASE: 'enabled-v1', INTERNAL_FN_SECRET: 'cron-secret', SUPER_ADMIN_EMAIL: 'owner@example.test' };
const LINE = '+12155550100';
const PATIENT_PHONE = '+13125550182';

export async function loadFunction(name, client, env = RELEASED, fetchImpl = null) {
  let source = await readFile(new URL(`../functions/${name}/entry.ts`, import.meta.url), 'utf8');
  source = source.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    'const createClientFromRequest = globalThis.__smsOutcomeClient;',
  );
  const file = join(tmpdir(), `sms_outcome_${name}_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(file, transpileTs(source).outputText);
  let handler;
  globalThis.__smsOutcomeClient = () => client;
  globalThis.Deno = { serve: (candidate) => { handler = candidate; }, env: { get: (key) => env[key] } };
  if (fetchImpl) globalThis.fetch = fetchImpl;
  try {
    await import(pathToFileURL(file).href);
  } finally {
    await unlink(file).catch(() => {});
    delete globalThis.__smsOutcomeClient;
  }
  return handler;
}

export function binding(overrides = {}) {
  const destination = overrides.destination_e164 || LINE;
  const row = {
    id: 'binding_1', binding_key: `telnyx:integration_1:${destination}`, provider: 'telnyx',
    integration_secret_id: 'integration_1', destination_e164: destination, provider_number_id: 'n1',
    phone_number_id: 'p1', agency_id: 'agency_a', messaging_profile_id: 'MP1', sms_inbound_enabled: true,
    sms_outbound_enabled: true, voice_inbound_enabled: false, fax_inbound_enabled: false, status: 'active',
    source: 'manual', created_by_user_id: 'owner', created_by_user_email_normalized: 'owner@example.com',
    created_at: '2026-09-01T00:00:01.000Z', activated_at: '2026-09-01T00:00:01.000Z',
    last_transition_by_user_id: 'owner', last_transition_by_email_normalized: 'owner@example.com',
    last_transition_at: '2026-09-01T00:00:01.000Z', last_transition_reason: 'Reviewed initial binding',
    last_transition_action: 'bind', last_transition_request_id: 'request_1', version: 1, ...overrides,
  };
  row.last_transition_request_key = `${row.binding_key}:${row.last_transition_request_id}`;
  return row;
}

export function optIn(overrides = {}) {
  return {
    id: 'consent_1', consent_key: `telnyx:integration_1:MP1:agency_a:${PATIENT_PHONE}`, provider: 'telnyx',
    integration_secret_id: 'integration_1', messaging_profile_id: 'MP1', agency_id: 'agency_a',
    destination_binding_id: 'binding_1', destination_binding_key: `telnyx:integration_1:${LINE}`,
    destination_e164: LINE, phone_e164: PATIENT_PHONE, consent_status: 'opted_in',
    consent_source: 'manual_opt_in', captured_by: 'nurse@example.test', captured_at: '2026-09-02T00:00:00.000Z',
    provider_event_id: null, provider_message_id: null, provider_event_occurred_at: null, ...overrides,
  };
}

/** A stateful fake: equality filters, `$in`, the two sorts the code uses, and recorded writes. */
export function fixture(seed = {}) {
  const data = {
    IntegrationSecret: [{ id: 'integration_1', provider: 'telnyx', api_key: 'KEYtest', messaging_profile_id: 'MP1', is_active: true }],
    TelecomDestinationBinding: [binding()],
    AgencyMembership: [{ id: 'm1', agency_id: 'agency_a', user_id: 'u1', user_email_normalized: 'nurse@example.test', status: 'active' }],
    Agency: [{ id: 'agency_a', agency_name: 'Agency A', status: 'active' }],
    AgencySettings: [{ tcpa_quiet_hours_enabled: false }],
    User: [],
    Patient: [],
    SmsConsent: [optIn()],
    SmsMessage: [],
    ScheduledSms: [],
    UserActivity: [],
    Notification: [],
    ...seed,
  };
  const writes = [];
  let sequence = 0;
  const matches = (row, query = {}) => Object.entries(query).every(([key, value]) => (
    value && typeof value === 'object' && Array.isArray(value.$in) ? value.$in.includes(row?.[key]) : row?.[key] === value
  ));
  const sorted = (rows, sort) => {
    if (sort === '-captured_at') return [...rows].sort((a, b) => Date.parse(b.captured_at) - Date.parse(a.captured_at));
    if (sort === '-created_date') return [...rows].reverse();
    return rows;
  };
  const entities = new Proxy({}, {
    get: (_target, nameValue) => {
      const name = String(nameValue);
      return {
        filter: async (query = {}, sort, limit = 5000) => sorted((data[name] || []).filter((row) => matches(row, query)), sort).slice(0, limit),
        list: async () => data[name] || [],
        create: async (row) => {
          sequence += 1;
          const created = { id: `${name}_${sequence}`, created_date: new Date().toISOString(), ...row };
          (data[name] ||= []).push(created);
          writes.push({ name, op: 'create', row: created });
          return created;
        },
        update: async (id, patch) => {
          const row = (data[name] || []).find((candidate) => candidate.id === id);
          if (row) Object.assign(row, patch);
          writes.push({ name, op: 'update', id, patch });
          return { id, ...patch };
        },
      };
    },
  });
  return { data, writes, client: { auth: { me: async () => null }, entities, asServiceRole: { entities } } };
}

/** The protected owner, who sendSms admits without a membership. */
export const owner = { id: 'owner_1', email: 'owner@example.test', role: 'admin', full_name: 'Owner', work_phone_number: LINE };

export function telnyxAnswer(status, json) {
  const sends = [];
  const impl = async (url, init = {}) => {
    sends.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
    return Response.json(json, { status, headers: { 'retry-after': '0' } });
  };
  return { sends, impl };
}

const sendSmsRequest = (body) => new Request('https://app/functions/sendSms', { method: 'POST', body: JSON.stringify(body) });

test('sendSms stores a Telnyx refusal with its HTTP status and Telnyx code first', async () => {
  const state = fixture();
  state.client.auth.me = async () => owner;
  const telnyx = telnyxAnswer(429, { errors: [{ code: '10011', title: 'Too many requests', detail: 'Too many requests' }] });
  const handler = await loadFunction('sendSms', state.client, RELEASED, telnyx.impl);
  const response = await handler(sendSmsRequest({ to_number: PATIENT_PHONE, body: 'Visit at 10' }));
  assert.equal(response.status, 429);
  // 429 proves Telnyx did not process it, so the in-request retry tried again.
  assert.equal(telnyx.sends.length, 3);
  const row = state.data.SmsMessage[0];
  assert.equal(row.status, 'failed');
  assert.equal(row.failure_reason, 'Telnyx API error: HTTP 429, code 10011: Too many requests');
});

test('sendSms sends an outcome-unknown 5xx once and records it as such', async () => {
  const state = fixture();
  state.client.auth.me = async () => owner;
  const telnyx = telnyxAnswer(502, { errors: [{ code: '10007', detail: 'Bad gateway' }] });
  const handler = await loadFunction('sendSms', state.client, RELEASED, telnyx.impl);
  await handler(sendSmsRequest({ to_number: PATIENT_PHONE, body: 'Visit at 10' }));
  assert.equal(telnyx.sends.length, 1, 'a 502 can follow an accepted message; never retried');
  assert.equal(state.data.SmsMessage[0].failure_reason, 'Telnyx API error: HTTP 502, code 10007: Bad gateway');
});

test('a test text writes no row, so it asks Telnyx for no delivery receipt', async () => {
  // A receipt for a rowless send 404s at handleTelnyxStatusWebhook and Telnyx
  // redelivers it; use_profile_webhooks: false with no webhook_url asks for none.
  const state = fixture();
  state.client.auth.me = async () => owner;
  const telnyx = telnyxAnswer(200, { data: { id: 'prov_test', to: [{ status: 'queued' }] } });
  const handler = await loadFunction('sendTestSms', state.client, RELEASED, telnyx.impl);
  const response = await handler(new Request('https://app/functions/sendTestSms', {
    method: 'POST', body: JSON.stringify({ to_number: PATIENT_PHONE }),
  }));
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(telnyx.sends.length, 1);
  assert.equal(telnyx.sends[0].body.use_profile_webhooks, false);
  assert.equal(Object.hasOwn(telnyx.sends[0].body, 'webhook_url'), false);
  assert.equal(state.data.SmsMessage.length, 0);
});

test('sendSms answers with the status it stored, not "sent"', async () => {
  const state = fixture();
  state.client.auth.me = async () => owner;
  const telnyx = telnyxAnswer(200, { data: { id: 'prov_1', to: [{ status: 'queued' }] } });
  const handler = await loadFunction('sendSms', state.client, RELEASED, telnyx.impl);
  const response = await handler(sendSmsRequest({ to_number: PATIENT_PHONE, body: 'Visit at 10' }));
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(state.data.SmsMessage[0].status, 'queued');
  assert.equal(json.status, 'queued');
  assert.equal(json.provider_message_id, 'prov_1');
});

const cron = (name) => new Request(`https://app/functions/${name}`, {
  method: 'POST', headers: { 'x-internal-secret': 'cron-secret' }, body: '{}',
});

function scheduledFixture(seed = {}) {
  return fixture({
    User: [{ id: 'u1', email: 'nurse@example.test', agency_name: 'Agency A' }],
    ScheduledSms: [{
      id: 'sched_1', status: 'pending', send_at: new Date(Date.now() - 60_000).toISOString(),
      nurse_email: 'nurse@example.test', from_number: LINE, to_number: PATIENT_PHONE, body: 'Your visit is at 10',
      thread_id: `${LINE}|${PATIENT_PHONE}`, patient_id: null, attempts: 0,
    }],
    ...seed,
  });
}

test('a scheduled send is recorded with the provenance and status sendSms records', async () => {
  const state = scheduledFixture();
  const telnyx = telnyxAnswer(200, { data: { id: 'prov_sched', to: [{ status: 'queued' }] } });
  const handler = await loadFunction('dispatchScheduledSms', state.client, RELEASED, telnyx.impl);
  const response = await handler(cron('dispatchScheduledSms'));
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(telnyx.sends.length, 1);
  const row = state.data.SmsMessage[0];
  assert.equal(row.agency_id, 'agency_a', 'stamped with the line agency, as sendSms stamps it');
  assert.equal(row.destination_binding_id, 'binding_1');
  assert.equal(row.status, 'queued', 'accepted is not sent: Telnyx answered queued');
  assert.equal(row.sent_by, row.nurse_email, 'redriveFailedSms requires sender and owner to agree');
  assert.equal(state.data.ScheduledSms[0].status, 'sent');
  assert.equal(state.data.ScheduledSms[0].sms_message_id, row.id);
});

test('a scheduled send Telnyx refuses records the HTTP status and Telnyx code', async () => {
  const state = scheduledFixture();
  const telnyx = telnyxAnswer(400, { errors: [{ code: '40310', detail: 'Invalid to number' }] });
  const handler = await loadFunction('dispatchScheduledSms', state.client, RELEASED, telnyx.impl);
  await handler(cron('dispatchScheduledSms'));
  assert.equal(state.data.ScheduledSms[0].status, 'failed');
  assert.equal(state.data.ScheduledSms[0].failure_reason, 'Telnyx API error: HTTP 400, code 40310: Invalid to number');
});

test('the scheduled monthly cap counts the line agency as sendSms does, not a profile agency_name', async () => {
  const thisMonth = new Date().toISOString();
  // Someone whose self-editable agency_name says "Agency A" but who holds no
  // membership there, texting for another agency: the old cohort counted them.
  const stranger = { id: 'u2', email: 'stranger@example.test', agency_name: 'Agency A' };
  const strangersText = {
    id: 'other_1', direction: 'outbound', nurse_email: 'stranger@example.test', sent_by: 'stranger@example.test',
    agency_id: 'agency_b', created_date: thisMonth,
  };
  const capped = { AgencySettings: [{ tcpa_quiet_hours_enabled: false, monthly_sms_cap: 1 }] };
  let state = scheduledFixture({
    ...capped,
    User: [{ id: 'u1', email: 'nurse@example.test', agency_name: 'Agency A' }, stranger],
    SmsMessage: [strangersText],
  });
  let telnyx = telnyxAnswer(200, { data: { id: 'prov_sched', to: [{ status: 'queued' }] } });
  let handler = await loadFunction('dispatchScheduledSms', state.client, RELEASED, telnyx.impl);
  await handler(cron('dispatchScheduledSms'));
  assert.equal(telnyx.sends.length, 1, "another agency's text does not count against this agency's cap");

  // A text stamped with this agency counts, whoever sent it.
  state = scheduledFixture({ ...capped, SmsMessage: [{ ...strangersText, agency_id: 'agency_a' }] });
  telnyx = telnyxAnswer(200, { data: { id: 'prov_sched', to: [{ status: 'queued' }] } });
  handler = await loadFunction('dispatchScheduledSms', state.client, RELEASED, telnyx.impl);
  await handler(cron('dispatchScheduledSms'));
  assert.equal(telnyx.sends.length, 0, 'cap reached for the line agency');
  assert.equal(state.data.ScheduledSms[0].status, 'pending', 'left for a later run, not failed');
});

// ---- Telnyx error 40300 ("Blocked due to STOP message") feeds the ledger ----

const OPT_OUT_REFUSAL = { errors: [{ code: '40300', title: 'Blocked due to STOP message', detail: 'Blocked due to STOP message' }] };

function assertProviderOptOut(row) {
  assert.deepEqual({
    consent_key: row.consent_key, agency_id: row.agency_id, integration_secret_id: row.integration_secret_id,
    messaging_profile_id: row.messaging_profile_id, destination_binding_id: row.destination_binding_id,
    destination_binding_key: row.destination_binding_key, destination_e164: row.destination_e164,
    phone_e164: row.phone_e164, consent_status: row.consent_status, consent_source: row.consent_source,
    captured_by: row.captured_by, patient_id: row.patient_id,
  }, {
    consent_key: `telnyx:integration_1:MP1:agency_a:${PATIENT_PHONE}`, agency_id: 'agency_a',
    integration_secret_id: 'integration_1', messaging_profile_id: 'MP1', destination_binding_id: 'binding_1',
    destination_binding_key: `telnyx:integration_1:${LINE}`, destination_e164: LINE, phone_e164: PATIENT_PHONE,
    consent_status: 'opted_out', consent_source: 'provider_opt_out', captured_by: null, patient_id: null,
  });
}

test('a send Telnyx blocks for a STOP records the opt-out, and the next send never reaches Telnyx', async () => {
  const state = fixture();
  state.client.auth.me = async () => owner;
  const telnyx = telnyxAnswer(400, OPT_OUT_REFUSAL);
  const handler = await loadFunction('sendSms', state.client, RELEASED, telnyx.impl);
  const first = await handler(sendSmsRequest({ to_number: PATIENT_PHONE, body: 'Visit at 10' }));
  assert.equal(first.status, 400);
  assert.equal((await first.json()).reason, 'provider_opt_out');
  assert.equal(telnyx.sends.length, 1);
  const recorded = state.data.SmsConsent.filter((row) => row.consent_source === 'provider_opt_out');
  assert.equal(recorded.length, 1);
  assertProviderOptOut(recorded[0]);
  assert.equal(recorded[0].provider_event_id, null, 'a refused request carries no provider event');
  assert.equal(state.data.SmsMessage[0].failure_reason, 'Telnyx API error: HTTP 400, code 40300: Blocked due to STOP message');

  const second = await handler(sendSmsRequest({ to_number: PATIENT_PHONE, body: 'Visit at 11' }));
  assert.equal(second.status, 403, 'the ledger now refuses before Telnyx does');
  assert.equal(telnyx.sends.length, 1);
  assert.equal(state.data.SmsConsent.filter((row) => row.consent_source === 'provider_opt_out').length, 1);
});

test('only Telnyx code 40300 records an opt-out; other refusals leave consent alone', async () => {
  const state = fixture();
  state.client.auth.me = async () => owner;
  const telnyx = telnyxAnswer(400, { errors: [{ code: '40310', detail: 'Blocked: invalid number' }] });
  const handler = await loadFunction('sendSms', state.client, RELEASED, telnyx.impl);
  await handler(sendSmsRequest({ to_number: PATIENT_PHONE, body: 'Visit at 10' }));
  assert.equal(state.data.SmsConsent.length, 1, 'nothing appended');
});

test('a provider opt-out is lifted only by a provider START, never by a manual opt-in', async () => {
  const inline = await (async () => {
    const source = (await readFile(new URL('../functions/sendSms/entry.ts', import.meta.url), 'utf8'))
      .replace(/import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/, 'const createClientFromRequest = () => ({});');
    const file = join(tmpdir(), `sms_ledger_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
    await writeFile(file, `${transpileTs(source).outputText}\nexport { loadLatestScopedSmsConsent, resolveActiveTelnyxSmsBinding };\n`);
    globalThis.Deno = { serve() {}, env: { get: () => undefined } };
    try { return await import(pathToFileURL(file).href); } finally { await unlink(file).catch(() => {}); }
  })();
  const read = async (consents) => {
    const state = fixture({ SmsConsent: consents });
    const authority = await inline.resolveActiveTelnyxSmsBinding(state.client, {
      integrationSecretId: 'integration_1', integrationProvider: 'telnyx', integrationIsActive: true,
      messagingProfileId: 'MP1', destinationE164: LINE, requireOutbound: true,
    });
    assert.equal(authority.ok, true);
    return inline.loadLatestScopedSmsConsent(state.client, authority, PATIENT_PHONE);
  };
  const blocked = optIn({
    id: 'c2', consent_status: 'opted_out', consent_source: 'provider_opt_out', captured_by: null,
    captured_at: '2026-09-03T00:00:00.000Z', notes: 'x',
  });
  const blockedByReceipt = {
    ...blocked, provider_event_id: 'event_1', provider_message_id: 'message_1',
    provider_event_occurred_at: blocked.captured_at,
  };
  for (const row of [blocked, blockedByReceipt]) {
    const result = await read([optIn(), row]);
    assert.equal(result.ok, true);
    assert.equal(result.effectiveStatus, 'opted_out');
    assert.equal(result.keywordStopActive, true);
  }
  const manualLater = optIn({ id: 'c3', captured_at: '2026-09-04T00:00:00.000Z' });
  assert.equal((await read([optIn(), blocked, manualLater])).effectiveStatus, 'opted_out', 'a manual opt-in cannot override it');
  const startLater = optIn({
    id: 'c4', consent_status: 'opted_in', consent_source: 'keyword_start', captured_by: null,
    captured_at: '2026-09-05T00:00:00.000Z', provider_event_id: 'event_start', provider_message_id: 'message_start',
    provider_event_occurred_at: '2026-09-05T00:00:00.000Z',
  });
  assert.equal((await read([optIn(), blocked, startLater])).effectiveStatus, 'opted_in', 'the recipient texting START lifts it');

  // A malformed provider row is an integrity failure, never an authorization.
  for (const malformed of [
    { ...blocked, consent_status: 'opted_in' },
    { ...blocked, captured_by: 'nurse@example.test' },
    { ...blocked, provider_event_id: 'event_1' },
    { ...blockedByReceipt, provider_event_occurred_at: '2026-09-03T00:00:01.000Z' },
  ]) {
    const result = await read([optIn(), malformed]);
    assert.equal(result.ok, false, JSON.stringify(malformed).slice(0, 120));
  }
});

test('a scheduled send and a redrive Telnyx blocks for a STOP record the opt-out too', async () => {
  let state = scheduledFixture();
  let telnyx = telnyxAnswer(400, OPT_OUT_REFUSAL);
  let handler = await loadFunction('dispatchScheduledSms', state.client, RELEASED, telnyx.impl);
  await handler(cron('dispatchScheduledSms'));
  assert.equal(state.data.ScheduledSms[0].status, 'failed');
  let recorded = state.data.SmsConsent.filter((row) => row.consent_source === 'provider_opt_out');
  assert.equal(recorded.length, 1);
  assertProviderOptOut(recorded[0]);

  state = fixture({
    SmsMessage: [{
      id: 'sms_1', direction: 'outbound', status: 'failed', failure_reason: 'Telnyx API error: HTTP 429, code 10011',
      created_date: new Date(Date.now() - 10 * 60_000).toISOString(), retry_count: 0,
      from_number: LINE, to_number: PATIENT_PHONE, body: 'Visit at 10',
      nurse_email: 'nurse@example.test', sent_by: 'nurse@example.test',
      agency_id: 'agency_a', destination_binding_id: 'binding_1',
    }],
  });
  telnyx = telnyxAnswer(400, OPT_OUT_REFUSAL);
  handler = await loadFunction('redriveFailedSms', state.client, RELEASED, telnyx.impl);
  await handler(cron('redriveFailedSms'));
  assert.equal(telnyx.sends.length, 1);
  recorded = state.data.SmsConsent.filter((row) => row.consent_source === 'provider_opt_out');
  assert.equal(recorded.length, 1);
  assertProviderOptOut(recorded[0]);
  assert.match(state.data.SmsMessage[0].failure_reason, /^Telnyx API error: HTTP 400, code 40300/);
});
