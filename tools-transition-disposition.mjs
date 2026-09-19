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

export function checkCoverage(capabilities, manifest) {
  const families = {};
  const missing = [];
  const unknown = [];
  const undecided = [];
  for (const family of FAMILIES) {
    const declared = manifest[family];
    const present = new Set(capabilities[family]);
    const counts = {};
    for (const name of capabilities[family]) {
      if (!Object.hasOwn(declared, name)) { missing.push(`${family}:${name}`); continue; }
      const value = declared[name];
      counts[value] = (counts[value] || 0) + 1;
      if (BLOCKING.includes(value)) undecided.push(`${family}:${name}`);
    }
    for (const name of Object.keys(declared)) if (!present.has(name)) unknown.push(`${family}:${name}`);
    families[family] = { capabilities: capabilities[family].length, declared: Object.keys(declared).length, counts };
  }
  const complete = missing.length === 0 && unknown.length === 0;
  return {
    format: FORMAT,
    schema_version: FORMAT_VERSION,
    review_state: manifest.review_state,
    families,
    missing_disposition: missing.sort(),
    unknown_capability: unknown.sort(),
    undecided: undecided.sort(),
    coverage_complete: complete,
    // Every capability classified AND none left undecided AND owners accepted.
    census_ready: complete && undecided.length === 0 && manifest.review_state === 'accepted',
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
    report = checkCoverage(discoverCapabilities(repository), parseManifest(readFileSync(join(repository, MANIFEST_FILE), 'utf8')));
  } catch (error) {
    log(JSON.stringify({ error: error?.message === 'ENOENT' ? 'MANIFEST_UNAVAILABLE' : (error?.message || 'MANIFEST_UNAVAILABLE') }));
    return 2;
  }
  if (args.includes('--summary')) {
    const totals = Object.entries(report.families)
      .map(([family, value]) => `${family}=${value.capabilities}`).join(' ');
    log(`disposition coverage ${report.coverage_complete ? 'complete' : 'INCOMPLETE'} (${totals}); `
      + `undecided=${report.undecided.length}; review_state=${report.review_state}; census_ready=${report.census_ready}`);
  } else {
    log(JSON.stringify(report, null, 2));
  }
  return report.coverage_complete ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}
