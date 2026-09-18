#!/usr/bin/env node
/** Offline supplied-export archive only. No SDK, network, import, or deletion path. */
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { constants, readSync } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ARCHIVE_SOURCE_APPS = Object.freeze({
  legacy: '68ee80d98929370f9e8f2932',
  production: '694ec16e72e01b60d22f7cbf',
  staging: '6a9881683dc68a0bd54f1ef7',
});
const APPS = new Set(Object.values(ARCHIVE_SOURCE_APPS));
export const ARCHIVE_LIMITS = Object.freeze({
  chunk: 1024 * 1024, line: 1024 * 1024, plan: 2 * 1024 * 1024,
  seal: 16 * 1024 * 1024, file: 128 * 1024 * 1024, total: 2 * 1024 * 1024 * 1024,
  rows: 100_000, files: 10_000, collections: 1000, edges: 500_000,
});
const MAGIC = 'pennsync-encrypted-offline-archive';
const HEX = /^[0-9a-f]{64}$/;
const ID = /^[0-9a-f]{24}$/;
const validId = (v) => typeof v === 'string' && ID.test(v);
const validHash = (v) => typeof v === 'string' && HEX.test(v);
const TEXT_ID = /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,199}$/;
const SECRET_ENTITY = /(?:secret|token|session|credential|oauth|apike)/i;
const SECRET_KEY = /(?:password|passwd|secret|token|privatekey|apikey|authorization|cookie|mfaseed|totpseed|recoverycodes|backupcodes)/i;
const RISK_FIELD = /(?:_id|_ids|_url|_urls|_uri|_uris)$/i;
const object = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const sha = (v) => createHash('sha256').update(v).digest('hex');
const keyOf = (app, entity, id) => JSON.stringify([app, entity, id]);
const json = (v) => Buffer.from(JSON.stringify(v));

export class ArchiveInputError extends Error {
  constructor(code) { super('Archive validation failed.'); this.code = code; }
}
function requireThat(value, code = 'invalid_input') { if (!value) throw new ArchiveInputError(code); }
function exact(v, keys) {
  requireThat(object(v) && Object.keys(v).sort().join('|') === [...keys].sort().join('|'));
}
function boundedArray(v, max) { requireThat(Array.isArray(v) && v.length <= max); }
function integer(v, max) { return Number.isSafeInteger(v) && v >= 0 && v <= max; }
function parse(raw) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
    const value = JSON.parse(text);
    // JSON.parse alone accepts duplicate keys, including escaped aliases.
    // Inspect tokens after syntax validation without normalizing archived bytes.
    const stack = [];
    for (const match of text.matchAll(/"(?:\\.|[^"\\])*"|[{}[\],:]/g)) {
      const token = match[0];
      if (token === '{' || token === '[') {
        requireThat(stack.length < 64); stack.push({ object: token === '{', key: true, keys: new Set() });
      } else if (token === '}' || token === ']') stack.pop();
      else if (token === ',') { if (stack.at(-1)?.object) stack.at(-1).key = true; }
      else if (token.startsWith('"') && stack.at(-1)?.object && stack.at(-1).key) {
        const key = JSON.parse(token); const frame = stack.at(-1);
        requireThat(!frame.keys.has(key)); frame.keys.add(key); frame.key = false;
      }
    }
    return value;
  }
  catch { throw new ArchiveInputError('invalid_json'); }
}
function safePath(v) {
  requireThat(typeof v === 'string' && v.length < 300 && /^[A-Za-z0-9_./-]+$/.test(v)
    && !isAbsolute(v) && v.split('/').every((p) => p && p !== '.' && p !== '..'), 'unsafe_path');
  return v;
}
function pointerParts(v) {
  requireThat(typeof v === 'string' && v.length < 500 && v.startsWith('/')
    && !/~(?![01])/.test(v), 'invalid_pointer');
  const parts = v.slice(1).split('/').map((p) => p.replaceAll('~1', '/').replaceAll('~0', '~'));
  requireThat(parts.length <= 32 && parts.every((p) => p && !['__proto__', 'prototype', 'constructor'].includes(p)));
  return parts;
}
function pointerEscape(v) { return v.replaceAll('~', '~0').replaceAll('/', '~1'); }
function atPointers(row, pointer, containers) {
  let nodes = [{ value: row, path: '' }];
  for (const part of pointerParts(pointer)) {
    const next = [];
    for (const node of nodes) {
      // An explicit wildcard declares a nullable collection. Preserve its null
      // bytes while visiting no elements; named-child traversal still rejects.
      if (part === '*' && node.value === null) { containers.add(node.path); continue; }
      // Only containers actually traversed by a policy can cover ancestor fields.
      // A missing child on a scalar/null must never hide an unchecked reference.
      requireThat(object(node.value) || Array.isArray(node.value), 'invalid_reference');
      containers.add(node.path);
      if (part === '*') {
        requireThat(Array.isArray(node.value), 'invalid_reference');
        node.value.forEach((value, index) => next.push({ value, path: `${node.path}/${index}` }));
      } else {
        if (Object.hasOwn(node.value, part)) next.push({ value: node.value[part], path: `${node.path}/${pointerEscape(part)}` });
      }
    }
    nodes = next;
  }
  return nodes;
}
function canonicalLocator(value) {
  requireThat(typeof value === 'string' && value.length > 0 && value.length <= 4000
    && value === value.trim() && [...value].every((c) => c.codePointAt(0) >= 32 && c.codePointAt(0) !== 127), 'invalid_file_locator');
}
function urlCandidate(value) {
  const text = typeof value === 'string' ? value.replaceAll(/[\t\r\n]/g, '').trim() : '';
  let start = 0; let end = text.length;
  // URL parsers also discard leading/trailing C0 controls, not only JS whitespace.
  while (start < end && text.charCodeAt(start) <= 32) start += 1;
  while (end > start && text.charCodeAt(end - 1) <= 32) end -= 1;
  return text.slice(start, end);
}
function scanRow(row) {
  const risky = [];
  let visited = 0;
  function walk(v, path, depth) {
    requireThat(++visited <= 50_000 && depth <= 40, 'row_too_complex');
    requireThat(typeof v !== 'number' || Number.isFinite(v), 'invalid_number');
    // URL parsing discards tabs/newlines and surrounding whitespace. Detect that
    // form first, then reject it without rewriting the supplied source bytes.
    const candidate = urlCandidate(v);
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
      requireThat(candidate === v, 'invalid_url');
      let url;
      try { url = new URL(v); } catch { throw new ArchiveInputError('invalid_url'); }
      const fragment = new URLSearchParams(url.hash.slice(1).replaceAll(/[?#]/g, '&'));
      requireThat(!url.username && !url.password && [...url.searchParams.keys(), ...fragment.keys()].every((k) => {
        const normalized = k.replaceAll(/[^a-z0-9]/gi, '');
        return !SECRET_KEY.test(normalized) && !/^(?:sig|signature|key|x(?:amz|goog)(?:credential|signature))$/i.test(normalized);
      }), 'credential_url');
    }
    if (!v || typeof v !== 'object') return;
    for (const [k, value] of Object.entries(v)) {
      requireThat(!SECRET_KEY.test(k.replaceAll(/[^a-z0-9]/gi, ''))
        && !['__proto__', 'prototype', 'constructor'].includes(k), 'credential_field');
      const next = `${path}/${pointerEscape(k)}`;
      if (RISK_FIELD.test(k) && !(path === '' && ['id', 'app_id'].includes(k))) risky.push(next);
      walk(value, next, depth + 1);
    }
  }
  walk(row, '', 0);
  return risky;
}
// Acquisition callers use the same credential/URL guard before persisting frames.
export function validateArchiveRow(row) { scanRow(row); }
function descriptor(d) {
  requireThat(integer(d.bytes, ARCHIVE_LIMITS.file) && validHash(d.sha256));
  safePath(d.path);
}
// Acquisition validates the same policy syntax/bounds before any source read.
// This does not verify live schemas, row values, relationship targets or bytes.
export function validateArchiveCollectionPolicy(c) {
  requireThat(object(c));
  boundedArray(c.fields, 300); boundedArray(c.references, 100); boundedArray(c.file_references, 100); boundedArray(c.opaque_fields, 300);
  requireThat(c.fields.includes('id') && new Set(c.fields).size === c.fields.length && c.fields.every((f) => typeof f === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(f)));
  for (const r of c.references) { exact(r, ['pointer', 'entity']); pointerParts(r.pointer); requireThat(typeof r.entity === 'string' && /^[A-Z][A-Za-z0-9]{0,99}$/.test(r.entity)); }
  for (const p of [...c.file_references, ...c.opaque_fields]) pointerParts(p);
  const classified = [...c.references.map((r) => r.pointer), ...c.file_references, ...c.opaque_fields];
  requireThat(new Set(classified).size === classified.length, 'ambiguous_field_policy');
  if (c.entity === 'User') { exact(c.scope, ['kind']); requireThat(c.scope.kind === 'principal'); }
  else if (c.entity === 'Agency') { exact(c.scope, ['kind']); requireThat(c.scope.kind === 'agency_root'); }
  else if (c.scope?.kind === 'agency') { exact(c.scope, ['kind', 'pointer']); pointerParts(c.scope.pointer); }
  else { exact(c.scope, ['kind', 'decision_sha256']); requireThat(c.scope.kind === 'global' && validHash(c.scope.decision_sha256)); }
}
function validatePlan(plan) {
  exact(plan, ['format', 'version', 'source_apps', 'snapshot_evidence_sha256', 'collections', 'identities', 'agencies', 'files']);
  requireThat(plan.format === 'pennsync-supplied-export' && plan.version === 1);
  boundedArray(plan.source_apps, 2);
  requireThat(plan.source_apps.length > 0 && new Set(plan.source_apps).size === plan.source_apps.length
    && plan.source_apps.every((a) => APPS.has(a)), 'source_app');
  requireThat(!plan.source_apps.includes(ARCHIVE_SOURCE_APPS.staging) || plan.source_apps.length === 1, 'staging_source_mixing');
  requireThat(validHash(plan.snapshot_evidence_sha256));
  boundedArray(plan.collections, ARCHIVE_LIMITS.collections);
  boundedArray(plan.files, ARCHIVE_LIMITS.files);
  const names = new Set();
  const paths = new Set(['plan.json']);
  let total = 0;
  for (const c of plan.collections) {
    exact(c, ['source_app_id', 'entity', 'path', 'bytes', 'sha256', 'rows', 'fields', 'references', 'file_references', 'opaque_fields', 'scope']);
    requireThat(plan.source_apps.includes(c.source_app_id) && typeof c.entity === 'string' && /^[A-Z][A-Za-z0-9]{0,99}$/.test(c.entity)
      && !SECRET_ENTITY.test(c.entity), 'source_collection');
    requireThat(!names.has(keyOf(c.source_app_id, c.entity, '')), 'duplicate_collection');
    names.add(keyOf(c.source_app_id, c.entity, ''));
    validateArchiveCollectionPolicy(c);
  }
  for (const app of plan.source_apps) for (const entity of ['User', 'Agency']) requireThat(names.has(keyOf(app, entity, '')), 'missing_identity_collection');
  for (const d of [plan.identities, plan.agencies]) exact(d, ['path', 'bytes', 'sha256', 'rows']);
  for (const f of plan.files) {
    exact(f, ['source_app_id', 'file_id', 'path', 'bytes', 'sha256', 'access', 'agency_id', 'owner_user_id', 'original_name', 'source_locator', 'bindings']);
    requireThat(plan.source_apps.includes(f.source_app_id) && validId(f.file_id)
      && validId(f.agency_id) && validId(f.owner_user_id) && ['private', 'public'].includes(f.access), 'invalid_file');
    requireThat(typeof f.original_name === 'string' && f.original_name.length > 0 && f.original_name.length <= 500
      && [...f.original_name].every((c) => c.codePointAt(0) >= 32 && c.codePointAt(0) !== 127), 'invalid_file');
    canonicalLocator(f.source_locator);
    scanRow(f);
    boundedArray(f.bindings, 1000);
    for (const b of f.bindings) {
      exact(b, ['entity', 'record_id', 'pointer', 'locator_sha256']); pointerParts(b.pointer);
      requireThat(validId(b.record_id) && validHash(b.locator_sha256) && b.locator_sha256 === sha(f.source_locator)
        && !b.pointer.includes('*'), 'file_binding_mismatch');
    }
  }
  for (const d of [...plan.collections, plan.identities, plan.agencies, ...plan.files]) {
    descriptor(d); requireThat(!paths.has(d.path), 'duplicate_path'); paths.add(d.path);
    total += d.bytes;
    if ('rows' in d) requireThat(integer(d.rows, ARCHIVE_LIMITS.rows));
  }
  requireThat(total <= ARCHIVE_LIMITS.total, 'archive_too_large');
  return plan;
}

async function localFile(root, path) {
  const base = await realpath(root);
  let current = base;
  for (const part of safePath(path).split('/')) {
    current = join(current, part);
    const info = await lstat(current);
    requireThat(!info.isSymbolicLink(), 'unsafe_path');
  }
  const resolved = await realpath(current);
  const rel = relative(base, resolved);
  requireThat(rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), 'unsafe_path');
  const handle = await open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  const info = await handle.stat();
  if (!info.isFile()) { await handle.close(); throw new ArchiveInputError('unsafe_path'); }
  return handle;
}
async function* diskChunks(root, path, limit) {
  const file = await localFile(root, path);
  let size = 0;
  try {
    while (true) {
      const buffer = Buffer.alloc(Math.min(ARCHIVE_LIMITS.chunk, limit + 1));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      size += bytesRead; requireThat(size <= limit, 'input_too_large');
      yield buffer.subarray(0, bytesRead);
    }
  } finally { await file.close(); }
}
async function collect(chunks, maximum) {
  let bytes = 0; const buffers = [];
  for await (const chunk of chunks) { bytes += chunk.length; requireThat(bytes <= maximum, 'input_too_large'); buffers.push(chunk); }
  return Buffer.concat(buffers);
}
async function* checked(chunks, expected) {
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of chunks) { bytes += chunk.length; requireThat(bytes <= expected.bytes, 'input_changed'); hash.update(chunk); yield chunk; }
  requireThat(bytes === expected.bytes && hash.digest('hex') === expected.sha256, 'input_changed');
}
async function* jsonLines(chunks) {
  let pending = Buffer.alloc(0);
  for await (const chunk of chunks) {
    let begin = 0;
    for (let i = 0; i < chunk.length; i += 1) {
      if (chunk[i] !== 10) continue;
      const line = Buffer.concat([pending, chunk.subarray(begin, i)]);
      requireThat(line.length <= ARCHIVE_LIMITS.line && line.length > 0, 'invalid_jsonl');
      yield parse(line); pending = Buffer.alloc(0); begin = i + 1;
    }
    pending = Buffer.concat([pending, chunk.subarray(begin)]);
    requireThat(pending.length <= ARCHIVE_LIMITS.line, 'line_too_large');
  }
  if (pending.length) yield parse(pending);
}
async function visitRows(d, read, visit) {
  let count = 0;
  for await (const row of jsonLines(checked(read(d), d))) {
    requireThat(++count <= d.rows && object(row), 'row_count'); await visit(row);
  }
  requireThat(count === d.rows, 'row_count');
}

async function inspectInputs(plan, read) {
  const rows = new Set(); const edges = []; const expectedFiles = new Map(); const rowScopes = new Map();
  let count = 0;
  for (const c of plan.collections) {
    await visitRows(c, read, (row) => {
      requireThat(++count <= ARCHIVE_LIMITS.rows && validId(row.id)
        && Object.keys(row).every((f) => c.fields.includes(f)), 'invalid_record');
      requireThat(!Object.hasOwn(row, 'app_id') || row.app_id === c.source_app_id, 'record_source_mixing');
      const key = keyOf(c.source_app_id, c.entity, row.id);
      requireThat(!rows.has(key), 'duplicate_record'); rows.add(key);
      const classified = new Set(); const containers = new Set();
      for (const p of c.opaque_fields) atPointers(row, p, containers).forEach((n) => classified.add(n.path));
      for (const r of c.references) for (const n of atPointers(row, r.pointer, containers)) {
        classified.add(n.path); if (n.value == null || n.value === '') continue;
        requireThat(validId(n.value), 'invalid_reference');
        edges.push([key, keyOf(c.source_app_id, r.entity, n.value)]);
      }
      let agency = null;
      if (c.scope.kind === 'agency') {
        const nodes = atPointers(row, c.scope.pointer, containers);
        requireThat(nodes.length === 1 && validId(nodes[0].value), 'ambiguous_agency');
        agency = nodes[0].value; classified.add(nodes[0].path);
        edges.push([key, keyOf(c.source_app_id, 'Agency', agency)]);
      } else if (c.scope.kind === 'agency_root') agency = row.id;
      rowScopes.set(key, agency);
      for (const p of c.file_references) for (const n of atPointers(row, p, containers)) {
        classified.add(n.path); if (n.value == null || n.value === '') continue;
        canonicalLocator(n.value);
        const binding = JSON.stringify([key, n.path]);
        requireThat(!expectedFiles.has(binding), 'ambiguous_file_binding');
        expectedFiles.set(binding, sha(n.value));
      }
      requireThat(scanRow(row).every((p) => classified.has(p) || containers.has(p)), 'unclassified_reference');
      requireThat(edges.length + expectedFiles.size <= ARCHIVE_LIMITS.edges, 'too_many_references');
    });
  }
  for (const [source, target] of edges) {
    requireThat(rows.has(target), 'orphan_reference');
    const sourceAgency = rowScopes.get(source); const targetAgency = rowScopes.get(target);
    requireThat(sourceAgency == null || targetAgency == null || sourceAgency === targetAgency, 'reference_agency_mismatch');
  }
  async function mappings(d, entity, idField, targetField) {
    const mapped = new Set(); const targets = new Set();
    await visitRows(d, read, (r) => {
      exact(r, ['source_app_id', idField, targetField, 'decision_sha256']);
      requireThat(plan.source_apps.includes(r.source_app_id) && validId(r[idField])
        && (typeof r[targetField] === 'string' && TEXT_ID.test(r[targetField])) && validHash(r.decision_sha256), 'invalid_mapping');
      const key = keyOf(r.source_app_id, entity, r[idField]);
      requireThat(rows.has(key) && !mapped.has(key) && !targets.has(r[targetField]), 'ambiguous_mapping');
      mapped.add(key); targets.add(r[targetField]);
    });
    for (const key of rows) if (JSON.parse(key)[1] === entity) requireThat(mapped.has(key), 'missing_mapping');
    return mapped.size;
  }
  const users = await mappings(plan.identities, 'User', 'user_id', 'target_subject');
  const agencies = await mappings(plan.agencies, 'Agency', 'agency_id', 'target_agency_id');
  const fileKeys = new Set(); const bound = new Set();
  for (const f of plan.files) {
    const fkey = keyOf(f.source_app_id, 'ArchiveFile', f.file_id);
    requireThat(!fileKeys.has(fkey), 'duplicate_file'); fileKeys.add(fkey);
    requireThat(rows.has(keyOf(f.source_app_id, 'User', f.owner_user_id))
      && rows.has(keyOf(f.source_app_id, 'Agency', f.agency_id)), 'file_owner_missing');
    for (const b of f.bindings) {
      const key = keyOf(f.source_app_id, b.entity, b.record_id);
      const binding = JSON.stringify([key, b.pointer]);
      requireThat(expectedFiles.get(binding) === b.locator_sha256 && !bound.has(binding), 'file_binding_mismatch');
      requireThat(rowScopes.get(key) == null || rowScopes.get(key) === f.agency_id, 'file_agency_mismatch');
      bound.add(binding);
    }
    // Reading and hashing files is local only. No provider URL is fetched.
    for await (const chunk of checked(read(f), f)) void chunk;
  }
  requireThat(bound.size === expectedFiles.size, 'missing_file');
  return { records: count, identities: users, agencies, files: plan.files.length, relationships: edges.length, file_bindings: bound.size };
}

function derive(key, header) {
  requireThat(Buffer.isBuffer(key) && key.length === 32, 'invalid_key');
  return Buffer.from(hkdfSync('sha256', key, Buffer.from(header.salt, 'hex'), MAGIC, 32));
}
function aad(header, slot, size) { return json([MAGIC, 1, header.archive_id, header.salt, slot, size]); }
function encrypt(bytes, key, header, slot) {
  const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad(header, slot, bytes.length));
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
}
function decrypt(bytes, key, header, slot) {
  requireThat(bytes.length >= 28, 'corrupt_archive');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28)); decipher.setAAD(aad(header, slot, bytes.length - 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
  } catch { throw new ArchiveInputError('authentication_failed'); }
}
async function writeExclusive(path, data) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
}
function report(counts, resumed = false) {
  return {
    status: 'verified_encrypted_offline_archive', version: 1, counts, resumed,
    full_transfer_complete: false, source_snapshot_verified: false,
    credential_migration_verified: false, relationship_contract_coverage_verified: false,
    hosted_restore_verified: false, remote_mutations: 0, source_mutations: 0,
    contains_row_values: false,
  };
}

/** Inputs must already be authorized, credential-free local exports. */
export async function buildArchive({ inputDir, archiveDir, key, resume = false }) {
  requireThat(Buffer.isBuffer(key) && key.length === 32, 'invalid_key');
  const rawPlan = await collect(diskChunks(inputDir, 'plan.json', ARCHIVE_LIMITS.plan), ARCHIVE_LIMITS.plan);
  const read = (d) => diskChunks(inputDir, d.path, d.bytes);
  return buildArchiveFromReader({ rawPlan, read, archiveDir, key, resume });
}

/** A bounded repeatable reader may decrypt local acquisition frames in memory.
 * All original plan, input, relationship and final archive checks still apply. */
export async function buildArchiveFromReader({ rawPlan, read, archiveDir, key, resume = false }) {
  requireThat(Buffer.isBuffer(key) && key.length === 32, 'invalid_key');
  requireThat(Buffer.isBuffer(rawPlan) && rawPlan.length <= ARCHIVE_LIMITS.plan && typeof read === 'function');
  const plan = validatePlan(parse(rawPlan));
  const counts = await inspectInputs(plan, read);
  if (resume) {
    const verified = await verifyArchive({ archiveDir, key, expectedPlanSha256: sha(rawPlan) });
    return { ...verified, resumed: true };
  }
  // A fresh directory is required: no output overwrite, repair or deletion.
  await mkdir(archiveDir, { mode: 0o700 });
  const header = { format: MAGIC, version: 1, archive_id: randomBytes(16).toString('hex'), salt: randomBytes(32).toString('hex') };
  const derived = derive(key, header);
  try {
    await writeExclusive(join(archiveDir, 'header.json'), json(header));
    let number = 0; const items = [];
    const descriptors = [{ path: 'plan.json', bytes: rawPlan.length, sha256: sha(rawPlan) }, ...plan.collections, plan.identities, plan.agencies, ...plan.files];
    for (const d of descriptors) {
      const item = { path: d.path, bytes: d.bytes, sha256: d.sha256, chunks: [] };
      const chunks = d.path === 'plan.json' ? [rawPlan] : read(d);
      for await (const chunk of checked(chunks, d)) {
        // The plan can span multiple encryption frames, like every other input.
        for (let offset = 0; offset < chunk.length; offset += ARCHIVE_LIMITS.chunk) {
          const bytes = chunk.subarray(offset, offset + ARCHIVE_LIMITS.chunk);
          const slot = String(++number).padStart(8, '0');
          await writeExclusive(join(archiveDir, `${slot}.bin`), encrypt(bytes, derived, header, slot));
          item.chunks.push({ slot, bytes: bytes.length });
        }
      }
      items.push(item);
    }
    const seal = json({ version: 1, plan_sha256: sha(rawPlan), counts, items });
    requireThat(seal.length <= ARCHIVE_LIMITS.seal, 'archive_too_large');
    // Only this authenticated last write marks a complete offline archive.
    await writeExclusive(join(archiveDir, 'seal.bin'), encrypt(seal, derived, header, 'seal'));
  } finally { derived.fill(0); }
  return verifyArchive({ archiveDir, key, expectedPlanSha256: sha(rawPlan) });
}

export async function verifyArchive({ archiveDir, key, expectedPlanSha256 }) {
  return inspectArchive({ archiveDir, key, expectedPlanSha256 });
}

/** Scoped reader for importers. The callback starts only after full verification.
 * Copy yielded buffers if retaining them: each is cleared when iteration resumes.
 * The callback must await all reads; its reader is invalid after it returns. */
export async function withVerifiedArchive(options, consume) {
  requireThat(typeof consume === 'function', 'invalid_consumer');
  return inspectArchive(options, consume);
}

async function inspectArchive({ archiveDir, key, expectedPlanSha256 }, consume) {
  const header = parse(await collect(diskChunks(archiveDir, 'header.json', 1024), 1024));
  exact(header, ['format', 'version', 'archive_id', 'salt']);
  requireThat(header.format === MAGIC && header.version === 1 && typeof header.archive_id === 'string'
    && /^[0-9a-f]{32}$/.test(header.archive_id) && validHash(header.salt), 'corrupt_archive');
  const derived = derive(key, header);
  try {
    const encryptedSeal = await collect(diskChunks(archiveDir, 'seal.bin', ARCHIVE_LIMITS.seal + 28), ARCHIVE_LIMITS.seal + 28);
    const seal = parse(decrypt(encryptedSeal, derived, header, 'seal'));
    exact(seal, ['version', 'plan_sha256', 'counts', 'items']);
    requireThat(seal.version === 1 && validHash(seal.plan_sha256)
      && (!expectedPlanSha256 || expectedPlanSha256 === seal.plan_sha256), 'plan_changed');
    boundedArray(seal.items, ARCHIVE_LIMITS.collections + ARCHIVE_LIMITS.files + 3);
    const items = new Map(); const files = new Set(['header.json', 'seal.bin']); let number = 0; let total = 0;
    for (const item of seal.items) {
      exact(item, ['path', 'bytes', 'sha256', 'chunks']); descriptor(item);
      requireThat(!items.has(item.path), 'corrupt_archive'); items.set(item.path, item);
      boundedArray(item.chunks, Math.ceil(ARCHIVE_LIMITS.file / ARCHIVE_LIMITS.chunk) + 1);
      let bytes = 0;
      for (const c of item.chunks) {
        exact(c, ['slot', 'bytes']);
        requireThat(c.slot === String(++number).padStart(8, '0') && integer(c.bytes, ARCHIVE_LIMITS.chunk) && c.bytes > 0, 'corrupt_archive');
        files.add(`${c.slot}.bin`); bytes += c.bytes;
      }
      requireThat(bytes === item.bytes, 'corrupt_archive'); total += bytes;
    }
    requireThat(total <= ARCHIVE_LIMITS.total + ARCHIVE_LIMITS.plan, 'archive_too_large');
    const entries = await readdir(archiveDir, { withFileTypes: true });
    requireThat(entries.length === files.size && entries.every((e) => e.isFile() && files.has(e.name)), 'unexpected_archive_entry');
    async function* read(d) {
      const item = items.get(d.path);
      requireThat(item && item.sha256 === d.sha256 && item.bytes === d.bytes, 'manifest_mismatch');
      for (const c of item.chunks) {
        const bytes = await collect(diskChunks(archiveDir, `${c.slot}.bin`, c.bytes + 28), c.bytes + 28);
        const plaintext = decrypt(bytes, derived, header, c.slot);
        requireThat(plaintext.length === c.bytes, 'corrupt_archive'); yield plaintext;
      }
    }
    const p = items.get('plan.json'); requireThat(p && p.sha256 === seal.plan_sha256, 'manifest_mismatch');
    const rawPlan = await collect(checked(read(p), p), ARCHIVE_LIMITS.plan);
    const plan = validatePlan(parse(rawPlan));
    const descriptors = [...plan.collections, plan.identities, plan.agencies, ...plan.files];
    requireThat(items.size === descriptors.length + 1, 'manifest_mismatch');
    const counts = await inspectInputs(plan, read);
    requireThat(JSON.stringify(counts) === JSON.stringify(seal.counts), 'manifest_mismatch');
    if (consume) {
      let active = true;
      const copy = Buffer.from(rawPlan);
      const canonical = new Map([p, ...descriptors].map(d => [d.path, { path: d.path, bytes: d.bytes, sha256: d.sha256 }]));
      const scopedRead = async function* (path) {
        requireThat(active, 'reader_closed');
        const d = canonical.get(path); requireThat(d, 'manifest_mismatch');
        for await (const chunk of checked(read(d), d)) {
          try { requireThat(active, 'reader_closed'); yield chunk; }
          finally { chunk.fill(0); }
        }
        requireThat(active, 'reader_closed');
      };
      try { return await consume({ rawPlan: copy, read: scopedRead, report: report(counts) }); }
      finally { active = false; copy.fill(0); rawPlan.fill(0); }
    }
    return report(counts);
  } finally { derived.fill(0); }
}

function readKey(env) {
  const fromEnv = env.PENNSYNC_ARCHIVE_KEY_BASE64;
  const fdText = env.PENNSYNC_ARCHIVE_KEY_FD;
  delete env.PENNSYNC_ARCHIVE_KEY_BASE64;
  requireThat((typeof fromEnv === 'string') !== (typeof fdText === 'string'), 'missing_key');
  let text = fromEnv;
  if (fdText !== undefined) {
    requireThat(/^(0|[3-9]|[1-9][0-9]{1,3})$/.test(fdText), 'invalid_key');
    const bytes = Buffer.alloc(128); let count = 0;
    try {
      while (count < bytes.length) { const n = readSync(Number(fdText), bytes, count, bytes.length - count, null); if (!n) break; count += n; }
      requireThat(count < bytes.length && bytes.subarray(0, count).every((b) => b < 128), 'invalid_key');
      text = bytes.subarray(0, count).toString('ascii').trim();
    } finally { bytes.fill(0); }
  }
  requireThat(typeof text === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(text), 'invalid_key');
  const result = Buffer.from(text, 'base64'); requireThat(result.length === 32 && result.toString('base64') === text, 'invalid_key');
  return result;
}

export async function runArchiveCli({ argv = process.argv, env = process.env, write = console.log, error = console.error } = {}) {
  let key;
  try {
    const args = argv.slice(2);
    requireThat(args.length === 1 && ['build', 'verify', 'resume'].includes(args[0]), 'usage');
    key = readKey(env);
    requireThat(typeof env.PENNSYNC_ARCHIVE_DIR === 'string' && env.PENNSYNC_ARCHIVE_DIR.length > 0, 'usage');
    const archiveDir = resolve(env.PENNSYNC_ARCHIVE_DIR);
    let result;
    if (args[0] === 'verify') result = await verifyArchive({ archiveDir, key });
    else {
      requireThat(typeof env.PENNSYNC_ARCHIVE_INPUT_DIR === 'string' && env.PENNSYNC_ARCHIVE_INPUT_DIR.length > 0, 'usage');
      result = await buildArchive({ inputDir: resolve(env.PENNSYNC_ARCHIVE_INPUT_DIR), archiveDir, key, resume: args[0] === 'resume' });
    }
    write(JSON.stringify(result)); return 0;
  } catch {
    // Raw paths, parse errors, row values and provider credentials never reach logs.
    error('Archive operation failed: inputs, key, or encrypted archive did not validate.'); return 1;
  } finally { delete env.PENNSYNC_ARCHIVE_KEY_BASE64; key?.fill(0); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await runArchiveCli();
