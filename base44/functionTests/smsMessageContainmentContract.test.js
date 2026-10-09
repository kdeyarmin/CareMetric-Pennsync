import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import JSON5 from 'json5';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const readEntry = (name) => readFileSync(join(here, '..', 'functions', name, 'entry.ts'), 'utf8');

test('SmsMessage: a nurse reads their own texts; every write, marking read included, is a backend function\'s', () => {
  // 2026-10-08 (owner decision): the browser update rule that let a nurse mark
  // inbound texts read also let them rewrite any field of a row addressed to
  // them, and redriveFailedSms re-sends rows. It is gone; markSmsRead sets
  // is_read and nothing else.
  const schema = JSON5.parse(readFileSync(join(here, '..', 'entities', 'SmsMessage.jsonc'), 'utf8'));
  assert.deepEqual(schema.rls, {
    read: {
      $or: [
        { 'data.nurse_email': '{{user.email}}' },
        { 'data.sent_by': '{{user.email}}' },
        { user_condition: { role: 'admin' } },
      ],
    },
    create: false,
    update: false,
    delete: false,
  });
  for (const field of ['agency_id', 'destination_binding_id']) {
    assert.equal(schema.properties[field]?.type, 'string', `${field} is a service-stamped provenance field`);
  }
});

test('scheduled SMS workers apply the global outbound gate before SDK creation', () => {
  // dispatchScheduledSms and redriveFailedSms both lost their narrower pauses
  // when the owner released them (2026-10-08); the shared outbound gate stays.
  for (const name of ['dispatchScheduledSms', 'redriveFailedSms']) {
    const source = readEntry(name);
    assert.doesNotMatch(source, /SCHEDULED_SMS_DISPATCH_PAUSED|SMS_REDRIVE_MIGRATION_PAUSED/);
    assert.match(source, /<<<BEGIN SHARED HELPER: outboundDeliveryGate/);
    const handler = source.indexOf('Deno.serve(async (req) =>');
    const releaseGate = source.indexOf("if (!outboundDeliveryReleased()) return outboundDeliveryPausedResponse('sms')", handler);
    const sdk = source.indexOf('createClientFromRequest(', handler);
    assert.ok(handler >= 0 && releaseGate > handler, `${name} handler and outbound gate must exist`);
    assert.ok(sdk > releaseGate, `${name} must fail closed before SDK creation and queue access`);
  }
});

test('redriveFailedSms re-proves provenance, line, sender and scoped consent before any re-send', () => {
  const source = readEntry('redriveFailedSms');
  const handler = source.slice(source.indexOf('Deno.serve(async (req) =>'));
  const auth = handler.indexOf('getSchedulerAuthError(req, me)');
  const provenance = handler.indexOf('if (!row.agency_id || !row.destination_binding_id)');
  const line = handler.indexOf('const lineAuthority = await resolveLineAuthority(row.from_number)');
  const sender = handler.indexOf('await senderStillAuthorized(lineAuthority.agencyId, sender)');
  const consent = handler.indexOf('loadLatestScopedSmsConsent(base44, lineAuthority, destination)');
  const claim = handler.indexOf('redrive_claimed_by: runId');
  const send = handler.indexOf('resp = await sendTelnyx(');
  for (const [label, index] of Object.entries({ auth, provenance, line, sender, consent, claim, send })) {
    assert.ok(index > 0, `${label} step must exist`);
  }
  assert.ok(auth < provenance && provenance < line && line < sender && sender < consent && consent < claim && claim < send,
    'every authority check precedes the claim and the provider send');
  assert.match(handler, /lineAuthority\.agencyId !== row\.agency_id\s*\|\|\s*lineAuthority\.bindingId !== row\.destination_binding_id/);
  assert.match(handler, /sender !== normalizeRedriveEmail\(row\.nurse_email\)/);
  assert.match(handler, /sendTelnyx\(apiKey, messagingProfileId, lineAuthority\.destinationE164, destination, row\.body, statusCallback\)/,
    'the re-send goes out from the binding\'s destination, never the row\'s own from_number');
  assert.doesNotMatch(handler, /SmsConsent\s*\.filter\(\{ phone_e164|User\s*\.filter\(\{ email: nurseEmail|\.agency_name \|\|/,
    'no phone-only consent row and no self-editable agency_name decide a re-send');
});

test('the send broker performs SmsMessage bookkeeping only after it authorizes the caller', () => {
  const source = readEntry('sendSms');
  const handler = source.slice(source.indexOf('Deno.serve'));
  const memberGate = handler.indexOf("code: 'agency_membership_required'");
  const create = handler.indexOf('base44.asServiceRole.entities.SmsMessage.create');
  assert.ok(memberGate >= 0 && create > memberGate, 'membership authorization must precede the write');
  assert.doesNotMatch(
    handler,
    /base44\.entities\.SmsMessage\.(?:create|update|delete)/,
    'direct caller-scoped SmsMessage mutations are disabled by entity RLS',
  );
  assert.ok(
    (handler.match(/base44\.asServiceRole\.entities\.SmsMessage\.update/g) || []).length >= 2,
    'provider success and failure reconciliation must remain service-owned',
  );
});

async function loadFunction(name, client, env = {}, fetchImpl = null) {
  let source = await readFile(new URL(`../functions/${name}/entry.ts`, import.meta.url), 'utf8');
  source = source.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    'const createClientFromRequest = globalThis.__smsContainmentClient;',
  );
  const file = join(tmpdir(), `sms_containment_${name}_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(file, transpileTs(source).outputText);
  let handler;
  globalThis.__smsContainmentClient = () => client;
  // Deno.env is read at request time, so the stub stays installed (each load
  // replaces it, as the other function harnesses here do).
  globalThis.Deno = { serve: (candidate) => { handler = candidate; }, env: { get: (key) => env[key] } };
  if (fetchImpl) globalThis.fetch = fetchImpl;
  try {
    await import(pathToFileURL(file).href);
  } finally {
    await unlink(file).catch(() => {});
    delete globalThis.__smsContainmentClient;
  }
  return handler;
}

test('markSmsRead sets is_read on the caller\'s own inbound texts and nothing else', async () => {
  const rows = [
    { id: 'mine_in', direction: 'inbound', nurse_email: 'nurse@example.test', is_read: false },
    { id: 'mine_out', direction: 'outbound', nurse_email: 'nurse@example.test', is_read: false },
    { id: 'theirs_in', direction: 'inbound', nurse_email: 'other@example.test', is_read: false },
  ];
  const updates = [];
  const client = {
    auth: { me: async () => ({ id: 'u1', email: 'Nurse@Example.test', is_active: true }) },
    asServiceRole: { entities: { SmsMessage: {
      filter: async (query) => rows.filter((row) => query.id.$in.includes(row.id)),
      update: async (id, patch) => { updates.push([id, patch]); return { id, ...patch }; },
    } } },
  };
  const handler = await loadFunction('markSmsRead', client);
  const post = (body) => new Request('http://local/markSmsRead', { method: 'POST', body: JSON.stringify(body) });

  const response = await handler(post({ message_ids: ['mine_in', 'mine_out', 'theirs_in', 'missing'] }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, marked: 1 });
  assert.deepEqual(updates, [['mine_in', { is_read: true }]], 'only the caller\'s own inbound row, only is_read');

  for (const body of [
    { message_ids: ['mine_in'], is_read: false },
    { message_ids: ['mine_in'], nurse_email: 'other@example.test' },
    { message_ids: [] },
    { message_ids: ['a', 'a'] },
    { message_ids: Array.from({ length: 101 }, (_, i) => `id_${i}`) },
  ]) {
    const refused = await handler(post(body));
    assert.equal(refused.status, 400, JSON.stringify(body).slice(0, 80));
  }
  assert.equal(updates.length, 1);

  const anonymous = await loadFunction('markSmsRead', { ...client, auth: { me: async () => null } });
  assert.equal((await anonymous(post({ message_ids: ['mine_in'] }))).status, 401);
  const deactivated = await loadFunction('markSmsRead', { ...client, auth: { me: async () => ({ id: 'u1', email: 'nurse@example.test', is_active: false }) } });
  assert.equal((await deactivated(post({ message_ids: ['mine_in'] }))).status, 403);
  assert.equal(updates.length, 1);
});

function redriveBinding(overrides = {}) {
  const destination = overrides.destination_e164 || '+12155550100';
  const binding = {
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
  binding.last_transition_request_key = `${binding.binding_key}:${binding.last_transition_request_id}`;
  return binding;
}

function redriveFixture(rowOverrides = {}, seed = {}) {
  const binding = redriveBinding();
  const data = {
    IntegrationSecret: [{ id: 'integration_1', provider: 'telnyx', api_key: 'KEYtest', messaging_profile_id: 'MP1', is_active: true }],
    TelecomDestinationBinding: [binding],
    AgencyMembership: [{ id: 'm1', agency_id: 'agency_a', user_id: 'u1', user_email_normalized: 'nurse@example.test', status: 'active' }],
    Agency: [{ id: 'agency_a', agency_name: 'Agency A', status: 'active' }],
    AgencySettings: [{ tcpa_quiet_hours_enabled: false }],
    User: [],
    SmsConsent: [{
      consent_key: 'telnyx:integration_1:MP1:agency_a:+13125550182', provider: 'telnyx',
      integration_secret_id: 'integration_1', messaging_profile_id: 'MP1', agency_id: 'agency_a',
      destination_binding_id: binding.id, destination_binding_key: binding.binding_key,
      destination_e164: binding.destination_e164, phone_e164: '+13125550182', consent_status: 'opted_in',
      consent_source: 'manual_opt_in', captured_by: 'nurse@example.test', captured_at: '2026-09-02T00:00:00.000Z',
      provider_event_id: null, provider_message_id: null, provider_event_occurred_at: null,
    }],
    SmsMessage: [{
      id: 'sms_1', direction: 'outbound', status: 'failed', failure_reason: 'Telnyx API error (503)',
      created_date: new Date(Date.now() - 10 * 60_000).toISOString(), retry_count: 0,
      from_number: '+12155550100', to_number: '+13125550182', body: 'Visit at 10',
      nurse_email: 'nurse@example.test', sent_by: 'nurse@example.test',
      agency_id: 'agency_a', destination_binding_id: 'binding_1', ...rowOverrides,
    }],
    UserActivity: [],
    ...seed,
  };
  const matches = (row, query = {}) => Object.entries(query).every(([key, value]) => row?.[key] === value);
  const entities = new Proxy({}, {
    get: (_target, nameValue) => {
      const name = String(nameValue);
      return {
        filter: async (query = {}, _sort, limit = 5000) => (data[name] || []).filter((row) => matches(row, query)).slice(0, limit),
        list: async () => data[name] || [],
        create: async (row) => { (data[name] ||= []).push(row); return { id: `${name}_new`, ...row }; },
        update: async (id, patch) => {
          const row = (data[name] || []).find((candidate) => candidate.id === id);
          if (row) Object.assign(row, patch);
          return { id, ...patch };
        },
      };
    },
  });
  return { data, client: { auth: { me: async () => null }, entities, asServiceRole: { entities } } };
}

test('redriveFailedSms re-sends only rows whose provenance, line, sender and consent still hold', async () => {
  const env = { OUTBOUND_DELIVERY_RELEASE: 'enabled-v1', INTERNAL_FN_SECRET: 'cron-secret' };
  const cron = () => new Request('https://app/functions/redriveFailedSms', {
    method: 'POST', headers: { 'x-internal-secret': 'cron-secret' }, body: '{}',
  });
  const run = async (rowOverrides, seed) => {
    const fixture = redriveFixture(rowOverrides, seed);
    const sends = [];
    const handler = await loadFunction('redriveFailedSms', fixture.client, env, async (url, init) => {
      sends.push(JSON.parse(init.body));
      return Response.json({ data: { id: 'prov_2', to: [{ status: 'sent' }] } });
    });
    const response = await handler(cron());
    return { fixture, sends, json: await response.json(), status: response.status };
  };

  const ok = await run();
  assert.equal(ok.status, 200);
  assert.equal(ok.sends.length, 1);
  assert.equal(ok.sends[0].from, '+12155550100', 'sent from the binding');
  assert.equal(ok.sends[0].to, '+13125550182');
  assert.equal(ok.fixture.data.SmsMessage[0].status, 'sent');

  for (const [label, rowOverrides, seed] of [
    ['a legacy row without provenance', { agency_id: undefined, destination_binding_id: undefined }],
    ['a row whose sending line is not the stamped binding', { destination_binding_id: 'binding_other' }],
    ['a row stamped for another agency', { agency_id: 'agency_b' }],
    ['a rewritten sending number with no binding', { from_number: '+12155550999' }],
    ['an owner field that disagrees with the sender', { nurse_email: 'other@example.test' }],
    ['a sender no longer in the agency', {}, { AgencyMembership: [] }],
    ['a recipient without consent in scope', {}, { SmsConsent: [] }],
    ['a permanent failure', { failure_reason: 'Recipient opted out' }],
    // Telnyx may have accepted a send that timed out; re-sending double-texts.
    ['a timed-out send whose outcome is unknown', { failure_reason: 'Outcome unknown: Telnyx did not answer within 15000 ms, so the text may have been sent. Not retried automatically.' }],
    ['a timed-out send recorded before the outcome-unknown wording', { failure_reason: 'Timed out reaching Telnyx' }],
  ]) {
    const result = await run(rowOverrides, seed);
    assert.equal(result.status, 200, label);
    assert.equal(result.sends.length, 0, `${label}: nothing is re-sent`);
    assert.equal(result.fixture.data.SmsMessage[0].redrive_claimed_by, undefined, `${label}: the row is not claimed`);
  }

  // A signed-in non-admin can never trigger the cron.
  const fixture = redriveFixture();
  const handler = await loadFunction('redriveFailedSms', {
    ...fixture.client, auth: { me: async () => ({ id: 'u1', email: 'nurse@example.test', role: 'user' }) },
  }, env, async () => Response.json({}));
  const refused = await handler(new Request('https://app/functions/redriveFailedSms', { method: 'POST', body: '{}' }));
  assert.equal(refused.status, 403);
});
