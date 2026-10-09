import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { seal } from './safety.mjs';
import {
  READ_ERROR, credentialMessage, credentialStatus, putCredential, readCredential,
} from './provider-credential.mjs';

const CONFIG = Object.freeze({ appId: 'synthetic-app', encryptionKey: '1'.repeat(64) });
const KEY = 'KEYSUPERSECRETVALUE9911';
const uuid = () => '11111111-2222-3333-4444-555555555555';
const randomUUID = () => uuid();

/** A store double that records what was written and answers from it. */
function storeDouble() {
  const written = [];
  return {
    written,
    async credentialPut(body) { written.push(body); return written.length; },
    async credentialActive() {
      const last = written.at(-1);
      return last ? {
        id: last.p_id, app_id: last.p_app_id, provider: last.p_provider, version: written.length,
        api_key_sealed: last.p_api_key_sealed, api_key_last_four: last.p_api_key_last_four,
        public_key: last.p_public_key, messaging_profile_id: last.p_messaging_profile_id,
        voice_connection_id: last.p_voice_connection_id, fax_connection_id: last.p_fax_connection_id,
        updated_by: last.p_updated_by, recorded_at: '2026-10-01T20:00:00.000Z',
      } : null;
    },
    async credentialStatus() {
      const last = written.at(-1);
      return last ? {
        provider: last.p_provider, version: written.length,
        api_key_last_four: last.p_api_key_last_four,
        public_key_configured: last.p_public_key !== null,
        messaging_profile_configured: last.p_messaging_profile_id !== null,
        voice_connection_configured: last.p_voice_connection_id !== null,
        fax_connection_configured: last.p_fax_connection_id !== null,
        updated_by: last.p_updated_by, recorded_at: '2026-10-01T20:00:00.000Z',
      } : null;
    },
  };
}

// A synthetic key in the only form a Telnyx webhook verifier can import: 32 raw
// Ed25519 bytes, base64. (This fixture used to be 'cHVibGljLWtleQ==', which is
// the ten bytes "public-key" and would refuse every signed webhook.)
const PUBLIC_KEY = Buffer.alloc(32, 1).toString('base64');
const PUT = Object.freeze({
  apiKey: KEY, updatedBy: 'operator@example.test', publicKey: PUBLIC_KEY,
  messagingProfileId: 'mp-1', voiceConnectionId: 'vc-1', faxConnectionId: 'fc-1',
});

test('the plaintext key never reaches the store, and the last four is derived from it', async () => {
  const store = storeDouble();
  const answer = await putCredential(CONFIG, store, PUT, { randomUUID });
  const body = store.written[0];
  assert.equal(Object.hasOwn(body, 'p_api_key'), false);
  assert.equal(JSON.stringify(body).includes(KEY), false);
  assert.equal(body.p_api_key_last_four, '9911');
  assert.equal(answer.api_key_last_four, '9911');
  assert.equal(answer.version, 1);
});

test('a sealed credential round-trips with its resource ids', async () => {
  const store = storeDouble();
  await putCredential(CONFIG, store, PUT, { randomUUID });
  const creds = await readCredential(CONFIG, store);
  assert.equal(creds.apiKey, KEY);
  assert.equal(creds.readError, null);
  assert.equal(creds.publicKey, PUBLIC_KEY);
  assert.equal(creds.messagingProfileId, 'mp-1');
  assert.equal(creds.voiceConnectionId, 'vc-1');
  assert.equal(creds.faxConnectionId, 'fc-1');
});

test('a store that will not answer is a read failure, not a missing key, and does not throw', async () => {
  const store = { ...storeDouble(), credentialActive() { throw new Error('503'); } };
  const creds = await readCredential(CONFIG, store);
  assert.equal(creds.readError, READ_ERROR);
  assert.equal(creds.apiKey, null);
  // The distinction the category exists for. An operator reading this must not
  // be sent to re-enter a key they already entered correctly.
  const message = credentialMessage(creds, 'fax credentials');
  assert.match(message, /NOT a missing-key result/);
  assert.equal(message.includes('not configured'), false);
});

test('an absent credential says not configured, and names no environment variable', async () => {
  const creds = await readCredential(CONFIG, storeDouble());
  assert.equal(creds.readError, null);
  assert.equal(creds.apiKey, null);
  const message = credentialMessage(creds, 'fax credentials');
  assert.match(message, /not configured/);
  assert.equal(/NOT a missing-key result/.test(message), false);
  assert.match(message, /environment variables are not read/);
});

test('a blob that will not open is reported as a read failure, never as configured', async () => {
  const store = storeDouble();
  await putCredential(CONFIG, store, PUT, { randomUUID });
  store.written[0].p_api_key_sealed = seal('2'.repeat(64), 'synthetic-app:credential:telnyx', KEY);
  const creds = await readCredential(CONFIG, store);
  assert.equal(creds.readError, READ_ERROR);
  assert.equal(creds.apiKey, null);
});

test('the seal is bound to the app and the provider', async () => {
  const store = storeDouble();
  await putCredential(CONFIG, store, PUT, { randomUUID });
  // Same encryption key, different context: a credential sealed for another
  // deployment or another provider must not open here.
  store.written[0].p_api_key_sealed = seal(CONFIG.encryptionKey, 'other-app:credential:telnyx', KEY);
  assert.equal((await readCredential(CONFIG, store)).readError, READ_ERROR);
  store.written[0].p_api_key_sealed = seal(CONFIG.encryptionKey, 'synthetic-app:credential:other', KEY);
  assert.equal((await readCredential(CONFIG, store)).readError, READ_ERROR);
});

test('the status answer carries no key material, whatever the store hands back', async () => {
  const store = storeDouble();
  await putCredential(CONFIG, store, PUT, { randomUUID });
  const sealed = store.written[0].p_api_key_sealed;
  // Sabotage: a store that wrongly returns the sealed column and the key.
  const leaky = { ...store, async credentialStatus() {
    return { ...(await store.credentialStatus()), api_key_sealed: sealed, api_key: KEY };
  } };
  const status = await credentialStatus(CONFIG, leaky);
  const serialized = JSON.stringify(status);
  assert.equal(serialized.includes(KEY), false);
  assert.equal(serialized.includes(sealed), false);
  assert.deepEqual(Object.keys(status).sort(), [
    'api_key_last_four', 'configured', 'fax_connection_configured', 'messaging_profile_configured',
    'provider', 'public_key_configured', 'public_key_source', 'read_error', 'source',
    'updated_at', 'updated_by', 'version', 'voice_connection_configured',
  ]);
  assert.equal(status.api_key_last_four, '9911');
  assert.equal(status.configured, true);
  assert.equal(status.source, 'config');
});

test('an unconfigured provider reports no timestamp and no actor', async () => {
  const status = await credentialStatus(CONFIG, storeDouble());
  assert.equal(status.configured, false);
  assert.equal(status.source, 'none');
  assert.equal(status.api_key_last_four, null);
  // The original's quirk, ported: a panel showing a timestamp beside "not
  // configured" would be reporting a credential nobody can use.
  assert.equal(status.updated_at, null);
  assert.equal(status.updated_by, null);
  assert.equal(status.fax_connection_configured, false);
});

test('a status read failure is distinguishable from an unconfigured provider', async () => {
  const status = await credentialStatus(CONFIG, { credentialStatus() { throw new Error('503'); } });
  assert.equal(status.read_error, READ_ERROR);
  assert.equal(status.configured, false);
});

test('a bad actor, key or resource id is refused before anything is written', async () => {
  const store = storeDouble();
  const refuses = async (patch, code) => {
    await assert.rejects(
      () => putCredential(CONFIG, store, { ...PUT, ...patch }, { randomUUID }),
      error => error.code === code,
    );
  };
  await refuses({ apiKey: '   ' }, 'CREDENTIAL_KEY_INVALID');
  await refuses({ apiKey: 'x'.repeat(4097) }, 'CREDENTIAL_KEY_INVALID');
  await refuses({ updatedBy: '' }, 'CREDENTIAL_ACTOR_INVALID');
  await refuses({ faxConnectionId: 'fc 1' }, 'CREDENTIAL_RESOURCE_INVALID');
  await refuses({ provider: 'other' }, 'UNSUPPORTED_PROVIDER');
  assert.equal(store.written.length, 0);
});

test('a webhook public key is stored only as the raw 32-byte Ed25519 key, base64', async () => {
  const pem = '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=\n-----END PUBLIC KEY-----';
  const malformed = [
    ['the old ten-byte fixture', 'cHVibGljLWtleQ=='],
    ['a PEM block', pem],
    ['the SPKI DER body without its armour', 'MCowBQYDK2VwAyEAAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE='],
    ['the key as hex', Buffer.alloc(32, 1).toString('hex')],
    ['the API key in the wrong field', KEY],
    ['no padding', PUBLIC_KEY.slice(0, 43)],
    ['url-safe alphabet', PUBLIC_KEY.slice(0, 10) + '-_' + PUBLIC_KEY.slice(12)],
    ['an inner space', PUBLIC_KEY.slice(0, 20) + ' ' + PUBLIC_KEY.slice(21)],
    ['33 bytes', Buffer.alloc(33, 1).toString('base64')],
    ['not a string', 42],
  ];
  for (const [label, publicKey] of malformed) {
    const store = storeDouble();
    await assert.rejects(
      () => putCredential(CONFIG, store, { ...PUT, publicKey }, { randomUUID }),
      error => error.code === 'CREDENTIAL_PUBLIC_KEY_INVALID',
      label,
    );
    assert.equal(store.written.length, 0, `${label} wrote nothing`);
  }
  // Surrounding whitespace from a paste is trimmed, as saveTelnyxSecret does.
  const store = storeDouble();
  await putCredential(CONFIG, store, { ...PUT, publicKey: `  ${PUBLIC_KEY}\n` }, { randomUUID });
  assert.equal(store.written[0].p_public_key, PUBLIC_KEY);
  // And an absent key is still allowed: signature checking is a later switch.
  await putCredential(CONFIG, store, { ...PUT, publicKey: null }, { randomUUID });
  assert.equal(store.written[1].p_public_key, null);
});

test('an unconfirmed write is refused rather than reported as a version', async () => {
  const store = { ...storeDouble(), async credentialPut() { return null; } };
  await assert.rejects(
    () => putCredential(CONFIG, store, PUT, { randomUUID }),
    error => error.code === 'CREDENTIAL_WRITE_UNCONFIRMED',
  );
});

test('this module reads no environment variable, which is the path that regressed three times', () => {
  const source = readFileSync(new URL('./provider-credential.mjs', import.meta.url), 'utf8');
  // Comments name the retired `TELNYX_*` path on purpose, so the scan is over
  // code with comments stripped rather than over the whole file.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.equal(/process\s*\.\s*env|Deno\s*\.\s*env|\benv\s*\./.test(code), false);
});

const MIGRATION = readFileSync(new URL('./migrations/007_provider_credential.sql', import.meta.url), 'utf8');

test('the credential table admits no browser role and carries no policy', () => {
  assert.match(MIGRATION, /alter table public\.cm_integration_credential enable row level security/);
  assert.match(MIGRATION, /alter table public\.cm_integration_credential force row level security/);
  assert.match(MIGRATION, /revoke all on public\.cm_integration_credential from public, anon, authenticated, service_role/);
  // Forced RLS with no policy admits nobody; the definer functions are the only
  // way in. A policy appearing here would be a way in that nothing reviewed.
  assert.equal(/create\s+policy/i.test(MIGRATION), false);
  for (const fn of ['put', 'active', 'status']) {
    assert.match(MIGRATION, new RegExp(`grant execute on function public\\.cm_integration_credential_${fn}\\([^)]*\\) to service_role`));
    assert.match(MIGRATION, new RegExp(`revoke all on function public\\.cm_integration_credential_${fn}\\([^)]*\\) from public, anon, authenticated`));
  }
});

test('the status function does not select the sealed column, and the active one does', () => {
  const body = fn => {
    const start = MIGRATION.indexOf(`create function public.cm_integration_credential_${fn}`);
    assert.notEqual(start, -1, `${fn} not found`);
    const end = MIGRATION.indexOf(`$${fn}$;`, MIGRATION.indexOf(`$${fn}$`, start) + 1);
    assert.notEqual(end, -1, `${fn} body not delimited`);
    return MIGRATION.slice(start, end);
  };
  assert.equal(body('status').includes('api_key_sealed'), false);
  assert.equal(body('active').includes('api_key_sealed'), true);
});

test('one active version per provider is enforced by an index, not by a sort', () => {
  assert.match(MIGRATION, /create unique index cm_integration_credential_one_active\s+on public\.cm_integration_credential \(app_id, provider\) where is_active/);
  // The property that lets the port delete the original's deterministic row
  // selection. Remove the index and the deletion becomes a regression.
  assert.match(MIGRATION, /A retired credential cannot be reactivated/);
  assert.match(MIGRATION, /Credential history is append-only/);
  assert.match(MIGRATION, /Credential rotation records a new version/);
});
