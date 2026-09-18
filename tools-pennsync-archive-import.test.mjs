import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { applyVerifiedPatientArchive, nativeImportTarget, runPatientImportCli } from './tools-pennsync-archive-import.mjs';
import { verifyArchive, withVerifiedArchive } from './tools-pennsync-archive.mjs';
import { IMPORT_APP, importActors, importId, importSha, syntheticImportArchive } from './tools-pennsync-archive-import-fixture.mjs';

async function fixture(t, alter) {
  const root = await mkdtemp(join(tmpdir(), 'pennsync-import-contract-'));
  t.after(async () => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir())); assert.ok(basename(root).startsWith('pennsync-import-contract-'));
    await rm(root, { recursive: true, force: true });
  });
  const f = await syntheticImportArchive({ archiveDir: join(root, 'archive'), key: randomBytes(32), alter });
  t.after(() => f.key.fill(0)); return f;
}

test('verified callback preserves exact bytes and is unavailable after scope closure', async t => {
  const f = await fixture(t); let lateRead; let planBuffer;
  const result = await withVerifiedArchive(f, async ({ rawPlan, read, report }) => {
    assert.equal(report.counts.records, 8); planBuffer = rawPlan; lateRead = read;
    for (const [path, expected] of f.original) {
      const parts = []; for await (const b of read(path)) parts.push(Buffer.from(b));
      assert.deepEqual(Buffer.concat(parts), expected);
    }
    rawPlan.fill(0); // Caller mutation must not change canonical descriptor lookup.
    await assert.rejects(async () => { for await (const b of read('../foreign')) void b; }, { code: 'manifest_mismatch' });
    return 'callback result';
  });
  assert.equal(result, 'callback result'); assert.equal(planBuffer.every(b => b === 0), true);
  await assert.rejects(async () => { for await (const b of lateRead('Patient.jsonl')) void b; }, { code: 'reader_closed' });
});

test('corrupt last frame and wrong key never reach verified callback', async t => {
  const f = await fixture(t); let calls = 0;
  await assert.rejects(withVerifiedArchive({ ...f, key: randomBytes(32) }, () => calls++));
  const name = (await readdir(f.archiveDir)).filter(n => /^\d/.test(n)).sort().at(-1);
  const path = join(f.archiveDir, name); const bytes = await readFile(path); bytes[bytes.length - 1] ^= 1; await writeFile(path, bytes);
  await assert.rejects(withVerifiedArchive(f, () => calls++)); assert.equal(calls, 0);
});

test('reader rechecks changed encrypted frames after initial verification', async t => {
  const f = await fixture(t);
  await assert.rejects(withVerifiedArchive(f, async ({ read }) => {
    const path = join(f.archiveDir, '00000002.bin'); const bytes = await readFile(path); bytes[30] ^= 1; await writeFile(path, bytes);
    for await (const b of read('User.jsonl')) void b;
  }), { code: 'authentication_failed' });
});

test('target rejects hosted/alias/other port/database/query overrides before connection', () => {
  const valid = `postgresql://postgres@127.0.0.1:54339/pennsync_import_${'a'.repeat(32)}`;
  assert.equal(nativeImportTarget(valid).port, '54339');
  for (const value of [undefined, valid.replace('127.0.0.1', 'localhost'), valid.replace('127.0.0.1', 'remote.invalid'),
    valid.replace('54339', '54322'), valid.replace(/pennsync_import_.+$/, 'postgres'), `${valid}?host=remote.invalid`,
    `${valid}#x`, valid.replace('postgres@', 'other@'), valid.replace('127.0.0.1', '127.1')]) {
    assert.throws(() => nativeImportTarget(value), { code: 'IMPORT_TARGET_FORBIDDEN' });
  }
});

for (const [name, alter] of [
  ['extra patient field', f => { f.source.Patient[0].date_of_birth = '1900-01-01'; }],
  ['non synthetic first name', f => { f.source.Patient[0].first_name = 'Other'; }],
  ['normalization required', f => { f.source.Patient[0].last_name = ' Imported A'; }],
  ['non canonical agency', f => { f.source.Agency[0].agency_name = 'Other Agency'; }],
  ['unknown native mapping', f => { f.identities[0].target_subject = 'not-a-native-uuid'; }],
  ['additional collection', f => { f.source.Extra = [{ id: importId(90), agency_id: importId(10), text: 'Synthetic extra' }]; }],
  ['declared file even when empty', f => {
    f.original.set('empty.bin', Buffer.alloc(0));
    f.plan.files.push({ source_app_id: IMPORT_APP, file_id: importId(99), path: 'empty.bin', bytes: 0, sha256: importSha(Buffer.alloc(0)),
      access: 'private', agency_id: importId(10), owner_user_id: importActors[0].id, original_name: 'empty.bin',
      source_locator: 'private/synthetic/empty.bin', bindings: [] });
  }],
]) test(`${name} refuses before any target lookup`, async t => {
  const f = await fixture(t, alter);
  if (name === 'declared file even when empty') {
    // The fixture alteration runs before sealing: independently authenticate the
    // resulting plan/file, so this cannot accidentally exercise target:null only.
    await withVerifiedArchive(f, async ({ rawPlan, read }) => {
      assert.equal(JSON.parse(rawPlan).files.length, 1);
      let bytes = 0; for await (const chunk of read('empty.bin')) bytes += chunk.length;
      assert.equal(bytes, 0);
    });
    assert.equal((await verifyArchive(f)).counts.files, 1);
  }
  await assert.rejects(applyVerifiedPatientArchive({ ...f, ownerKey: randomBytes(32), target: null }), { code: 'IMPORT_SCOPE_UNSUPPORTED' });
});

test('CLI errors suppress supplied key, source path and raw content; command-line secrets reject', async () => {
  const outputs = []; const errors = []; const secret = randomBytes(32).toString('base64');
  const env = { PENNSYNC_ARCHIVE_KEY_BASE64: secret, PENNSYNC_IMPORT_OWNER_KEY_BASE64: secret,
    PENNSYNC_ARCHIVE_DIR: 'synthetic_sensitive_path', PENNSYNC_IMPORT_PLAN_SHA256: 'invalid' };
  assert.equal(await runPatientImportCli({ argv: ['node', 'tool', 'import'], env,
    write: s => outputs.push(s), error: s => errors.push(s) }), 1);
  assert.equal(outputs.length, 0); assert.equal(errors.length, 1);
  assert.equal(errors.join().includes(secret), false); assert.equal(errors.join().includes('synthetic_sensitive_path'), false);
  assert.equal(env.PENNSYNC_ARCHIVE_KEY_BASE64, undefined); assert.equal(env.PENNSYNC_IMPORT_OWNER_KEY_BASE64, undefined);
  assert.equal(await runPatientImportCli({ argv: ['node', 'tool', 'import', secret], env: {}, error: () => {} }), 1);
});
