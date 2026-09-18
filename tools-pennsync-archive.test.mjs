import assert from 'node:assert/strict';
import { createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ARCHIVE_LIMITS, ARCHIVE_SOURCE_APPS, buildArchive, runArchiveCli, verifyArchive } from './tools-pennsync-archive.mjs';

const APP = ARCHIVE_SOURCE_APPS.staging;
const id = (n) => n.toString(16).padStart(24, '0');
const hash = (v) => createHash('sha256').update(v).digest('hex');
const evidence = hash('synthetic decision only');
const TOOL = fileURLToPath(new URL('./tools-pennsync-archive.mjs', import.meta.url));

async function fixture(t, apps = [APP]) {
  const root = await mkdtemp(join(tmpdir(), 'pennsync-archive-test-'));
  t.after(async () => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('pennsync-archive-test-'));
    await rm(root, { recursive: true, force: true });
  });
  const inputDir = join(root, 'input'); await mkdir(inputDir);
  const plan = { format: 'pennsync-supplied-export', version: 1, source_apps: apps, snapshot_evidence_sha256: evidence, collections: [], identities: {}, agencies: {}, files: [] };
  const original = new Map();
  const key = randomBytes(32);
  async function save(path, bytes, rows) {
    const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    await writeFile(join(inputDir, path), data); original.set(path, data);
    return { path, bytes: data.length, sha256: hash(data), ...(rows === undefined ? {} : { rows }) };
  }
  const mappingUsers = []; const mappingAgencies = [];
  for (const [index, app] of apps.entries()) {
    const prefix = `${index}-`;
    const user = { id: id(1), app_id: app, email: 'invented@example.invalid', role: 'user', is_verified: true };
    const agency = { id: id(2), name: 'Synthetic agency' };
    const patient = { id: id(3), agency_id: id(2), assigned_user_id: id(1), note: 'Invented content for archive regression only.' };
    const document = { id: id(4), agency_id: id(2), patient_id: id(3), file_uri: 'private/synthetic/object.txt', previous: [{ patient_id: id(3) }] };
    for (const [entity, row, scope, references, files] of [
      ['User', user, { kind: 'principal' }, [], []],
      ['Agency', agency, { kind: 'agency_root' }, [], []],
      ['Patient', patient, { kind: 'agency', pointer: '/agency_id' }, [{ pointer: '/assigned_user_id', entity: 'User' }], []],
      ['Document', document, { kind: 'agency', pointer: '/agency_id' }, [{ pointer: '/patient_id', entity: 'Patient' }, { pointer: '/previous/*/patient_id', entity: 'Patient' }], ['/file_uri']],
    ]) {
      // Whitespace and CRLF are deliberately retained; input isn't canonicalized.
      const raw = ` ${JSON.stringify(row)}\r\n`;
      plan.collections.push({ source_app_id: app, entity, ...await save(`${prefix}${entity}.jsonl`, raw, 1), fields: Object.keys(row), references, file_references: files, opaque_fields: [], scope });
    }
    mappingUsers.push({ source_app_id: app, user_id: id(1), target_subject: `external-user-${index}`, decision_sha256: evidence });
    mappingAgencies.push({ source_app_id: app, agency_id: id(2), target_agency_id: `external-agency-${index}`, decision_sha256: evidence });
    plan.files.push({ source_app_id: app, file_id: id(5), ...await save(`${prefix}object.bin`, Buffer.from([0, 255, 0, 1, 128, 10, 13])), access: 'private', agency_id: id(2), owner_user_id: id(1), original_name: 'Synthetic résumé.bin', source_locator: document.file_uri, bindings: [{ entity: 'Document', record_id: id(4), pointer: '/file_uri', locator_sha256: hash(document.file_uri) }] });
  }
  plan.identities = await save('identities.jsonl', mappingUsers.map((r) => JSON.stringify(r)).join('\n'), mappingUsers.length);
  plan.agencies = await save('agencies.jsonl', mappingAgencies.map((r) => JSON.stringify(r)).join('\n'), mappingAgencies.length);
  const writePlan = async () => { await save('plan.json', JSON.stringify(plan, null, 2)); };
  const changeRows = async (entity, alter, app = apps[0]) => {
    const c = plan.collections.find((v) => v.entity === entity && v.source_app_id === app);
    const row = JSON.parse((await readFile(join(inputDir, c.path))).toString());
    const changed = alter(row);
    Object.assign(c, await save(c.path, `${JSON.stringify(changed)}\n`, 1));
    return c;
  };
  await writePlan();
  return { root, inputDir, archiveDir: join(root, 'archive'), plan, key, original, save, writePlan, changeRows };
}

async function readArchiveIndependently(directory, rawKey) {
  const header = JSON.parse(await readFile(join(directory, 'header.json'), 'utf8'));
  const key = Buffer.from(hkdfSync('sha256', rawKey, Buffer.from(header.salt, 'hex'), header.format, 32));
  function decrypt(bytes, slot) {
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    decipher.setAAD(Buffer.from(JSON.stringify([header.format, 1, header.archive_id, header.salt, slot, bytes.length - 28])));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
  }
  try {
    const seal = JSON.parse(decrypt(await readFile(join(directory, 'seal.bin')), 'seal'));
    const result = new Map();
    for (const item of seal.items) {
      const chunks = [];
      for (const c of item.chunks) chunks.push(decrypt(await readFile(join(directory, `${c.slot}.bin`)), c.slot));
      result.set(item.path, Buffer.concat(chunks));
    }
    return result;
  } finally { key.fill(0); }
}

test('offline round trip preserves exact JSONL and binary bytes, IDs and relationships without claiming transfer', async (t) => {
  const f = await fixture(t); const result = await buildArchive(f);
  assert.deepEqual(result.counts, { records: 4, identities: 1, agencies: 1, files: 1, relationships: 5, file_bindings: 1 });
  for (const flag of ['full_transfer_complete', 'source_snapshot_verified', 'credential_migration_verified', 'relationship_contract_coverage_verified', 'hosted_restore_verified', 'contains_row_values']) assert.equal(result[flag], false);
  assert.equal(result.remote_mutations, 0); assert.equal(result.source_mutations, 0);
  const restored = await readArchiveIndependently(f.archiveDir, f.key);
  assert.deepEqual(restored, f.original);
  for (const [path, bytes] of f.original) assert.deepEqual(await readFile(join(f.inputDir, path)), bytes);
  const publicNames = await readdir(f.archiveDir);
  assert.ok(publicNames.every((n) => /^(header\.json|seal\.bin|\d{8}\.bin)$/.test(n)));
  for (const name of publicNames) {
    const raw = await readFile(join(f.archiveDir, name));
    assert.equal(raw.includes(Buffer.from('invented@example.invalid')), false);
    assert.equal(raw.includes(Buffer.from(id(3))), false);
    assert.equal(raw.includes(Buffer.from('private/synthetic/object.txt')), false);
  }
});

test('source namespaces retain identical IDs from old/current apps without collision', async (t) => {
  const f = await fixture(t, [ARCHIVE_SOURCE_APPS.legacy, ARCHIVE_SOURCE_APPS.production]);
  const result = await buildArchive(f); assert.equal(result.counts.records, 8); assert.equal(result.counts.identities, 2);
});

test('staging cannot share a bundle with either production source', async (t) => {
  const f = await fixture(t, [APP, ARCHIVE_SOURCE_APPS.production]);
  await assert.rejects(buildArchive(f), { code: 'staging_source_mixing' });
});

test('wrong key, ciphertext corruption, truncated chunk and altered public header fail authentication', async (t) => {
  const f = await fixture(t); await buildArchive(f);
  await assert.rejects(verifyArchive({ ...f, key: randomBytes(32) }), { code: 'authentication_failed' });
  const path = join(f.archiveDir, '00000002.bin'); const original = await readFile(path);
  const changed = Buffer.from(original); changed[30] ^= 1; await writeFile(path, changed);
  await assert.rejects(verifyArchive(f), { code: 'authentication_failed' });
  await writeFile(path, original.subarray(0, original.length - 1));
  await assert.rejects(verifyArchive(f));
  await writeFile(path, original);
  const headerPath = join(f.archiveDir, 'header.json'); const header = JSON.parse(await readFile(headerPath));
  header.archive_id = '0'.repeat(32); await writeFile(headerPath, JSON.stringify(header));
  await assert.rejects(verifyArchive(f), { code: 'authentication_failed' });
});

test('missing final manifest and unexpected files reject partial or mixed archives', async (t) => {
  const f = await fixture(t); await buildArchive(f);
  await writeFile(join(f.archiveDir, 'unlisted.bin'), 'unexpected');
  await assert.rejects(verifyArchive(f), { code: 'unexpected_archive_entry' });
  await rm(join(f.archiveDir, 'unlisted.bin'));
  await rm(join(f.archiveDir, 'seal.bin'));
  await assert.rejects(verifyArchive(f));
  await assert.rejects(buildArchive({ ...f, resume: true }));
});

test('resume revalidates sealed bytes and exact input plan; fresh build never overwrites output', async (t) => {
  const f = await fixture(t); await buildArchive(f);
  const before = new Map(await Promise.all((await readdir(f.archiveDir)).map(async (p) => [p, await readFile(join(f.archiveDir, p))])));
  assert.equal((await buildArchive({ ...f, resume: true })).resumed, true);
  await assert.rejects(buildArchive(f));
  const after = new Map(await Promise.all((await readdir(f.archiveDir)).map(async (p) => [p, await readFile(join(f.archiveDir, p))])));
  assert.deepEqual(before, after);
  await f.changeRows('Patient', (row) => ({ ...row, note: 'A newer source value' })); await f.writePlan();
  await assert.rejects(buildArchive({ ...f, resume: true }), { code: 'plan_changed' });
});

test('missing user/file manifests, exact counts and changed source hashes cannot be accepted', async (t) => {
  const f = await fixture(t); const identities = f.plan.identities;
  delete f.plan.identities; await f.writePlan(); await assert.rejects(buildArchive(f));
  f.plan.identities = identities; f.plan.files = []; await f.writePlan();
  await assert.rejects(buildArchive(f), { code: 'missing_file' });
  const f2 = await fixture(t); f2.plan.collections[0].rows = 2; await f2.writePlan();
  await assert.rejects(buildArchive(f2), { code: 'row_count' });
  const f3 = await fixture(t); await writeFile(join(f3.inputDir, f3.plan.collections[0].path), '{}\n');
  await assert.rejects(buildArchive(f3));
});

test('duplicate IDs, wrong source IDs and orphaned same-source references fail closed', async (t) => {
  const f = await fixture(t); const c = f.plan.collections[0];
  const row = await readFile(join(f.inputDir, c.path)); Object.assign(c, await f.save(c.path, Buffer.concat([row, row]), 2)); await f.writePlan();
  await assert.rejects(buildArchive(f), { code: 'duplicate_record' });
  const f2 = await fixture(t); await f2.changeRows('User', (r) => ({ ...r, app_id: ARCHIVE_SOURCE_APPS.production })); await f2.writePlan();
  await assert.rejects(buildArchive(f2), { code: 'record_source_mixing' });
  const f3 = await fixture(t); await f3.changeRows('Document', (r) => ({ ...r, patient_id: id(999) })); await f3.writePlan();
  await assert.rejects(buildArchive(f3), { code: 'orphan_reference' });
});

test('duplicate/missing target mapping and missing agency authority cannot be guessed', async (t) => {
  const f = await fixture(t, [ARCHIVE_SOURCE_APPS.legacy, ARCHIVE_SOURCE_APPS.production]);
  const mappings = (await readFile(join(f.inputDir, f.plan.identities.path), 'utf8')).split('\n').map(JSON.parse);
  mappings[1].target_subject = mappings[0].target_subject;
  Object.assign(f.plan.identities, await f.save('identities.jsonl', mappings.map((r) => JSON.stringify(r)).join('\n'), 2)); await f.writePlan();
  await assert.rejects(buildArchive(f), { code: 'ambiguous_mapping' });
  const f2 = await fixture(t); Object.assign(f2.plan.agencies, await f2.save('agencies.jsonl', '', 0)); await f2.writePlan();
  await assert.rejects(buildArchive(f2), { code: 'missing_mapping' });
  const f3 = await fixture(t); await f3.changeRows('Patient', (r) => ({ ...r, agency_id: null })); await f3.writePlan();
  await assert.rejects(buildArchive(f3), { code: 'ambiguous_agency' });
});

test('unclassified references, nested credentials, duplicate JSON keys and coercible IDs reject', async (t) => {
  const f = await fixture(t); const c = await f.changeRows('Patient', (r) => ({ ...r, unknown_user_id: id(1) })); c.fields.push('unknown_user_id'); await f.writePlan();
  await assert.rejects(buildArchive(f), { code: 'unclassified_reference' });
  const f2 = await fixture(t); const c2 = await f2.changeRows('Patient', (r) => ({ ...r, nested: { accessToken: 'do-not-expose' } })); c2.fields.push('nested'); await f2.writePlan();
  await assert.rejects(buildArchive(f2), { code: 'credential_field' });
  const f3 = await fixture(t); const c3 = f3.plan.collections[0];
  const original = (await readFile(join(f3.inputDir, c3.path), 'utf8')).trim();
  Object.assign(c3, await f3.save(c3.path, original.replace('{', `{"\\u0069d":"${id(99)}",`), 1)); await f3.writePlan();
  await assert.rejects(buildArchive(f3), { code: 'invalid_json' });
  const f4 = await fixture(t); await f4.changeRows('Patient', (r) => ({ ...r, id: [id(3)] })); await f4.writePlan();
  await assert.rejects(buildArchive(f4), { code: 'invalid_record' });
});

test('file binding and agency mismatches cannot relabel a supplied private file', async (t) => {
  const f = await fixture(t); f.plan.files[0].bindings[0].locator_sha256 = hash('different handle'); await f.writePlan();
  await assert.rejects(buildArchive(f), { code: 'file_binding_mismatch' });
  const f2 = await fixture(t); f2.plan.files[0].agency_id = id(999); await f2.writePlan();
  await assert.rejects(buildArchive(f2), { code: 'file_owner_missing' });
});

test('declared empty reference arrays are valid and signed credential URLs remain excluded', async (t) => {
  const f = await fixture(t);
  const c = await f.changeRows('Patient', (row) => ({ ...row, related_patient_ids: [] }));
  c.fields.push('related_patient_ids'); c.references.push({ pointer: '/related_patient_ids/*', entity: 'Patient' });
  await f.writePlan(); await buildArchive(f);
  const f2 = await fixture(t);
  const c2 = await f2.changeRows('Patient', (row) => ({ ...row, source: 'https://example.invalid/object?X-Amz-Signature=never-print-this' }));
  c2.fields.push('source'); await f2.writePlan();
  await assert.rejects(buildArchive(f2), { code: 'credential_url' });
});

test('descendant policies cannot classify a present scalar or null as a validated reference', async (t) => {
  for (const [label, value] of [['id', id(999)], ['number', 999], ['boolean', false], ['null', null]]) {
    await t.test(label, async (t) => {
      const f = await fixture(t);
      const c = await f.changeRows('Patient', (row) => ({ ...row, assigned_user_id: value }));
      c.references = [{ pointer: '/assigned_user_id/missing_child', entity: 'User' }];
      await f.writePlan();
      await assert.rejects(buildArchive(f), { code: 'invalid_reference' });
    });
  }
  await t.test('scalar inside an array', async (t) => {
    const f = await fixture(t);
    const c = await f.changeRows('Patient', (row) => ({ ...row, related_user_ids: [id(999)] }));
    c.fields.push('related_user_ids'); c.references.push({ pointer: '/related_user_ids/*/missing_child', entity: 'User' });
    await f.writePlan();
    await assert.rejects(buildArchive(f), { code: 'invalid_reference' });
  });
});

test('validated optional containers and absent or null reference leaves remain supported', async (t) => {
  const f = await fixture(t);
  const c = await f.changeRows('Patient', (row) => ({ ...row, assigned_user_id: null, related_user_ids: [], metadata_ids: {} }));
  c.fields.push('related_user_ids', 'metadata_ids');
  c.references.push({ pointer: '/related_user_ids/*/user_id', entity: 'User' }, { pointer: '/metadata_ids/optional_user_id', entity: 'User' }, { pointer: '/absent_user_id', entity: 'User' });
  await f.writePlan(); await buildArchive(f);
});

test('existing references across two tenant scopes fail reconciliation', async (t) => {
  const f = await fixture(t);
  const agencies = f.plan.collections.find((c) => c.entity === 'Agency');
  const originalAgency = JSON.parse(await readFile(join(f.inputDir, agencies.path), 'utf8'));
  Object.assign(agencies, await f.save(agencies.path, [originalAgency, { id: id(22), name: 'Synthetic agency B' }].map((r) => JSON.stringify(r)).join('\n'), 2));
  const originalMapping = JSON.parse(await readFile(join(f.inputDir, f.plan.agencies.path), 'utf8'));
  Object.assign(f.plan.agencies, await f.save(f.plan.agencies.path, [originalMapping, { source_app_id: APP, agency_id: id(22), target_agency_id: 'external-agency-b', decision_sha256: evidence }].map((r) => JSON.stringify(r)).join('\n'), 2));
  await f.changeRows('Patient', (row) => ({ ...row, agency_id: id(22) }));
  await f.writePlan();
  await assert.rejects(buildArchive(f), { code: 'reference_agency_mismatch' });
});

test('principal and explicitly reviewed global references retain their unscoped semantics', async (t) => {
  const f = await fixture(t);
  const global = { id: id(6), patient_id: id(3) };
  f.plan.collections.push({ source_app_id: APP, entity: 'SharedCatalog', ...await f.save('global.jsonl', `${JSON.stringify(global)}\n`, 1), fields: Object.keys(global), references: [{ pointer: '/patient_id', entity: 'Patient' }], file_references: [], opaque_fields: [], scope: { kind: 'global', decision_sha256: evidence } });
  const c = await f.changeRows('Document', (row) => ({ ...row, catalog_id: id(6) }));
  c.fields.push('catalog_id'); c.references.push({ pointer: '/catalog_id', entity: 'SharedCatalog' });
  await f.writePlan();
  assert.equal((await buildArchive(f)).counts.relationships, 7);
});

test('file locators reject whitespace and control-character URL normalization', async (t) => {
  for (const [label, locator] of [
    ['space prefix', ' https://example.invalid/private?token=synthetic_secret_only'],
    ['tab prefix', '\thttps://example.invalid/private?token=synthetic_secret_only'],
    ['newline prefix', '\nhttps://example.invalid/private?token=synthetic_secret_only'],
    ['embedded newline', 'https:\n//example.invalid/private?token=synthetic_secret_only'],
    ['space suffix', 'https://example.invalid/private '],
    ['durable handle whitespace', ' private/synthetic/object.txt'],
  ]) {
    await t.test(label, async (t) => {
      const f = await fixture(t);
      await f.changeRows('Document', (row) => ({ ...row, file_uri: locator }));
      f.plan.files[0].source_locator = locator;
      f.plan.files[0].bindings[0].locator_sha256 = hash(locator);
      await f.writePlan();
      await assert.rejects(buildArchive(f), { code: 'invalid_file_locator' });
    });
  }
});

test('credentials in URL fragments and whitespace-prefixed row URLs cannot evade scanning', async (t) => {
  for (const [label, url, code] of [
    ['fragment', 'https://example.invalid/private#access_token=synthetic_secret_only', 'credential_url'],
    ['fragment query', 'https://example.invalid/private#/route?token=synthetic_secret_only', 'credential_url'],
    ['encoded fragment key', 'https://example.invalid/private#access%5Ftoken=synthetic_secret_only', 'credential_url'],
    ['row whitespace', ' \thttps://example.invalid/private?token=synthetic_secret_only', 'invalid_url'],
    ['row newline', 'https:\n//example.invalid/private?token=synthetic_secret_only', 'invalid_url'],
    ['row C0 prefix', '\u0000https://example.invalid/private?token=synthetic_secret_only', 'invalid_url'],
  ]) {
    await t.test(label, async (t) => {
      const f = await fixture(t);
      const c = await f.changeRows('Patient', (row) => ({ ...row, source: url }));
      c.fields.push('source'); await f.writePlan();
      await assert.rejects(buildArchive(f), { code });
    });
  }
});

test('large supplied files use bounded encryption frames and verify exact bytes', async (t) => {
  const f = await fixture(t); const large = Buffer.alloc(ARCHIVE_LIMITS.chunk * 2 + 17, 91);
  Object.assign(f.plan.files[0], await f.save(f.plan.files[0].path, large)); await f.writePlan(); await buildArchive(f);
  const restored = await readArchiveIndependently(f.archiveDir, f.key);
  assert.deepEqual(restored.get(f.plan.files[0].path), large);
  for (const name of await readdir(f.archiveDir)) if (/^\d/.test(name)) assert.ok((await readFile(join(f.archiveDir, name))).length <= ARCHIVE_LIMITS.chunk + 28);
});

test('unsafe paths and symlinked source files fail without touching referenced content', async (t) => {
  const f = await fixture(t); f.plan.collections[0].path = '../outside.jsonl'; await f.writePlan();
  await assert.rejects(buildArchive(f), { code: 'unsafe_path' });
  const f2 = await fixture(t); const path = join(f2.inputDir, f2.plan.files[0].path);
  await rm(path); const outside = join(f2.root, 'outside.bin'); await writeFile(outside, 'do-not-read');
  try { await symlink(outside, path); } catch (e) { if (e.code === 'EPERM') return; throw e; }
  await assert.rejects(buildArchive(f2), { code: 'unsafe_path' }); assert.equal(await readFile(outside, 'utf8'), 'do-not-read');
});

test('CLI refuses command-line secrets, erases key environment and prints aggregate reports only', async (t) => {
  const f = await fixture(t); const output = []; const errors = [];
  const env = { PENNSYNC_ARCHIVE_KEY_BASE64: f.key.toString('base64'), PENNSYNC_ARCHIVE_DIR: f.archiveDir, PENNSYNC_ARCHIVE_INPUT_DIR: f.inputDir };
  assert.equal(await runArchiveCli({ argv: ['node', TOOL, 'build'], env, write: (s) => output.push(s), error: (s) => errors.push(s) }), 0);
  assert.equal(env.PENNSYNC_ARCHIVE_KEY_BASE64, undefined); assert.equal(JSON.parse(output[0]).full_transfer_complete, false);
  assert.equal(output.join('').includes('invented@example.invalid'), false);
  assert.equal(await runArchiveCli({ argv: ['node', TOOL, 'verify', '--key', 'never-print-this'], env: {}, write: () => {}, error: (s) => errors.push(s) }), 1);
  assert.equal(errors.join('').includes('never-print-this'), false);
  assert.equal(errors.join('').includes(f.root), false);
});

test('CLI accepts a key only from explicit stdin descriptor, with no insecure default', async (t) => {
  const f = await fixture(t); await buildArchive(f);
  const env = { ...process.env, PENNSYNC_ARCHIVE_DIR: f.archiveDir, PENNSYNC_ARCHIVE_KEY_FD: '0' }; delete env.PENNSYNC_ARCHIVE_KEY_BASE64;
  const result = spawnSync(process.execPath, [TOOL, 'verify'], { input: `${f.key.toString('base64')}\n`, env, encoding: 'utf8' });
  assert.equal(result.status, 0); assert.equal(JSON.parse(result.stdout).status, 'verified_encrypted_offline_archive'); assert.equal(result.stderr, '');
  delete env.PENNSYNC_ARCHIVE_KEY_FD;
  const failed = spawnSync(process.execPath, [TOOL, 'verify'], { env, encoding: 'utf8' });
  assert.equal(failed.status, 1); assert.equal(failed.stdout, ''); assert.equal(failed.stderr.includes(f.archiveDir), false);
});
