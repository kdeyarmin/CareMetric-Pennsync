// Disposable synthetic databases only. Never accepts an existing source/target DB.
import { execFile } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const LIMIT = 32 * 1024 * 1024;
const MAGIC = Buffer.from('CMSYNDB1');
const AAD = Buffer.from('cm.pennsync.disposable-database-backup.v1');
const root = fileURLToPath(new URL('../../../', import.meta.url));
export const APP = '6a9881683dc68a0bd54f1ef7';
export const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const request = n => `80000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const digest = value => createHash('sha256').update(value).digest('hex');
const q = value => `"${value.replaceAll('"', '""')}"`;
const check = (condition, code) => { if (!condition) throw new Error(code); };
const roleState = async db => digest(JSON.stringify((await db.query(`select rolname,rolsuper,rolinherit,rolcreaterole,
  rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil,rolconfig
  from pg_catalog.pg_roles order by rolname`)).rows));

export function localLabUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('LOCAL_RESTORE_URL_REQUIRED'); }
  check(['postgres:', 'postgresql:'].includes(url.protocol)
    && ['127.0.0.1', '[::1]'].includes(url.hostname)
    && url.pathname === '/postgres' && !url.search && !url.hash
    && /^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(url.username), 'LOCAL_RESTORE_URL_FORBIDDEN');
  return url;
}

export function encryptBackup(plaintext, key) {
  check(Buffer.isBuffer(plaintext) && plaintext.length > 5 && plaintext.length <= LIMIT
    && plaintext.subarray(0, 5).toString() === 'PGDMP' && Buffer.isBuffer(key) && key.length === 32,
  'LOCAL_BACKUP_INPUT_INVALID');
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptBackup(envelope, key, expectedHash) {
  try {
    if (!Buffer.isBuffer(envelope) || envelope.length <= 41 || envelope.length > LIMIT + 36
      || !envelope.subarray(0, 8).equals(MAGIC) || !Buffer.isBuffer(key) || key.length !== 32
      || !/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, envelope.subarray(8, 20));
    decipher.setAAD(AAD); decipher.setAuthTag(envelope.subarray(20, 36));
    const plaintext = Buffer.concat([decipher.update(envelope.subarray(36)), decipher.final()]);
    if (plaintext.subarray(0, 5).toString() !== 'PGDMP' || digest(plaintext) !== expectedHash) {
      plaintext.fill(0); throw new Error();
    }
    return plaintext;
  } catch { throw new Error('LOCAL_BACKUP_AUTHENTICATION_FAILED'); }
}

function childEnvironment(base) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)));
  // Connection values are memory-only; none appears in a child argument or log.
  Object.assign(env, { PGHOST: base.hostname.replace(/^\[|\]$/g, ''), PGPORT: base.port || '5432',
    PGUSER: base.username, PGPASSWORD: decodeURIComponent(base.password), PGCONNECT_TIMEOUT: '10',
    PGSSLMODE: 'disable', PGAPPNAME: 'pennsync_disposable_restore' });
  return env;
}

function command(executable, args, env, input, code) {
  return new Promise((resolve, reject) => {
    const child = execFile(executable, args, { env, encoding: 'buffer', windowsHide: true,
      timeout: 45000, maxBuffer: LIMIT }, (error, stdout, stderr) => {
      // Never return child errors/output on failure: pg diagnostics can contain
      // connection data, statements, record values and credentials.
      if (error || stderr.length) reject(new Error(code)); else resolve(stdout);
    });
    child.stdin.on('error', () => { /* process exit is handled above */ });
    child.stdin.end(input);
  });
}

export async function withRestoreLab({ url, binDir }, run) {
  const base = localLabUrl(url), env = childEnvironment(base);
  check(path.isAbsolute(binDir || ''), 'LOCAL_POSTGRES_BINARY_DIRECTORY_REQUIRED');
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const dump = path.join(binDir, `pg_dump${suffix}`), restore = path.join(binDir, `pg_restore${suffix}`);
  const versions = {};
  for (const [name, executable] of [['dump', dump], ['restore', restore]]) {
    const value = (await command(executable, ['--version'], env, undefined, 'LOCAL_POSTGRES_TOOL_UNAVAILABLE')).toString().trim();
    check(new RegExp(`^pg_${name} \\(PostgreSQL\\) 17\\.[0-9]+(?: \\(.*\\))?$`).test(value), 'LOCAL_POSTGRES_TOOL_VERSION_MISMATCH');
    versions[name] = value;
  }
  const admin = new pg.Client({ connectionString: base.toString(), connectionTimeoutMillis: 10000, statement_timeout: 15000 });
  const owned = new Set(), clients = [];
  await admin.connect();
  try {
    const preflight = await admin.query(`select rolname,rolsuper,rolbypassrls from pg_catalog.pg_roles
      where rolname=any($1::text[]) order by rolname`, [['anon', 'authenticated', 'service_role']]);
    check(JSON.stringify(preflight.rows.map(r => r.rolname)) === JSON.stringify(['anon', 'authenticated', 'service_role'])
      && preflight.rows.filter(r => r.rolname !== 'service_role').every(r => !r.rolsuper && !r.rolbypassrls),
    'LOCAL_EXISTING_SAFE_ROLES_REQUIRED');
    const owner = (await admin.query('select rolsuper from pg_catalog.pg_roles where rolname=current_user')).rows[0];
    check(owner?.rolsuper, 'LOCAL_DISPOSABLE_LAB_ADMIN_REQUIRED');
    const rolesBefore = await roleState(admin);
    const server = (await admin.query('show server_version_num')).rows[0].server_version_num;
    check(Number(server) >= 170000 && Number(server) < 180000, 'LOCAL_POSTGRES_SERVER_VERSION_MISMATCH');
    const nonce = `${process.pid}_${randomBytes(8).toString('hex')}`;
    const names = ['source', 'restored'].map(kind => `pennsync_restore_${kind}_${nonce}`);
    for (const name of names) {
      await admin.query(`create database ${q(name)} template template0`); owned.add(name);
      const dbUrl = new URL(base); dbUrl.pathname = `/${name}`;
      const db = new pg.Client({ connectionString: dbUrl.toString(), statement_timeout: 15000 });
      clients.push(db); await db.connect();
      await db.query("set timezone='UTC'; set search_path=pg_catalog");
    }
    const [source, restored] = clients;
    const dumpOwned = () => command(dump, ['--format=custom', '--no-password', `--dbname=${names[0]}`], env, undefined, 'LOCAL_DUMP_FAILED');
    const restoreOwned = bytes => command(restore, ['--single-transaction', '--exit-on-error', '--no-password',
      `--dbname=${names[1]}`], env, bytes, 'LOCAL_RESTORE_FAILED');
    const result = await run({ source, restored, dumpOwned, restoreOwned, versions, server });
    check(await roleState(admin) === rolesBefore, 'LOCAL_CLUSTER_ROLES_CHANGED');
    return { ...result, checks: { ...result?.checks, existing_cluster_roles_unchanged: true } };
  } finally {
    for (const db of clients) { await db.query('rollback').catch(() => {}); await db.end(); }
    try { for (const name of owned) await admin.query(`drop database ${q(name)}`); }
    finally { await admin.end(); }
  }
}

export async function applyAuthority(db) {
  // The preflight has already verified existing cluster roles. Strip the older
  // test-double role provisioning block so this harness contains no role DDL.
  const bootstrap = await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8');
  const start = bootstrap.indexOf('create schema auth;');
  check(start > 0 && bootstrap.indexOf('create schema auth;', start + 1) === -1, 'LOCAL_AUTH_DOUBLE_LAYOUT_CHANGED');
  await db.query(bootstrap.slice(start));
  const directory = new URL('../supabase/migrations/', import.meta.url);
  const migrations = [];
  for (const file of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
    const bytes = await readFile(new URL(file, directory));
    await db.query(bytes.toString()); migrations.push({ file: `authority/${file}`, sha256: digest(bytes) });
  }
  await db.query(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  return migrations;
}

export function orderedRuntimeMigrationFiles(names) {
  const files = names.filter(name => /\.sql$/i.test(name));
  check(files.length > 0 && files.every(name => /^[0-9]{3,}_[a-z0-9_]+\.sql$/.test(name)),
    'LOCAL_RUNTIME_MIGRATION_NAMES_INVALID');
  const ordered = files.map(file => ({ file, version: BigInt(file.split('_')[0]) }))
    .sort((a, b) => a.version < b.version ? -1 : a.version > b.version ? 1 : 0);
  check(ordered.every((entry, i) => entry.version > 0n && (i === 0 || entry.version !== ordered[i - 1].version)),
    'LOCAL_RUNTIME_MIGRATION_ORDER_INVALID');
  return ordered.map(entry => entry.file);
}

export async function applyRuntime(db, { migrationDirectory = new URL('../../integration-runtime/migrations/', import.meta.url) } = {}) {
  const runtime = new URL('../../integration-runtime/', import.meta.url);
  const entries = await readdir(migrationDirectory, { withFileTypes: true });
  const files = orderedRuntimeMigrationFiles(entries.map(entry => entry.name));
  check(entries.filter(entry => files.includes(entry.name)).every(entry => entry.isFile()),
    'LOCAL_RUNTIME_MIGRATION_FILE_REQUIRED');
  await db.query(await readFile(new URL('tests/platform-double.sql', runtime), 'utf8'));
  const migrations = [];
  for (const file of files) {
    const bytes = await readFile(new URL(file, migrationDirectory));
    await db.query(bytes.toString()); migrations.push({ file: `runtime/${file}`, sha256: digest(bytes) });
  }
  return migrations;
}

export async function actor(db, n, run) {
  await db.query('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid(n), session_id: sid(n),
      role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })]);
    await db.query('set local role authenticated');
    const result = await run(); await db.query('commit'); return result;
  } catch (error) { await db.query('rollback'); throw error; }
}
export async function rpc(db, name, args) {
  check(/^[a-z][a-z0-9_]+$/.test(name), 'LOCAL_RPC_NAME_INVALID');
  return (await db.query(`select public.pennsync_staging_${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args)).rows[0].result;
}

export async function fingerprint(db) {
  const tableRows = await db.query(`select n.nspname as schema,c.relname as name from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and n.nspname !~ '^pg_' and n.nspname<>'information_schema' order by n.nspname,c.relname`);
  const tables = [];
  for (const table of tableRows.rows) {
    const rows = await db.query(`select to_jsonb(t)::text as row from ${q(table.schema)}.${q(table.name)} t order by to_jsonb(t)::text collate "C"`);
    const bytes = rows.rows.map(row => row.row).join('\n');
    check(Buffer.byteLength(bytes) <= LIMIT, 'LOCAL_SYNTHETIC_DATA_LIMIT');
    tables.push({ ...table, count: rows.rowCount, sha256: digest(bytes), row_sha256: rows.rows.map(row => digest(row.row)) });
  }
  const catalogQueries = {
    schemas: `select nspname as name,pg_get_userbyid(nspowner) as owner,nspacl::text as acl from pg_namespace
      where nspname !~ '^pg_' and nspname<>'information_schema' order by nspname`,
    relations: `select n.nspname as schema,c.relname as name,c.relkind as kind,pg_get_userbyid(c.relowner) as owner,
      c.relrowsecurity as rls,c.relforcerowsecurity as force_rls,
      coalesce(c.relacl,acldefault(case when c.relkind='S' then 's'::"char" else 'r'::"char" end,c.relowner))::text as acl
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname !~ '^pg_' and n.nspname<>'information_schema' order by n.nspname,c.relname`,
    columns: `select n.nspname as schema,c.relname as name,a.attname as column,a.attnum as position,format_type(a.atttypid,a.atttypmod) as type,
      a.attnotnull as not_null,a.attidentity as identity,a.attgenerated as generated,a.attacl::text as acl,pg_get_expr(d.adbin,d.adrelid) as default
      from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
      where a.attnum>0 and not a.attisdropped and c.relkind in ('r','v','m','p') and n.nspname !~ '^pg_' and n.nspname<>'information_schema'
      order by n.nspname,c.relname,a.attnum`,
    functions: `select n.nspname as schema,p.proname as name,pg_get_function_identity_arguments(p.oid) as args,
      pg_get_functiondef(p.oid) as definition,pg_get_userbyid(p.proowner) as owner,p.proacl::text as acl,p.prosecdef as definer,p.proconfig as config
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prokind in ('f','p') and n.nspname !~ '^pg_'
      and n.nspname<>'information_schema' order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)`,
    constraints: `select n.nspname as schema,c.conname as name,coalesce(t.relname,'') as table,c.contype as type,
      pg_get_constraintdef(c.oid,true) as definition,c.convalidated as validated from pg_constraint c join pg_namespace n on n.oid=c.connamespace
      left join pg_class t on t.oid=c.conrelid where n.nspname !~ '^pg_' and n.nspname<>'information_schema' order by n.nspname,coalesce(t.relname,''),c.conname`,
    indexes: `select schemaname as schema,tablename,indexname,indexdef from pg_indexes where schemaname !~ '^pg_'
      and schemaname<>'information_schema' order by schemaname,tablename,indexname`,
    triggers: `select n.nspname as schema,c.relname as table,t.tgname as name,t.tgenabled as enabled,pg_get_triggerdef(t.oid) as definition
      from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal
      and n.nspname !~ '^pg_' and n.nspname<>'information_schema' order by n.nspname,c.relname,t.tgname`,
    policies: `select schemaname as schema,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies
      where schemaname !~ '^pg_' order by schemaname,tablename,policyname`,
    default_grants: `select pg_get_userbyid(d.defaclrole) as owner,n.nspname as schema,d.defaclobjtype as type,d.defaclacl::text as acl
      from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace order by owner,schema,type`,
    types: `select n.nspname as schema,t.typname as name,t.typtype as kind,t.typnotnull as not_null,t.typdefault as default,
      pg_get_userbyid(t.typowner) as owner,t.typacl::text as acl,format_type(t.typbasetype,t.typtypmod) as base
      from pg_type t join pg_namespace n on n.oid=t.typnamespace where t.typtype='d'
      and n.nspname !~ '^pg_' order by n.nspname,t.typname`,
  };
  const catalogs = [];
  for (const [name, sql] of Object.entries(catalogQueries)) {
    const rows = (await db.query(sql)).rows;
    catalogs.push({ name, count: rows.length, sha256: digest(JSON.stringify(rows)) });
  }
  const sequences = [];
  for (const row of (await db.query("select schemaname,sequencename,start_value,min_value,max_value,increment_by,cycle,cache_size from pg_sequences where schemaname !~ '^pg_' order by schemaname,sequencename")).rows) {
    const state = (await db.query(`select last_value,is_called from ${q(row.schemaname)}.${q(row.sequencename)}`)).rows[0];
    sequences.push({ ...row, ...state });
  }
  catalogs.push({ name: 'sequences', count: sequences.length, sha256: digest(JSON.stringify(sequences)) });
  return { tables, catalogs, rows: tables.reduce((sum, table) => sum + table.count, 0), sha256: digest(JSON.stringify({ tables, catalogs })) };
}

export async function retainReceipt(receipt) {
  const directory = path.join(root, 'work', 'restore-rehearsal');
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `receipt-${randomBytes(12).toString('hex')}.json`);
  await writeFile(file, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return file;
}

export async function revisionBinding() {
  const output = await command('git', ['-C', root, 'rev-parse', 'HEAD'], process.env, undefined, 'LOCAL_GIT_REVISION_REQUIRED');
  const revision = output.toString().trim(); check(/^[a-f0-9]{40}$/.test(revision), 'LOCAL_GIT_REVISION_REQUIRED');
  const changed = await command('git', ['-C', root, 'status', '--porcelain', '--untracked-files=normal', '--', '.', ':(exclude)work'], process.env, undefined, 'LOCAL_GIT_STATUS_REQUIRED');
  return { revision, dirty_worktree: changed.length !== 0 };
}
