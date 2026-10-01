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
 * The same baseline carries an allowance for the one signal that is not a
 * count: a file may take an entity HANDLE without an immediately visible call
 * only while that file and entity are listed, so this tree's existing handles
 * are recorded in a reviewed diff and a NEW one fails. An allowance is the
 * record of an undercount, not permission for it, which is why an entry that
 * matches nothing fails too: it has outlived the defect it describes.
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
/**
 * Three ways a module binds the namespace before calling through it, each
 * requiring its binding IN THE SAME FILE so the extra names are bounded by
 * something readable rather than by a guess.
 *
 * `ENTITY_CALL` alone matches a literal `base44.entities.Name.`, and
 * `src/lib/retiredOfflineQueue.js` binds the four entities into an object
 * literal and then calls through the identifier that carries it, so eight real
 * call sites were invisible to this ratchet AND to the destination census at
 * once — the two tools share the matcher, which is what made one fix move both.
 * The backend classifier in `tools-transition-disposition.mjs` has read
 * aliasing since it was written, so the two halves of one question disagreed
 * and the later half was right; this is the earlier half catching up.
 *
 * A repo-wide scan bounded it before it was fixed: one module of the map shape,
 * not a class of them. The bound is the useful part — a finding that names its
 * population is actionable and one that does not is only alarming.
 */
const NAMESPACE_ALIAS = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*base44\s*\.\s*entities\s*[;\n]/g;
const NAMESPACE_DESTRUCTURE = /\{([^{}]*)\}\s*=\s*base44\s*\.\s*entities\b/g;
const ENTITY_MAP_BINDING = /\b([A-Z][A-Za-z0-9_]*)\s*:\s*base44\s*\.\s*entities\s*\.\s*\1\b/g;

/**
 * Every entity call site in one file, as `{ entity, end }` where `end` is the
 * offset of the operation identifier — the shape all three consumers already
 * read out of `ENTITY_CALL`, so they keep one definition and one total.
 *
 * Sites are yielded in source order and deduplicated by offset, because a
 * literal call and an aliased one can name the same characters: counting it
 * twice would inflate the ratchet and the census together and look like
 * agreement.
 */
export function* entityCalls(text) {
  const found = new Map();
  for (const match of text.matchAll(ENTITY_CALL)) {
    found.set(match.index + match[0].length, match[1]);
  }
  // The two forms are NOT one pass: a map is reached through the identifier
  // carrying it (`q.Incident.filter`) and a destructured binding is the
  // identifier (`Task.create`). Writing them as one cost a test that drove both
  // and got nothing for the second, which is why each is driven with the
  // binding present AND absent rather than once.
  const carried = new Set();
  for (const match of text.matchAll(ENTITY_MAP_BINDING)) carried.add(match[1]);
  for (const name of carried) {
    // The lookbehind is NOT what stops a literal call being counted twice --
    // `found` is keyed on the operation's OFFSET, so the literal pass and this
    // one write the same entry. What it does is refuse a deeper chain
    // (`a.b.Incident.filter`), which the binding says nothing about. A
    // sabotage removing it left every test green, and the comment that used to
    // sit here claimed the dedup: it was describing the Map's work.
    for (const use of text.matchAll(new RegExp(`(?<![.?\\w$])[A-Za-z_$][\\w$]*\\s*\\.\\s*${name}\\s*\\.\\s*`, 'g'))) {
      found.set(use.index + use[0].length, name);
    }
  }
  const bound = new Set();
  for (const match of text.matchAll(NAMESPACE_DESTRUCTURE)) {
    for (const part of match[1].split(',')) {
      const name = part.split(':').pop().trim();
      if (/^[A-Z][A-Za-z0-9_]*$/.test(name)) bound.add(name);
    }
  }
  for (const name of bound) {
    for (const use of text.matchAll(new RegExp(`(?<![.?\\w$])${name}\\s*\\.\\s*`, 'g'))) {
      found.set(use.index + use[0].length, name);
    }
  }
  for (const match of text.matchAll(NAMESPACE_ALIAS)) {
    const alias = match[1].replace(/[$]/g, '\\$&');
    for (const use of text.matchAll(new RegExp(`\\b${alias}\\s*\\.\\s*([A-Z][A-Za-z0-9_]*)\\s*\\.\\s*`, 'g'))) {
      found.set(use.index + use[0].length, use[1]);
    }
  }
  for (const end of [...found.keys()].sort((a, b) => a - b)) {
    yield { entity: found.get(end), end };
  }
}
/**
 * Comment bodies, blanked rather than removed so every line number downstream
 * still points at the line it came from. Blanking is the whole reason this is
 * not the repo's usual two-replace strip: a strip that deletes the text moves
 * every line after it, and the refusal below reports file and LINE.
 *
 * Its limit, stated because a reader will assume more: only a `//` comment that
 * STARTS its line is blanked, so a trailing one after code survives. That is
 * safe for this matcher in one direction only — a trailing comment mentioning
 * `base44.entities.Name` would be reported as a taken handle. It is driven by a
 * test rather than left to the reader.
 */
const withoutComments = text => text
  .replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/gu, ' '))
  .replace(/^[ \t]*\/\/.*$/gmu, comment => comment.replace(/[^\n]/gu, ' '));

/**
 * Where a file takes an entity HANDLE instead of calling through it: the same
 * characters `ENTITY_CALL` matches, with the following `.` captured rather than
 * required, so one regex decides both halves and they cannot drift apart.
 */
export const ENTITY_HANDLE = /\bbase44\s*\.\s*entities\s*\.\s*([A-Z][A-Za-z0-9_]*)(?![\w$])[ \t\r\n]*(\.)?/g;

/**
 * Every `{ entity, line }` where this file takes a handle and does not
 * immediately call a method on it. Comments are blanked first, because a
 * sentence ABOUT the SDK is not a call site and `src/lib/independentStagingAdapter.js`
 * contains one.
 */
export function takenHandles(text) {
  const code = withoutComments(text);
  const taken = [];
  for (const match of code.matchAll(ENTITY_HANDLE)) {
    if (match[2] === '.') continue;
    taken.push({ entity: match[1], line: code.slice(0, match.index).split('\n').length });
  }
  return taken;
}

/**
 * Taking a handle is allowed only while the tool can still SEE calls arriving
 * through it. So a taken handle is accounted for when `entityCalls` resolves at
 * least one NON-LITERAL site for that entity in that file, and refused
 * otherwise — which fails closed on every way of reaching the handle rather
 * than chasing aliases through the code.
 *
 * Why the non-literal part carries the weight. `CourseLessonBuilder.jsx` reads
 * through a literal `base44.entities.TrainingModule.filter` on one line and
 * hands the HANDLE to a shared hook on the next; the hook creates, updates and
 * deletes through it. "This entity appears somewhere in this file" would call
 * that accounted and miss three writes, which is the case this refusal exists
 * for. An accounted handle must have its ALIASED path resolve, not merely share
 * an entity name with a visible call.
 */
export function unaccountedHandles(repository) {
  const unaccounted = [];
  for (const file of sourceFiles(join(repository, 'src'))) {
    const text = readFileSync(file, 'utf8');
    const taken = takenHandles(text);
    if (taken.length === 0) continue;
    const literals = new Set();
    for (const match of text.matchAll(ENTITY_CALL)) literals.add(match.index + match[0].length);
    const resolved = new Set();
    for (const site of entityCalls(text)) if (!literals.has(site.end)) resolved.add(site.entity);
    for (const hit of taken) {
      if (!resolved.has(hit.entity)) {
        unaccounted.push({ file: relative(repository, file), line: hit.line, entity: hit.entity });
      }
    }
  }
  return unaccounted;
}

/**
 * How the committed allowance names a handle this tree already takes: by FILE
 * and ENTITY, never by line. A line number is invalidated by any edit above it,
 * so a line-keyed allowance would turn an unrelated insertion into a refusal
 * and teach a reader to re-run `--update` to clear it. File and entity are also
 * what a reviewer can check against the source without counting lines.
 */
export const handleKey = handle => `${handle.file}::${handle.entity}`;

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
    for (const site of entityCalls(text)) {
      counts.entity_call_sites += 1;
      entityTypes.add(site.entity);
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
  const allowed = baseline.allowed_handles ?? [];
  if (!Array.isArray(allowed) || new Set(allowed).size !== allowed.length
    || allowed.some(key => typeof key !== 'string' || !key.includes('::'))) {
    throw new Error('BASELINE_INVALID_ALLOWANCE');
  }
  return { ...baseline, allowed_handles: allowed };
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
    const allowed_handles = unaccountedHandles(repository).map(handleKey).sort();
    write(baselinePath, JSON.stringify({ format: FORMAT, version: FORMAT_VERSION, maximum: measured.counts, allowed_handles }, null, 2) + '\n');
    log(JSON.stringify({ updated: relative(repository, baselinePath), maximum: measured.counts, allowed_handles }, null, 2));
    return 0;
  }
  let baseline;
  try { baseline = parseBaseline(readFileSync(baselinePath, 'utf8')); }
  catch (error) { log(JSON.stringify({ error: error?.message || 'BASELINE_UNAVAILABLE' })); return 2; }
  const report = compareSurface(measured, baseline);
  // Reported and failed SEPARATELY from the ratchet, because it is a different
  // kind of answer: the baseline says whether the coupling grew, and this says
  // whether the baseline could see it. A handle the tool cannot follow makes
  // every metric above an UNDERCOUNT, so it must not be expressible as one.
  const unaccounted = unaccountedHandles(repository);
  const allowance = new Set(baseline.allowed_handles);
  report.unaccounted_handles = unaccounted;
  report.refused_handles = unaccounted.filter(handle => !allowance.has(handleKey(handle)));
  // A stale entry FAILS rather than passing with a note. It means somebody has
  // repaired one of the recorded handles, and the gate is the only thing that
  // will tell them the record of it must go: a passing report says it on a line
  // nobody reads, and the allowance then outlives the defect it describes.
  report.stale_allowance = [...allowance]
    .filter(key => !unaccounted.some(handle => handleKey(handle) === key)).sort();
  if (args.includes('--summary')) {
    log(`base44 surface ${report.within_baseline ? 'within baseline' : 'REGRESSED'}: `
      + METRICS.map(metric => `${metric}=${report.counts[metric]}/${baseline.maximum[metric]}`).join(' '));
    for (const handle of report.unaccounted_handles) {
      const refused = report.refused_handles.includes(handle);
      log(`  ${refused ? 'REFUSED' : 'allowed'} HANDLE ${handle.file}:${handle.line} takes ${handle.entity}`
        + ' and no call through it is visible');
    }
    for (const key of report.stale_allowance) {
      log(`  STALE ALLOWANCE ${key} takes no unaccounted handle any more. Delete the entry.`);
    }
  } else {
    log(JSON.stringify(report, null, 2));
  }
  return report.within_baseline && report.refused_handles.length === 0
    && report.stale_allowance.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}
