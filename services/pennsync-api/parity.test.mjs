import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from './authority.mjs';
import * as runtime from '../integration-runtime/authority.mjs';

/**
 * Drift guard for the deliberately duplicated authority module.
 *
 * Each Railway service builds from its own directory, so neither can import
 * the other's copy at runtime. Both must still agree on every value that
 * decides who is authorized: the contract name, the fixed RPC, the permitted
 * targets, the key shape and the accepted context shape. This test is the only
 * thing preventing the two from diverging silently.
 */
test('both services pin the same authority contract, RPC and targets', () => {
  assert.equal(api.AUTHORITY_CONTRACT, runtime.AUTHORITY_CONTRACT);
  assert.equal(api.AUTHORITY_RPC, runtime.AUTHORITY_RPC);
  assert.deepEqual([...api.AUTHORITY_TARGETS].sort(), [...runtime.AUTHORITY_TARGETS].sort());
});

test('both services accept exactly the same publishable keys and targets', () => {
  for (const value of ['sb_publishable_synthetic-acceptance-key', 'sb_secret_synthetic-acceptance-key',
    'eyJhbGciOiJIUzI1NiJ9.synthetic', 'sb_publishable_short', '', null, undefined, 42]) {
    assert.equal(api.validAuthorityKey(value), runtime.validAuthorityKey(value), `key disagreement for ${String(value)}`);
  }
  for (const value of ['https://xxtyweswohkvgkprimwa.supabase.co', 'http://127.0.0.1:54321',
    'https://xxtyweswohkvgkprimwa.supabase.co/', 'https://foreign.supabase.co', 'https://base44.app', '', null]) {
    assert.equal(api.validAuthorityTarget(value), runtime.validAuthorityTarget(value), `target disagreement for ${String(value)}`);
  }
});

test('both services validate the current context identically', () => {
  const base = {
    contract: api.AUTHORITY_CONTRACT, app_id: '694ec16e72e01b60d22f7cbf',
    auth_user_id: '11111111-2222-4333-8444-555555555555', staging: true, synthetic: true,
    user_id: 'user-a', user_email: 'synthetic@example.test', identity_version: 1,
    is_platform_owner: false, agency_id: 'agency-a', membership_id: 'member-a',
    membership_key: 'agency-a:user-a', membership_version: 1, membership_status: 'active',
    tenant_role: 'clinician', agency: { id: 'agency-a', name: 'Synthetic Agency A', status: 'active' },
  };
  const scope = { appId: base.app_id, agencyId: 'agency-a' };
  const variants = [
    base,
    { ...base, contract: 'other' },
    { ...base, is_platform_owner: true },
    { ...base, membership_status: 'revoked' },
    { ...base, membership_version: 0 },
    { ...base, tenant_role: 'platform_owner' },
    { ...base, agency_id: 'agency-b' },
    { ...base, membership_key: 'agency-a:someone-else' },
    { ...base, user_email: 'Synthetic@example.test' },
    { ...base, agency: { id: 'agency-a', name: 'Synthetic Agency A', status: 'suspended' } },
    { ...base, extra: true },
  ];
  for (const value of variants) {
    assert.equal(api.validContext(value, scope), runtime.validContext(value, scope),
      `context disagreement for ${JSON.stringify(value).slice(0, 80)}`);
  }
  // Both accept the canonical context and reject an incomplete one.
  assert.equal(api.validContext(base, scope), true);
  const missing = { ...base }; delete missing.membership_key;
  assert.equal(api.validContext(missing, scope), false);
});

test('the ported API has no Base44 call path of its own', async () => {
  const { readFile, readdir } = await import('node:fs/promises');
  // Calling the Base44 API, importing its SDK, or building a client from a
  // request are the three ways a Base44 execution dependency could reappear.
  // The CORS allowlist deliberately names the Base44-hosted browser origin,
  // which is a permitted caller, not an outbound call.
  const CALL_PATH = /base44\.app\/api|@base44\/sdk|createClientFromRequest|functions\/getMyTenantContext/;
  const files = (await readdir(new URL('./', import.meta.url)))
    .filter(name => name.endsWith('.mjs') && !name.endsWith('.test.mjs'));
  assert.ok(files.length >= 6);
  for (const name of files) {
    const source = await readFile(new URL(`./${name}`, import.meta.url), 'utf8');
    assert.equal(CALL_PATH.test(source), false, `${name} must not reach the Base44 API`);
  }
});
