#!/usr/bin/env node
/** Local synthetic Patient import. No source API, Auth enrollment, or hosted target. */
import { createHash } from 'node:crypto';
import { readSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCHIVE_SOURCE_APPS, withVerifiedArchive } from './tools-pennsync-archive.mjs';

const APP = ARCHIVE_SOURCE_APPS.staging;
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const ACTORS = new Map([
  ['6aac58fe36c13a1c49ba7cf8', 'info+pennsync-admin-a@caremetricai.com'],
  ['6aac58ff8ec706a643a7aa42', 'info+pennsync-clinician-a@caremetricai.com'],
  ['6aac58ffa5f6252bcf92f11f', 'info+pennsync-clinician-empty@caremetricai.com'],
  ['6aac5900bf4098977893276d', 'info+pennsync-admin-b@caremetricai.com'],
]);
const ADMIN = { 'agency-a': '6aac58fe36c13a1c49ba7cf8', 'agency-b': '6aac5900bf4098977893276d' };
const FIELDS = { User: ['id', 'email'], Agency: ['id', 'agency_name', 'status'], Patient: ['id', 'agency_id', 'first_name', 'last_name'] };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value);
const same = (a, b) => json(a) === json(b);
class ImportError extends Error { constructor(code) { super(code); this.code = code; } }
function check(value, code = 'IMPORT_SCOPE_UNSUPPORTED') { if (!value) throw new ImportError(code); }
function exactFields(row, fields) { return same(Object.keys(row).sort(), [...fields].sort()); }
const canonicalName = value => typeof value === 'string' && value === value.trim()
  && /^Synthetic [A-Za-z0-9][A-Za-z0-9 -]{0,109}$/.test(value) && !value.includes('  ');

/** Hash actual target projection, not source completeness or Auth provenance. */
export function patientProjectionSha256(patients) {
  return sha(json([...patients].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .map(p => ({ id: p.id, agency_id: p.agency_id, display_name: p.display_name,
      synthetic: p.synthetic, version: Number(p.version), status: p.status }))));
}

async function parseBatch({ rawPlan, read }, expectedPlanSha256) {
  check(sha(rawPlan) === expectedPlanSha256, 'IMPORT_PLAN_MISMATCH');
  const plan = JSON.parse(rawPlan);
  check(same(plan.source_apps, [APP]) && plan.files.length === 0 && plan.collections.length === 3);
  check(plan.collections.reduce((n, d) => n + d.bytes, 0) + plan.identities.bytes + plan.agencies.bytes <= 256 * 1024);
  const collections = new Map();
  for (const d of plan.collections) {
    check(FIELDS[d.entity] && exactFields(Object.fromEntries(d.fields.map(f => [f, true])), FIELDS[d.entity])
      && d.references.length === 0 && d.file_references.length === 0 && d.opaque_fields.length === 0);
    check(same(d.scope, d.entity === 'User' ? { kind: 'principal' }
      : d.entity === 'Agency' ? { kind: 'agency_root' } : { kind: 'agency', pointer: '/agency_id' }));
    check(d.rows >= 1 && d.rows <= ({ User: 4, Agency: 2, Patient: 100 })[d.entity]);
    collections.set(d.entity, d);
  }
  check(collections.size === 3);
  const rows = async descriptor => {
    const buffers = []; let length = 0;
    try {
      for await (const bytes of read(descriptor.path)) {
        length += bytes.length; check(length <= 256 * 1024); buffers.push(Buffer.from(bytes));
      }
      const raw = Buffer.concat(buffers);
      try { return raw.toString('utf8').split('\n').filter((line, i, all) => line !== '' || i !== all.length - 1).map(JSON.parse); }
      finally { raw.fill(0); }
    } finally { buffers.forEach(b => b.fill(0)); }
  };
  const users = await rows(collections.get('User'));
  const agencies = await rows(collections.get('Agency'));
  const patients = await rows(collections.get('Patient'));
  const identities = new Map((await rows(plan.identities)).map(r => [r.user_id, r]));
  const agencyMap = new Map((await rows(plan.agencies)).map(r => [r.agency_id, r]));
  for (const u of users) check(exactFields(u, FIELDS.User) && ACTORS.get(u.id) === u.email
    && UUID.test(identities.get(u.id)?.target_subject));
  for (const a of agencies) check(exactFields(a, FIELDS.Agency) && canonicalName(a.agency_name)
    && ['active', 'trial'].includes(a.status) && Object.hasOwn(ADMIN, agencyMap.get(a.id)?.target_agency_id)
    && identities.has(ADMIN[agencyMap.get(a.id).target_agency_id]));
  const projection = patients.map(p => {
    check(exactFields(p, FIELDS.Patient) && p.first_name === 'Synthetic'
      && typeof p.last_name === 'string' && p.last_name.length <= 80 && canonicalName(`${p.first_name} ${p.last_name}`));
    return { id: p.id, agency_id: agencyMap.get(p.agency_id).target_agency_id,
      display_name: `${p.first_name} ${p.last_name}`, synthetic: true, version: 1, status: 'active' };
  }).sort((a, b) => a.id < b.id ? -1 : 1);
  return { users, agencies, identities, agencyMap, projection, planSha256: expectedPlanSha256,
    projectionSha256: patientProjectionSha256(projection) };
}

/** Native acceptance target only; hostname aliases and query overrides reject before connecting. */
export function nativeImportTarget(raw) {
  let url; try { url = new URL(raw); } catch { throw new ImportError('IMPORT_TARGET_FORBIDDEN'); }
  check(['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname === '127.0.0.1'
    && ['54339', '5432'].includes(url.port) && url.username === 'postgres' && !url.search && !url.hash
    && /^\/pennsync_import_[a-f0-9]{32}$/.test(url.pathname), 'IMPORT_TARGET_FORBIDDEN');
  return url;
}

async function targetConfiguration(target) {
  if (target?.kind === 'native') return { url: nativeImportTarget(target.url), native: true };
  check(target?.kind === 'owned-stack' && exactFields(target, ['kind']), 'IMPORT_TARGET_FORBIDDEN');
  // Existing harness verifies exact project, worktree, local daemon and ownership marker.
  const { localStatus } = await import('./services/authority-store/tests/http-local-stack.mjs');
  const status = await localStatus();
  return { url: new URL(status.DB_URL), native: false };
}

async function targetPreflight(db, configuration, ownerSha256) {
  const expectedDatabase = configuration.url.pathname.slice(1);
  const result = (await db.query(`select current_database() as database, current_user as role,
    host(inet_server_addr()) as address, inet_server_port() as port,
    (select shobj_description(oid,'pg_database') from pg_database where datname=current_database()) as marker,
    (select (rolsuper or rolbypassrls) from pg_roles where rolname=current_user) as trusted`)).rows[0];
  check(result.database === expectedDatabase && result.role === 'postgres' && result.trusted === true
    && (configuration.native && configuration.url.port === '54339'
      ? result.address === '127.0.0.1' && result.port === 54339 : result.port === 5432), 'IMPORT_TARGET_MISMATCH');
  if (configuration.native) check(result.marker === `PENNSYNC_IMPORT_TARGET_V1:${ownerSha256}`, 'IMPORT_TARGET_UNOWNED');
  const tables = (await db.query(`select c.relname as name,c.relrowsecurity as rls,c.relforcerowsecurity as forced,
    array(select a.attname::text from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped order by a.attnum) as columns,
    c.relowner=(select oid from pg_roles where rolname=current_user) as owned,
    not exists(select 1 from pg_policy p where p.polrelid=c.oid) as no_policies,
    not exists(select 1 from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal) as no_triggers,
    not exists(select 1 from pg_rewrite r where r.ev_class=c.oid) as no_rules,
    not (has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_any_column_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,REFERENCES')
      or has_any_column_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,REFERENCES')
      or has_any_column_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,REFERENCES')) as private
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='pennsync_private' and c.relname in ('patient','archive_patient_import_receipt') and c.relkind='r'
    order by c.relname`)).rows;
  check(tables.length === 2 && tables.every(t => t.rls && t.forced && t.owned && t.no_policies && t.no_triggers && t.no_rules && t.private), 'IMPORT_SCHEMA_UNSAFE');
  check(same(tables[0].columns, ['app_id', 'plan_sha256', 'owner_sha256', 'projection_sha256', 'patient_count', 'state',
    'database_name', 'operator_role', 'created_at', 'rolled_back_at'])
    && same(tables[1].columns, ['app_id', 'id', 'agency_id', 'display_name', 'synthetic', 'version', 'status']), 'IMPORT_SCHEMA_UNSAFE');
}

async function reconcileAuthority(db, batch) {
  // Same lock order as authority RPCs: app, native users, identities, agencies, memberships, patients.
  for (const u of [...batch.users].sort((a, b) => a.id < b.id ? -1 : 1)) {
    const uuid = batch.identities.get(u.id).target_subject;
    const native = (await db.query(`select email from auth.users where id=$1 and deleted_at is null
      and email_confirmed_at is not null and email_confirmed_at<=clock_timestamp() and is_anonymous=false
      and (banned_until is null or banned_until<=clock_timestamp()) for share`, [uuid])).rows;
    check(native.length === 1 && native[0].email === u.email, 'IMPORT_IDENTITY_MISMATCH');
  }
  for (const u of batch.users) {
    const identity = (await db.query(`select expected_email,source_evidence_sha256,version::integer from pennsync_private.identity_map
      where app_id=$1 and auth_user_id=$2 and base44_user_id=$3 and enabled and revoked_at is null
      and verified_at<=clock_timestamp() for share`, [APP, batch.identities.get(u.id).target_subject, u.id])).rows;
    check(identity.length === 1 && identity[0].expected_email === u.email
      && HASH.test(identity[0].source_evidence_sha256) && identity[0].version === 1, 'IMPORT_IDENTITY_MISMATCH');
  }
  for (const a of [...batch.agencies].sort((x, y) => x.id < y.id ? -1 : 1)) {
    const id = batch.agencyMap.get(a.id).target_agency_id;
    const rows = (await db.query(`select name,status,version::integer from pennsync_private.agency
      where app_id=$1 and id=$2 for share`, [APP, id])).rows;
    check(rows.length === 1 && rows[0].name === a.agency_name && rows[0].status === a.status
      && rows[0].version === 1, 'IMPORT_AGENCY_MISMATCH');
  }
  for (const a of batch.agencies) {
    const id = batch.agencyMap.get(a.id).target_agency_id;
    const admin = ADMIN[id];
    const rows = (await db.query(`select version::integer from pennsync_private.membership where app_id=$1 and agency_id=$2
      and auth_user_id=$3 and base44_user_id=$4 and tenant_role='agency_admin' and status='active'
      and revoked_at is null and revoked_by is null for share`, [APP, id, batch.identities.get(admin).target_subject, admin])).rows;
    check(rows.length === 1 && rows[0].version === 1, 'IMPORT_AGENCY_AUTHORITY_MISMATCH');
  }
}

async function currentPatients(db, batch) {
  return (await db.query(`select id,agency_id,display_name,synthetic,version::integer,status from pennsync_private.patient
    where app_id=$1 and id=any($2::text[]) order by id for update`, [APP, batch.projection.map(p => p.id)])).rows;
}

function outcome(state, count, replayed) {
  return { status: state, patients: count, replayed, full_transfer_complete: false,
    source_snapshot_verified: false, credential_migration_verified: false, files_imported: 0,
    production_ready: false, source_mutations: 0, hosted_mutations: 0, contains_row_values: false };
}

/** Owns its connection; any uncertain COMMIT requires a later explicit reconcile. */
export async function applyVerifiedPatientArchive({ archiveDir, key, expectedPlanSha256, ownerKey, target, action = 'import' }) {
  let db; let commitStarted = false;
  try {
    check(Buffer.isBuffer(key) && key.length === 32 && Buffer.isBuffer(ownerKey) && ownerKey.length === 32
      && HASH.test(expectedPlanSha256) && ['import', 'reconcile', 'rollback'].includes(action), 'IMPORT_CONFIGURATION_INVALID');
    // Source authentication, reconciliation and finite-shape checks precede any target connection.
    const batch = await withVerifiedArchive({ archiveDir, key, expectedPlanSha256 }, reader => parseBatch(reader, expectedPlanSha256));
    const ownerSha256 = sha(ownerKey);
    const configuration = await targetConfiguration(target);
    const require = createRequire(new URL('./services/authority-store/package.json', import.meta.url));
    const { Client } = require('pg');
    const url = configuration.url;
    db = new Client({ host: url.hostname, port: Number(url.port), database: url.pathname.slice(1), user: 'postgres',
      password: decodeURIComponent(url.password), ssl: false, connectionTimeoutMillis: 5000,
      statement_timeout: 10000, query_timeout: 12000, application_name: 'pennsync-archive-patient-import',
      options: '-c search_path=pg_catalog -c log_statement=none -c log_min_error_statement=panic -c log_parameter_max_length=0 -c log_parameter_max_length_on_error=0' });
    // Do not forward provider exception text, connection URLs, query bindings or events.
    db.on('error', () => {});
    await db.connect();
    await db.query('begin isolation level read committed');
    await db.query('select pg_advisory_xact_lock(168344,20260918)');
    await targetPreflight(db, configuration, ownerSha256);
    await reconcileAuthority(db, batch);
    const receipt = (await db.query(`select * from pennsync_private.archive_patient_import_receipt
      where app_id=$1 and plan_sha256=$2 for update`, [APP, batch.planSha256])).rows;
    const existing = await currentPatients(db, batch);
    let result;
    if (receipt.length) {
      const r = receipt[0];
      check(r.owner_sha256 === ownerSha256 && r.projection_sha256 === batch.projectionSha256
        && r.patient_count === batch.projection.length && r.database_name === url.pathname.slice(1)
        && r.operator_role === 'postgres', 'IMPORT_RECEIPT_CONFLICT');
      if (r.state === 'rolled_back') {
        check(existing.length === 0 && action !== 'import', 'IMPORT_ROLLED_BACK');
        result = outcome('rolled_back', batch.projection.length, true);
      } else {
        check(r.state === 'applied' && existing.length === batch.projection.length
          && patientProjectionSha256(existing) === batch.projectionSha256, 'IMPORT_TARGET_DRIFT');
        if (action === 'rollback') {
          // Existing foreign keys refuse assignments, referrals, visits or derived artifacts.
          // Never cascade, adopt an unreceipted row, or reset a changed patient version.
          await db.query('delete from pennsync_private.patient where app_id=$1 and id=any($2::text[])',
            [APP, batch.projection.map(p => p.id)]);
          await db.query(`update pennsync_private.archive_patient_import_receipt set state='rolled_back',rolled_back_at=clock_timestamp()
            where app_id=$1 and plan_sha256=$2`, [APP, batch.planSha256]);
          result = outcome('rolled_back', batch.projection.length, false);
        } else result = outcome('reconciled', batch.projection.length, true);
      }
    } else {
      check(existing.length === 0, 'IMPORT_UNOWNED_PATIENT');
      check(action === 'import', 'IMPORT_NOT_APPLIED');
      for (const p of batch.projection) await db.query(`insert into pennsync_private.patient
        (app_id,id,agency_id,display_name,synthetic,version,status) values($1,$2,$3,$4,true,1,'active')`,
      [APP, p.id, p.agency_id, p.display_name]);
      await db.query(`insert into pennsync_private.archive_patient_import_receipt
        (app_id,plan_sha256,owner_sha256,projection_sha256,patient_count,state) values($1,$2,$3,$4,$5,'applied')`,
      [APP, batch.planSha256, ownerSha256, batch.projectionSha256, batch.projection.length]);
      check(patientProjectionSha256(await currentPatients(db, batch)) === batch.projectionSha256, 'IMPORT_TARGET_DRIFT');
      result = outcome('imported', batch.projection.length, false);
    }
    commitStarted = true;
    try { await db.query('commit'); } catch { throw new ImportError('IMPORT_COMMIT_OUTCOME_UNKNOWN'); }
    return result;
  } catch (error) {
    if (db && !commitStarted) { try { await db.query('rollback'); } catch { /* Connection loss rolls back uncommitted work. */ } }
    throw error instanceof ImportError ? error : new ImportError('IMPORT_FAILED_DETAILS_REDACTED');
  } finally { if (db) { try { await db.end(); } catch { /* No content or credentials in cleanup diagnostics. */ } } }
}

function readSecret(env, prefix) {
  const value = env[`${prefix}_BASE64`]; const fd = env[`${prefix}_FD`]; delete env[`${prefix}_BASE64`];
  check((typeof value === 'string') !== (typeof fd === 'string'), 'IMPORT_KEY_REQUIRED');
  let text = value;
  if (fd !== undefined) {
    check(/^(0|[3-9]|[1-9][0-9]{1,3})$/.test(fd), 'IMPORT_KEY_INVALID');
    const buffer = Buffer.alloc(128); let count = 0;
    try {
      while (count < buffer.length) { const n = readSync(Number(fd), buffer, count, buffer.length - count, null); if (!n) break; count += n; }
      check(count < buffer.length && buffer.subarray(0, count).every(b => b < 128), 'IMPORT_KEY_INVALID');
      text = buffer.subarray(0, count).toString('ascii').trim();
    } finally { buffer.fill(0); }
  }
  check(typeof text === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(text), 'IMPORT_KEY_INVALID');
  const bytes = Buffer.from(text, 'base64');
  check(bytes.length === 32 && bytes.toString('base64') === text, 'IMPORT_KEY_INVALID'); return bytes;
}

export async function runPatientImportCli({ argv = process.argv, env = process.env, write = console.log, error = console.error } = {}) {
  let key, ownerKey;
  try {
    check(argv.length === 3 && ['import', 'reconcile', 'rollback'].includes(argv[2]), 'IMPORT_USAGE');
    key = readSecret(env, 'PENNSYNC_ARCHIVE_KEY'); ownerKey = readSecret(env, 'PENNSYNC_IMPORT_OWNER_KEY');
    const target = env.PENNSYNC_IMPORT_TARGET === 'owned-stack' ? { kind: 'owned-stack' }
      : env.PENNSYNC_IMPORT_TARGET === 'native' ? { kind: 'native', url: env.PENNSYNC_IMPORT_DATABASE_URL } : null;
    const result = await applyVerifiedPatientArchive({ archiveDir: env.PENNSYNC_ARCHIVE_DIR, key, ownerKey, target,
      expectedPlanSha256: env.PENNSYNC_IMPORT_PLAN_SHA256, action: argv[2] });
    write(json(result)); return 0;
  } catch (cause) {
    error(cause?.code === 'IMPORT_COMMIT_OUTCOME_UNKNOWN'
      ? 'Import commit outcome is unknown. Reconcile this exact archive and owned target before taking further action.'
      : 'Patient import failed. No source values or credentials are included in this diagnostic.');
    return 1;
  } finally {
    delete env.PENNSYNC_ARCHIVE_KEY_BASE64; delete env.PENNSYNC_IMPORT_OWNER_KEY_BASE64;
    key?.fill(0); ownerKey?.fill(0);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await runPatientImportCli();
