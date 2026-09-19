#!/usr/bin/env node
/**
 * Capability disposition coverage for the Base44 exit.
 *
 * The offline cutover evidence contract requires a disposition for every
 * capability in the census. This tool enumerates the repository's own
 * capabilities and checks that `tools-transition-disposition.json` classifies
 * each one exactly once, with no entry left over for a capability that no
 * longer exists.
 *
 * Coverage alone would let a disposition contradict the source it describes,
 * so each function's declared disposition is also checked against what its
 * module can actually do. A function that cannot perform any I/O has no live
 * behavior to move, and claiming otherwise would send reviewers to port a
 * deliberately fail-closed endpoint.
 *
 * It is deterministic and offline. It reads no secret, contacts no provider,
 * performs no hosted inventory and authorizes nothing. Coverage is not the
 * same as review: `undecided` entries are counted and reported as blocking,
 * and a manifest whose `review_state` is `proposed` never reports owner
 * review as complete.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPERATIONS } from './services/integration-runtime/contracts.mjs';

export const FORMAT = 'pennsync-transition-disposition';
export const FORMAT_VERSION = 1;
export const MANIFEST_FILE = 'tools-transition-disposition.json';
export const FAMILIES = Object.freeze(['functions', 'entities', 'workflows', 'integrations']);
export const DISPOSITIONS = Object.freeze(['port', 'broker', 'hub', 'retire', 'preserved_paused', 'undecided']);
export const REVIEW_STATES = Object.freeze(['proposed', 'accepted']);
/** Dispositions that assert the capability still has behavior worth carrying. */
export const ACTIVE_DISPOSITIONS = Object.freeze(['port', 'broker', 'hub']);
/** Only `accepted` plus zero undecided entries makes the census usable. */
export const BLOCKING = Object.freeze(['undecided']);

const SOURCE_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'];
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'coverage', '.git', 'test', 'tests', '__tests__']);
const INTEGRATION_PATTERN = /\bintegrations\s*\.\s*Core\s*\.\s*([A-Za-z][A-Za-z0-9_]{0,63})/g;

function listDirectories(path) {
  try { return readdirSync(path).filter(name => statSync(join(path, name)).isDirectory()).sort(); }
  catch { return []; }
}

function listFiles(path, match) {
  try { return readdirSync(path).filter(name => match.test(name)).sort(); }
  catch { return []; }
}

function* sourceFiles(root) {
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.isSymbolicLink()) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      yield* sourceFiles(path);
    } else if (SOURCE_EXTENSIONS.some(extension => entry.name.endsWith(extension))
      && !/\.(test|spec)\./.test(entry.name)) {
      yield path;
    }
  }
}

/**
 * Discover the Core integrations this repository actually reaches for, rather
 * than trusting a hand-kept list. A newly used integration therefore appears
 * as missing coverage instead of passing unnoticed. The external runtime's own
 * operation list is unioned in, because an adapter it already implements is a
 * capability whether or not a caller has migrated to it yet.
 */
export function discoverIntegrations(repository) {
  const found = new Set(OPERATIONS);
  for (const root of ['src', 'base44/functions']) {
    for (const file of sourceFiles(join(repository, root))) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(INTEGRATION_PATTERN)) found.add(match[1]);
    }
  }
  return [...found].sort();
}

/**
 * A function module is inert when it cannot perform any work: it imports
 * nothing, awaits nothing, reaches no network or environment, constructs no
 * Base44 client, and reads nothing from the request but its method, so every
 * caller gets the same constant response. That is the shape this repository
 * uses to keep a quarantined, paused or retired endpoint fail-closed, and it is
 * decided from the source rather than from the wording of its comment or the
 * status code it happens to serve.
 *
 * Every condition errs toward calling a module live. A synchronous endpoint
 * that answers from its query string reads the request and is not inert, and an
 * `await`, `fetch` or client mention inside a comment is enough to disqualify
 * one. A missed pause is a disposition left as its author wrote it; a live
 * handler wrongly called inert would push real behavior out of `port`.
 */
export function isInertFunction(source) {
  if (typeof source !== 'string') return false;
  if (!/\bDeno\s*\.\s*serve\b/.test(source)) return false;
  if (/^\s*import\s/m.test(source)) return false;
  if (/\bawait\b/.test(source)) return false;
  if (/\bfetch\s*\(/.test(source)) return false;
  if (/\bDeno\s*\.\s*env\b/.test(source)) return false;
  if (/createClientFromRequest|\bbase44\s*\./.test(source)) return false;
  // Reading the request at all means the response can vary with the caller.
  // Branching on the method only is still one constant answer per method.
  return [...source.matchAll(/\b_?req(?:uest)?\s*\.\s*(\w+)/g)].every(match => match[1] === 'method');
}

export function discoverInertFunctions(repository) {
  const root = join(repository, 'base44/functions');
  const inert = [];
  for (const name of listDirectories(root)) {
    let source;
    try { source = readFileSync(join(root, name, 'entry.ts'), 'utf8'); } catch { continue; }
    if (isInertFunction(source)) inert.push(name);
  }
  return inert.sort();
}

export function discoverEvidence(repository) {
  return { inertFunctions: discoverInertFunctions(repository) };
}

export function discoverCapabilities(repository) {
  return {
    functions: listDirectories(join(repository, 'base44/functions')),
    entities: listFiles(join(repository, 'base44/entities'), /\.jsonc?$/).map(name => name.replace(/\.jsonc?$/, '')),
    workflows: listFiles(join(repository, 'base44/workflows'), /\.jsonc?$/),
    integrations: discoverIntegrations(repository),
  };
}

export function parseManifest(raw) {
  let manifest;
  try { manifest = JSON.parse(raw); } catch { throw new Error('MANIFEST_INVALID_JSON'); }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('MANIFEST_INVALID_SHAPE');
  if (manifest.format !== FORMAT || manifest.version !== FORMAT_VERSION) throw new Error('MANIFEST_UNSUPPORTED_FORMAT');
  if (!REVIEW_STATES.includes(manifest.review_state)) throw new Error('MANIFEST_INVALID_REVIEW_STATE');
  const allowed = new Set([...FAMILIES, 'format', 'version', 'review_state']);
  if (Object.keys(manifest).some(key => !allowed.has(key))) throw new Error('MANIFEST_UNKNOWN_FIELD');
  for (const family of FAMILIES) {
    const entries = manifest[family];
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error('MANIFEST_INVALID_FAMILY');
    for (const value of Object.values(entries)) {
      if (!DISPOSITIONS.includes(value)) throw new Error('MANIFEST_INVALID_DISPOSITION');
    }
  }
  return manifest;
}

export function checkCoverage(capabilities, manifest, evidence = {}) {
  const inert = new Set(Array.isArray(evidence.inertFunctions) ? evidence.inertFunctions : []);
  const families = {};
  const missing = [];
  const unknown = [];
  const undecided = [];
  const contradicted = [];
  for (const family of FAMILIES) {
    const declared = manifest[family];
    const present = new Set(capabilities[family]);
    const counts = {};
    for (const name of capabilities[family]) {
      if (!Object.hasOwn(declared, name)) { missing.push(`${family}:${name}`); continue; }
      const value = declared[name];
      counts[value] = (counts[value] || 0) + 1;
      if (BLOCKING.includes(value)) undecided.push(`${family}:${name}`);
      // An endpoint that cannot run has nothing to port, broker or hand to the
      // hub; carrying it paused or retiring it are the only honest readings.
      if (family === 'functions' && inert.has(name) && ACTIVE_DISPOSITIONS.includes(value)) {
        contradicted.push(`${family}:${name} declared ${value} but its module performs no work`);
      }
    }
    for (const name of Object.keys(declared)) if (!present.has(name)) unknown.push(`${family}:${name}`);
    families[family] = { capabilities: capabilities[family].length, declared: Object.keys(declared).length, counts };
  }
  const complete = missing.length === 0 && unknown.length === 0;
  const consistent = contradicted.length === 0;
  return {
    format: FORMAT,
    schema_version: FORMAT_VERSION,
    review_state: manifest.review_state,
    families,
    missing_disposition: missing.sort(),
    unknown_capability: unknown.sort(),
    undecided: undecided.sort(),
    coverage_complete: complete,
    inert_functions: inert.size,
    contradicted_disposition: contradicted.sort(),
    evidence_consistent: consistent,
    // Every capability classified AND consistent with its source AND none left
    // undecided AND owners accepted.
    census_ready: complete && consistent && undecided.length === 0 && manifest.review_state === 'accepted',
    owner_review_complete: manifest.review_state === 'accepted',
    // This tool inventories the repository only.
    hosted_inventory_reconciled: false,
    migration_authorized: false,
  };
}

export function main(args = process.argv.slice(2), { repository = resolve(dirname(fileURLToPath(import.meta.url))), log = console.log } = {}) {
  if (args.some(argument => !['--json', '--summary'].includes(argument))) {
    log(JSON.stringify({ error: 'INVALID_ARGUMENTS' }));
    return 2;
  }
  let report;
  try {
    report = checkCoverage(
      discoverCapabilities(repository),
      parseManifest(readFileSync(join(repository, MANIFEST_FILE), 'utf8')),
      discoverEvidence(repository),
    );
  } catch (error) {
    log(JSON.stringify({ error: error?.message === 'ENOENT' ? 'MANIFEST_UNAVAILABLE' : (error?.message || 'MANIFEST_UNAVAILABLE') }));
    return 2;
  }
  if (args.includes('--summary')) {
    const totals = Object.entries(report.families)
      .map(([family, value]) => `${family}=${value.capabilities}`).join(' ');
    log(`disposition coverage ${report.coverage_complete ? 'complete' : 'INCOMPLETE'} (${totals}); `
      + `contradicted=${report.contradicted_disposition.length}; undecided=${report.undecided.length}; `
      + `review_state=${report.review_state}; census_ready=${report.census_ready}`);
    for (const entry of report.contradicted_disposition) log(`  contradicted: ${entry}`);
  } else {
    log(JSON.stringify(report, null, 2));
  }
  return report.coverage_complete && report.evidence_consistent ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}
