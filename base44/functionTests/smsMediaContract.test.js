import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as nodeSign } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transpileTs } from '../../tools-transpile-ts.mjs';
import { copyRows, createStamp, stampSmsRows, updateManyRows } from './smsStoreFake.js';

/**
 * Inbound MMS, end to end against the real handlers:
 *   - handleTelnyxStatusWebhook records each attachment 'pending' and fetches
 *     NOTHING (Telnyx retries a webhook not answered in about two seconds);
 *   - copyInboundSmsMedia copies it into private storage, drops the provider
 *     URL, never copies one attachment twice, and gives up visibly;
 *   - getSmsMediaUrl mints a short-lived link only for the text's own nurse
 *     who still belongs to its agency;
 *   - an outbound MMS is recorded and never redriven as text only.
 */

const RELEASED = { OUTBOUND_DELIVERY_RELEASE: 'enabled-v1', INTERNAL_FN_SECRET: 'cron-secret', SUPER_ADMIN_EMAIL: 'owner@example.test' };
const LINE = '+12155550100';
const PATIENT_PHONE = '+13125550182';
const MEDIA_URL = 'https://media.provider.example/mms/inbound-1.jpg';

async function loadFunction(name, client, env = RELEASED, fetchImpl = null) {
  let source = await readFile(new URL(`../functions/${name}/entry.ts`, import.meta.url), 'utf8');
  source = source.replace(/import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/, 'const createClientFromRequest = globalThis.__smsMediaClient;');
  const file = join(tmpdir(), `sms_media_${name}_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(file, transpileTs(source).outputText);
  let handler;
  globalThis.__smsMediaClient = () => client;
  globalThis.Deno = { serve: (candidate) => { handler = candidate; }, env: { get: (key) => env[key] } };
  if (fetchImpl) globalThis.fetch = fetchImpl;
  try {
    await import(pathToFileURL(file).href);
  } finally {
    await unlink(file).catch(() => {});
    delete globalThis.__smsMediaClient;
  }
  return handler;
}

function binding() {
  const row = {
    id: 'binding_1', binding_key: `telnyx:integration_1:${LINE}`, provider: 'telnyx',
    integration_secret_id: 'integration_1', destination_e164: LINE, provider_number_id: 'n1',
    phone_number_id: 'p1', agency_id: 'agency_a', messaging_profile_id: 'MP1', sms_inbound_enabled: true,
    sms_outbound_enabled: true, voice_inbound_enabled: false, fax_inbound_enabled: false, status: 'active',
    source: 'manual', created_by_user_id: 'owner', created_by_user_email_normalized: 'owner@example.com',
    created_at: '2026-09-01T00:00:01.000Z', activated_at: '2026-09-01T00:00:01.000Z',
    last_transition_by_user_id: 'owner', last_transition_by_email_normalized: 'owner@example.com',
    last_transition_at: '2026-09-01T00:00:01.000Z', last_transition_reason: 'Reviewed initial binding',
    last_transition_action: 'bind', last_transition_request_id: 'request_1', version: 1,
  };
  row.last_transition_request_key = `${row.binding_key}:${row.last_transition_request_id}`;
  return row;
}

function fixture(seed = {}, { uploads = [] } = {}) {
  const data = {
    IntegrationSecret: [],
    TelecomDestinationBinding: [binding()],
    AgencyMembership: [{ id: 'm1', agency_id: 'agency_a', user_id: 'u_nurse', user_email_normalized: 'nurse@example.test', status: 'active' }],
    Agency: [{ id: 'agency_a', agency_name: 'Agency A', status: 'active' }],
    AgencySettings: [{ auto_off_duty_enabled: false }],
    User: [], Patient: [], PhoneNumber: [], SmsConsent: [], SmsMessage: [], Notification: [], UserActivity: [],
    ...seed,
  };
  let sequence = 0;
  // SmsMessage behaves as the hosted store does (smsStoreFake.js): reads are
  // copies, every write moves updated_date, updateMany honours its predicate.
  const stamp = createStamp();
  stampSmsRows(data, stamp);
  const sms = (name) => name === 'SmsMessage';
  const matches = (row, query = {}) => Object.entries(query).every(([key, value]) => row?.[key] === value);
  const entities = new Proxy({}, {
    get: (_target, nameValue) => {
      const name = String(nameValue);
      return {
        filter: async (query = {}, _sort, limit = 5000) => {
          const rows = (data[name] || []).filter((row) => matches(row, query)).slice(0, limit);
          return sms(name) ? copyRows(rows) : rows;
        },
        list: async () => data[name] || [],
        create: async (row) => {
          sequence += 1;
          const created = { id: `${name}_${sequence}`, created_date: new Date().toISOString(), ...row };
          if (sms(name)) created.updated_date = stamp();
          (data[name] ||= []).push(created);
          return created;
        },
        update: async (id, patch) => {
          const row = (data[name] || []).find((candidate) => candidate.id === id);
          if (row) Object.assign(row, patch, sms(name) ? { updated_date: stamp() } : {});
          return { id, ...patch };
        },
        updateMany: async (query, operations) => updateManyRows(data[name], query, operations, stamp),
      };
    },
  });
  const integrations = {
    Core: {
      UploadPrivateFile: async ({ file }) => {
        uploads.push({ name: file.name, type: file.type, size: file.size });
        return { file_uri: `private/agency_a/${file.name}` };
      },
      CreateFileSignedUrl: async ({ file_uri: fileUri, expires_in: expiresIn }) => ({
        signed_url: `https://storage.example.test/signed/${encodeURIComponent(fileUri)}?expires=${expiresIn}`,
      }),
    },
  };
  return { data, uploads, client: { auth: { me: async () => null }, entities, asServiceRole: { entities, integrations } } };
}

function rawEd25519PublicKeyB64(publicKey) {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return Buffer.from(der.subarray(der.length - 32)).toString('base64');
}

function signed(privateKey, event) {
  const rawBody = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1000));
  return new Request('https://app/functions/handleTelnyxStatusWebhook', {
    method: 'POST',
    headers: {
      'telnyx-signature-ed25519': nodeSign(null, Buffer.from(`${timestamp}|${rawBody}`), privateKey).toString('base64'),
      'telnyx-timestamp': timestamp,
    },
    body: rawBody,
  });
}

const mmsEvent = (media) => ({
  data: {
    id: 'event_mms_1', occurred_at: new Date().toISOString(), event_type: 'message.received',
    payload: {
      id: 'mms_1', direction: 'inbound', type: 'MMS', messaging_profile_id: 'MP1',
      from: { phone_number: PATIENT_PHONE }, to: [{ phone_number: LINE }], text: 'Here is the wound', media,
    },
  },
});

test('the webhook records an inbound attachment as pending and downloads nothing', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const state = fixture({
    IntegrationSecret: [{
      id: 'integration_1', provider: 'telnyx', api_key: 'KEYtest', public_key: rawEd25519PublicKeyB64(publicKey),
      messaging_profile_id: 'MP1', is_active: true, updated_date: '2026-09-05T11:59:00.000Z',
    }],
  });
  const fetched = [];
  const handler = await loadFunction('handleTelnyxStatusWebhook', state.client, RELEASED, async (url) => {
    fetched.push(String(url));
    return Response.json({ data: {} });
  });
  const event = mmsEvent([
    { url: MEDIA_URL, content_type: 'image/jpeg', size: 2048, hash_sha256: 'abc' },
    { url: 'https://media.provider.example/mms/layout.smil', content_type: 'application/smil' },
    { url: 'https://media.provider.example/mms/page.html', content_type: 'text/html' },
  ]);
  const response = await handler(signed(privateKey, event));
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(fetched.filter((url) => url.includes('media.provider.example')), [], 'no media fetch inside the webhook');
  const [row] = state.data.SmsMessage;
  assert.equal(row.body, 'Here is the wound');
  assert.equal(row.media_pending, true);
  assert.deepEqual(row.media, [
    { status: 'pending', content_type: 'image/jpeg', byte_size: 2048, external_url: MEDIA_URL, attempts: 0 },
    { status: 'unavailable', content_type: null, byte_size: null },
  ]);

  // A retried delivery stores nothing new.
  const retried = await handler(signed(privateKey, event));
  assert.equal((await retried.json()).deduped, true);
  assert.equal(state.data.SmsMessage.length, 1);
});

const cron = () => new Request('https://app/functions/copyInboundSmsMedia', {
  method: 'POST', headers: { 'x-internal-secret': 'cron-secret' }, body: '{}',
});

function pendingRow(overrides = {}) {
  return {
    id: 'sms_in_1', direction: 'inbound', status: 'received', body: 'Here is the wound', created_date: new Date().toISOString(),
    nurse_email: 'nurse@example.test', agency_id: 'agency_a', destination_binding_id: 'binding_1', provider_message_id: 'mms_1',
    media_pending: true,
    media: [{ status: 'pending', content_type: 'image/jpeg', byte_size: 4, external_url: MEDIA_URL, attempts: 0 }],
    ...overrides,
  };
}

const jpegBytes = () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { status: 200, headers: { 'content-type': 'image/jpeg' } });

test('the copier moves a pending attachment into private storage and drops the provider URL', async () => {
  const state = fixture({ SmsMessage: [pendingRow()] });
  const fetched = [];
  const handler = await loadFunction('copyInboundSmsMedia', state.client, RELEASED, async (url, init) => {
    fetched.push({ url: String(url), redirect: init?.redirect });
    return jpegBytes();
  });
  const response = await handler(cron());
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).copied, 1);
  assert.deepEqual(fetched, [{ url: MEDIA_URL, redirect: 'manual' }]);
  assert.deepEqual(state.uploads, [{ name: 'mms-sms_in_1-0.jpeg', type: 'image/jpeg', size: 4 }]);
  const [row] = state.data.SmsMessage;
  assert.deepEqual(row.media, [{ status: 'stored', content_type: 'image/jpeg', byte_size: 4, file_uri: 'private/agency_a/mms-sms_in_1-0.jpeg' }]);
  assert.equal(row.media_pending, false);
  assert.equal(row.media_claimed_by, null);
  assert.doesNotMatch(JSON.stringify(row), /media\.provider\.example/, 'the provider URL is gone');

  // Nothing left to copy: a second run uploads nothing.
  await handler(cron());
  assert.equal(state.uploads.length, 1);
});

test('a row another run has claimed is not copied twice; a stale claim is taken over', async () => {
  const fresh = new Date().toISOString();
  let state = fixture({ SmsMessage: [pendingRow({ media_claimed_by: 'run_other', media_claimed_at: fresh })] });
  let handler = await loadFunction('copyInboundSmsMedia', state.client, RELEASED, async () => jpegBytes());
  await handler(cron());
  assert.equal(state.uploads.length, 0, 'a live claim is left alone');

  const stale = new Date(Date.now() - 11 * 60_000).toISOString();
  state = fixture({ SmsMessage: [pendingRow({ media_claimed_by: 'run_dead', media_claimed_at: stale })] });
  handler = await loadFunction('copyInboundSmsMedia', state.client, RELEASED, async () => jpegBytes());
  await handler(cron());
  assert.equal(state.uploads.length, 1, 'a claim whose run died is taken over');
});

test('two overlapping copier runs upload one attachment once: the claim is a compare-and-set', async () => {
  // Run B listed the row before run A claimed it, and tries to claim it while A
  // is mid-copy. Update-then-read-back let B overwrite A's token and read back
  // its own, after A had already read back its own: both uploaded.
  const state = fixture({ SmsMessage: [pendingRow()] });
  const entities = state.client.asServiceRole.entities;
  let aFetching;
  const aIsFetching = new Promise((resolve) => { aFetching = resolve; });
  let releaseA;
  const aMayFinish = new Promise((resolve) => { releaseA = resolve; });
  let listed = null;
  const runClient = (role) => {
    const view = new Proxy({}, {
      get: (_target, name) => {
        const real = entities[name];
        if (name !== 'SmsMessage') return real;
        return {
          ...real,
          filter: async (query, sort, limit) => {
            if (query?.media_pending !== true) return real.filter(query, sort, limit);
            if (role === 'A') {
              listed = await real.filter(query, sort, limit);
              return structuredClone(listed);
            }
            await aIsFetching;
            return structuredClone(listed);
          },
        };
      },
    });
    return { auth: { me: async () => null }, entities: view, asServiceRole: { entities: view, integrations: state.client.asServiceRole.integrations } };
  };
  let fetches = 0;
  const fetchImpl = async () => {
    fetches += 1;
    if (fetches === 1) {
      aFetching();
      await aMayFinish;
    }
    return jpegBytes();
  };
  const runA = await loadFunction('copyInboundSmsMedia', runClient('A'), RELEASED, fetchImpl);
  const runB = await loadFunction('copyInboundSmsMedia', runClient('B'), RELEASED, fetchImpl);
  const pendingA = runA(cron());
  const answerB = await (await runB(cron())).json();
  releaseA();
  const answerA = await (await pendingA).json();

  assert.equal(state.uploads.length, 1, 'one attachment, one upload');
  assert.equal(fetches, 1, 'the losing run never fetched it either');
  assert.equal(answerA.copied, 1);
  assert.equal(answerB.copied, 0);
  assert.equal(answerB.skipped, 1, 'the run whose claim lost skips the row');
  const [row] = state.data.SmsMessage;
  assert.deepEqual(row.media, [{ status: 'stored', content_type: 'image/jpeg', byte_size: 4, file_uri: 'private/agency_a/mms-sms_in_1-0.jpeg' }]);
  assert.equal(row.media_claimed_by, null, 'the winner released its claim');
});

test('an attachment that cannot be copied is retried, then marked unavailable without its URL', async () => {
  const state = fixture({ SmsMessage: [pendingRow()] });
  const handler = await loadFunction('copyInboundSmsMedia', state.client, RELEASED, async () => new Response('busy', { status: 503 }));
  for (let run = 1; run <= 4; run += 1) {
    await handler(cron());
    assert.equal(state.data.SmsMessage[0].media[0].status, 'pending', `run ${run} retries`);
    assert.equal(state.data.SmsMessage[0].media[0].attempts, run);
  }
  await handler(cron());
  assert.deepEqual(state.data.SmsMessage[0].media, [{ status: 'unavailable', content_type: 'image/jpeg', byte_size: 4 }]);
  assert.equal(state.data.SmsMessage[0].media_pending, false);
});

test('the copier never follows a redirect off https, nor reads past the size bound', async () => {
  for (const [label, answer] of [
    ['a redirect to plain http', () => new Response(null, { status: 302, headers: { location: 'http://media.provider.example/x.jpg' } })],
    ['a redirect to a private address', () => new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/x.jpg' } })],
    ['a body larger than declared', () => new Response(new Uint8Array(5 * 1024 * 1024 + 1), { status: 200, headers: { 'content-type': 'image/jpeg' } })],
    ['a declared length over the bound', () => new Response(new Uint8Array(4), { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': String(6 * 1024 * 1024) } })],
  ]) {
    const state = fixture({ SmsMessage: [pendingRow()] });
    const fetched = [];
    const handler = await loadFunction('copyInboundSmsMedia', state.client, RELEASED, async (url) => {
      fetched.push(String(url));
      return answer();
    });
    await handler(cron());
    assert.equal(state.uploads.length, 0, label);
    assert.equal(state.data.SmsMessage[0].media[0].status, 'unavailable', label);
    assert.ok(fetched.every((url) => url === MEDIA_URL), `${label}: no second hop`);
  }
});

test('only the scheduler may run the copier', async () => {
  const state = fixture({ SmsMessage: [pendingRow()] });
  state.client.auth.me = async () => ({ id: 'u_nurse', email: 'nurse@example.test', role: 'user' });
  const handler = await loadFunction('copyInboundSmsMedia', state.client, RELEASED, async () => jpegBytes());
  const response = await handler(new Request('https://app/functions/copyInboundSmsMedia', { method: 'POST', body: '{}' }));
  assert.equal(response.status, 403);
  assert.equal(state.uploads.length, 0);
});

const mediaRequest = (body) => new Request('https://app/functions/getSmsMediaUrl', { method: 'POST', body: JSON.stringify(body) });
const storedRow = (overrides = {}) => pendingRow({
  media_pending: false,
  media: [
    { status: 'stored', content_type: 'image/jpeg', byte_size: 4, file_uri: 'private/agency_a/mms-sms_in_1-0.jpeg' },
    { status: 'pending', content_type: 'image/png', external_url: MEDIA_URL, attempts: 0 },
  ],
  ...overrides,
});

test("getSmsMediaUrl mints a 60-second link for the text's own nurse in its agency, and for nobody else", async () => {
  const nurse = { id: 'u_nurse', email: 'Nurse@Example.test', is_active: true };
  let state = fixture({ SmsMessage: [storedRow()] });
  state.client.auth.me = async () => nurse;
  let handler = await loadFunction('getSmsMediaUrl', state.client);
  let response = await handler(mediaRequest({ message_id: 'sms_in_1', index: 0 }));
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const json = await response.json();
  assert.equal(json.content_type, 'image/jpeg');
  assert.equal(json.expires_in, 60);
  assert.match(json.url, /^https:\/\/storage\.example\.test\/signed\/.*expires=60$/);

  for (const [label, seed, me, body, status] of [
    ['another nurse', {}, { id: 'u2', email: 'other@example.test' }, { message_id: 'sms_in_1', index: 0 }, 404],
    ['a nurse who left the agency', { AgencyMembership: [] }, nurse, { message_id: 'sms_in_1', index: 0 }, 404],
    ['an attachment not yet copied', {}, nurse, { message_id: 'sms_in_1', index: 1 }, 404],
    ['an index past the attachments', {}, nurse, { message_id: 'sms_in_1', index: 5 }, 404],
    ['a row without agency provenance', { SmsMessage: [storedRow({ agency_id: undefined })] }, nurse, { message_id: 'sms_in_1', index: 0 }, 404],
    ['an unknown body field', {}, nurse, { message_id: 'sms_in_1', index: 0, file_uri: 'private/x' }, 400],
    ['an anonymous caller', {}, null, { message_id: 'sms_in_1', index: 0 }, 401],
  ]) {
    state = fixture({ SmsMessage: [storedRow()], ...seed });
    state.client.auth.me = async () => me;
    handler = await loadFunction('getSmsMediaUrl', state.client);
    response = await handler(mediaRequest(body));
    assert.equal(response.status, status, label);
    assert.doesNotMatch(await response.text(), /private\/agency_a/, `${label}: no file URI is disclosed`);
  }
});

test('getSmsMediaUrl finds the membership by the caller\'s immutable user id, never by the address alone', async () => {
  const nurse = { id: 'u_nurse', email: 'Nurse@Example.test', is_active: true };
  const member = { id: 'm1', agency_id: 'agency_a', user_id: 'u_nurse', user_email_normalized: 'nurse@example.test', status: 'active' };
  const ask = async (memberships) => {
    const state = fixture({ SmsMessage: [storedRow()], AgencyMembership: memberships });
    state.client.auth.me = async () => nurse;
    const handler = await loadFunction('getSmsMediaUrl', state.client);
    const response = await handler(mediaRequest({ message_id: 'sms_in_1', index: 0 }));
    const text = await response.text();
    assert.doesNotMatch(text, /private\/agency_a/, 'no file URI is disclosed');
    return { status: response.status, json: JSON.parse(text) };
  };

  // Control: the one active row for this user in this agency mints the link.
  const ok = await ask([member]);
  assert.equal(ok.status, 200);
  assert.match(ok.json.url, /^https:\/\/storage\.example\.test\/signed\//);

  for (const [label, memberships] of [
    // Somebody else's membership that happens to carry the caller's address
    // (an address can be reassigned; the user id cannot).
    ['an active row with the address under another user id', [{ ...member, user_id: 'u_other' }]],
    ['two active rows for the caller in the agency (ambiguous)', [member, { ...member, id: 'm2' }]],
    ['the caller\'s row whose address no longer matches', [{ ...member, user_email_normalized: 'former@example.test' }]],
    ['the caller\'s active row in another agency', [{ ...member, agency_id: 'agency_b' }]],
    ['the caller\'s row, no longer active', [{ ...member, status: 'suspended' }]],
  ]) {
    const refused = await ask(memberships);
    assert.equal(refused.status, 404, label);
    assert.equal(refused.json.url, undefined, `${label}: no link`);
  }
});

test('an outbound MMS is recorded with its attachments and never redriven as text only', async () => {
  const owner = { id: 'owner_1', email: 'owner@example.test', role: 'admin', full_name: 'Owner', work_phone_number: LINE };
  const consent = {
    id: 'consent_1', consent_key: `telnyx:integration_1:MP1:agency_a:${PATIENT_PHONE}`, provider: 'telnyx',
    integration_secret_id: 'integration_1', messaging_profile_id: 'MP1', agency_id: 'agency_a',
    destination_binding_id: 'binding_1', destination_binding_key: `telnyx:integration_1:${LINE}`,
    destination_e164: LINE, phone_e164: PATIENT_PHONE, consent_status: 'opted_in', consent_source: 'manual_opt_in',
    captured_by: 'nurse@example.test', captured_at: '2026-09-02T00:00:00.000Z',
    provider_event_id: null, provider_message_id: null, provider_event_occurred_at: null,
  };
  const seed = {
    IntegrationSecret: [{ id: 'integration_1', provider: 'telnyx', api_key: 'KEYtest', messaging_profile_id: 'MP1', is_active: true }],
    AgencySettings: [{ tcpa_quiet_hours_enabled: false }],
    SmsConsent: [consent],
    User: [owner],
  };
  const state = fixture(seed);
  state.client.auth.me = async () => owner;
  const sends = [];
  const telnyx = async (url, init) => {
    sends.push(JSON.parse(init.body));
    return Response.json({ errors: [{ code: '10011', detail: 'Too many requests' }] }, { status: 429, headers: { 'retry-after': '0' } });
  };
  const send = await loadFunction('sendSms', state.client, RELEASED, telnyx);
  await send(new Request('https://app/functions/sendSms', {
    method: 'POST', body: JSON.stringify({ to_number: PATIENT_PHONE, body: 'See attached', media_urls: ['https://files.example.test/care-plan.pdf'] }),
  }));
  const [row] = state.data.SmsMessage;
  assert.deepEqual(row.media, [{ status: 'sent', external_url: 'https://files.example.test/care-plan.pdf' }]);
  assert.match(row.failure_reason, /^Telnyx API error: HTTP 429/, 'a 429 that would otherwise be redriven');
  // Past the first backoff gap, so only the attachments can hold it back.
  row.created_date = new Date(Date.now() - 10 * 60_000).toISOString();
  const sentBefore = sends.length;

  const redrive = await loadFunction('redriveFailedSms', state.client, RELEASED, telnyx);
  await redrive(new Request('https://app/functions/redriveFailedSms', {
    method: 'POST', headers: { 'x-internal-secret': 'cron-secret' }, body: '{}',
  }));
  assert.equal(sends.length, sentBefore, 'the MMS is not re-sent as a text');

  // Control: the same row without media IS redriven.
  delete row.media;
  await redrive(new Request('https://app/functions/redriveFailedSms', {
    method: 'POST', headers: { 'x-internal-secret': 'cron-secret' }, body: '{}',
  }));
  assert.equal(sends.length, sentBefore + 1);
});
