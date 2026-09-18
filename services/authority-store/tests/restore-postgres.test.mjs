import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { s4Fields } from './s4-fixture.mjs';
import { s3Fields } from './s3-fixture.mjs';
import { APP, uid, sid, request, actor, rpc, applyAuthority, applyRuntime, withRestoreLab, localLabUrl,
  digest, encryptBackup, decryptBackup, fingerprint, retainReceipt, revisionBinding } from './restore-rehearsal.mjs';
import { seedRuntime, proveRuntime } from './restore-runtime-fixture.mjs';

const directory = fileURLToPath(new URL('../../../work/restore-rehearsal/', import.meta.url));
const fixedError = message => error => error.message === message;
const equal = (actual, expected, message) => assert.equal(digest(JSON.stringify(actual)), digest(JSON.stringify(expected)), message);

test('database restore rejects foreign sources, existing target names and unauthenticated backup bytes', () => {
  for (const value of [undefined, '', 'postgresql://postgres@remote.example/postgres',
    'postgresql://postgres@127.0.0.1/customer', 'postgresql://postgres@127.0.0.1/postgres?host=remote.example',
    'postgresql://postgres@127.0.0.1/postgres#override', 'postgresql://postgres%20other@127.0.0.1/postgres']) {
    assert.throws(() => localLabUrl(value), /^Error: LOCAL_RESTORE_URL_/);
  }
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
  const rosters = [['patient-a1', 'patient-a2'], ['patient-a1'], [], ['patient-b1']];
  for (const n of [1, 2, 3, 4]) {
    const agency = n === 4 ? 'agency-b' : 'agency-a';
    const context = await actor(db, n, () => rpc(db, 'context', [APP, agency]));
    assert.equal(context.auth_user_id, uid(n)); assert.equal(context.user_id, `6aac00000000${String(n).padStart(12, '0')}`);
    const result = await actor(db, n, () => rpc(db, 'patients', [APP, agency, 50, null]));
    assert.deepEqual(result.items.map(row => row.id), rosters[n - 1]);
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

test('real pg_dump and pg_restore preserve synthetic authority, S3, S4, runtime data and security catalogs', { timeout: 180000 }, async t => {
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
      const runtime = await seedRuntime(source);
      const before = await fingerprint(source);
      assert.equal(before.tables.find(row => row.schema === 'auth' && row.name === 'users').count, 4);
      assert.equal(before.tables.find(row => row.name === 's4_create_receipt').count, 3);
      assert.equal(before.tables.find(row => row.name === 's3_referral').count, 3);
      assert.equal(before.tables.find(row => row.name === 's3_receipt').count, 5);
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
      const after = await fingerprint(restored);
      if (after.sha256 !== before.sha256) t.diagnostic(JSON.stringify({ differing_tables: before.tables.filter((row, i) => row.sha256 !== after.tables[i]?.sha256).map(row => `${row.schema}.${row.name}`), differing_catalogs: before.catalogs.filter((row, i) => row.sha256 !== after.catalogs[i]?.sha256).map(row => row.name) }));
      equal(after, before, 'Exact tables, records, identifiers, receipts, sequences, grants and security definitions');
      const functional = await proveAuthority(restored, authority);
      Object.assign(functional, await proveRuntime(restored, runtime));
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
        source: before, restored: after, checks: { exact_snapshot: true, failed_restore_atomic: true,
          authenticated_backup_negative_cases: 5, same_count_corruption_detected: true, source_unchanged: true, ...functional },
        limitations: ['local Auth, Storage and cron catalog doubles; no provider login/session restore proof',
          'no customer or hosted database', 'no object-byte backup or storage-provider restore',
          'opaque synthetic runtime marker does not prove cached-result decryption or production key recovery',
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
