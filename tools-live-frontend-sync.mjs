// Exact, read-only comparison of a local build with the published frontend.
// Usage: node tools-live-frontend-sync.mjs [allowed-origin] [--dist dist] [--json]
// Default: check BOTH production addresses. Exit 0 = exact static publication,
// 1 = observed drift, 2 = unavailable/invalid verification. This never proves
// authenticated workflows, tenant isolation, data migration, or release gates.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRODUCTION_ORIGINS = Object.freeze([
  'https://app.caremetricai.com',
  'https://caremetricai.base44.app',
]);
const ALLOWED_ORIGINS = new Set([
  ...PRODUCTION_ORIGINS,
  'https://caremetric-pennsync-staging-2026-09-d54f1ef7.base44.app',
]);
const MAX_FILES = 2000;
const MAX_ASSET_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export class VerificationError extends Error {
  constructor(code) { super(code); this.name = 'VerificationError'; this.code = code; }
}

export function validateOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new VerificationError('INVALID_ORIGIN'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || url.pathname !== '/' || !ALLOWED_ORIGINS.has(url.origin)) {
    throw new VerificationError('INVALID_ORIGIN');
  }
  return url.origin;
}

function localAssetPath(value, origin) {
  let url;
  try { url = new URL(value, origin + '/'); } catch { throw new VerificationError('INVALID_ASSET_REFERENCE'); }
  if (url.origin !== origin || url.search || url.hash || /[%\\]/.test(url.pathname)
    || !/^\/(?:assets|icons)\/[A-Za-z0-9_./-]+$/.test(url.pathname)) {
    throw new VerificationError('INVALID_ASSET_REFERENCE');
  }
  return url.pathname;
}

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/\b([\w-]+)\s*=\s*(["'])(.*?)\2/g)) {
    const key = match[1].toLowerCase();
    if (key in result) throw new VerificationError('DUPLICATE_HTML_ATTRIBUTE');
    result[key] = match[3];
  }
  return result;
}

export function htmlReferences(html, origin) {
  // Generated Vite tags use quoted attributes. Comments must never count as
  // installed scripts. Foreign injected assets are not used as release proof.
  const clean = html.replace(/<!--[\s\S]*?-->/g, '');
  if (/<base\b/i.test(clean)) throw new VerificationError('UNEXPECTED_BASE_ELEMENT');
  const entries = [];
  const roots = [];
  for (const match of clean.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
    const attr = attributes(match[0]);
    const script = /^<script\b/i.test(match[0]);
    const value = script ? attr.src : attr.href;
    if (!value) continue;
    const isEntry = script && /(?:^|\/)assets\/index-[A-Za-z0-9_-]+\.js$/.test(value);
    const isRoot = isEntry || (!script && ['modulepreload', 'stylesheet'].includes(attr.rel));
    if (!isRoot) continue;
    const path = localAssetPath(value, origin);
    roots.push(path);
    if (isEntry) {
      if (attr.type !== 'module') throw new VerificationError('INVALID_MODULE_ENTRY');
      entries.push(path);
    }
  }
  if (entries.length !== 1) throw new VerificationError('MISSING_OR_AMBIGUOUS_ENTRY');
  return { entry: entries[0], roots: [...new Set(roots)].sort() };
}

export function createBuildInventory(dist = 'dist') {
  const root = resolve(dist);
  if (lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) {
    throw new VerificationError('INVALID_BUILD_DIRECTORY');
  }
  const resolvedRoot = realpathSync(root);
  const assets = [];
  let totalBytes = 0;
  const walk = (directory) => {
    for (const item of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const filename = join(directory, item.name);
      const stat = lstatSync(filename);
      if (stat.isSymbolicLink() || !realpathSync(filename).startsWith(resolvedRoot + sep)) {
        throw new VerificationError('UNSAFE_BUILD_FILE');
      }
      if (item.name.startsWith('.')) throw new VerificationError('HIDDEN_BUILD_FILE');
      if (stat.isDirectory()) { walk(filename); continue; }
      if (!stat.isFile() || stat.size > MAX_ASSET_BYTES) throw new VerificationError('INVALID_BUILD_FILE');
      const path = '/' + relative(root, filename).split(sep).join('/');
      if (!/^\/[A-Za-z0-9_./-]+$/.test(path)) throw new VerificationError('INVALID_BUILD_FILENAME');
      if (path === '/index.html') continue;
      const bytes = readFileSync(filename);
      totalBytes += bytes.length;
      if (assets.length >= MAX_FILES || totalBytes > MAX_TOTAL_BYTES) throw new VerificationError('BUILD_LIMIT_EXCEEDED');
      assets.push({ path, bytes: bytes.length, sha256: sha256(bytes) });
    }
  };
  walk(root);
  const indexPath = join(root, 'index.html');
  if (lstatSync(indexPath).size > MAX_HTML_BYTES) throw new VerificationError('HTML_LIMIT_EXCEEDED');
  const html = readFileSync(indexPath, 'utf8');
  const references = htmlReferences(html, PRODUCTION_ORIGINS[0]);
  const paths = new Set(assets.map((a) => a.path));
  if (!references.roots.every((path) => paths.has(path))) throw new VerificationError('INCOMPLETE_LOCAL_BUILD');
  const entry = assets.find((a) => a.path === references.entry);
  return Object.freeze({ ...references, entry_sha256: entry.sha256, assets, total_bytes: totalBytes });
}

async function fetchBytes(url, limit, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET', redirect: 'error', credentials: 'omit',
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      signal: AbortSignal.timeout(15_000),
    });
  } catch { throw new VerificationError('TRANSPORT_UNAVAILABLE'); }
  if (!response.ok || response.redirected) {
    await response.body?.cancel();
    throw new VerificationError(response.status === 404 ? 'ASSET_MISSING' : 'HTTP_UNAVAILABLE');
  }
  const announced = Number(response.headers.get('content-length'));
  if (Number.isFinite(announced) && announced > limit) {
    await response.body?.cancel();
    throw new VerificationError('RESPONSE_LIMIT_EXCEEDED');
  }
  if (!response.body) throw new VerificationError('EMPTY_RESPONSE');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new VerificationError('RESPONSE_LIMIT_EXCEEDED'); }
      chunks.push(Buffer.from(part.value));
    }
  } catch (error) {
    if (error instanceof VerificationError) throw error;
    throw new VerificationError('TRANSPORT_UNAVAILABLE');
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

export async function verifyOrigin(origin, inventory, { fetchImpl = fetch, concurrency = 4 } = {}) {
  origin = validateOrigin(origin);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 6) {
    throw new VerificationError('INVALID_CONCURRENCY');
  }
  const report = {
    origin, status: 'unverified', publication_verified: false,
    expected_entry: inventory.entry, expected_entry_sha256: inventory.entry_sha256,
    expected_assets: inventory.assets.length, matched_assets: 0, failures: [],
  };
  try {
    const initial = htmlReferences((await fetchBytes(origin + '/', MAX_HTML_BYTES, fetchImpl)).toString('utf8'), origin);
    report.live_entry = initial.entry;
    if (JSON.stringify(initial) !== JSON.stringify({ entry: inventory.entry, roots: inventory.roots })) {
      report.status = 'drift'; report.failures.push({ code: 'HTML_RELEASE_MISMATCH' }); return report;
    }
    let next = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (!report.failures.length && next < inventory.assets.length) {
        const asset = inventory.assets[next++];
        try {
          const bytes = await fetchBytes(origin + asset.path, MAX_ASSET_BYTES, fetchImpl);
          if (bytes.length !== asset.bytes || sha256(bytes) !== asset.sha256) {
            report.failures.push({ path: asset.path, code: 'ASSET_HASH_MISMATCH' });
          } else { report.matched_assets++; }
        } catch (error) {
          report.failures.push({ path: asset.path, code: error.code || 'VERIFICATION_UNAVAILABLE' });
        }
      }
    }));
    if (report.failures.length) {
      report.status = report.failures.some((f) => !['ASSET_MISSING', 'ASSET_HASH_MISMATCH'].includes(f.code))
        ? 'unverified' : 'drift';
      return report;
    }
    // Catch the index changing partway through publication; old HTML plus new
    // lazy chunks is not an atomically observed, complete release.
    const final = htmlReferences((await fetchBytes(origin + '/', MAX_HTML_BYTES, fetchImpl)).toString('utf8'), origin);
    if (JSON.stringify(initial) !== JSON.stringify(final)) {
      report.status = 'drift'; report.failures.push({ code: 'RELEASE_CHANGED_DURING_CHECK' }); return report;
    }
    report.publication_verified = report.matched_assets === report.expected_assets;
    report.status = report.publication_verified ? 'published_exact_build' : 'unverified';
    return report;
  } catch (error) {
    report.failures.push({ code: error.code || 'VERIFICATION_UNAVAILABLE' });
    return report;
  }
}

export async function main(args = process.argv.slice(2), { fetchImpl = fetch, log = console.log } = {}) {
  let dist = 'dist';
  const origins = [];
  try {
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--json') continue;
      if (args[i] === '--dist') {
        if (!args[i + 1] || args[i + 1].startsWith('--')) throw new VerificationError('INVALID_ARGUMENTS');
        dist = args[++i]; continue;
      }
      if (args[i].startsWith('-') || origins.length) throw new VerificationError('INVALID_ARGUMENTS');
      origins.push(validateOrigin(args[i]));
    }
    const inventory = createBuildInventory(dist);
    const reports = [];
    for (const origin of (origins.length ? origins : PRODUCTION_ORIGINS)) {
      reports.push(await verifyOrigin(origin, inventory, { fetchImpl }));
    }
    const verified = reports.every((r) => r.publication_verified);
    log(JSON.stringify({ checked_at: new Date().toISOString(), scope: 'static_frontend_publication_only',
      publication_verified: verified, authenticated_workflows_verified: false,
      full_release_complete: false, reports }, null, 2));
    return verified ? 0 : reports.some((r) => r.status === 'unverified') ? 2 : 1;
  } catch (error) {
    log(JSON.stringify({ scope: 'static_frontend_publication_only', publication_verified: false,
      full_release_complete: false, error: error.code || 'LOCAL_BUILD_UNAVAILABLE' }, null, 2));
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
