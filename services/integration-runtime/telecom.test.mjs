import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { BROWSER_FORBIDDEN_OPERATIONS, OPERATIONS } from './contracts.mjs';
import { readJson } from './safety.mjs';
import { loadConfig } from './runtime.mjs';
import {
  MAX_SMS_TEXT, TELECOM_OPERATIONS, TELECOM_PROVIDER, TELECOM_RELEASE_VALUE,
  isOwnedMediaUrl, isOwnedWebhookUrl, sendTelecom, telecomPayload, validateTelecomParams,
} from './telecom.mjs';

const STORAGE = 'https://xsqobvvreaovwibxwyvv.supabase.co';
const ORIGIN = 'https://app.caremetricai.com';
const config = (released = false) => ({
  supabaseUrl: STORAGE, origins: [ORIGIN], telecomReleased: released,
});
const MEDIA = `${STORAGE}/storage/v1/object/sign/cm-private/app/subject/job?token=abc`;
const FAX = Object.freeze({ to: '+17244650441', from: '+17244650444', media_url: MEDIA });
const SMS = Object.freeze({ to: '+17244650441', from: '+17244650444', text: 'Synthetic body' });
const CREDENTIAL = Object.freeze({
  apiKey: 'KEYSYNTHETIC', faxConnectionId: 'fc-1', messagingProfileId: 'mp-1',
  voiceConnectionId: 'vc-1', publicKey: null, record: {}, readError: null,
});

/** A fetcher that fails the test if it is called at all. */
const forbiddenFetcher = () => { assert.fail('no provider call may be made on this path'); };

const accepting = (seen, body = { data: { id: 'prov-1', status: 'queued' } }, status = 200) =>
  async (url, options) => {
    seen.push({ url, options });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };

const send = (operation, params, { released = true, credential = CREDENTIAL, fetcher } = {}) =>
  sendTelecom(operation, params, {
    config: config(released),
    readCredential: async () => credential,
    fetcher: fetcher ?? forbiddenFetcher,
    readJson,
  });

const refuses = async (promise, code) => {
  await assert.rejects(() => promise, error => {
    assert.equal(error.code, code);
    return true;
  });
};

test('with the release unset, nothing reaches the provider and the refusal says so', async () => {
  for (const [operation, params] of [['SendFax', FAX], ['SendSms', SMS]]) {
    // `forbiddenFetcher` is the assertion: a path that reached Telnyx here
    // would fail the test rather than merely return the wrong code.
    await refuses(send(operation, params, { released: false }), 'TELECOM_DELIVERY_RELEASE_PAUSED');
  }
});

test('the release refusal comes before the credential is read, so it discloses nothing about one', async () => {
  let asked = 0;
  await assert.rejects(() => sendTelecom('SendFax', FAX, {
    config: config(false),
    readCredential: async () => { asked += 1; return CREDENTIAL; },
    fetcher: forbiddenFetcher,
    readJson,
  }), error => error.code === 'TELECOM_DELIVERY_RELEASE_PAUSED');
  assert.equal(asked, 0);
});

test('a credential that could not be read is not reported as a missing one', async () => {
  await refuses(
    send('SendFax', FAX, { credential: { ...CREDENTIAL, apiKey: null, readError: 'credential_store_unavailable' } }),
    'TELECOM_CREDENTIAL_STORE_UNAVAILABLE');
  await refuses(
    send('SendFax', FAX, { credential: { ...CREDENTIAL, apiKey: null } }),
    'TELECOM_CREDENTIAL_NOT_CONFIGURED');
});

test('each half of the provider is reported separately, as the originals report it', async () => {
  // A key with no fax connection id is configured for texting and not for
  // faxing. One refusal for both is what sends an operator to re-enter a key
  // they already have correctly.
  await refuses(send('SendFax', FAX, { credential: { ...CREDENTIAL, faxConnectionId: null } }),
    'FAX_CONFIGURATION_UNAVAILABLE');
  await refuses(send('SendSms', SMS, { credential: { ...CREDENTIAL, messagingProfileId: null } }),
    'SMS_CONFIGURATION_UNAVAILABLE');
  // And the other half still works, which is the point of splitting them.
  const seen = [];
  await send('SendSms', SMS, { credential: { ...CREDENTIAL, faxConnectionId: null }, fetcher: accepting(seen) });
  assert.equal(seen.length, 1);
});

test('a released, credentialled fax carries the original\'s payload', async () => {
  const seen = [];
  const answer = await send('SendFax', { ...FAX, from_display_name: 'Office Fax 724-465-0444' },
    { fetcher: accepting(seen) });
  assert.equal(seen[0].url, 'https://api.telnyx.com/v2/faxes');
  assert.equal(seen[0].options.headers.Authorization, 'Bearer KEYSYNTHETIC');
  assert.deepEqual(JSON.parse(seen[0].options.body), {
    connection_id: 'fc-1', from: '+17244650444', to: '+17244650441',
    media_url: MEDIA, quality: 'high', from_display_name: 'Office Fax 724-465-0444',
  });
  assert.deepEqual(answer, {
    accepted: true, delivered: false, provider: TELECOM_PROVIDER,
    provider_id: 'prov-1', provider_status: 'queued', operation: 'SendFax',
  });
});

test('a released, credentialled text carries the messaging profile and nothing more', async () => {
  const seen = [];
  await send('SendSms', SMS, { fetcher: accepting(seen) });
  assert.equal(seen[0].url, 'https://api.telnyx.com/v2/messages');
  assert.deepEqual(JSON.parse(seen[0].options.body), {
    messaging_profile_id: 'mp-1', from: '+17244650444', to: '+17244650441', text: 'Synthetic body',
  });
});

test('an absent display name and webhook are omitted rather than sent null', () => {
  assert.deepEqual(Object.keys(telecomPayload('SendFax', FAX, CREDENTIAL)).sort(),
    ['connection_id', 'from', 'media_url', 'quality', 'to']);
  assert.deepEqual(Object.keys(telecomPayload('SendSms', SMS, CREDENTIAL)).sort(),
    ['from', 'messaging_profile_id', 'text', 'to']);
});

test('both ends must already be E.164, which is the narrower of the two answers the original carries', () => {
  // `normalizeFaxDest` falls back to the RAW STRING when it cannot normalise,
  // so these reach the provider today. `normalizeFromE164` returns null for the
  // same input and its comment says why. This boundary takes the second answer
  // for both ends, and that narrowing is recorded in `contracts.mjs`.
  for (const bad of ['724-465-0441', '7244650441', '+0172446504', '', 'not a number',
    '+1724465044100000', '+1 724 465 0441']) {
    assert.throws(() => validateTelecomParams('SendFax', { ...FAX, to: bad }, config(true)),
      error => error.code === 'TELECOM_NUMBER_INVALID', `accepted ${JSON.stringify(bad)} as a destination`);
    assert.throws(() => validateTelecomParams('SendSms', { ...SMS, from: bad }, config(true)),
      error => error.code === 'TELECOM_NUMBER_INVALID', `accepted ${JSON.stringify(bad)} as a sender`);
  }
  assert.doesNotThrow(() => validateTelecomParams('SendFax', FAX, config(true)));
  // An international destination is admitted, because the original decides the
  // already-plus case FIRST and never rewrites it into a US subscriber.
  assert.doesNotThrow(() => validateTelecomParams('SendFax', { ...FAX, to: '+4989123456' }, config(true)));
});

test('a malformed NANP number passes this boundary, and that is the caller\'s gate rather than a hole here', () => {
  // `+1724465044` is nine digits after the `+1`, so it is a broken US number
  // and not an international one. It is valid E.164 BY SHAPE, and the original
  // accepts it here too: `normalizeFaxDest` decides the already-plus case
  // first and returns it unchanged. What refuses it is `isAllowedDestination`
  // — "a +1-prefixed number that isn't exactly 10 NANP digits is malformed,
  // not international" — which takes the agency's own settings and therefore
  // lives on the record side with the blocked area codes and the premium
  // prefixes.
  //
  // This case exists because the first draft of the suite above asserted a
  // refusal here and the code was right: writing the NANP rule into this
  // module would have meant a cost control with the agency's settings
  // defaulted to nothing, which admits everything while reading as a control.
  // So the boundary is recorded rather than moved, and a caller that reaches
  // this operation without running that gate is sending an unbounded number.
  assert.doesNotThrow(() => validateTelecomParams('SendFax', { ...FAX, to: '+1724465044' }, config(true)));
});

test('the media the provider fetches must be ours, and nothing a caller chose', () => {
  for (const bad of [
    'http://xsqobvvreaovwibxwyvv.supabase.co/storage/v1/object/sign/x',
    'https://example.test/storage/v1/object/sign/x',
    `${STORAGE}/storage/v1/object/public/cm-private/x`,
    `${STORAGE}/storage/v1/object/sign/x#fragment`,
    'https://user:pass@xsqobvvreaovwibxwyvv.supabase.co/storage/v1/object/sign/x',
    'not a url', '',
  ]) {
    assert.equal(isOwnedMediaUrl(bad, config(true)), false, `accepted ${JSON.stringify(bad)}`);
    assert.throws(() => validateTelecomParams('SendFax', { ...FAX, media_url: bad }, config(true)),
      error => error.code === 'FAX_MEDIA_NOT_OWNED');
  }
  assert.equal(isOwnedMediaUrl(MEDIA, config(true)), true);
  // With no storage binding there is no origin to match, so nothing is ours.
  assert.equal(isOwnedMediaUrl(MEDIA, { ...config(true), supabaseUrl: '' }), false);
});

test('the status webhook must be one of our own origins', () => {
  assert.equal(isOwnedWebhookUrl(`${ORIGIN}/telnyx/status`, config(true)), true);
  for (const bad of [
    'https://example.test/telnyx/status',
    `http://app.caremetricai.com/telnyx/status`,
    `${ORIGIN}/telnyx/status?x=1`,
    `${ORIGIN}/telnyx/status#x`,
    'not a url',
  ]) {
    assert.equal(isOwnedWebhookUrl(bad, config(true)), false, `accepted ${JSON.stringify(bad)}`);
  }
  assert.throws(() => validateTelecomParams('SendSms', { ...SMS, webhook_url: 'https://example.test/x' }, config(true)),
    error => error.code === 'SMS_WEBHOOK_NOT_OWNED');
});

test('an unknown or missing parameter is refused rather than ignored', () => {
  assert.throws(() => validateTelecomParams('SendFax', { ...FAX, surprise: 1 }, config(true)),
    error => error.code === 'INVALID_INPUT');
  assert.throws(() => validateTelecomParams('SendSms', { ...SMS, surprise: 1 }, config(true)),
    error => error.code === 'INVALID_INPUT');
  // A fax has no `text` and a text has no `media_url`: the two shapes are not
  // interchangeable and a caller sending the wrong one is a bug, not a default.
  assert.throws(() => validateTelecomParams('SendFax', SMS, config(true)),
    error => error.code === 'INVALID_INPUT');
  assert.throws(() => validateTelecomParams('SendSms', FAX, config(true)),
    error => error.code === 'INVALID_INPUT');
  assert.throws(() => validateTelecomParams('SendSms', { ...SMS, text: 'x'.repeat(MAX_SMS_TEXT + 1) }, config(true)),
    error => error.code === 'INVALID_TEXT');
  assert.throws(() => validateTelecomParams('StartCall', SMS, config(true)),
    error => error.code === 'INTEGRATION_NOT_MIGRATED');
  assert.throws(() => validateTelecomParams('SendFax', { ...FAX, from_display_name: 'Office (724) 465' }, config(true)),
    error => error.code === 'FAX_DISPLAY_NAME_INVALID');
});

test('a provider refusal is logged and never echoed back', async () => {
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  try {
    const seen = [];
    await refuses(send('SendFax', FAX, {
      fetcher: accepting(seen, { errors: [{ code: '20001', detail: `recipient ${FAX.to} unreachable` }] }, 422),
    }), 'TELECOM_NOT_ACCEPTED');
    // The original's own note: the recipient number and the media URL are PHI,
    // and a provider error body carries the request back.
    const logged = JSON.stringify(errors);
    assert.equal(logged.includes(FAX.to), false);
    assert.equal(logged.includes(MEDIA), false);
    assert.match(logged, /20001/);
  } finally {
    console.error = original;
  }
});

test('an unreachable provider is its own answer, because the outcome is unknown', async () => {
  await refuses(send('SendFax', FAX, { fetcher: async () => { throw new Error('ECONNRESET'); } }),
    'TELECOM_PROVIDER_UNREACHABLE');
});

test('an acceptance with no provider id is refused rather than reported as sent', async () => {
  const seen = [];
  await refuses(send('SendSms', SMS, { fetcher: accepting(seen, { data: {} }) }), 'TELECOM_ACCEPTANCE_UNREADABLE');
  await refuses(send('SendSms', SMS, { fetcher: accepting(seen, {}) }), 'TELECOM_ACCEPTANCE_UNREADABLE');
  // A status the answer cannot read is null rather than a refusal: the id is
  // what a retry needs and the status is a label.
  const answer = await send('SendSms', SMS, { fetcher: accepting(seen, { data: { id: 'prov-2', status: 7 } }) });
  assert.equal(answer.provider_status, null);
  assert.equal(answer.provider_id, 'prov-2');
});

test('no browser caller may be granted either operation, and the boot refuses it', () => {
  for (const operation of TELECOM_OPERATIONS) {
    assert.ok(OPERATIONS.includes(operation), `${operation} must be a service operation`);
    assert.ok(BROWSER_FORBIDDEN_OPERATIONS.includes(operation), `${operation} must be browser-forbidden`);
    assert.throws(() => loadConfig({
      INTEGRATIONS_ALLOWED_OPERATIONS: operation,
      INTEGRATIONS_BROWSER_OPERATIONS: operation,
      INTEGRATIONS_APP_ID: '6a9881683dc68a0bd54f1ef7',
    }), /BROWSER_FORBIDDEN_OPERATION/, `${operation} was configurable for the browser`);
  }
});

test('the release is off by default and opens only on the exact value', () => {
  const read = value => loadConfig({
    INTEGRATIONS_APP_ID: '6a9881683dc68a0bd54f1ef7',
    ...(value === undefined ? {} : { INTEGRATIONS_TELECOM_RELEASE: value }),
  }).telecomReleased;
  assert.equal(read(undefined), false);
  assert.equal(read(''), false);
  assert.equal(read('true'), false);
  assert.equal(read('enabled'), false);
  assert.equal(read('enabled-v2'), false);
  assert.equal(read(` ${TELECOM_RELEASE_VALUE} `), false);
  assert.equal(read(TELECOM_RELEASE_VALUE), true);
  // And it is independent of the service's own release, because a telecom send
  // is one of the owner's holds and must not ride a variable that releases the
  // AI and file operations.
  assert.equal(loadConfig({
    INTEGRATIONS_APP_ID: '6a9881683dc68a0bd54f1ef7', INTEGRATIONS_RELEASE: 'enabled-v1',
  }).telecomReleased, false);
});

test('the reservation path admits both operations, in both of the places that list them', () => {
  // The behaviour is proved against a real cluster in
  // `tests/postgres-bootstrap.test.mjs`, which reads the names out of the
  // constraint and drives the real reserve function for each. This asserts the
  // migration carries both names in BOTH copies, which is the half 006 records
  // as easy to extend one of.
  const sql = readFileSync(new URL('./migrations/008_telecom_operations.sql', import.meta.url), 'utf8');
  const constraint = sql.slice(sql.indexOf('add constraint'), sql.indexOf('do $$'));
  const patch = sql.slice(sql.indexOf('do $$'));
  for (const operation of TELECOM_OPERATIONS) {
    assert.ok(constraint.includes(`'${operation}'`), `${operation} missing from the table constraint`);
    assert.ok(patch.includes(`''${operation}''`), `${operation} missing from the function patch`);
  }
  // Refusing rather than patching blind is what makes a changed body loud.
  assert.match(patch, /Expected reservation operation list not found/);
});
