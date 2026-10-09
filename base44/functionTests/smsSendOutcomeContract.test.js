import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transpileTs } from '../../tools-transpile-ts.mjs';
import { copyRows, createStamp, stampSmsRows, updateManyRows } from './smsStoreFake.js';

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

/**
 * A stateful fake: equality filters, `$in`, the two sorts the code uses, and
 * recorded writes. SmsMessage behaves as the hosted store does
 * (smsStoreFake.js): reads are copies, every write moves updated_date, and
 * updateMany applies only where its predicate still matches.
 */
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
  const stamp = createStamp();
  stampSmsRows(data, stamp);
  const sms = (name) => name === 'SmsMessage';
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
        filter: async (query = {}, sort, limit = 5000) => {
          const rows = sorted((data[name] || []).filter((row) => matches(row, query)), sort).slice(0, limit);
          return sms(name) ? copyRows(rows) : rows;
        },
        list: async () => data[name] || [],
        create: async (row) => {
          sequence += 1;
          const created = { id: `${name}_${sequence}`, created_date: new Date().toISOString(), ...row };
          if (sms(name)) created.updated_date = stamp();
          (data[name] ||= []).push(created);
          writes.push({ name, op: 'create', row: created });
          return created;
        },
        update: async (id, patch) => {
          const row = (data[name] || []).find((candidate) => candidate.id === id);
          if (row) Object.assign(row, patch, sms(name) ? { updated_date: stamp() } : {});
          writes.push({ name, op: 'update', id, patch });
          return { id, ...patch };
        },
        updateMany: async (query, operations) => {
          writes.push({ name, op: 'updateMany', query, operations });
          return updateManyRows(data[name], query, operations, stamp);
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

// ---- a manual Resend retires the failed original from the redrive ----

function failedOriginal(overrides = {}) {
  return {
    id: 'sms_orig', direction: 'outbound', status: 'failed',
    failure_reason: 'Telnyx API error: HTTP 429, code 10011: Too many requests',
    created_date: new Date(Date.now() - 10 * 60_000).toISOString(), retry_count: 0,
    from_number: LINE, to_number: PATIENT_PHONE, body: 'Visit at 10',
    nurse_email: owner.email, sent_by: owner.email,
    agency_id: 'agency_a', destination_binding_id: 'binding_1', client_message_id: 'client_orig',
    ...overrides,
  };
}

test('a manual Resend supersedes the failed original, and the redrive then leaves it alone', async () => {
  // The owner row lets the redrive authorize the sender, so the ONLY thing that
  // can stop it re-sending the original is the supersede.
  const state = fixture({ SmsMessage: [failedOriginal()], User: [owner] });
  state.client.auth.me = async () => owner;
  const telnyx = telnyxAnswer(200, { data: { id: 'prov_resend', to: [{ status: 'queued' }] } });
  const send = await loadFunction('sendSms', state.client, RELEASED, telnyx.impl);
  const response = await send(sendSmsRequest({ to_number: PATIENT_PHONE, body: 'Visit at 10', resend_of: 'sms_orig' }));
  assert.equal(response.status, 200, await response.clone().text());
  const [original, resent] = state.data.SmsMessage;
  assert.equal(resent.resend_of, 'sms_orig');
  assert.equal(original.superseded_by, resent.client_message_id);
  assert.ok(original.superseded_at);
  assert.equal(telnyx.sends.length, 1);

  // The original still reads failed with a redrivable 429, yet it is not re-sent.
  const redrive = await loadFunction('redriveFailedSms', state.client, RELEASED, telnyx.impl);
  await redrive(cron('redriveFailedSms'));
  assert.equal(telnyx.sends.length, 1, 'the patient is texted once');

  // Control: without the supersede the same row IS redriven, so the assertion
  // above is about the supersede and nothing else.
  const control = fixture({ SmsMessage: [failedOriginal()], User: [owner] });
  const controlTelnyx = telnyxAnswer(200, { data: { id: 'prov_redrive', to: [{ status: 'queued' }] } });
  const controlRedrive = await loadFunction('redriveFailedSms', control.client, RELEASED, controlTelnyx.impl);
  await controlRedrive(cron('redriveFailedSms'));
  assert.equal(controlTelnyx.sends.length, 1);
});

test('a Resend is refused for a row the caller did not send, a changed text, or one already resent or claimed', async () => {
  for (const [label, original, body, status] of [
    ["another sender's text", failedOriginal({ sent_by: 'other@example.test', nurse_email: 'other@example.test' }), 'Visit at 10', 404],
    ['a text to another number', failedOriginal({ to_number: '+13125550199' }), 'Visit at 10', 404],
    ["another agency's text", failedOriginal({ agency_id: 'agency_b' }), 'Visit at 10', 404],
    ['an inbound text', failedOriginal({ direction: 'inbound' }), 'Visit at 10', 404],
    ['a changed body', failedOriginal(), 'Visit at 11', 400],
    ['a text already resent', failedOriginal({ superseded_by: 'client_earlier' }), 'Visit at 10', 409],
    ['a text the redrive has claimed', failedOriginal({ redrive_claimed_by: 'run_1' }), 'Visit at 10', 409],
    ['a text that is no longer failed', failedOriginal({ status: 'sent' }), 'Visit at 10', 409],
  ]) {
    const state = fixture({ SmsMessage: [original] });
    state.client.auth.me = async () => owner;
    const telnyx = telnyxAnswer(200, { data: { id: 'prov_resend', to: [{ status: 'queued' }] } });
    const send = await loadFunction('sendSms', state.client, RELEASED, telnyx.impl);
    const response = await send(sendSmsRequest({ to_number: PATIENT_PHONE, body, resend_of: 'sms_orig' }));
    assert.equal(response.status, status, label);
    assert.equal(telnyx.sends.length, 0, `${label}: nothing is sent`);
    assert.equal(state.data.SmsMessage.length, 1, `${label}: no new row`);
  }
});

test('a redrive that listed the row before a Resend superseded it cannot claim it and sends nothing', async () => {
  const state = fixture({ SmsMessage: [failedOriginal({ superseded_by: 'client_resend', nurse_email: 'nurse@example.test', sent_by: 'nurse@example.test' })] });
  // The cron's listing predates the Resend: it does not see superseded_by.
  const entities = state.client.asServiceRole.entities;
  const stale = new Proxy({}, {
    get: (_target, name) => (name === 'SmsMessage'
      ? {
        ...entities.SmsMessage,
        filter: async (query, sort, limit) => {
          const rows = await entities.SmsMessage.filter(query, sort, limit);
          return query.status === 'failed' ? rows.map(({ superseded_by, ...row }) => row) : rows;
        },
      }
      : entities[name]),
  });
  const telnyx = telnyxAnswer(200, { data: { id: 'prov_2', to: [{ status: 'queued' }] } });
  const redrive = await loadFunction('redriveFailedSms', { auth: { me: async () => null }, entities: stale, asServiceRole: { entities: stale } }, RELEASED, telnyx.impl);
  const response = await redrive(cron('redriveFailedSms'));
  assert.equal(response.status, 200);
  assert.equal(telnyx.sends.length, 0);
  // The claim is a compare-and-set over the row as listed (superseded_by
  // absent); the row now carries the Resend's mark, so the claim never lands.
  const [row] = state.data.SmsMessage;
  assert.equal(row.redrive_claimed_by, undefined, 'the row was never claimed');
  assert.equal(row.retry_count, 0, 'no redrive attempt was counted');
  assert.equal(row.superseded_by, 'client_resend', "the Resend's mark stands");
});

// ---- overlapping writers: every claim on a failed text is a compare-and-set ----

/**
 * A second client over the SAME store, for a run that overlaps another: the
 * SmsMessage methods `override(real)` returns replace the live ones (a stale
 * read, a failing write); every other entity is the live store.
 */
function runClient(state, auth, override = () => ({})) {
  const entities = state.client.asServiceRole.entities;
  const view = new Proxy({}, {
    get: (_target, name) => {
      const real = entities[name];
      return name === 'SmsMessage' ? { ...real, ...override(real) } : real;
    },
  });
  return { auth, entities: view, asServiceRole: { entities: view } };
}

/** A Telnyx whose FIRST send is held open until released, so a run can be caught mid-send. */
function heldTelnyx(status, json) {
  const sends = [];
  let started;
  const firstSendStarted = new Promise((resolve) => { started = resolve; });
  let release;
  const released = new Promise((resolve) => { release = resolve; });
  const impl = async (url, init = {}) => {
    sends.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
    if (sends.length === 1) {
      started();
      await released;
    }
    return Response.json(json, { status, headers: { 'retry-after': '0' } });
  };
  return { sends, impl, firstSendStarted, release };
}

const ownerAuth = { me: async () => owner };
const cronAuth = { me: async () => null };
const accepted = { data: { id: 'prov_once', to: [{ status: 'queued' }] } };
const isRedriveListing = (query) => query?.status === 'failed' && query?.direction === 'outbound';
const isOriginalRead = (query) => query?.id === 'sms_orig';

/** The first read `matches` is served by `serve`; every later read is live. */
function firstRead(matches, serve) {
  let served = false;
  return (real) => ({
    filter: async (query, sort, limit) => {
      if (served || !matches(query)) return real.filter(query, sort, limit);
      served = true;
      return serve(() => real.filter(query, sort, limit));
    },
  });
}

test('two overlapping redrive runs send a failed text once: the claim is a compare-and-set', async () => {
  // Run B listed the row before run A claimed it, and claims it while A is
  // mid-send. Update-then-read-back let B overwrite A's token after A had read
  // back its own, and both texted the patient.
  const state = fixture({ SmsMessage: [failedOriginal()], User: [owner] });
  const telnyx = heldTelnyx(200, accepted);
  let listed;
  const clientA = runClient(state, cronAuth, firstRead(isRedriveListing, async (live) => {
    listed = await live();
    return structuredClone(listed);
  }));
  const clientB = runClient(state, cronAuth, firstRead(isRedriveListing, async () => {
    await telnyx.firstSendStarted;
    return structuredClone(listed);
  }));
  const redriveA = await loadFunction('redriveFailedSms', clientA, RELEASED, telnyx.impl);
  const redriveB = await loadFunction('redriveFailedSms', clientB, RELEASED, telnyx.impl);
  const pendingA = redriveA(cron('redriveFailedSms'));
  const answerB = await (await redriveB(cron('redriveFailedSms'))).json();
  telnyx.release();
  const answerA = await (await pendingA).json();

  assert.equal(telnyx.sends.length, 1, 'the patient is texted once');
  assert.equal(answerA.redriven, 1);
  assert.equal(answerB.redriven, 0);
  assert.equal(answerB.skipped, 1, 'the run whose claim lost skips the row');
  const [row] = state.data.SmsMessage;
  assert.equal(row.retry_count, 1, 'one attempt is counted');
  assert.equal(row.status, 'queued');
  assert.equal(row.redrive_claimed_by, null, 'the winner released its claim');
});

test('two overlapping Resends of one failed text send it once', async () => {
  // Resend B read the original before Resend A retired it, and tries to retire
  // it while A is mid-send: the old write-then-read-back let B overwrite A's
  // mark, read back its own, and text the patient a second time.
  const state = fixture({ SmsMessage: [failedOriginal()] });
  const telnyx = heldTelnyx(200, accepted);
  let seen;
  const clientA = runClient(state, ownerAuth, firstRead(isOriginalRead, async (live) => {
    seen = await live();
    return structuredClone(seen);
  }));
  const clientB = runClient(state, ownerAuth, firstRead(isOriginalRead, async () => {
    await telnyx.firstSendStarted;
    return structuredClone(seen);
  }));
  const sendA = await loadFunction('sendSms', clientA, RELEASED, telnyx.impl);
  const sendB = await loadFunction('sendSms', clientB, RELEASED, telnyx.impl);
  const resend = () => sendSmsRequest({ to_number: PATIENT_PHONE, body: 'Visit at 10', resend_of: 'sms_orig' });
  const pendingA = sendA(resend());
  const responseB = await sendB(resend());
  telnyx.release();
  const responseA = await pendingA;

  assert.equal(responseA.status, 200, await responseA.clone().text());
  assert.equal(responseB.status, 409, await responseB.clone().text());
  assert.equal((await responseB.json()).reason, 'resend_already_superseded', 'B re-read the row and saw it resent');
  assert.equal(telnyx.sends.length, 1, 'the patient is texted once');
  assert.equal(state.data.SmsMessage.length, 2, 'one replacement row');
  const [original, replacement] = state.data.SmsMessage;
  assert.equal(original.superseded_by, replacement.client_message_id, "the mark names A's replacement");
});

test('a Resend and a redrive racing for one failed text: only one of them sends', async () => {
  // The Resend read the row before the redrive claimed it, then tries to retire
  // it while the redrive is mid-send: its compare-and-set no longer matches.
  let state = fixture({ SmsMessage: [failedOriginal()], User: [owner] });
  let telnyx = heldTelnyx(200, accepted);
  const before = structuredClone(state.data.SmsMessage);
  const resendClient = runClient(state, ownerAuth, firstRead(isOriginalRead, async () => {
    await telnyx.firstSendStarted;
    return structuredClone(before);
  }));
  const redrive = await loadFunction('redriveFailedSms', state.client, RELEASED, telnyx.impl);
  const send = await loadFunction('sendSms', resendClient, RELEASED, telnyx.impl);
  const pendingRedrive = redrive(cron('redriveFailedSms'));
  const resent = await send(sendSmsRequest({ to_number: PATIENT_PHONE, body: 'Visit at 10', resend_of: 'sms_orig' }));
  telnyx.release();
  assert.equal((await (await pendingRedrive).json()).redriven, 1);
  assert.equal(resent.status, 409, await resent.clone().text());
  assert.equal(telnyx.sends.length, 1, 'only the redrive texted the patient');
  assert.equal(state.data.SmsMessage.length, 1, 'the refused Resend recorded nothing');
  assert.equal(state.data.SmsMessage[0].superseded_by ?? null, null, 'the original is not retired');

  // The other way round: the redrive listed the row before the Resend retired
  // it, and tries to claim it while the Resend is mid-send.
  state = fixture({ SmsMessage: [failedOriginal()], User: [owner] });
  telnyx = heldTelnyx(200, accepted);
  const listed = structuredClone(state.data.SmsMessage);
  const redriveClient = runClient(state, cronAuth, firstRead(isRedriveListing, async () => {
    await telnyx.firstSendStarted;
    return structuredClone(listed);
  }));
  const lateRedrive = await loadFunction('redriveFailedSms', redriveClient, RELEASED, telnyx.impl);
  const resendFirst = await loadFunction('sendSms', runClient(state, ownerAuth), RELEASED, telnyx.impl);
  const pendingResend = resendFirst(sendSmsRequest({ to_number: PATIENT_PHONE, body: 'Visit at 10', resend_of: 'sms_orig' }));
  const redriveAnswer = await (await lateRedrive(cron('redriveFailedSms'))).json();
  telnyx.release();
  assert.equal((await pendingResend).status, 200);
  assert.equal(redriveAnswer.redriven, 0);
  assert.equal(telnyx.sends.length, 1, 'only the Resend texted the patient');
  assert.equal(state.data.SmsMessage[0].redrive_claimed_by, undefined, 'the retired row was never claimed');
});

test('a Resend whose replacement row cannot be recorded restores the original, which the redrive can still send', async () => {
  // The reservation was taken and nothing reached Telnyx. Left in place it
  // retired the original for good, under a mark naming no row: the redrive
  // skipped it and the thread offered no Resend.
  for (const [label, create] of [
    ['a create that fails', async () => { throw new Error('Storage unavailable'); }],
    ['a create that answers without an id', async () => ({})],
  ]) {
    const state = fixture({ SmsMessage: [failedOriginal()], User: [owner] });
    const telnyx = telnyxAnswer(200, accepted);
    const send = await loadFunction('sendSms', runClient(state, ownerAuth, () => ({ create })), RELEASED, telnyx.impl);
    const response = await send(sendSmsRequest({ to_number: PATIENT_PHONE, body: 'Visit at 10', resend_of: 'sms_orig' }));
    assert.equal(response.status, 503, label);
    assert.equal((await response.json()).reason, 'sms_record_unavailable', label);
    assert.equal(telnyx.sends.length, 0, `${label}: nothing was sent`);
    const [original] = state.data.SmsMessage;
    assert.equal(original.superseded_by, null, `${label}: the reservation is undone`);
    assert.equal(original.superseded_at, null, label);

    const redrive = await loadFunction('redriveFailedSms', state.client, RELEASED, telnyx.impl);
    await redrive(cron('redriveFailedSms'));
    assert.equal(telnyx.sends.length, 1, `${label}: the restored original is redriven`);
  }
});

test('a reservation write whose outcome is unknown is undone, and only that reservation', async () => {
  // updateMany landed and then the answer was lost: the Resend reports itself
  // unavailable and clears exactly its own mark, so the original is not retired.
  const state = fixture({ SmsMessage: [failedOriginal()], User: [owner] });
  const telnyx = telnyxAnswer(200, accepted);
  let lost = false;
  const send = await loadFunction('sendSms', runClient(state, ownerAuth, (real) => ({
    updateMany: async (query, operations) => {
      const answer = await real.updateMany(query, operations);
      if (!lost && operations?.$set?.superseded_by) {
        lost = true;
        throw new Error('Gateway timeout');
      }
      return answer;
    },
  })), RELEASED, telnyx.impl);
  const response = await send(sendSmsRequest({ to_number: PATIENT_PHONE, body: 'Visit at 10', resend_of: 'sms_orig' }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, 'resend_unavailable');
  assert.equal(telnyx.sends.length, 0);
  assert.equal(state.data.SmsMessage.length, 1, 'no replacement row');
  assert.equal(state.data.SmsMessage[0].superseded_by, null, 'the landed reservation was released');

  // A release names its own token: when it was ANOTHER Resend's reservation
  // that landed while this one's answer was lost, that mark is never cleared.
  const raced = fixture({ SmsMessage: [failedOriginal()] });
  const lostRace = await loadFunction('sendSms', runClient(raced, ownerAuth, (real) => ({
    updateMany: async (query, operations) => {
      if (operations?.$set?.superseded_by) {
        Object.assign(raced.data.SmsMessage[0], { superseded_by: 'client_newer', superseded_at: new Date().toISOString() });
        throw new Error('Gateway timeout');
      }
      return real.updateMany(query, operations);
    },
  })), RELEASED, telnyx.impl);
  const refused = await lostRace(sendSmsRequest({ to_number: PATIENT_PHONE, body: 'Visit at 10', resend_of: 'sms_orig' }));
  assert.equal(refused.status, 503);
  assert.equal(raced.data.SmsMessage[0].superseded_by, 'client_newer', "the other Resend's mark stands");
  assert.equal(telnyx.sends.length, 0);
});

test('once the replacement exists the original stays retired, even when Telnyx\'s answer is lost', async () => {
  // A send that timed out may have been accepted: undoing the reservation here
  // would let the redrive text the patient a second time.
  const state = fixture({ SmsMessage: [failedOriginal()], User: [owner] });
  state.client.auth.me = async () => owner;
  const attempts = [];
  const send = await loadFunction('sendSms', state.client, RELEASED, async (url) => {
    attempts.push(String(url));
    throw new DOMException('The operation was aborted.', 'AbortError');
  });
  const response = await send(sendSmsRequest({ to_number: PATIENT_PHONE, body: 'Visit at 10', resend_of: 'sms_orig' }));
  assert.equal(response.status, 504);
  assert.equal(attempts.length, 1, 'a timeout is never retried');
  const [original, replacement] = state.data.SmsMessage;
  assert.equal(replacement.resend_of, 'sms_orig');
  assert.match(replacement.failure_reason, /^Outcome unknown/);
  assert.equal(original.superseded_by, replacement.client_message_id, 'the original stays retired');
  assert.ok(original.superseded_at);

  // Neither row is ever sent again automatically.
  const redriveTelnyx = telnyxAnswer(200, accepted);
  const redrive = await loadFunction('redriveFailedSms', state.client, RELEASED, redriveTelnyx.impl);
  await redrive(cron('redriveFailedSms'));
  assert.equal(redriveTelnyx.sends.length, 0);
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
