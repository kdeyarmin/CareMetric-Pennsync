import { readFile, readdir } from 'node:fs/promises';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { independentAuthorize, validContext as runtimeValidContext, AUTHORITY_CONTRACT } from '../../integration-runtime/authority.mjs';
import { validContext as apiValidContext, CONTEXT_KEYS } from '../../pennsync-api/authority.mjs';

/**
 * Contract guard between the owned authority store and the two services that
 * read it.
 *
 * Both services validate the context RPC's response against an exact key set
 * written from the documented contract. If the SQL ever returns a different
 * shape, those validators deny every request, and nothing else in the suite
 * would catch it: the services' own tests use fixtures the services define.
 *
 * This runs the real migrations in PGlite and feeds the actual RPC response
 * into both validators.
 */
const app = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let db; let fixtures;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const migrationDir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(migrationDir)).filter(n => n.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, migrationDir), 'utf8'));
  }
  fixtures = await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8');
});
after(async () => db?.close());

async function login(n) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
    sub: uid(n), session_id: sid(n), role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
  })]);
  await db.exec('set local role authenticated');
}

async function context(actor, agency) {
  const { rows } = await db.query('select public.pennsync_staging_context($1,$2) as result', [app, agency]);
  return rows[0].result;
}

function scenario(name, fn) {
  test(name, async () => {
    await db.exec('begin');
    try { await db.exec(fixtures); await fn(); }
    finally { await db.exec('rollback'); }
  });
}

scenario('the real context response satisfies both services\' exact key contract', async () => {
  await login(1);
  const result = await context(1, 'agency-a');
  // The key set is the contract. A field added or removed in SQL fails here
  // rather than denying every request at runtime.
  assert.deepEqual(Object.keys(result).sort(), [...CONTEXT_KEYS].sort());
  assert.equal(result.contract, AUTHORITY_CONTRACT);
  const scope = { appId: app, agencyId: 'agency-a' };
  assert.equal(runtimeValidContext(result, scope), true);
  assert.equal(apiValidContext(result, scope), true);
});

scenario('every seeded actor and agency produces an accepted context', async () => {
  for (const [actor, agency, role] of [[1, 'agency-a', 'agency_admin'], [2, 'agency-a', 'clinician'],
    [3, 'agency-a', 'clinician'], [4, 'agency-b', 'agency_admin']]) {
    await login(actor);
    const result = await context(actor, agency);
    const scope = { appId: app, agencyId: agency };
    assert.equal(runtimeValidContext(result, scope), true, `runtime rejected actor ${actor}`);
    assert.equal(apiValidContext(result, scope), true, `api rejected actor ${actor}`);
    assert.equal(result.tenant_role, role);
    assert.equal(result.is_platform_owner, false);
  }
});

scenario('the external runtime authorizes end to end against the real response', async () => {
  await login(1);
  const result = await context(1, 'agency-a');
  const config = {
    appId: app,
    authorityUrl: 'http://127.0.0.1:54321',
    authorityKey: 'sb_publishable_synthetic-acceptance-key',
    hashKey: '2'.repeat(64),
  };
  const request = new Request('https://runtime.example.test/v1/integrations', {
    method: 'POST',
    headers: { authorization: 'Bearer synthetic-native-session-token' },
    body: '{}',
  });
  // The response travels as JSON, exactly as it would from PostgREST.
  const actor = await independentAuthorize(config, request, 'agency-a',
    async () => new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } }));
  assert.deepEqual(actor.binding, {
    user_id: result.user_id, agency_id: 'agency-a', membership_id: result.membership_id,
    membership_version: result.membership_version, tenant_role: result.tenant_role, is_platform_owner: false,
  });
  assert.equal(actor.canEmail, true);
  assert.match(actor.subject, /^[a-f0-9]{64}$/);
  // No credential or native identifier leaks into the durable subject.
  assert.equal(actor.subject.includes(result.auth_user_id), false);
});

scenario('a foreign agency is refused by the database, not by the validators', async () => {
  await login(1);
  await assert.rejects(() => context(1, 'agency-b'));
});
