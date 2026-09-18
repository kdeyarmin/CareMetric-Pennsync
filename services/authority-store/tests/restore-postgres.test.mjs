import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { s4Fields } from './s4-fixture.mjs';
import { s3Fields } from './s3-fixture.mjs';
import { APP, uid, sid, request, actor, rpc, applyAuthority, applyRuntime, withRestoreLab, localLabUrl,
  digest, encryptBackup, decryptBackup, fingerprint, retainReceipt, revisionBinding, orderedRuntimeMigrationFiles } from './restore-rehearsal.mjs';
import { seedRuntime, proveRuntime } from './restore-runtime-fixture.mjs';
import { importPatients, seedImportReceipt, proveImportReceipt } from './restore-import-fixture.mjs';
import { assertRestoreFixtureShape } from './restore-schema-fixture.mjs';
import { seedVisitDisclosures, proveVisitDisclosures } from './restore-visit-fixture.mjs';
import { seedPatientDisclosures, provePatientDisclosures } from './restore-patient-fixture.mjs';

const directory = fileURLToPath(new URL('../../../work/restore-rehearsal/', import.meta.url));
const fixedError = message => error => error.message === message;
const equal = (actual, expected, message) => assert.equal(digest(JSON.stringify(actual)), digest(JSON.stringify(expected)), message);

test('database restore rejects foreign sources, existing target names and unauthenticated backup bytes', async () => {
  for (const value of [undefined, '', 'postgresql://postgres@remote.example/postgres',
    'postgresql://postgres@localhost/postgres', 'postgresql://postgres@localhost./postgres',
    'postgresql://postgres@127.1/postgres', 'postgresql://postgres@[::ffff:127.0.0.1]/postgres',
    'postgresql://postgres@127.0.0.1/customer', 'postgresql://postgres@127.0.0.1/postgres?host=remote.example',
    'postgresql://postgres@127.0.0.1/postgres#override', 'postgresql://postgres%20other@127.0.0.1/postgres']) {
    assert.throws(() => localLabUrl(value), /^Error: LOCAL_RESTORE_URL_/);
  }
  for (const host of ['127.0.0.1', '[::1]']) assert.equal(localLabUrl(`postgresql://postgres@${host}/postgres`).hostname, host);
  // URL rejection must precede binary lookup, DNS resolution or database work.
  await assert.rejects(() => withRestoreLab({ url: 'postgresql://postgres@localhost/postgres',
    binDir: path.join(directory, 'nonexistent-binaries') }, () => assert.fail('Must not reach a database')),
  fixedError('LOCAL_RESTORE_URL_FORBIDDEN'));
  const plaintext = Buffer.from('PGDMPsynthetic binary codec fixture'), key = randomBytes(32);
  const envelope = encryptBackup(plaintext, key), hash = digest(plaintext);
  equal(decryptBackup(envelope, key, hash), plaintext, 'Authenticated backup bytes round-trip');
  const corrupt = Buffer.from(envelope); corrupt[corrupt.length - 1] ^= 1;
  for (const input of [undefined, Buffer.alloc(0), envelope.subarray(0, 20), corrupt]) {
    assert.throws(() => decryptBackup(input, key, hash), fixedError('LOCAL_BACKUP_AUTHENTICATION_FAILED'));
  }
  assert.throws(() => decryptBackup(envelope, randomBytes(32), hash), fixedError('LOCAL_BACKUP_AUTHENTICATION_FAILED'));
  assert.throws(() => decryptBackup(envelope, key, '0'.repeat(64)), fixedError('LOCAL_BACKUP_AUTHENTICATION_FAILED'));
  key.fill(0); plaintext.fill(0);
});

test('runtime migration discovery includes future versions and rejects ambiguous SQL ordering', () => {
  assert.deepEqual(orderedRuntimeMigrationFiles(['1000_later.sql', 'README.md', '010_next.sql', '006_future.sql', '001_first.sql']),
    ['001_first.sql', '006_future.sql', '010_next.sql', '1000_later.sql']);
  for (const names of [[], ['README.md'], ['001_first.sql', 'unversioned.sql'], ['001_first.sql', '006_UPPER.SQL']]) {
    assert.throws(() => orderedRuntimeMigrationFiles(names), fixedError('LOCAL_RUNTIME_MIGRATION_NAMES_INVALID'));
  }
  for (const names of [['001_first.sql', '0001_duplicate.sql'], ['000_zero.sql']]) {
    assert.throws(() => orderedRuntimeMigrationFiles(names), fixedError('LOCAL_RUNTIME_MIGRATION_ORDER_INVALID'));
  }
});

test('all native PostgreSQL harnesses reject localhost before DNS or socket connections', async () => {
  const harnesses = [
    ['./postgres.test.mjs', 'Only a loopback PostgreSQL /postgres test administrator is allowed'],
    ['./s3-postgres.test.mjs', 'Only loopback PostgreSQL /postgres is allowed'],
    ['./s4-postgres.test.mjs', 'Only loopback PostgreSQL /postgres is allowed'],
    ['./visit-documentation-postgres.test.mjs', 'Only loopback PostgreSQL /postgres is allowed'],
    ['./patient-context-postgres.test.mjs', 'Only loopback PostgreSQL /postgres is allowed'],
    ['../../integration-runtime/tests/postgres-bootstrap.test.mjs', 'Only an explicit loopback PostgreSQL test lab is allowed'],
  ];
  for (const [file, expectedError] of harnesses) {
    const script = `import net from 'node:net'; import dns from 'node:dns';
      net.Socket.prototype.connect = () => process.exit(41);
      dns.lookup = () => process.exit(42);
      try { await import(${JSON.stringify(new URL(file, import.meta.url).href)}); }
      catch (error) { process.exit(error.message === ${JSON.stringify(expectedError)} ? 0 : 44); }
      process.exit(43);`;
    const status = await new Promise(resolve => {
      // Child diagnostics are intentionally not surfaced. Fixed exit statuses
      // distinguish URL rejection from attempted networking/accepted imports.
      execFile(process.execPath, ['--input-type=module', '--eval', script], { windowsHide: true, timeout: 10000,
        env: { ...process.env, PENNSYNC_TEST_PG_URL: 'postgresql://postgres@localhost:9/postgres' } },
      error => resolve(error?.code ?? 0));
    });
    assert.equal(status, 0, `${file} must reject localhost before DNS or connection work`);
  }
});

test('a future runtime SQL file is applied and unreviewed fixture schema changes fail closed', { timeout: 180000 }, async () => {
  const tracked = new URL('../../integration-runtime/migrations/', import.meta.url);
  const files = orderedRuntimeMigrationFiles(await readdir(tracked));
  const future = `${(BigInt(files.at(-1).split('_')[0]) + 1n).toString().padStart(3, '0')}_future_restore_fixture.sql`;
  const futureSql = Buffer.from(`create table public.restore_future_fixture(id integer primary key);
    insert into public.restore_future_fixture values(42);
    create schema pgx; create table pgx.restore_future_fixture(id integer primary key);
    insert into pgx.restore_future_fixture values(43);`);
  await mkdir(directory, { recursive: true });
  const owned = await mkdtemp(path.join(directory, 'migration-fixture-'));
  const written = [];
  try {
    for (const file of [...files, future]) {
      await writeFile(path.join(owned, file), file === future ? futureSql : await readFile(new URL(file, tracked)), { flag: 'wx' });
      written.push(file);
    }
    await withRestoreLab({ url: process.env.PENNSYNC_TEST_PG_URL, binDir: process.env.PENNSYNC_TEST_PG_BIN }, async ({ source }) => {
      await applyAuthority(source);
      const migrations = await applyRuntime(source, { migrationDirectory: pathToFileURL(`${owned}${path.sep}`) });
      assert.deepEqual(migrations.map(entry => entry.file), [...files, future].map(file => `runtime/${file}`));
      assert.equal(migrations.at(-1).sha256, digest(futureSql));
      assert.equal((await source.query('select id from public.restore_future_fixture')).rows[0].id, 42);
      await seedRuntime(source);
      await assert.rejects(() => assertRestoreFixtureShape(source), fixedError('LOCAL_RESTORE_FIXTURE_SCHEMA_CHANGED'));
      await source.query('drop table public.restore_future_fixture');
      // pgx is user-owned: SQL LIKE 'pg_%' incorrectly treats '_' as any
      // character and would silently exclude this schema from both inventories.
      await assert.rejects(() => assertRestoreFixtureShape(source), fixedError('LOCAL_RESTORE_FIXTURE_SCHEMA_CHANGED'));
      const extra = await fingerprint(source);
      assert.equal(extra.tables.find(table => table.schema === 'pgx' && table.name === 'restore_future_fixture')?.count, 1);
      await source.query('drop table pgx.restore_future_fixture; drop schema pgx');
      const reviewed = await fingerprint(source);
      for (const name of ['schemas', 'relations', 'columns', 'constraints', 'indexes']) {
        assert.notEqual(extra.catalogs.find(row => row.name === name).sha256, reviewed.catalogs.find(row => row.name === name).sha256);
      }
      await assertRestoreFixtureShape(source);
      await source.query('alter table public.cm_integration_files add column unreviewed_fixture_column text');
      await assert.rejects(() => assertRestoreFixtureShape(source), fixedError('LOCAL_RESTORE_FIXTURE_SCHEMA_CHANGED'));
    });
  } finally {
    for (const file of written) await unlink(path.join(owned, file));
    await rmdir(owned);
  }
});

async function seedAuthority(db) {
  await actor(db, 1, async () => {
    await rpc(db, 'assignment', [APP, 'agency-a', 'patient-a2', 'membership-3', 'grant', 1, 1, 0, request(1)]);
    await rpc(db, 'assignment', [APP, 'agency-a', 'patient-a2', 'membership-3', 'revoke', 1, 1, 1, request(2)]);
  });
  const artifacts = [];
  for (const [n, agency, patient] of [[1, 'agency-a', 'patient-a1'], [2, 'agency-a', 'patient-a1'], [4, 'agency-b', 'patient-b1']]) {
    const args = [APP, agency, patient, 1, 1, request(n + 10)];
    const result = await actor(db, n, () => rpc(db, 's4_create', [...args, JSON.stringify(s4Fields())]));
    artifacts.push({ n, args, result });
  }
  const referrals = [];
  for (const [n, agency, patient, id, accepted] of [[1, 'agency-a', 'patient-a1', 100, false],
    [1, 'agency-a', 'patient-a2', 110, true], [4, 'agency-b', 'patient-b1', 120, true]]) {
    const scope = [APP, agency, patient, 1, 1];
    const createArgs = [...scope, request(id), JSON.stringify(s3Fields())];
    const created = await actor(db, n, () => rpc(db, 's3_create', createArgs));
    const readArgs = [...scope, created.referral.id];
    const confirmArgs = [...readArgs, 1, request(id + 1)];
    const confirmed = accepted ? await actor(db, n, () => rpc(db, 's3_confirm', confirmArgs)) : null;
    referrals.push({ n, createArgs, readArgs, confirmArgs, created, confirmed });
  }
  return { artifacts, referrals };
}

async function proveAuthority(db, { artifacts, referrals }) {
  const rosters = [[importPatients[0].id, 'patient-a1', 'patient-a2'], ['patient-a1'], [], [importPatients[1].id, 'patient-b1']];
  for (const n of [1, 2, 3, 4]) {
    const agency = n === 4 ? 'agency-b' : 'agency-a';
    const context = await actor(db, n, () => rpc(db, 'context', [APP, agency]));
    assert.equal(context.auth_user_id, uid(n)); assert.equal(context.user_id, `6aac00000000${String(n).padStart(12, '0')}`);
    const result = await actor(db, n, () => rpc(db, 'patients', [APP, agency, 50, null]));
    assert.deepEqual(result.items.map(row => row.id), rosters[n - 1]);
  }
  for(const n of [1,4]) {
    const agency=n===4?'agency-b':'agency-a';
    const result=await actor(db,n,()=>rpc(db,'referral_patients',[APP,agency,50,null]));
    assert.deepEqual(result.items.map(row=>row.id),rosters[n-1]);
    const selected=await actor(db,n,()=>rpc(db,'referral_patient',[APP,agency,result.items[0].id]));
    assert.deepEqual(selected.patient,result.items[0]);
  }
  for (const [n, agency, patient] of [[1, 'agency-a', 'patient-b1'], [2, 'agency-a', 'patient-a2'],
    [2, 'agency-a', 'patient-b1'], [3, 'agency-a', 'patient-a1'], [3, 'agency-a', 'patient-a2'],
    [3, 'agency-a', 'patient-b1'], [4, 'agency-b', 'patient-a1'], [4, 'agency-b', 'patient-a2']]) {
    await assert.rejects(() => actor(db, n, () => rpc(db, 'patient', [APP, agency, patient])), error => error.code === '42501');
  }
  for (const { n, args, result } of artifacts) {
    equal(await actor(db, n, () => rpc(db, 's4_create', [...args, JSON.stringify(s4Fields())])), { ...result, replayed: true }, 'Restored S4 exact create retry');
    equal(await actor(db, n, () => rpc(db, 's4_read', args)), { ...result, replayed: true }, 'Restored S4 artifact and receipt recovery');
  }
  for (const { n, createArgs, readArgs, confirmArgs, created, confirmed } of referrals) {
    const page=await actor(db,n,()=>rpc(db,'s3_list',[...readArgs.slice(0,5),50,null]));
    assert.deepEqual(page.items.map(item=>item.referral),[(confirmed||created).referral]);
    assert.equal(page.next_cursor,null);
    equal((await actor(db, n, () => rpc(db, 's3_read', readArgs))).referral,
      (confirmed || created).referral, 'Restored S3 current referral is exact');
    if (confirmed) {
      equal(await actor(db, n, () => rpc(db, 's3_confirm', confirmArgs)), { ...confirmed, replayed: true }, 'Restored S3 confirmation receipt');
      await assert.rejects(() => actor(db, n, () => rpc(db, 's3_create', createArgs)), error => error.code === 'PT409');
    } else equal(await actor(db, n, () => rpc(db, 's3_create', createArgs)), { ...created, replayed: true }, 'Restored S3 pending create receipt');
  }
  for (const n of [2, 3, 4]) {
    for (const [method, args] of [['s3_create', referrals[0].createArgs], ['s3_confirm', referrals[0].confirmArgs], ['s3_read', referrals[0].readArgs]]) {
      await assert.rejects(() => actor(db, n, () => rpc(db, method, args)), error => error.code === '42501');
    }
  }
  // Changed payload and the obsolete grant receipt must not gain a second write.
  await assert.rejects(() => actor(db, 1, () => rpc(db, 's4_create', [...artifacts[0].args,
    JSON.stringify(s4Fields({ nurse_notes: 'Synthetic changed retry' }))])), error => error.code === 'PT409');
  await assert.rejects(() => actor(db, 1, () => rpc(db, 'assignment',
    [APP, 'agency-a', 'patient-a2', 'membership-3', 'grant', 1, 1, 0, request(1)])), error => error.code === 'PT409');
  const tables = (await db.query("select tablename from pg_tables where schemaname='pennsync_private' order by tablename")).rows;
  for (const table of tables) {
    await assert.rejects(() => actor(db, 1, () => db.query(`select * from pennsync_private."${table.tablename}"`)), error => error.code === '42501');
  }
  // Defense in depth remains effective even if trusted maintenance accidentally
  // grants SELECT. Roll back the test grant so catalog fingerprints stay exact.
  await db.query('begin');
  try {
    await db.query('grant select on all tables in schema pennsync_private to authenticated');
    await db.query('set local role authenticated');
    for (const table of tables) assert.equal((await db.query(`select * from pennsync_private."${table.tablename}"`)).rowCount, 0);
  } finally { await db.query('rollback'); }
  for (const mutation of [
    ['delete from auth.sessions where id=$1', [sid(2)], '28000', 2, 's4_read', artifacts[1].args],
    ["update pennsync_private.membership set status='revoked',version=2,revoked_at=clock_timestamp(),revoked_by=$1 where id='membership-2'", [uid(1)], '42501', 2, 's4_read', artifacts[1].args],
    ['delete from auth.sessions where id=$1', [sid(1)], '28000', 1, 's3_read', referrals[0].readArgs],
    ["update pennsync_private.membership set status='revoked',version=2,revoked_at=clock_timestamp(),revoked_by=$1 where id='membership-1'", [uid(4)], '42501', 1, 's3_read', referrals[0].readArgs],
  ]) {
    await db.query('begin');
    try {
      await db.query('select pg_advisory_xact_lock(168344,20260918)'); await db.query(mutation[0], mutation[1]);
      await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid(mutation[3]), session_id: sid(mutation[3]), role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })]);
      await db.query('set local role authenticated');
      await assert.rejects(() => rpc(db, mutation[4], mutation[5]), error => error.code === mutation[2]);
    } finally { await db.query('rollback'); }
  }
  return { four_role_rosters: true, cross_tenant_patient_denials: 8, immutable_identity_mapping: true,
    exact_artifact_receipt_replay: true, exact_referral_receipt_replay: true, restored_s3_scope_denials: 9, stale_changed_requests_denied: true,
    direct_private_table_denials: tables.length, force_rls_after_accidental_select: true,
    native_session_and_membership_revocation: true };
}

test('real pg_dump and pg_restore preserve synthetic authority, import receipts, S3, S4, runtime data and security catalogs', { timeout: 180000 }, async t => {
  const binding = await revisionBinding();
  const key = randomBytes(32);
  let plaintext, restoredPlaintext, envelope, file, ownedDirectory, receipt;
  let fileCreated = false;
  try {
    receipt = await withRestoreLab({ url: process.env.PENNSYNC_TEST_PG_URL,
      binDir: process.env.PENNSYNC_TEST_PG_BIN }, async ({ source, restored, dumpOwned, restoreOwned, versions, server }) => {
      const migrations = await applyAuthority(source);
      migrations.push(...await applyRuntime(source));
      const authority = await seedAuthority(source);
      const disclosures = await seedVisitDisclosures(source, authority.artifacts);
      const patientDisclosures = await seedPatientDisclosures(source);
      const runtime = await seedRuntime(source);
      const imported = await seedImportReceipt(source);
      await assertRestoreFixtureShape(source);
      const before = await fingerprint(source);
      assert.equal(before.tables.find(row => row.schema === 'auth' && row.name === 'users').count, 4);
      assert.equal(before.tables.find(row => row.name === 's4_create_receipt').count, 3);
      assert.equal(before.tables.find(row => row.name === 's3_referral').count, 3);
      assert.equal(before.tables.find(row => row.name === 's3_receipt').count, 5);
      assert.equal(before.tables.find(row => row.name === 'archive_patient_import_receipt').count, 1);
      assert.equal(before.tables.find(row => row.schema === 'pennsync_private' && row.name === 'patient').count, 5);
      assert.equal(before.tables.find(row => row.name === 'visit_list_disclosure_audit').count, 3);
      assert.equal(before.tables.find(row => row.name === 'patient_context').count, 2);
      assert.equal(before.tables.find(row => row.name === 'patient_disclosure_audit').count, 6);
      plaintext = await dumpOwned();
      assert.equal(plaintext.subarray(0, 5).toString(), 'PGDMP');
      const backupHash = digest(plaintext);
      envelope = encryptBackup(plaintext, key);
      await mkdir(directory, { recursive: true });
      ownedDirectory = await mkdtemp(path.join(directory, 'owned-'));
      file = path.join(ownedDirectory, 'synthetic-database.aesgcm');
      await writeFile(file, envelope, { flag: 'wx', mode: 0o600 });
      fileCreated = true;
      const retained = await readFile(file);
      assert.equal(digest(retained), digest(envelope));
      const damaged = Buffer.from(retained); damaged[damaged.length - 1] ^= 1;
      for (const bad of [undefined, retained.subarray(0, 20), damaged]) {
        assert.throws(() => decryptBackup(bad, key, backupHash), fixedError('LOCAL_BACKUP_AUTHENTICATION_FAILED'));
      }
      assert.throws(() => decryptBackup(retained, randomBytes(32), backupHash), fixedError('LOCAL_BACKUP_AUTHENTICATION_FAILED'));
      assert.throws(() => decryptBackup(retained, key, '0'.repeat(64)), fixedError('LOCAL_BACKUP_AUTHENTICATION_FAILED'));
      restoredPlaintext = decryptBackup(retained, key, backupHash);
      // A truncated native archive must fail without creating partial catalog or
      // data state; --single-transaction and --exit-on-error enforce this.
      const empty = await fingerprint(restored);
      assert.equal(empty.tables.length, 0);
      await assert.rejects(() => restoreOwned(restoredPlaintext.subarray(0, Math.floor(restoredPlaintext.length * 0.9))), fixedError('LOCAL_RESTORE_FAILED'));
      equal(await fingerprint(restored), empty, 'Failed native restore rolled back all objects');
      await restoreOwned(restoredPlaintext);
      await assertRestoreFixtureShape(restored);
      const after = await fingerprint(restored);
      if (after.sha256 !== before.sha256) t.diagnostic(JSON.stringify({ differing_tables: before.tables.filter((row, i) => row.sha256 !== after.tables[i]?.sha256).map(row => `${row.schema}.${row.name}`), differing_catalogs: before.catalogs.filter((row, i) => row.sha256 !== after.catalogs[i]?.sha256).map(row => row.name) }));
      equal(after, before, 'Exact tables, records, identifiers, receipts, sequences, grants and security definitions');
      const functional = await proveAuthority(restored, authority);
      Object.assign(functional, await proveRuntime(restored, runtime));
      Object.assign(functional, await proveImportReceipt(restored, imported));
      Object.assign(functional, await proveVisitDisclosures(restored, disclosures));
      Object.assign(functional, await provePatientDisclosures(restored, patientDisclosures));
      equal(await fingerprint(restored), before, 'Read/retry/security probes preserved restored snapshot');
      await restored.query('begin');
      try {
        await restored.query("update pennsync_private.patient set display_name='Synthetic wrong restored patient' where id='patient-a1'");
        const changed = await fingerprint(restored);
        assert.equal(changed.rows, before.rows); assert.notEqual(changed.sha256, before.sha256);
      } finally { await restored.query('rollback'); }
      equal(await fingerprint(source), before, 'Source snapshot remained unchanged');
      return { contract: 'cm.pennsync.disposable-database-restore.v1', kind: 'local_synthetic_database_rehearsal',
        ...binding, completed_at: new Date().toISOString(), migrations, tools: versions, server_version_num: server,
        backup: { format: 'PostgreSQL custom', encryption: 'AES-256-GCM', plaintext_sha256: backupHash,
          encrypted_sha256: digest(envelope), plaintext_bytes: plaintext.length,
          key_retained: false, backup_retained: false, plaintext_written_to_disk: false },
        source: before, restored: after, checks: { exact_snapshot: true, reviewed_fixture_schema: true, failed_restore_atomic: true,
          authenticated_backup_negative_cases: 5, same_count_corruption_detected: true, source_unchanged: true, ...functional },
        limitations: ['local Auth, Storage and cron catalog doubles; no provider login/session restore proof',
          'no customer or hosted database', 'no object-byte backup or storage-provider restore',
          'opaque synthetic runtime marker does not prove cached-result decryption or production key recovery',
          'import receipt is a representative synthetic fixture; archive import execution and restored-target ownership rebind are not proved',
          'global role configuration, extensions and provider services are outside this database backup',
          'no external secret/key escrow or unattended disaster recovery',
          'no write freeze, in-flight or final-delta reconciliation',
          'no frontend/native artifact restoration or production routing change',
          'does not satisfy archive_restore, sessions, rollback or cutover release gates'] };
    });
  } finally {
    key.fill(0); plaintext?.fill(0); restoredPlaintext?.fill(0);
    if (fileCreated) await unlink(file);
    if (ownedDirectory) await rmdir(ownedDirectory);
  }
  const retainedReceipt = await retainReceipt(receipt);
  t.diagnostic(`Sanitized snapshot/hash receipt: ${retainedReceipt}`);
});
