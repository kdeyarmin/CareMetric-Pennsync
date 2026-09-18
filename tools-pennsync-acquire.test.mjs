import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createHash, generateKeyPairSync, hkdfSync, randomBytes, sign } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { captureStaging, promoteCapture, runAcquisitionCli, runCaptureWorker, verifyCapture } from './tools-pennsync-acquire.mjs';
import { ARCHIVE_SOURCE_APPS, verifyArchive } from './tools-pennsync-archive.mjs';

const APP = ARCHIVE_SOURCE_APPS.staging;
const USER = '6aac58fe36c13a1c49ba7cf8';
const EMAIL = 'info+pennsync-admin-a@caremetricai.com';
const id = n => n.toString(16).padStart(24, '0');
const hash = value => createHash('sha256').update(value).digest('hex');
const runtime = { app_id: APP, data_environment: 'prod', privileged: false };
const decision = hash('Synthetic decisions only; no customer records.');
async function fixture(t, count = 205) {
  const root = await mkdtemp(join(tmpdir(), 'pennsync-acquire-test-'));
  t.after(async () => { assert.equal(dirname(resolve(root)), resolve(tmpdir())); assert.ok(basename(root).startsWith('pennsync-acquire-test-')); await rm(root, { recursive: true, force: true }); });
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const signerSpki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const rows = {
    User: [{ id: USER, email: EMAIL, full_name: 'Synthetic principal' }],
    Agency: [{ id: id(2), name: 'Synthetic agency' }],
    Patient: Array.from({ length: count }, (_, i) => ({ id: id(100 + i), app_id: APP, agency_id: id(2), assigned_user_id: USER,
      name: `Synthetic row ${i}`, previous: i % 3 === 0 ? null : i % 3 === 1 ? [] : [{ user_id: USER }], ...(i % 2 ? {} : { optional: null }) })),
  };
  const payload = {
    format: 'pennsync-staging-capture-permit', version: 1, source_app_id: APP, data_environment: 'prod', privilege: 'user',
    producer: 'reviewed-synthetic-fixture', inventory: 'explicit-fixture-ids', valid_from: new Date(Date.now() - 60000).toISOString(), valid_until: new Date(Date.now() + 3600000).toISOString(), schema_sha256: decision,
    collections: Object.entries(rows).map(([entity, records]) => ({ entity, fields: [...new Set(records.flatMap(row => Object.keys(row)))], ids: records.map(row => row.id),
      references: entity === 'Patient' ? [{ pointer: '/assigned_user_id', entity: 'User' }, { pointer: '/previous/*/user_id', entity: 'User' }] : [],
      file_references: [], opaque_fields: [], scope: entity === 'User' ? { kind: 'principal' } : entity === 'Agency' ? { kind: 'agency_root' } : { kind: 'agency', pointer: '/agency_id' } })),
    identities: [{ source_app_id: APP, user_id: USER, target_subject: 'synthetic-target-user', decision_sha256: decision }],
    agencies: [{ source_app_id: APP, agency_id: id(2), target_agency_id: 'synthetic-target-agency', decision_sha256: decision }],
  };
  function signed() { const bytes = Buffer.from(JSON.stringify(payload)); return { payload_base64: bytes.toString('base64'), signature_base64: sign(null, bytes, privateKey).toString('base64') }; }
  const calls = [];
  const sdk = { entities: Object.fromEntries(Object.keys(rows).map(entity => [entity, { async filter(query, sort, limit, skip, fields) {
    calls.push({ entity, query, sort, limit, skip, fields });
    assert.deepEqual(query, { id: { $in: payload.collections.find(c => c.entity === entity).ids } });
    assert.equal(sort, 'id'); assert.equal(limit, 100);
    assert.deepEqual(fields, payload.collections.find(c => c.entity === entity).fields);
    return structuredClone(rows[entity].slice(skip, skip + limit));
  } }])) };
  const options = { sdk, runtime, signerSpki, captureDir: join(root, 'capture'), key: randomBytes(32) };
  const capture = () => captureStaging({ ...options, envelope: signed() });
  return { root, payload, signed, rows, sdk, calls, options, capture };
}

async function independentRead(dir, master, formatId) {
  const header = JSON.parse(await readFile(join(dir, 'header.json'), 'utf8'));
  const key = Buffer.from(hkdfSync('sha256', master, Buffer.from(header.salt, 'hex'), header.format, 32));
  const identifier = header[formatId];
  const decrypt = (bytes, slot) => {
    const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(12, 28));
    cipher.setAAD(Buffer.from(JSON.stringify([header.format, 1, identifier, header.salt, slot, bytes.length - 28])));
    return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]);
  };
  const seal = JSON.parse(decrypt(await readFile(join(dir, 'seal.bin')), 'seal'));
  const result = new Map();
  for (const item of seal.items) {
    const chunks = [];
    for (const chunk of item.chunks) chunks.push(decrypt(await readFile(join(dir, `${chunk.slot}.bin`)), chunk.slot));
    result.set(item.path, Buffer.concat(chunks));
  }
  key.fill(0); return { result, seal };
}

test('signed explicit fixture capture encrypts two bounded passes and bridges without plaintext files', async t => {
  const f = await fixture(t); const result = await f.capture();
  assert.equal(result.records, 207); assert.equal(result.read_requests, 16);
  assert.equal(result.observed_fixture_bytes_matched, true);
  for (const name of ['source_snapshot_verified', 'source_inventory_complete', 'private_file_inventory_complete', 'credential_migration_verified', 'full_transfer_complete', 'cutover_authorized', 'contains_row_values']) assert.equal(result[name], false);
  const captured = await independentRead(f.options.captureDir, f.options.key, 'capture_id');
  for (const [entity, rows] of Object.entries(f.rows)) assert.equal(captured.result.get(`${entity}.jsonl`).toString(), rows.map(row => JSON.stringify(row) + '\n').join(''));
  assert.equal(captured.seal.envelope.payload_base64, f.signed().payload_base64);
  const archiveDir = join(f.root, 'archive'); const archive = await promoteCapture({ ...f.options, archiveDir });
  assert.equal(archive.status, 'verified_encrypted_offline_archive'); assert.equal(archive.counts.identities, 1); assert.equal(archive.counts.agencies, 1);
  assert.equal(archive.counts.relationships, 478); assert.equal(archive.acquisition.source_inventory_complete, false);
  const archived = await independentRead(archiveDir, f.options.key, 'archive_id');
  for (const [path, bytes] of captured.result) assert.deepEqual(archived.result.get(path), bytes);
  assert.equal((await verifyArchive({ archiveDir, key: f.options.key })).full_transfer_complete, false);
  for (const dir of [f.options.captureDir, archiveDir]) for (const name of await readdir(dir)) {
    assert.match(name, /^(header\.json|seal\.bin|\d{8}\.bin)$/);
    const text = (await readFile(join(dir, name))).toString('utf8');
    for (const secret of ['Synthetic principal', EMAIL, APP, 'Patient.jsonl']) assert.equal(text.includes(secret), false);
  }
});

test('zero-row inventories are explicit and issue no broad empty-ID request', async t => {
  const f = await fixture(t, 0); f.payload.collections.find(c => c.entity === 'Patient').fields = ['id', 'agency_id'];
  const result = await f.capture(); assert.equal(result.records, 2); assert.equal(result.read_requests, 8);
  assert.equal(f.calls.some(c => c.entity === 'Patient'), false);
});

test('unsigned, wrong-signer and tampered permits make no source calls', async t => {
  for (const type of ['unsigned', 'wrong signer', 'altered payload']) await t.test(type, async t => {
    const f = await fixture(t, 1); const envelope = f.signed(); let signerSpki = f.options.signerSpki;
    if (type === 'unsigned') envelope.signature_base64 = '';
    if (type === 'wrong signer') signerSpki = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    if (type === 'altered payload') { f.payload.collections[0].fields.push('password'); envelope.payload_base64 = Buffer.from(JSON.stringify(f.payload)).toString('base64'); }
    await assert.rejects(captureStaging({ ...f.options, envelope, signerSpki })); assert.equal(f.calls.length, 0);
  });
});

test('signed unsafe source, scope, fields, identities or validity are refused before reading', async t => {
  const changes = [
    p => { p.source_app_id = ARCHIVE_SOURCE_APPS.production; },
    p => { p.data_environment = 'dev'; }, p => { p.privilege = 'service_role'; },
    p => { p.inventory = 'all records'; }, p => { p.schema_sha256 = ''; },
    p => { p.collections[0].fields.push('password_hash'); }, p => { p.collections[0].entity = 'IntegrationSecret'; },
    p => { p.collections[2].ids.push(p.collections[2].ids[0]); },
    p => { p.identities = []; }, p => { p.agencies[0].agency_id = id(999); },
    p => { p.valid_until = new Date(Date.now() - 1).toISOString(); },
    p => { p.source_snapshot_verified = true; },
  ];
  for (const [i, change] of changes.entries()) await t.test(String(i), async t => {
    const f = await fixture(t, 1); change(f.payload); await assert.rejects(f.capture()); assert.equal(f.calls.length, 0);
  });
});

test('runtime target and privilege mismatch cannot be overridden by a valid permit', async t => {
  for (const altered of [{ ...runtime, app_id: ARCHIVE_SOURCE_APPS.production }, { ...runtime, data_environment: 'dev' }, { ...runtime, privileged: true }]) {
    const f = await fixture(t, 1); await assert.rejects(captureStaging({ ...f.options, runtime: altered, envelope: f.signed() })); assert.equal(f.calls.length, 0);
  }
});

test('a signed permit cannot include the protected owner or an unapproved account', async t => {
  for (const forbidden of ['6a98816d3dc68a0bd54f1ef8', id(999)]) await t.test(forbidden === id(999) ? 'unapproved account' : 'protected owner', async t => {
    const f = await fixture(t, 1); f.payload.collections[0].ids = [forbidden]; f.payload.identities[0].user_id = forbidden;
    await assert.rejects(f.capture(), error => error.code === 'protected_identity'); assert.equal(f.calls.length, 0);
    assert.deepEqual(await readdir(f.root), []);
  });
});

test('a changed test-account email cannot be captured as the approved principal', async t => {
  const f = await fixture(t, 1); f.rows.User[0].email = 'unapproved@example.invalid';
  await assert.rejects(f.capture(), error => error.code === 'identity_changed');
  assert.equal((await readdir(f.options.captureDir)).includes('seal.bin'), false);
});

test('extra fields, credential URLs, invalid IDs and missing or reordered pages never seal', async t => {
  const changes = [
    rows => { rows[0].extra = 'unexpected'; }, rows => { rows[0].name = 'https://invalid.example/object?X-Goog-Signature=synthetic'; },
    rows => { rows[0].previous = [{ password: 'synthetic only' }]; }, rows => { rows[0].app_id = ARCHIVE_SOURCE_APPS.production; },
    rows => { rows[0].id = id(999); }, rows => { rows.reverse(); }, rows => { rows.pop(); }, rows => { rows.push(rows[0]); },
    rows => { rows[0].name = Number.NaN; }, rows => { rows[0].name = 'x'.repeat(1024 * 1024); },
  ];
  for (const [i, change] of changes.entries()) await t.test(String(i), async t => {
    const f = await fixture(t, 2); change(f.rows.Patient); await assert.rejects(f.capture());
    assert.equal((await readdir(f.options.captureDir)).includes('seal.bin'), false);
    await assert.rejects(verifyCapture(f.options));
  });
});

test('second-pass changes reject capture and preserve encrypted incomplete output without retry', async t => {
  const f = await fixture(t, 2); const filter = f.sdk.entities.User.filter; let calls = 0;
  f.sdk.entities.User.filter = async (...args) => { const rows = await filter(...args); if (++calls === 3) rows[0].full_name = 'Synthetic changed'; return rows; };
  await assert.rejects(f.capture(), error => error.code === 'observed_drift');
  assert.equal((await readdir(f.options.captureDir)).includes('seal.bin'), false);
  const before = f.calls.length; await assert.rejects(f.capture()); assert.equal(f.calls.length, before);
});

test('matching sampled bytes do not claim to exclude ABA changes or a complete source inventory', async t => {
  const f = await fixture(t, 1); const result = await f.capture();
  assert.equal(result.source_snapshot_verified, false); assert.equal(result.source_inventory_complete, false);
  assert.equal(result.cutover_authorized, false);
});

test('wrong key, altered frame, missing seal and extra files fail independent verification', async t => {
  for (const type of ['key', 'frame', 'seal', 'extra']) await t.test(type, async t => {
    const f = await fixture(t, 1); await f.capture(); let key = f.options.key;
    if (type === 'key') key = randomBytes(32);
    if (type === 'frame') { const path = join(f.options.captureDir, '00000001.bin'); const bytes = await readFile(path); bytes[30] ^= 1; await writeFile(path, bytes); }
    if (type === 'seal') await rm(join(f.options.captureDir, 'seal.bin'));
    if (type === 'extra') await writeFile(join(f.options.captureDir, 'unexpected.json'), '{}');
    await assert.rejects(verifyCapture({ ...f.options, key }));
  });
});

test('archive bridge still rejects orphan/foreign-tenant relations and missing file bytes', async t => {
  for (const type of ['orphan', 'foreign tenant', 'file']) await t.test(type, async t => {
    const f = await fixture(t, 1);
    if (type === 'orphan') f.rows.Patient[0].assigned_user_id = id(999);
    if (type === 'foreign tenant') f.rows.Patient[0].agency_id = id(888);
    if (type === 'file') { f.rows.Patient[0].file_uri = 'private/synthetic-object'; f.payload.collections[2].fields.push('file_uri'); f.payload.collections[2].file_references.push('/file_uri'); }
    await f.capture(); await assert.rejects(promoteCapture({ ...f.options, archiveDir: join(f.root, 'archive') }));
    assert.equal((await readdir(f.root)).includes('archive'), false);
  });
});

test('worker suppresses SDK exceptions and erases its supplied key without printing payloads', async t => {
  const f = await fixture(t, 1); const path = join(f.root, 'permit.json'); await writeFile(path, JSON.stringify(f.signed()));
  const env = { PENNSYNC_ARCHIVE_KEY_BASE64: f.options.key.toString('base64'), PENNSYNC_CAPTURE_PERMIT_PATH: path,
    PENNSYNC_CAPTURE_DIR: f.options.captureDir, PENNSYNC_CAPTURE_SIGNER_SPKI_BASE64: f.options.signerSpki, BASE44_APP_ID: APP, BASE44_DATA_ENV: 'prod', BASE44_PRIVILEGED: 'false' };
  f.sdk.entities.User.filter = async () => { throw new Error('synthetic-sensitive-row-and-provider-token'); };
  const output = []; assert.equal(await runCaptureWorker(f.sdk, env, value => output.push(value)), 1);
  assert.deepEqual(output, []); assert.equal(env.PENNSYNC_ARCHIVE_KEY_BASE64, undefined);
});

test('launcher discards CLI stdout/stderr, rejects command-line secrets and never trusts a printed success', async t => {
  for (const type of ['error', 'non-JSON', 'oversized']) await t.test(type, async t => {
    const f = await fixture(t, 1); const output = []; let killed = 0; let childKey;
    const env = { PENNSYNC_ARCHIVE_KEY_BASE64: f.options.key.toString('base64'), PENNSYNC_CAPTURE_DIR: f.options.captureDir, PENNSYNC_CAPTURE_SIGNER_SPKI_BASE64: f.options.signerSpki };
    const launch = (binary, args, options) => {
      assert.equal(binary, process.execPath); assert.equal(options.windowsHide, true); assert.equal(args.includes('--privileged'), false);
      assert.equal(args.includes(f.options.key.toString('base64')), false); childKey = options.env.PENNSYNC_ARCHIVE_KEY_BASE64;
      const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => { killed++; };
      setImmediate(() => {
        child.stdout.write(type === 'oversized' ? 's'.repeat(65537) : 'PENNSYNC_CAPTURE_RECEIPT {"status":"success"}\n');
        child.stderr.write('synthetic-provider-secret-or-row'); child.emit('close', type === 'error' ? 1 : 0);
      }); return child;
    };
    assert.equal(await runAcquisitionCli({ argv: ['node', 'tool', 'capture'], env, launch, write: v => output.push(v), error: v => output.push(v) }), 1);
    assert.deepEqual(output, ['Staging acquisition failed: no verified capture or archive was accepted.']);
    assert.equal(childKey, f.options.key.toString('base64')); assert.equal(env.PENNSYNC_ARCHIVE_KEY_BASE64, undefined);
    if (type === 'oversized') assert.equal(killed, 1);
  });
  const output = [];
  assert.equal(await runAcquisitionCli({ argv: ['node', 'tool', 'capture', '--key', 'synthetic-secret'], env: {}, error: v => output.push(v) }), 1);
  assert.equal(output[0].includes('synthetic-secret'), false);
});
