// Real disposable Storage bytes. Requires the owned Auth suite and runtime bootstrap.
// No hosted target, new grant, direct Auth write, production switch or credential output.
import test from 'node:test';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { localStatus, API } from '../../authority-store/tests/http-local-stack.mjs';
import { BUCKET, createStore, performDurable } from '../runtime.mjs';
import { createProviders } from '../providers.mjs';
import { createHandler } from '../app.mjs';
import { hash, stable, limitedBytes, readJson, IntegrationError } from '../safety.mjs';

const APP = '6a9881683dc68a0bd54f1ef7';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FIXTURE = Buffer.from('fixture,value\nSynthetic private-file restoration,42\n', 'utf8');
const SHA = createHash('sha256').update(FIXTURE).digest('hex');
const check = (value, code) => { if (!value) throw new Error(code); };
const actors = [
  { email: 'info+pennsync-admin-a@caremetricai.com', legacy: '6aac58fe36c13a1c49ba7cf8', agency: 'agency-a' },
  { email: 'info+pennsync-admin-b@caremetricai.com', legacy: '6aac5900bf4098977893276d', agency: 'agency-b' },
];

test('real synthetic private file preserves ownership, expiry and restored bytes', { timeout: 180000 }, async () => {
  const status = await localStatus();
  const db = new pg.Client({ connectionString: status.DB_URL, connectionTimeoutMillis: 10000, statement_timeout: 10000 });
  const sessions = new Map();
  const counts = { uploads: 0, signing: 0, deletes: 0, outside: 0 };
  let phase = 'preconditions';
  let ownedPath = null;
  let ownerSubject;
  let admission = true;
  // This dependency-injected local fixture never calls loadConfig or changes its
  // production host pin. Public handlers remain closed with both release flags false.
  const config = { appId: APP, supabaseUrl: API, supabaseKey: status.SECRET_KEY,
    hashKey: randomBytes(32).toString('hex'), encryptionKey: randomBytes(32).toString('hex'),
    configured: true, released: false, browserReleased: false, operations: [], browserOperations: [],
    origins: [], dailyLimit: 20, revision: 'unbound', anthropicKey: '', sendgridKey: '' };

  const localFetch = async (input, options = {}) => {
    const url = new URL(input); const method = options.method || 'GET';
    if (url.origin !== API || url.username || url.password || url.hash) {
      counts.outside++; throw new Error('LOCAL_STORAGE_EGRESS_FORBIDDEN');
    }
    let allowed = false;
    if (url.pathname === '/auth/v1/admin/generate_link' && method === 'POST' && !url.search) {
      const body = JSON.parse(options.body);
      allowed = body.type === 'magiclink' && Object.keys(body).length === 2 && actors.some(a => a.email === body.email);
    } else if (url.pathname === '/auth/v1/verify' && method === 'POST' && !url.search) {
      const body = JSON.parse(options.body);
      allowed = body.type === 'magiclink' && typeof body.token_hash === 'string' && Object.keys(body).length === 2;
    } else if (url.pathname === '/auth/v1/user' && method === 'GET' && !url.search) allowed = true;
    else if (url.pathname === '/auth/v1/logout' && method === 'POST' && url.search === '?scope=local') allowed = true;
    else if (method === 'POST' && !url.search && [
      '/rest/v1/rpc/pennsync_staging_context', '/rest/v1/rpc/cm_integration_reserve',
      '/rest/v1/rpc/cm_integration_finish', '/rest/v1/rpc/cm_integration_file_record',
      '/rest/v1/rpc/cm_integration_file_get',
    ].includes(url.pathname)) allowed = true;
    else {
      const prefix = `/storage/v1/object/${BUCKET}/${APP}/${ownerSubject}/`;
      if (method === 'POST' && !url.search && url.pathname.startsWith(prefix)
        && UUID.test(url.pathname.slice(prefix.length))) {
        const path = url.pathname.slice(`/storage/v1/object/${BUCKET}/`.length);
        if (ownedPath === null) ownedPath = path;
        allowed = path === ownedPath && counts.uploads < 2;
        if (allowed) counts.uploads++;
      } else if (ownedPath && method === 'POST' && !url.search
        && url.pathname === `/storage/v1/object/sign/${BUCKET}/${ownedPath}`) {
        allowed = true;
        if (options.headers?.apikey === status.SECRET_KEY) counts.signing++;
      } else if (ownedPath && method === 'GET'
        && url.pathname === `/storage/v1/object/sign/${BUCKET}/${ownedPath}`) {
        allowed = url.searchParams.getAll('token').length === 1 && !!url.searchParams.get('token')
          && [...url.searchParams.keys()].every(key => key === 'token');
      } else if (ownedPath && method === 'GET' && !url.search
        && ['authenticated', 'public'].some(kind => url.pathname === `/storage/v1/object/${kind}/${BUCKET}/${ownedPath}`)) allowed = true;
      else if (ownedPath && method === 'DELETE' && !url.search && url.pathname === `/storage/v1/object/${BUCKET}`) {
        const body = JSON.parse(options.body);
        allowed = Object.keys(body).length === 1 && Array.isArray(body.prefixes) && body.prefixes.length === 1
          && body.prefixes[0] === ownedPath && counts.deletes === 0 && !admission;
        if (allowed) counts.deletes++;
      }
    }
    check(allowed, 'LOCAL_STORAGE_REQUEST_FORBIDDEN');
    return fetch(url, { ...options, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
  };
  const jsonCall = async (path, body, privileged = false, token) => {
    const key = privileged ? status.SECRET_KEY : status.PUBLISHABLE_KEY;
    const response = await localFetch(`${API}${path}`, { method: 'POST', headers: {
      apikey: key, ...(privileged || token ? { Authorization: `Bearer ${token || key}` } : {}), 'Content-Type': 'application/json',
    }, body: JSON.stringify(body) });
    return { status: response.status, value: await readJson(response, 262144) };
  };
  const mailCount = async () => {
    const response = await fetch('http://127.0.0.1:54324/api/v1/info', { redirect: 'error', signal: AbortSignal.timeout(10000) });
    check(response.ok, 'LOCAL_MAIL_SINK_REQUIRED');
    const result = await readJson(response, 65536);
    check(result.Messages === 0, 'LOCAL_UNEXPECTED_EMAIL');
  };
  const context = async actor => {
    const result = await jsonCall('/rest/v1/rpc/pennsync_staging_context', { p_app_id: APP, p_agency_id: actor.agency }, false, sessions.get(actor.email));
    const c = result.value;
    check(result.status === 200 && c.contract === 'cm.pennsync.authority.staging.v1' && c.staging === true && c.synthetic === true
      && c.app_id === APP && c.auth_user_id === actor.uuid && c.user_id === actor.legacy && c.user_email === actor.email
      && c.agency_id === actor.agency && c.agency?.id === actor.agency && c.agency.status === 'active'
      && c.is_platform_owner === false && c.tenant_role === 'agency_admin' && c.membership_status === 'active'
      && c.membership_id === `membership-${actor.agency === 'agency-a' ? 'admin-a' : 'admin-b'}`
      && c.membership_key === `${actor.agency}:${actor.legacy}` && c.membership_version === 1,
    'LOCAL_CURRENT_FILE_AUTHORITY_REQUIRED');
    return c;
  };
  // Test-only independent adapter: every check reaches the real named RPC with
  // the actor's signed token. This is not the production Base44 authority bridge.
  const authority = async (_config, request, agency) => {
    const actor = actors.find(a => a.agency === agency && request.headers.get('authorization') === `Bearer ${sessions.get(a.email)}`);
    check(actor, 'LOCAL_FILE_ACTOR_REQUIRED');
    const c = await context(actor);
    return { subject: hash(config.hashKey, [APP, agency, c.user_id]), canEmail: false,
      snapshot: stable([c.user_id, c.user_email, agency, c.tenant_role, c.membership_id, c.membership_version, false, c.agency.status]) };
  };
  const store = createStore(config, localFetch);
  const rawProvider = createProviders(config, store, localFetch);
  const provider = async (operation, params, ctx) => {
    check(['UploadPrivateFile', 'CreateFileSignedUrl'].includes(operation), 'LOCAL_FILE_OPERATION_FORBIDDEN');
    const began = Date.now(); const result = await rawProvider(operation, params, ctx);
    return operation === 'CreateFileSignedUrl' ? { ...result, expires_at_ms: began + 60000 } : result;
  };
  const invoke = (actor, operation, requestId, params) => {
    check(admission, 'LOCAL_RESTORE_ADMISSION_PAUSED');
    return performDurable({ config, req: new Request(`${API}/local-fixture`, { headers: { Authorization: `Bearer ${sessions.get(actor.email)}` } }),
      agencyId: actor.agency, operation, requestId, params, provider, store, authority });
  };
  const download = async signed => {
    const response = await localFetch(signed.signed_url);
    check(response.status === 200, 'LOCAL_SIGNED_DOWNLOAD_FAILED');
    const bytes = await limitedBytes(response, 1024);
    check(bytes.length === FIXTURE.length && createHash('sha256').update(bytes).digest('hex') === SHA, 'LOCAL_DOWNLOAD_HASH_MISMATCH');
    return bytes;
  };
  const deniedResponse = async response => {
    check([400, 401, 403, 404].includes(response.status), 'LOCAL_PRIVATE_STORAGE_NOT_DENIED');
    await limitedBytes(response, 65536); // Consume without reporting server text or signed URL.
  };
  const deniedActor = async (actor, file) => {
    let failure;
    try { await invoke(actor, 'CreateFileSignedUrl', randomUUID(), { file_uri: file.file_uri }); } catch (error) { failure = error; }
    check(failure instanceof IntegrationError && failure.status === 403 && failure.code === 'FILE_ACCESS_DENIED', 'LOCAL_FOREIGN_FILE_NOT_DENIED');
  };
  const directDenials = async () => {
    for (const actor of [actors[1], null]) {
      const headers = { apikey: status.PUBLISHABLE_KEY, ...(actor ? { Authorization: `Bearer ${sessions.get(actor.email)}` } : {}) };
      for (const kind of ['authenticated', 'public']) await deniedResponse(await localFetch(`${API}/storage/v1/object/${kind}/${BUCKET}/${ownedPath}`, { headers }));
      await deniedResponse(await localFetch(`${API}/storage/v1/object/sign/${BUCKET}/${ownedPath}`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 60 }) }));
      const denied = await jsonCall('/rest/v1/rpc/cm_integration_file_get', { p_id: ownedPath.split('/').at(-1), p_app_id: APP, p_subject: ownerSubject }, false, actor ? sessions.get(actor.email) : undefined);
      check([401, 403].includes(denied.status) && denied.value.code === '42501', 'LOCAL_FILE_RPC_PRIVILEGES_NOT_DENIED');
    }
  };
  try {
    await db.connect(); await mailCount();
    check((await db.query('select count(*)::int n from auth.users')).rows[0].n === 4, 'LOCAL_EXISTING_FOUR_ACTORS_REQUIRED');
    for (const actor of actors) {
      const rows = (await db.query('select auth_user_id,base44_user_id from pennsync_private.identity_map where app_id=$1 and expected_email=$2 and enabled and revoked_at is null', [APP, actor.email])).rows;
      check(rows.length === 1 && UUID.test(rows[0].auth_user_id) && rows[0].base44_user_id === actor.legacy, 'LOCAL_EXISTING_IDENTITY_REQUIRED');
      actor.uuid = rows[0].auth_user_id;
    }
    phase = 'real existing actor sessions';
    for (const actor of actors) {
      // Supported Admin API generates a local-only link; no invitation/email send.
      const link = await jsonCall('/auth/v1/admin/generate_link', { type: 'magiclink', email: actor.email }, true);
      check(link.status === 200 && link.value.id === actor.uuid && typeof link.value.hashed_token === 'string', 'LOCAL_GENERATED_SESSION_LINK_FAILED');
      const login = await jsonCall('/auth/v1/verify', { type: 'magiclink', token_hash: link.value.hashed_token });
      check(login.status === 200 && login.value.user?.id === actor.uuid && login.value.user?.email === actor.email
        && login.value.user?.role === 'authenticated' && typeof login.value.access_token === 'string', 'LOCAL_SIGNED_FILE_SESSION_FAILED');
      sessions.set(actor.email, login.value.access_token);
      const user = await localFetch(`${API}/auth/v1/user`, { headers: { apikey: status.PUBLISHABLE_KEY, Authorization: `Bearer ${sessions.get(actor.email)}` } });
      check(user.status === 200 && (await readJson(user, 65536)).id === actor.uuid, 'LOCAL_FILE_SESSION_NOT_AUTHENTICATED');
      await context(actor);
    }
    await mailCount();
    ownerSubject = hash(config.hashKey, [APP, actors[0].agency, actors[0].legacy]);
    const foreignSubject = hash(config.hashKey, [APP, actors[1].agency, actors[1].legacy]);
    const handler = createHandler(config, { store, provider, authority });
    for (const route of ['/v1/integrations', '/v2/integrations']) {
      const paused = await handler(new Request(`${API}${route}`, { method: 'POST' }));
      check(paused.status === 503 && (await paused.json()).error === 'EXTERNAL_INTEGRATIONS_NOT_RELEASED', 'LOCAL_RELEASE_GATE_CHANGED');
    }
    phase = 'real upload and exact replay';
    const uploadId = randomUUID();
    const params = { base64: FIXTURE.toString('base64'), content_type: 'text/csv' };
    const file = await invoke(actors[0], 'UploadPrivateFile', uploadId, params);
    check(file.private === true && file.size_bytes === FIXTURE.length && UUID.test(file.file_uri?.slice(7))
      && file.file_uri === `cmfile:${ownedPath?.split('/').at(-1)}`, 'LOCAL_FILE_HANDLE_MISMATCH');
    check(stable(await invoke(actors[0], 'UploadPrivateFile', uploadId, params)) === stable(file) && counts.uploads === 1, 'LOCAL_UPLOAD_REPLAY_REPEATED_WRITE');
    const metadata = await store.fileGet({ p_id: file.file_uri.slice(7), p_app_id: APP, p_subject: ownerSubject });
    check(metadata?.object_path === ownedPath && metadata.app_id === APP && metadata.subject === ownerSubject
      && metadata.sha256 === SHA && metadata.size_bytes === FIXTURE.length && metadata.content_type === 'text/csv', 'LOCAL_OWNER_METADATA_MISMATCH');
    check(await store.fileGet({ p_id: file.file_uri.slice(7), p_app_id: APP, p_subject: foreignSubject }) === null, 'LOCAL_FOREIGN_METADATA_NOT_DENIED');
    await deniedActor(actors[1], file); await directDenials();
    phase = 'real signed bytes and expiry';
    const signId = randomUUID();
    const first = await invoke(actors[0], 'CreateFileSignedUrl', signId, { file_uri: file.file_uri });
    check(first.expires_in === 60, 'LOCAL_SIGNED_LEASE_CHANGED');
    const snapshot = await download(first);
    const token = new URL(first.signed_url).searchParams.get('token');
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    check(Number.isSafeInteger(claims.exp) && claims.exp * 1000 > Date.now() && claims.exp * 1000 < Date.now() + 65000, 'LOCAL_SIGNED_EXPIRY_INVALID');
    const deadline = Math.max(claims.exp * 1000 + 2000, first.expires_at_ms + 2000);
    while (Date.now() < deadline) await delay(Math.min(1000, deadline - Date.now()));
    await deniedResponse(await localFetch(first.signed_url));
    let expired;
    try { await invoke(actors[0], 'CreateFileSignedUrl', signId, { file_uri: file.file_uri }); } catch (error) { expired = error; }
    check(expired instanceof IntegrationError && expired.code === 'SIGNED_URL_EXPIRED_REQUEST_NEW_LINK', 'LOCAL_EXPIRED_DURABLE_LINK_REPLAYED');
    const renewed = await invoke(actors[0], 'CreateFileSignedUrl', randomUUID(), { file_uri: file.file_uri });
    await download(renewed); check(counts.uploads === 1 && counts.signing === 2, 'LOCAL_LINK_RENEWAL_REUPLOADED');
    phase = 'single owned object loss and restoration';
    admission = false;
    const removed = await localFetch(`${API}/storage/v1/object/${BUCKET}`, { method: 'DELETE',
      headers: { apikey: status.SECRET_KEY, Authorization: `Bearer ${status.SECRET_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: [ownedPath] }) });
    check(removed.ok, 'LOCAL_OWNED_OBJECT_REMOVAL_FAILED'); await limitedBytes(removed, 65536);
    check((await db.query('select count(*)::int n from storage.objects where bucket_id=$1 and name=$2', [BUCKET, ownedPath])).rows[0].n === 0, 'LOCAL_OWNED_OBJECT_STILL_PRESENT');
    await deniedResponse(await localFetch(renewed.signed_url));
    const restored = await localFetch(`${API}/storage/v1/object/${BUCKET}/${ownedPath}`, { method: 'POST',
      headers: { apikey: status.SECRET_KEY, Authorization: `Bearer ${status.SECRET_KEY}`, 'Content-Type': metadata.content_type, 'x-upsert': 'false' }, body: snapshot });
    check(restored.ok, 'LOCAL_OWNED_OBJECT_RESTORE_FAILED'); await limitedBytes(restored, 65536);
    check(stable(await store.fileGet({ p_id: metadata.id, p_app_id: APP, p_subject: ownerSubject })) === stable(metadata), 'LOCAL_RESTORED_METADATA_CHANGED');
    admission = true;
    const restoredLink = await invoke(actors[0], 'CreateFileSignedUrl', randomUUID(), { file_uri: file.file_uri });
    await download(restoredLink); await deniedActor(actors[1], file); await directDenials();
    check((await db.query('select count(*)::int n from storage.objects where bucket_id=$1 and name=$2', [BUCKET, ownedPath])).rows[0].n === 1, 'LOCAL_RESTORED_OBJECT_NOT_UNIQUE');
    check(counts.uploads === 2 && counts.deletes === 1 && counts.outside === 0, 'LOCAL_FILE_SIDE_EFFECT_COUNT_CHANGED');
    check((await db.query('select count(*)::int n from auth.users')).rows[0].n === 4, 'LOCAL_AUTH_ACCOUNT_COUNT_CHANGED');
    await mailCount();
  } catch (error) {
    // Never forward token-bearing fetch errors, response bodies, pg detail or assertions.
    const code = /^LOCAL_[A-Z_]+$/.test(error?.message || '') ? error.message
      : error instanceof IntegrationError && /^[A-Z_]+$/.test(error.code) ? error.code : 'DETAILS_SUPPRESSED';
    throw new Error(`LOCAL_PRIVATE_FILE_PROOF_FAILED at ${phase}: ${code}`);
  } finally {
    let cleanupFailed = false;
    for (const token of sessions.values()) {
      try {
        const response = await localFetch(`${API}/auth/v1/logout?scope=local`, { method: 'POST', headers: { apikey: status.PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } });
        if (response.status !== 204) cleanupFailed = true;
        await response.body?.cancel();
      } catch { cleanupFailed = true; }
    }
    sessions.clear(); await db.end().catch(() => {});
    // Throw through a helper so cleanup failures remain visible without raw output.
    check(!cleanupFailed, 'LOCAL_FILE_SESSION_CLEANUP_FAILED');
  }
});
