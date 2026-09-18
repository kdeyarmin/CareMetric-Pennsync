// Owned existing Auth fixtures only; no account creation, email, grant, or hosted target.
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import pg from 'pg';
import { localStatus, API } from './http-local-stack.mjs';
import { readJson } from '../../integration-runtime/safety.mjs';
import { applyVerifiedPatientArchive } from '../../../tools-pennsync-archive-import.mjs';
import { IMPORT_APP as APP, importActors, importId, syntheticImportArchive } from '../../../tools-pennsync-archive-import-fixture.mjs';

const check = (value, code) => { if (!value) throw new Error(code); };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
// Only these authored diagnostics may leave the harness; never provider text or SQL.
const IMPORT_CODES = new Set(['IMPORT_CONNECTION_FAILED', 'IMPORT_LOGGING_UNSAFE', 'IMPORT_SCHEMA_UNSAFE',
  'IMPORT_TARGET_MISMATCH', 'IMPORT_TARGET_UNOWNED', 'IMPORT_IDENTITY_MISMATCH', 'IMPORT_AGENCY_MISMATCH',
  'IMPORT_AGENCY_AUTHORITY_MISMATCH', 'IMPORT_PATIENT_ALREADY_OWNED', 'IMPORT_RECEIPT_CONFLICT',
  'IMPORT_FAILED_DETAILS_REDACTED']);
const sameProjection = (actual, expected) => actual && JSON.stringify(Object.keys(actual).sort()) === JSON.stringify(Object.keys(expected).sort())
  && Object.entries(expected).every(([key, value]) => actual[key] === value);

test('verified archive patients are readable through real native sessions and roll back exactly', { timeout: 120000 }, async () => {
  let db, root, baselineSessions, failure; let connected = false; let phase = 'owned-stack';
  const key = randomBytes(32), ownerKey = randomBytes(32), sessions = new Map();
  const nativeSessionIds = new Set();
  let status;
  const actors = importActors.map(a => ({ ...a }));
  const request = async (path, body, privileged = false, token) => {
    check(['/auth/v1/admin/generate_link', '/auth/v1/verify', '/auth/v1/logout?scope=local',
      '/rest/v1/rpc/pennsync_staging_patients', '/rest/v1/rpc/pennsync_staging_patient'].includes(path), 'IMPORT_HTTP_ROUTE');
    if (path === '/auth/v1/admin/generate_link') check(privileged && body.type === 'magiclink'
      && Object.keys(body).length === 2 && actors.some(a => a.email === body.email), 'IMPORT_HTTP_LINK_SCOPE');
    else check(!privileged, 'IMPORT_HTTP_PRIVILEGED_ROUTE');
    const apiKey = privileged ? status.SECRET_KEY : status.PUBLISHABLE_KEY;
    const response = await fetch(`${API}${path}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { apikey: apiKey, 'Content-Type': 'application/json',
        ...(privileged || token ? { Authorization: `Bearer ${token || apiKey}` } : {}) }, body: JSON.stringify(body) });
    return { status: response.status, value: response.status === 204 ? null : await readJson(response, 262144) };
  };
  const mail = async () => {
    const response = await fetch('http://127.0.0.1:54324/api/v1/info', { redirect: 'error', signal: AbortSignal.timeout(10000) });
    check(response.ok && (await readJson(response, 65536)).Messages === 0, 'IMPORT_HTTP_UNEXPECTED_MAIL');
  };
  const rpc = (actor, patient) => request(`/rest/v1/rpc/pennsync_staging_${patient ? 'patient' : 'patients'}`,
    { p_app_id: APP, p_agency_id: actor.agency, ...(patient ? { p_patient_id: patient } : { p_limit: 100, p_after_id: null }) }, false, sessions.get(actor.id));
  const valid = (response, actor) => {
    const v = response.value;
    check(response.status === 200 && v.contract === 'cm.pennsync.authority.staging.v1' && v.app_id === APP
      && v.staging === true && v.synthetic === true && v.auth_user_id === actor.uuid
      && v.context?.auth_user_id === actor.uuid && v.context?.user_id === actor.id
      && v.context?.user_email === actor.email && v.context?.agency_id === actor.agency
      && v.context?.membership_status === 'active' && v.context?.tenant_role === actor.role, 'IMPORT_HTTP_CURRENT_AUTHORITY');
    return v;
  };
  try {
    status = await localStatus();
    db = new pg.Client({ connectionString: status.DB_URL, connectionTimeoutMillis: 10000, statement_timeout: 10000 });
    db.on('error', () => {}); await db.connect(); connected = true; await mail();
    check((await db.query('select count(*)::int n from auth.users')).rows[0].n === 4, 'IMPORT_HTTP_EXISTING_USERS');
    check((await db.query('select count(*)::int n from pennsync_private.archive_patient_import_receipt')).rows[0].n === 0, 'IMPORT_HTTP_FRESH_RECEIPTS');
    for (const a of actors) {
      const rows = (await db.query(`select auth_user_id from pennsync_private.identity_map where app_id=$1
        and base44_user_id=$2 and expected_email=$3 and enabled and revoked_at is null`, [APP, a.id, a.email])).rows;
      check(rows.length === 1 && UUID.test(rows[0].auth_user_id), 'IMPORT_HTTP_EXISTING_IDENTITY'); a.uuid = rows[0].auth_user_id;
    }
    baselineSessions = (await db.query('select id from auth.sessions order by id')).rows.map(row => row.id);
    phase = 'native-existing-logins';
    for (const a of actors) {
      const link = await request('/auth/v1/admin/generate_link', { type: 'magiclink', email: a.email }, true);
      check(link.status === 200 && link.value.id === a.uuid && typeof link.value.hashed_token === 'string', 'IMPORT_HTTP_EXISTING_LINK');
      const login = await request('/auth/v1/verify', { type: 'magiclink', token_hash: link.value.hashed_token });
      // Retain a returned capability for scoped cleanup even if later identity checks fail.
      if (typeof login.value?.access_token === 'string') sessions.set(a.id, login.value.access_token);
      check(login.status === 200 && login.value.user?.id === a.uuid && login.value.user?.email === a.email
        && login.value.user?.role === 'authenticated' && typeof login.value.access_token === 'string', 'IMPORT_HTTP_NATIVE_SESSION');
      const claims = JSON.parse(Buffer.from(login.value.access_token.split('.')[1], 'base64url').toString('utf8'));
      check(claims.sub === a.uuid && UUID.test(claims.session_id) && claims.role === 'authenticated'
        && Number.isSafeInteger(claims.exp) && claims.exp > Date.now() / 1000
        && !baselineSessions.includes(claims.session_id) && !nativeSessionIds.has(claims.session_id), 'IMPORT_HTTP_SESSION_BINDING');
      nativeSessionIds.add(claims.session_id);
      check((await db.query('select count(*)::int n from auth.sessions where id=$1 and user_id=$2',
        [claims.session_id, a.uuid])).rows[0].n === 1, 'IMPORT_HTTP_NATIVE_SESSION_ROW');
    }
    for (const a of [actors[0], actors[3]]) check(valid(await rpc(a), a).items.every(p => ![importId(20), importId(21)].includes(p.id)), 'IMPORT_HTTP_PATIENT_EXISTS');
    phase = 'archive-build';
    root = await mkdtemp(join(tmpdir(), 'pennsync-http-import-'));
    const archive = await syntheticImportArchive({ archiveDir: join(root, 'archive'), key, actors, statuses: ['active', 'active'] });
    const options = { ...archive, ownerKey, target: { kind: 'owned-stack' } };
    phase = 'archive-apply';
    check((await applyVerifiedPatientArchive(options)).status === 'imported', 'IMPORT_HTTP_NOT_APPLIED');
    phase = 'archive-replay';
    check((await applyVerifiedPatientArchive(options)).status === 'reconciled', 'IMPORT_HTTP_REPLAY');
    phase = 'real-rosters-and-denials';
    for (const [a, index] of [[actors[0], 0], [actors[3], 1]]) {
      const id = importId(20 + index);
      const expected = { id, agency_id: a.agency, display_name: `Synthetic Imported ${index ? 'B' : 'A'}`, version: 1, synthetic: true };
      const items = valid(await rpc(a), a).items.filter(p => p.id === id);
      check(items.length === 1 && sameProjection(items[0], expected), 'IMPORT_HTTP_ROSTER_PROJECTION');
      check(sameProjection(valid(await rpc(a, id), a).patient, expected), 'IMPORT_HTTP_DETAIL_PROJECTION');
    }
    for (const [a, id] of [[actors[0], importId(21)], [actors[3], importId(20)], [actors[1], importId(20)], [actors[2], importId(20)]]) {
      const denied = await rpc(a, id); check(denied.status === 403 && denied.value.code === '42501', 'IMPORT_HTTP_SCOPE_DENIAL');
    }
    phase = 'owned-rollback';
    check((await applyVerifiedPatientArchive({ ...options, action: 'rollback' })).status === 'rolled_back', 'IMPORT_HTTP_ROLLBACK');
    check((await applyVerifiedPatientArchive({ ...options, action: 'reconcile' })).status === 'rolled_back', 'IMPORT_HTTP_ROLLBACK_RECONCILE');
    for (const a of [actors[0], actors[3]]) check(valid(await rpc(a), a).items.every(p => ![importId(20), importId(21)].includes(p.id)), 'IMPORT_HTTP_ROLLBACK_ROSTER');
    check((await db.query('select count(*)::int n from auth.users')).rows[0].n === 4, 'IMPORT_HTTP_USER_COUNT_CHANGED');
    await mail();
  } catch (cause) { failure = new Error(`LOCAL_ARCHIVE_IMPORT_HTTP_FAILED:${phase}${IMPORT_CODES.has(cause?.code) ? `:${cause.code}` : ''}`); }
  finally {
    let cleanupFailed = false;
    for (const token of sessions.values()) {
      try { if ((await request('/auth/v1/logout?scope=local', {}, false, token)).status !== 204) cleanupFailed = true; }
      catch { cleanupFailed = true; }
    }
    if (connected && baselineSessions) {
      try {
        const after = (await db.query('select id from auth.sessions order by id')).rows.map(row => row.id);
        if (after.some(id => nativeSessionIds.has(id)) || JSON.stringify(after) !== JSON.stringify(baselineSessions)) cleanupFailed = true;
      } catch { cleanupFailed = true; }
    }
    sessions.clear(); nativeSessionIds.clear(); key.fill(0); ownerKey.fill(0);
    try { await db?.end(); } catch { cleanupFailed = true; }
    if (root) {
      try {
        check(dirname(resolve(root)) === resolve(tmpdir()) && basename(root).startsWith('pennsync-http-import-'), 'IMPORT_HTTP_CLEANUP_PATH');
        await rm(root, { recursive: true, force: true });
      } catch { cleanupFailed = true; }
    }
    if (cleanupFailed) failure = new Error('LOCAL_ARCHIVE_IMPORT_HTTP_FAILED:owned-session-cleanup');
  }
  if (failure) throw failure;
});
