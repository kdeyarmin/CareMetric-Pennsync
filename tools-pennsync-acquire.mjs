#!/usr/bin/env node
/** Explicit synthetic staging records only. No broad list, file fetch or remote write. */
import { createCipheriv, createDecipheriv, createHash, createPublicKey, hkdfSync, randomBytes, verify } from 'node:crypto';
import { constants, readSync } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { ARCHIVE_SOURCE_APPS, buildArchiveFromReader, validateArchiveCollectionPolicy, validateArchiveRow } from './tools-pennsync-archive.mjs';

const APP = ARCHIVE_SOURCE_APPS.staging;
const ACTORS = new Map([
  ['6aac58fe36c13a1c49ba7cf8', 'info+pennsync-admin-a@caremetricai.com'],
  ['6aac58ff8ec706a643a7aa42', 'info+pennsync-clinician-a@caremetricai.com'],
  ['6aac58ffa5f6252bcf92f11f', 'info+pennsync-clinician-empty@caremetricai.com'],
  ['6aac5900bf4098977893276d', 'info+pennsync-admin-b@caremetricai.com'],
]);
const PROTECTED_OWNER = '6a98816d3dc68a0bd54f1ef8';
const MAGIC = 'pennsync-encrypted-staging-capture';
const PAGE = 100; const FRAME = 1024 * 1024; const META = 4 * FRAME;
const MAX_BYTES = 128 * FRAME; const MAX_ROWS = 10000;
const ID = /^[0-9a-f]{24}$/; const HASH = /^[0-9a-f]{64}$/;
const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => Buffer.from(JSON.stringify(value));
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
class CaptureError extends Error { constructor(code) { super('Staging capture did not validate.'); this.code = code; } }
function check(value, code = 'invalid_capture') { if (!value) throw new CaptureError(code); }
function exact(value, keys) { check(isObject(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|')); }
function parse(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new CaptureError('invalid_json'); }
}
function plain(value, depth = 0, state = { count: 0 }) {
  check(++state.count <= 50000 && depth <= 40, 'value_bounds');
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number') { check(Number.isFinite(value)); return; }
  check(typeof value === 'object' && (Array.isArray(value) || [Object.prototype, null].includes(Object.getPrototypeOf(value))));
  if (Array.isArray(value)) check(Object.keys(value).length === value.length && Array.from({ length: value.length }, (_, i) => Object.hasOwn(value, i)).every(Boolean));
  for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    check(Object.hasOwn(descriptor, 'value') && !['__proto__', 'constructor', 'prototype', 'toJSON'].includes(name));
    plain(descriptor.value, depth + 1, state);
  }
}
function canonicalBase64(value, maximum) {
  check(typeof value === 'string' && value.length <= maximum * 2 && /^[A-Za-z0-9+/]*={0,2}$/.test(value));
  const bytes = Buffer.from(value, 'base64'); check(bytes.length <= maximum && bytes.toString('base64') === value); return bytes;
}
function permit(envelope, signerSpki, at) {
  exact(envelope, ['payload_base64', 'signature_base64']);
  const bytes = canonicalBase64(envelope.payload_base64, META / 2);
  const signature = canonicalBase64(envelope.signature_base64, 64);
  let publicKey;
  try { publicKey = createPublicKey({ key: canonicalBase64(signerSpki, 512), format: 'der', type: 'spki' }); }
  catch { throw new CaptureError('invalid_signer'); }
  check(publicKey.asymmetricKeyType === 'ed25519' && signature.length === 64 && verify(null, bytes, publicKey, signature), 'unsigned_permit');
  const p = parse(bytes); plain(p); check(json(p).equals(bytes), 'noncanonical_permit');
  exact(p, ['format', 'version', 'source_app_id', 'data_environment', 'privilege', 'producer', 'inventory', 'valid_from', 'valid_until', 'schema_sha256', 'collections', 'identities', 'agencies']);
  check(p.format === 'pennsync-staging-capture-permit' && p.version === 1 && p.source_app_id === APP
    && p.data_environment === 'prod' && p.privilege === 'user' && p.producer === 'reviewed-synthetic-fixture'
    && p.inventory === 'explicit-fixture-ids' && HASH.test(p.schema_sha256), 'source_boundary');
  const start = Date.parse(p.valid_from); const end = Date.parse(p.valid_until);
  check(Number.isFinite(start) && Number.isFinite(end) && start <= at && at <= end && end - start <= 86400000, 'permit_expired');
  check(Array.isArray(p.collections) && p.collections.length >= 2 && p.collections.length <= 20);
  const entities = new Set(); let rows = 0;
  for (const c of p.collections) {
    exact(c, ['entity', 'fields', 'ids', 'references', 'file_references', 'opaque_fields', 'scope']);
    check(/^[A-Z][A-Za-z0-9]{0,99}$/.test(c.entity) && !/(secret|token|session|credential|oauth|apike)/i.test(c.entity) && !entities.has(c.entity));
    entities.add(c.entity);
    check(Array.isArray(c.ids) && c.ids.length <= 1000 && c.ids.every((id, i) => ID.test(id) && (i === 0 || c.ids[i - 1] < id)));
    rows += c.ids.length; check(rows <= MAX_ROWS);
    check(Array.isArray(c.fields) && c.fields.length <= 100 && c.fields.includes('id') && new Set(c.fields).size === c.fields.length
      && c.fields.every(f => typeof f === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(f)));
    if (c.entity === 'User') check(c.fields.includes('email') && c.ids.every(id => id !== PROTECTED_OWNER && ACTORS.has(id)), 'protected_identity');
    validateArchiveRow(Object.fromEntries(c.fields.map(f => [f, null])));
    validateArchiveCollectionPolicy(c);
  }
  check(entities.has('User') && entities.has('Agency'), 'identity_inventory_required');
  for (const [name, entity, source, target] of [['identities', 'User', 'user_id', 'target_subject'], ['agencies', 'Agency', 'agency_id', 'target_agency_id']]) {
    check(Array.isArray(p[name]) && p[name].length === p.collections.find(c => c.entity === entity).ids.length);
    const ids = new Set(); const targets = new Set();
    for (const row of p[name]) {
      exact(row, ['source_app_id', source, target, 'decision_sha256']);
      check(row.source_app_id === APP && p.collections.find(c => c.entity === entity).ids.includes(row[source])
        && !ids.has(row[source]) && typeof row[target] === 'string' && /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,199}$/.test(row[target])
        && !targets.has(row[target]) && HASH.test(row.decision_sha256), 'identity_mapping');
      ids.add(row[source]); targets.add(row[target]);
    }
  }
  return p;
}
async function boundedRead(handle, maximum) {
  const chunks = []; let size = 0;
  for (;;) {
    const data = Buffer.alloc(Math.min(65536, maximum + 1 - size));
    const result = await handle.read(data); if (!result.bytesRead) break;
    size += result.bytesRead; check(size <= maximum, 'size_limit'); chunks.push(data.subarray(0, result.bytesRead));
  }
  return Buffer.concat(chunks);
}
async function boundedRegularFile(path, maximum) {
  const stat = await lstat(path); check(stat.isFile() && !stat.isSymbolicLink());
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  try {
    const info = await handle.stat(); check(info.isFile() && info.size <= maximum, 'size_limit');
    return await boundedRead(handle, maximum);
  } finally { await handle.close(); }
}
async function boundedFile(dir, name, maximum) {
  check(/^(header\.json|seal\.bin|[0-9]{8}\.bin)$/.test(name));
  return boundedRegularFile(join(dir, name), maximum);
}
async function writeNew(dir, name, bytes) {
  const handle = await open(join(dir, name), 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
function derive(key, header) {
  check(Buffer.isBuffer(key) && key.length === 32, 'invalid_key');
  return Buffer.from(hkdfSync('sha256', key, Buffer.from(header.salt, 'hex'), MAGIC, 32));
}
function aad(header, slot, size) { return json([MAGIC, 1, header.capture_id, header.salt, slot, size]); }
function encrypt(bytes, key, header, slot) {
  const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad(header, slot, bytes.length));
  const output = Buffer.concat([cipher.update(bytes), cipher.final()]); return Buffer.concat([nonce, cipher.getAuthTag(), output]);
}
function decrypt(bytes, key, header, slot) {
  try {
    check(bytes.length >= 28); const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAAD(aad(header, slot, bytes.length - 28)); decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
  } catch { throw new CaptureError('authentication_failed'); }
}
function encodePage(rows, c, offset) {
  check(Array.isArray(rows) && rows.length === Math.min(PAGE, c.ids.length - offset), 'missing_or_extra_rows');
  for (const [index, row] of rows.entries()) {
    plain(row); check(isObject(row) && row.id === c.ids[offset + index] && Object.keys(row).every(f => c.fields.includes(f)), 'row_scope');
    if (c.entity === 'User') check(ACTORS.get(row.id) === row.email, 'identity_changed');
    check(!Object.hasOwn(row, 'app_id') || row.app_id === APP, 'source_boundary'); validateArchiveRow(row);
  }
  const bytes = Buffer.from(rows.map(row => JSON.stringify(row) + '\n').join(''));
  check(bytes.length <= FRAME, 'page_too_large'); return bytes;
}
function receipt(seal, p) {
  return { status: 'verified_encrypted_staging_live_capture', collections: p.collections.length,
    records: p.collections.reduce((n, c) => n + c.ids.length, 0), read_requests: seal.read_requests,
    observed_fixture_bytes_matched: true, source_snapshot_verified: false, source_inventory_complete: false,
    private_file_inventory_complete: false, file_bytes_captured: 0, credential_migration_verified: false,
    full_transfer_complete: false, cutover_authorized: false, remote_mutations: 0, contains_row_values: false };
}

/** SDK objects serialize as JSONL; these are not the provider's original HTTP JSON bytes. */
export async function captureStaging({ sdk, runtime, envelope, signerSpki, captureDir, key }) {
  const started = Date.now(); const p = permit(envelope, signerSpki, started);
  exact(runtime, ['app_id', 'data_environment', 'privileged']);
  check(runtime.app_id === APP && runtime.data_environment === 'prod' && runtime.privileged === false, 'runtime_boundary');
  check(sdk && sdk.entities && Buffer.isBuffer(key) && key.length === 32, 'invalid_runtime');
  // Check every method before creating output or making the first source read.
  for (const c of p.collections) check(typeof sdk.entities[c.entity]?.filter === 'function', 'unsupported_sdk');
  await mkdir(captureDir, { mode: 0o700 });
  const header = { format: MAGIC, version: 1, capture_id: randomBytes(16).toString('hex'), salt: randomBytes(32).toString('hex') };
  const derived = derive(key, header); let slot = 0; let total = 0; let requests = 0; const items = [];
  try {
    await writeNew(captureDir, 'header.json', json(header));
    for (let pass = 0; pass < 2; pass++) {
      for (const c of p.collections) {
        const expected = items.find(item => item.path === `${c.entity}.jsonl`);
        const item = { path: `${c.entity}.jsonl`, bytes: 0, sha256: '', rows: c.ids.length, chunks: [] };
        const digest = createHash('sha256'); let page = 0;
        const offsets = Array.from({ length: Math.ceil(c.ids.length / PAGE) }, (_, i) => i * PAGE);
        if (c.ids.length) offsets.push(c.ids.length); // Never issue an empty/broad ID query.
        for (const offset of offsets) {
          let timer; let rows;
          try {
            rows = await Promise.race([sdk.entities[c.entity].filter({ id: { $in: [...c.ids] } }, 'id', PAGE, offset, [...c.fields]),
              new Promise((_, reject) => { timer = setTimeout(() => reject(new CaptureError('source_timeout')), 15000); })]);
          } catch { throw new CaptureError('source_read_failed'); }
          finally { clearTimeout(timer); }
          requests++;
          const bytes = encodePage(rows, c, offset); digest.update(bytes); item.bytes += bytes.length;
          if (offset === c.ids.length) { check(bytes.length === 0); continue; }
          const record = { slot: pass ? expected.chunks[page]?.slot : String(++slot).padStart(8, '0'), bytes: bytes.length,
            sha256: sha(bytes), rows: rows.length, first_id: rows[0].id, last_id: rows.at(-1).id };
          if (pass) check(JSON.stringify(record) === JSON.stringify(expected.chunks[page]), 'observed_drift');
          else {
            total += bytes.length; check(total <= MAX_BYTES, 'capture_too_large');
            await writeNew(captureDir, `${record.slot}.bin`, encrypt(bytes, derived, header, record.slot)); item.chunks.push(record);
          }
          page++;
        }
        item.sha256 = digest.digest('hex');
        if (pass) check(item.bytes === expected.bytes && item.sha256 === expected.sha256 && page === expected.chunks.length, 'observed_drift');
        else items.push(item);
      }
    }
    const ended = Date.now(); permit(envelope, signerSpki, ended);
    const seal = { format: MAGIC, version: 1, envelope, started_at: started, ended_at: ended, read_requests: requests, items };
    const bytes = json(seal); check(bytes.length <= META, 'capture_too_large');
    await writeNew(captureDir, 'seal.bin', encrypt(bytes, derived, header, 'seal'));
  } finally { derived.fill(0); }
  return verifyCapture({ captureDir, key, signerSpki });
}

async function withCapture({ captureDir, key, signerSpki }, use) {
  const header = parse(await boundedFile(captureDir, 'header.json', 1024));
  exact(header, ['format', 'version', 'capture_id', 'salt']);
  check(header.format === MAGIC && header.version === 1 && /^[0-9a-f]{32}$/.test(header.capture_id) && HASH.test(header.salt));
  const derived = derive(key, header);
  try {
    const seal = parse(decrypt(await boundedFile(captureDir, 'seal.bin', META + 28), derived, header, 'seal'));
    exact(seal, ['format', 'version', 'envelope', 'started_at', 'ended_at', 'read_requests', 'items']);
    check(seal.format === MAGIC && seal.version === 1 && Number.isSafeInteger(seal.started_at) && Number.isSafeInteger(seal.ended_at) && seal.ended_at >= seal.started_at);
    const p = permit(seal.envelope, signerSpki, seal.started_at); permit(seal.envelope, signerSpki, seal.ended_at);
    check(Array.isArray(seal.items) && seal.items.length === p.collections.length);
    const expectedRequests = 2 * p.collections.reduce((n, c) => n + (c.ids.length ? Math.ceil(c.ids.length / PAGE) + 1 : 0), 0);
    check(seal.read_requests === expectedRequests);
    const files = new Set(['header.json', 'seal.bin']); let slot = 0; let total = 0;
    async function* read(item) {
      for (const chunk of item.chunks) {
        const bytes = decrypt(await boundedFile(captureDir, `${chunk.slot}.bin`, FRAME + 28), derived, header, chunk.slot);
        check(bytes.length === chunk.bytes && sha(bytes) === chunk.sha256, 'frame_changed'); yield bytes;
      }
    }
    for (const [index, c] of p.collections.entries()) {
      const item = seal.items[index]; exact(item, ['path', 'bytes', 'sha256', 'rows', 'chunks']);
      check(item.path === `${c.entity}.jsonl` && item.rows === c.ids.length && Number.isSafeInteger(item.bytes) && item.bytes >= 0 && HASH.test(item.sha256)
        && Array.isArray(item.chunks) && item.chunks.length === Math.ceil(c.ids.length / PAGE));
      for (const chunk of item.chunks) {
        exact(chunk, ['slot', 'bytes', 'sha256', 'rows', 'first_id', 'last_id']);
        check(chunk.slot === String(++slot).padStart(8, '0') && Number.isSafeInteger(chunk.bytes) && chunk.bytes > 0 && chunk.bytes <= FRAME && HASH.test(chunk.sha256));
        files.add(`${chunk.slot}.bin`);
      }
      const digest = createHash('sha256'); let size = 0; let offset = 0; let page = 0;
      for await (const bytes of read(item)) {
        const lines = bytes.toString('utf8').split('\n'); check(lines.pop() === '');
        const rows = lines.map(line => parse(Buffer.from(line)));
        check(encodePage(rows, c, offset).equals(bytes), 'frame_encoding');
        const chunk = item.chunks[page++]; check(chunk.rows === rows.length && chunk.first_id === rows[0].id && chunk.last_id === rows.at(-1).id);
        offset += rows.length; size += bytes.length; digest.update(bytes);
      }
      check(offset === c.ids.length && size === item.bytes && digest.digest('hex') === item.sha256);
      total += size; check(total <= MAX_BYTES);
    }
    const entries = await readdir(captureDir, { withFileTypes: true });
    check(entries.length === files.size && entries.every(entry => entry.isFile() && files.has(entry.name)), 'unexpected_entry');
    return await use({ seal, p, read });
  } finally { derived.fill(0); }
}
export async function verifyCapture(options) { return withCapture(options, ({ seal, p }) => receipt(seal, p)); }

/** Promotion still requires all archive identity, tenant, relationship and file checks. */
export async function promoteCapture({ archiveDir, ...options }) {
  const capture = await realpath(options.captureDir);
  const destination = resolve(archiveDir);
  const archive = join(await realpath(dirname(destination)), basename(destination));
  const contains = (parent, child) => {
    const path = relative(parent, child);
    return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
  };
  // Resolve parent aliases before the builder can add any entry to the capture.
  check(!contains(capture, archive) && !contains(archive, capture), 'overlapping_output');
  return withCapture(options, async ({ seal, p, read }) => {
    const mappings = new Map(['identities', 'agencies'].map(name => [name + '.jsonl', Buffer.from(p[name].map(row => JSON.stringify(row) + '\n').join(''))]));
    const describe = name => ({ path: name + '.jsonl', bytes: mappings.get(name + '.jsonl').length, sha256: sha(mappings.get(name + '.jsonl')), rows: p[name].length });
    const plan = { format: 'pennsync-supplied-export', version: 1, source_apps: [APP], snapshot_evidence_sha256: sha(json(seal)),
      collections: p.collections.map((c, i) => ({ source_app_id: APP, entity: c.entity, path: seal.items[i].path, bytes: seal.items[i].bytes, sha256: seal.items[i].sha256,
        rows: c.ids.length, fields: c.fields, references: c.references, file_references: c.file_references, opaque_fields: c.opaque_fields, scope: c.scope })),
      identities: describe('identities'), agencies: describe('agencies'), files: [] };
    const readInput = d => mappings.has(d.path) ? [mappings.get(d.path)] : read(seal.items.find(item => item.path === d.path));
    const result = await buildArchiveFromReader({ rawPlan: json(plan), read: readInput, archiveDir: archive, key: options.key });
    return { ...result, acquisition: receipt(seal, p) };
  });
}

function readKey(env) {
  const encoded = env.PENNSYNC_ARCHIVE_KEY_BASE64; const fd = env.PENNSYNC_ARCHIVE_KEY_FD;
  delete env.PENNSYNC_ARCHIVE_KEY_BASE64;
  check((encoded !== undefined) !== (fd !== undefined), 'missing_key');
  let value = encoded;
  if (fd !== undefined) {
    check(/^(0|[3-9]|[1-9][0-9]{1,3})$/.test(fd)); const bytes = Buffer.alloc(128); let count = 0;
    try {
      while (count < bytes.length) { const n = readSync(Number(fd), bytes, count, bytes.length - count, null); if (!n) break; count += n; }
      check(count < bytes.length && bytes.subarray(0, count).every(b => b < 128)); value = bytes.subarray(0, count).toString('ascii').trim();
    } finally { bytes.fill(0); }
  }
  const key = canonicalBase64(value, 32); check(key.length === 32); return key;
}

/** Called only inside CLI exec; raw failures must never escape its printing wrapper. */
export async function runCaptureWorker(sdk, env = process.env, write = value => process.stdout.write(value)) {
  let key;
  try {
    key = readKey(env);
    check(typeof env.PENNSYNC_CAPTURE_PERMIT_PATH === 'string' && typeof env.PENNSYNC_CAPTURE_DIR === 'string');
    const envelope = parse(await boundedRegularFile(env.PENNSYNC_CAPTURE_PERMIT_PATH, META));
    const result = await captureStaging({ sdk, key, captureDir: resolve(env.PENNSYNC_CAPTURE_DIR), envelope, signerSpki: env.PENNSYNC_CAPTURE_SIGNER_SPKI_BASE64,
      runtime: { app_id: env.BASE44_APP_ID, data_environment: env.BASE44_DATA_ENV, privileged: env.BASE44_PRIVILEGED === 'true' } });
    write(`PENNSYNC_CAPTURE_RECEIPT ${JSON.stringify(result)}\n`); return 0;
  } catch { return 1; } finally { delete env.PENNSYNC_ARCHIVE_KEY_BASE64; key?.fill(0); }
}

/** CLI diagnostics can contain source values; capture them boundedly and discard all. */
export async function runAcquisitionCli({ argv = process.argv, env = process.env, write = console.log, error = console.error, launch = spawn } = {}) {
  let key;
  try {
    check(argv.length === 3 && ['capture', 'verify', 'promote'].includes(argv[2]), 'usage');
    key = readKey(env); check(typeof env.PENNSYNC_CAPTURE_DIR === 'string');
    const options = { key, captureDir: resolve(env.PENNSYNC_CAPTURE_DIR), signerSpki: env.PENNSYNC_CAPTURE_SIGNER_SPKI_BASE64 };
    let result;
    if (argv[2] === 'capture') {
      check(await lstat(options.captureDir).then(() => false, e => e.code === 'ENOENT'), 'destination_exists');
      // Run the local package-manager JavaScript entry directly; no shell or
      // command interpolation, including on Windows where .cmd cannot be spawned.
      let npx;
      for (const candidate of [join(dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js'), join(dirname(process.execPath), '../lib/node_modules/npm/bin/npx-cli.js')]) {
        if (await lstat(candidate).then(s => s.isFile(), () => false)) { npx = candidate; break; }
      }
      check(npx, 'local_npx_required');
      const script = `const {runCaptureWorker}=await import(${JSON.stringify(import.meta.url)}); if(await runCaptureWorker(globalThis.base44)) throw new Error('CAPTURE_FAILED');`;
      const childEnv = { ...env, NODE_ENV: 'production', PENNSYNC_ARCHIVE_KEY_BASE64: key.toString('base64') }; delete childEnv.PENNSYNC_ARCHIVE_KEY_FD;
      await new Promise((done, reject) => {
        const child = launch(process.execPath, [npx, '--no-install', 'base44', '--app-id', APP, 'exec', '--data-env', 'prod'],
          { env: childEnv, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
        delete childEnv.PENNSYNC_ARCHIVE_KEY_BASE64;
        let terminated = false;
        const terminate = () => {
          if (terminated) return; terminated = true;
          if (!Number.isSafeInteger(child.pid) || child.pid <= 0) { child.kill(); return; }
          if (process.platform === 'win32') spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
          else { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already stopped. */ } }
        };
        let bytes = 0; const timer = setTimeout(() => { terminate(); reject(new CaptureError('child_failed')); }, 300000);
        for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { bytes += chunk.length; if (bytes > 65536) { clearTimeout(timer); terminate(); reject(new CaptureError('child_failed')); } });
        child.on('error', () => { clearTimeout(timer); reject(new CaptureError('child_failed')); });
        child.on('close', code => { clearTimeout(timer); code === 0 ? done() : reject(new CaptureError('child_failed')); });
        child.stdin.on('error', () => {}); child.stdin.end(script);
      });
      result = await verifyCapture(options); // A child exit code or printed receipt is never sufficient.
    } else if (argv[2] === 'verify') result = await verifyCapture(options);
    else { check(typeof env.PENNSYNC_ARCHIVE_DIR === 'string'); result = await promoteCapture({ ...options, archiveDir: resolve(env.PENNSYNC_ARCHIVE_DIR) }); }
    write(JSON.stringify(result)); return 0;
  } catch { error('Staging acquisition failed: no verified capture or archive was accepted.'); return 1; }
  finally { delete env.PENNSYNC_ARCHIVE_KEY_BASE64; key?.fill(0); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await runAcquisitionCli();
