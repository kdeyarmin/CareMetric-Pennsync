#!/usr/bin/env node
/**
 * Base44 coupling ratchet for the application frontend.
 *
 * The exit replaces Base44 one consumer at a time, so the useful guard is not
 * "is it gone" but "did it grow". This tool counts the remaining coupling in
 * production source and compares it with a committed baseline. A count above
 * its baseline fails; a count below it passes and is reported so the gain can
 * be locked in by lowering the baseline.
 *
 * It is deterministic and offline: no network, no credential, no hosted
 * inventory. Test and spec files are excluded because they deliberately model
 * the very surface being retired.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORMAT = 'pennsync-base44-surface';
export const FORMAT_VERSION = 1;
export const BASELINE_FILE = 'tools-base44-surface-expectations.json';
export const METRICS = Object.freeze([
  'client_importers', 'entity_call_sites', 'entity_types',
  'function_invocations', 'function_wrappers', 'core_integration_sites', 'sdk_importers',
]);

const SOURCE_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'];
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'coverage', '.git', '__tests__']);
const IS_TEST = /\.(test|spec)\.[cm]?[jt]sx?$/;
const CLIENT_IMPORT = /api\/base44Client/;
const SDK_IMPORT = /@base44\/sdk/;
// Exported for the reason `sourceFiles` is: one matcher, so one count.
export const ENTITY_CALL = /\bbase44\s*\.\s*entities\s*\.\s*([A-Z][A-Za-z0-9_]*)\s*\./g;
const FUNCTION_INVOKE = /\bfunctions\s*\.\s*invoke\s*\(/g;
const CORE_INTEGRATION = /\bintegrations\s*\.\s*Core\s*\.\s*[A-Za-z][A-Za-z0-9_]*/g;

/**
 * The production source files this ratchet measures, shared rather than
 * re-derived. `tools-frontend-destination.mjs` crosses the SAME call sites
 * against their dispositions, and two walkers that agreed by coincidence would
 * let one tool's total drift from the other's silently.
 */
export function* sourceFiles(root) {
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.isSymbolicLink()) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      yield* sourceFiles(path);
    } else if (SOURCE_EXTENSIONS.some(extension => entry.name.endsWith(extension)) && !IS_TEST.test(entry.name)) {
      yield path;
    }
  }
}

const countMatches = (text, pattern) => (text.match(pattern) || []).length;

export function measureSurface(repository) {
  const source = join(repository, 'src');
  const counts = Object.fromEntries(METRICS.map(metric => [metric, 0]));
  const entityTypes = new Set();
  for (const file of sourceFiles(source)) {
    const text = readFileSync(file, 'utf8');
    if (CLIENT_IMPORT.test(text)) counts.client_importers += 1;
    if (SDK_IMPORT.test(text)) counts.sdk_importers += 1;
    counts.function_invocations += countMatches(text, FUNCTION_INVOKE);
    counts.core_integration_sites += countMatches(text, CORE_INTEGRATION);
    for (const match of text.matchAll(ENTITY_CALL)) {
      counts.entity_call_sites += 1;
      entityTypes.add(match[1]);
    }
  }
  counts.entity_types = entityTypes.size;
  try {
    counts.function_wrappers = readdirSync(join(source, 'functions'))
      .filter(name => SOURCE_EXTENSIONS.some(extension => name.endsWith(extension)) && !IS_TEST.test(name)).length;
  } catch { counts.function_wrappers = 0; }
  return { counts, entity_types: [...entityTypes].sort() };
}

export function parseBaseline(raw) {
  let baseline;
  try { baseline = JSON.parse(raw); } catch { throw new Error('BASELINE_INVALID_JSON'); }
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) throw new Error('BASELINE_INVALID_SHAPE');
  if (baseline.format !== FORMAT || baseline.version !== FORMAT_VERSION) throw new Error('BASELINE_UNSUPPORTED_FORMAT');
  const maximum = baseline.maximum;
  if (!maximum || typeof maximum !== 'object' || Array.isArray(maximum)) throw new Error('BASELINE_INVALID_MAXIMUM');
  if (Object.keys(maximum).length !== METRICS.length || METRICS.some(metric => !Number.isSafeInteger(maximum[metric]) || maximum[metric] < 0)) {
    throw new Error('BASELINE_INVALID_MAXIMUM');
  }
  return baseline;
}

export function compareSurface(measured, baseline) {
  const regressions = [];
  const improvements = [];
  for (const metric of METRICS) {
    const actual = measured.counts[metric];
    const allowed = baseline.maximum[metric];
    if (actual > allowed) regressions.push({ metric, actual, allowed });
    else if (actual < allowed) improvements.push({ metric, actual, allowed });
  }
  return {
    format: FORMAT,
    schema_version: FORMAT_VERSION,
    counts: measured.counts,
    regressions,
    improvements,
    within_baseline: regressions.length === 0,
    // True only when the frontend reaches Base44 nowhere at all.
    base44_free: METRICS.every(metric => measured.counts[metric] === 0),
  };
}

export function main(args = process.argv.slice(2), { repository = resolve(dirname(fileURLToPath(import.meta.url))), log = console.log, write = writeFileSync } = {}) {
  if (args.some(argument => !['--json', '--summary', '--update'].includes(argument))) {
    log(JSON.stringify({ error: 'INVALID_ARGUMENTS' }));
    return 2;
  }
  const baselinePath = join(repository, BASELINE_FILE);
  const measured = measureSurface(repository);
  if (args.includes('--update')) {
    // Deliberately explicit: lowering the baseline locks in real progress and
    // must appear in a reviewed diff. It can also silence a regression, so it
    // is never run automatically.
    write(baselinePath, JSON.stringify({ format: FORMAT, version: FORMAT_VERSION, maximum: measured.counts }, null, 2) + '\n');
    log(JSON.stringify({ updated: relative(repository, baselinePath), maximum: measured.counts }, null, 2));
    return 0;
  }
  let baseline;
  try { baseline = parseBaseline(readFileSync(baselinePath, 'utf8')); }
  catch (error) { log(JSON.stringify({ error: error?.message || 'BASELINE_UNAVAILABLE' })); return 2; }
  const report = compareSurface(measured, baseline);
  if (args.includes('--summary')) {
    log(`base44 surface ${report.within_baseline ? 'within baseline' : 'REGRESSED'}: `
      + METRICS.map(metric => `${metric}=${report.counts[metric]}/${baseline.maximum[metric]}`).join(' '));
  } else {
    log(JSON.stringify(report, null, 2));
  }
  return report.within_baseline ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}
