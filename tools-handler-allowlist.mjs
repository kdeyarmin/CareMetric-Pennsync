/**
 * What a screen SENDS a ported capability, against what its handler ADMITS.
 *
 * A capability's arguments are read three times before anything runs, and each
 * reader has its own list:
 *
 * 1. the screen's call site, which writes the keys;
 * 2. `handlers.mjs`, which refuses a key outside its `exactObject` allowlist
 *    with `INVALID_PARAMS`;
 * 3. `record-contracts.mjs`, which refuses one outside the contract's `params`
 *    with `CONTRACT_ARGUMENTS_INVALID`.
 *
 * `record-contracts.test.mjs` crosses 2 against 3. `independentEntityRoutes`'
 * own suite crosses a ROUTE's emitted arguments against 2. This module is the
 * third pair: what a screen writes, against 2.
 *
 * **It would not have caught the policy-acknowledgement defect, and that is
 * worth saying here rather than discovering later.** That screen sent exactly
 * the three keys its handler admits, so 1 and 2 agreed and the disagreement was
 * between 2 and 3. D180: where three layers must agree, a check across two of
 * them is green by construction on that pair and silent on the third. Three
 * pairwise checks are not one check of the triple, and none of them subsumes
 * another.
 *
 * ## Why the population is small on purpose
 *
 * Only a PASS-THROUGH wrapper is comparable at all. Most of `src/functions/`
 * shapes the payload on its way past — translating camelCase to snake_case,
 * packing a flat body into one key, supplying a tenant through `portedCall` —
 * and for those the caller's keys and the handler's allowlist are simply not
 * the same vocabulary. Comparing them reports the translation itself as a
 * finding, about a hundred times, and a check whose first run is a hundred
 * false positives gets its threshold tuned rather than its question fixed.
 *
 * Only a SINGLE UNCONDITIONAL allowlist is comparable either. A handler that
 * dispatches on `params.action` has one allowlist per action, and which one a
 * call site must satisfy depends on the action it sends — a question this
 * module deliberately does not try to answer, because guessing it wrong
 * silently compares against the wrong list.
 *
 * So the comparable population is small, it is asserted as a SET rather than
 * against a floor, and both narrowings are reported rather than left implicit.
 *
 * ## Reading keys is not reading values
 *
 * The splitting is `tools-entity-call-arguments.mjs`'s — one authority for
 * "where does this argument end", which already knows that an argument list
 * holds strings, template literals, comments and nested calls. What is added
 * here is the KEY grammar, which that module's `evaluateArgument` does not
 * need: it refuses a property with no `:` because it cannot evaluate a
 * shorthand's VALUE, while a shorthand's KEY is written down in plain sight.
 *
 * Every one of the four rules below was a LIVE defect in a draft of this file,
 * found on this tree rather than reasoned about, and only one of the four was
 * loud:
 *
 * - A naive key regex read `Event Type:` and `Submitted By:` out of the TEXT of
 *   a template literal in `src/pages/EventReport.jsx` and reported four
 *   rejected keys at a call site that is correct. The invented-finding
 *   direction, and the only one that announces itself.
 * - A key regex requiring `:` read `importProvidersCsv({ csv_text })` as a call
 *   with NO keys and passed it. A shorthand key outside the allowlist would
 *   never have been seen.
 * - An import matcher accepting single quotes only found TWO call sites where
 *   there are eighteen, and reported clean. A check that reaches a ninth of its
 *   population and a check that reaches all of it are the same green.
 * - Splitting the argument text without removing comments first made
 *   `src/pages/IncidentReportingModule.jsx` unreadable, because two of its
 *   thirteen keys carry an explanation beside them. Safe, and still wrong about
 *   the population.
 *
 * Three of the four were silent, which is the argument for asserting the
 * population as a SET rather than against a floor. A floor near eighteen would
 * have caught the third and passed the other two -- and the set is load-bearing
 * rather than tidy, which was PROVED rather than argued: narrow the import
 * matcher back to one quote style and `no screen sends a ported capability a
 * key its handler refuses` stays GREEN, with only the population assertions
 * firing. The check that looks like the point of this file cannot tell a clean
 * tree from a blind reader. The set can.
 *
 * ## An unreadable site is named, never counted clean
 *
 * Three call sites build their payload as a variable and hand the whole object
 * over, so nothing static can say what they send. They are listed by name. A
 * site moving from compared to unreadable is a COMPARISON GOING QUIET, and a
 * population that shrinks without its list reads as the thing getting smaller
 * rather than as the instrument getting blinder -- which is the same mistake as
 * the three silent defects above, arriving from the direction of the data
 * instead of the direction of the parser.
 *
 * ## Where the figures come from
 *
 * The seventeen wrappers and eighteen readable sites were measured twice, by
 * two threads, through DIFFERENT derivations -- #335 measured them from its own
 * side of the sweep and this module was written without reading its code. Two
 * routes to one pair is a second artefact and is worth recording as such; two
 * runs of one function over one tree would be repetition with two authors, and
 * corroborates nothing.
 *
 * Anything this cannot read statically — a spread, a computed key, a payload
 * that is a variable rather than a literal — is UNREADABLE and is reported as
 * its own bucket. It is never counted as a clean comparison, because a site
 * this cannot read might be the one the handler would refuse.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { argumentText, splitArguments } from './tools-entity-call-arguments.mjs';

export const API_DIRECTORY = 'services/pennsync-api';
export const REGISTRY_FILE = 'handlers.mjs';
export const WRAPPER_DIRECTORY = 'src/functions';
export const SOURCE_DIRECTORY = 'src';

/** A property name, or null when the entry's key is not statically readable. */
export function propertyKey(entry) {
  const text = entry.trim();
  if (!text) return null;
  if (text.startsWith('...') || text.startsWith('[')) return null;
  const quoted = /^(['"])([^'"\\]*)\1\s*:/.exec(text);
  if (quoted) return quoted[2];
  const named = /^([$A-Za-z_][$\w]*)\s*:/.exec(text);
  if (named) return named[1];
  // Shorthand: the whole entry is the identifier, and the key is its name.
  const shorthand = /^([$A-Za-z_][$\w]*)$/.exec(text);
  return shorthand ? shorthand[1] : null;
}

/**
 * The top-level keys of an object-literal payload, or null when any one of them
 * cannot be read. Null is a refusal, not an empty object: a payload that is
 * partly unreadable is unreadable, since the unreadable part is exactly where a
 * rejected key would hide.
 */
/**
 * Comment spans removed, quote-aware.
 *
 * `argumentText` skips comments while it scans for the closing paren and then
 * returns the raw slice, comments and all. Splitting that slice puts a `//` at
 * the head of an entry and a comma inside a comment in the middle of one, so a
 * payload carrying an inline note reads as UNREADABLE. That fails in the safe
 * direction and still understates the population, which is why it is fixed
 * here rather than tolerated: `src/pages/IncidentReportingModule.jsx` explains
 * two of its thirteen keys in a comment beside them and was the one real call
 * site this check could not see.
 */
export function withoutComments(text) {
  let out = '';
  let quote = null;
  for (let at = 0; at < text.length; at += 1) {
    const character = text[at];
    if (quote) {
      out += character;
      if (character === '\\') { out += text[at + 1] ?? ''; at += 1; continue; }
      if (character === quote) quote = null;
      continue;
    }
    if (character === '/' && text[at + 1] === '/') {
      const end = text.indexOf('\n', at);
      if (end < 0) return out;
      out += '\n'; at = end;
      continue;
    }
    if (character === '/' && text[at + 1] === '*') {
      const end = text.indexOf('*/', at + 2);
      if (end < 0) return out;
      out += ' '; at = end + 1;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') quote = character;
    out += character;
  }
  return out;
}

export function payloadKeys(text) {
  const source = withoutComments(text).trim();
  if (!source.startsWith('{') || !source.endsWith('}')) return null;
  const keys = [];
  for (const entry of splitArguments(source.slice(1, -1))) {
    const key = propertyKey(entry);
    if (key === null) return null;
    keys.push(key);
  }
  return keys;
}

const stripBlockComments = source => source.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Each handler's single unconditional `exactObject` allowlist.
 *
 * Handlers with more than one are reported under `dispatched` rather than
 * dropped, so a capability leaving the comparable population is visible instead
 * of simply going quiet.
 */
export function handlerAllowlists(repository) {
  const directory = resolve(repository, API_DIRECTORY);
  const admits = new Map();
  const dispatched = new Set();
  let entries = 0;
  for (const file of readdirSync(directory).sort()) {
    if (!file.endsWith('.mjs') || file.endsWith('.test.mjs')) continue;
    const source = readFileSync(join(directory, file), 'utf8');
    const found = [...source.matchAll(/^ {2}([A-Za-z_][\w]*): Object\.freeze\(\{/gm)]
      .map(match => ({ name: match[1], at: match.index }));
    // Counted from the REGISTRY's own file. A first version summed the pattern
    // over every module in the directory and reached 313, because a two-space
    // frozen object is an ordinary shape and other modules are full of them.
    // The sentinel below then held at 187 with `handlers.mjs` contributing
    // nothing at all, so the one thing it exists to notice -- the registry
    // ceasing to parse -- could not move it. Found by crossing these figures
    // against a second thread's derivation rather than by reading the code.
    if (file === REGISTRY_FILE) entries = found.length;
    for (const [index, entry] of found.entries()) {
      const body = stripBlockComments(
        source.slice(entry.at, found[index + 1]?.at ?? source.length));
      const lists = [...body.matchAll(/exactObject\(\s*params\s*,\s*\[([^\]]*)\]/g)];
      if (lists.length === 0) continue;
      if (lists.length > 1) { dispatched.add(entry.name); continue; }
      admits.set(entry.name, Object.freeze(lists[0][1]
        .split(',').map(key => key.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)));
    }
  }
  return { admits, dispatched, entries };
}

/**
 * The wrappers that forward their whole payload untouched.
 *
 * Measured by SHAPE and not by a list: the module's only statement is an arrow
 * that hands `base44.functions.invoke` the very parameter it was given. A
 * wrapper that renames a key, supplies a default or reads anything is not one,
 * and falls out here rather than being compared against a vocabulary it does
 * not speak.
 */
export function passThroughWrappers(repository) {
  const directory = resolve(repository, WRAPPER_DIRECTORY);
  const wrappers = new Map();
  for (const file of readdirSync(directory).sort()) {
    if (!file.endsWith('.js') || file.endsWith('.spec.js')) continue;
    const source = stripBlockComments(readFileSync(join(directory, file), 'utf8'))
      .replace(/^\s*\/\/.*$/gm, '');
    const match = /export const ([$A-Za-z_][$\w]*)\s*=\s*\(\s*([$A-Za-z_][$\w]*)(?:\s*=\s*\{\s*\})?\s*\)\s*=>\s*base44\.functions\.invoke\(\s*'([\w]+)'\s*,\s*([$A-Za-z_][$\w]*)\s*\)\s*;?/
      .exec(source);
    if (!match) continue;
    const [statement, exported, parameter, handler, forwarded] = match;
    if (parameter !== forwarded) continue;
    const rest = source.replace(statement, '').replace(/^\s*import[^;]+;\s*$/gm, '').trim();
    if (rest) continue;
    wrappers.set(exported, { handler, file: `${WRAPPER_DIRECTORY}/${file}` });
  }
  return wrappers;
}

const sourceFiles = (repository) => {
  const root = resolve(repository, SOURCE_DIRECTORY);
  const wrappers = resolve(repository, WRAPPER_DIRECTORY);
  const found = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory).sort()) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) { if (path !== wrappers) walk(path); continue; }
      if (!/\.(js|jsx)$/.test(path) || /\.(spec|test)\.jsx?$/.test(path)) continue;
      found.push(path);
    }
  };
  walk(root);
  return found;
};

/** The local names a file binds to each wrapper, honouring `as` aliases. */
export function importedWrappers(source, wrappers) {
  const bound = new Map();
  // Both quote styles. A first draft matched single quotes only and found two
  // call sites where there are eighteen -- green, and blind to all but two of
  // the population it claims to measure. The declared set below is what turns
  // that into a failure rather than a quiet pass.
  for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@\/functions\/[\w-]+['"]/g)) {
    for (const clause of match[1].split(',')) {
      const parts = clause.trim().split(/\s+as\s+/);
      const exported = parts[0]?.trim();
      const local = (parts[1] ?? parts[0])?.trim();
      if (exported && local && wrappers.has(exported)) bound.set(local, exported);
    }
  }
  return bound;
}

/**
 * Every call to a pass-through wrapper whose handler has one allowlist.
 *
 * A site whose payload cannot be read statically carries `keys: null` and is
 * counted separately. A call with no arguments at all carries `keys: []`, which
 * is a real comparison — `exactObject` refuses a non-object, so an argumentless
 * call is a defect this cannot see and the HANDLER answers.
 */
export function wrapperCallSites(repository, wrappers = passThroughWrappers(repository),
  admits = handlerAllowlists(repository).admits) {
  const sites = [];
  for (const path of sourceFiles(repository)) {
    const source = readFileSync(path, 'utf8');
    const bound = importedWrappers(source, wrappers);
    if (bound.size === 0) continue;
    const file = relative(repository, path);
    for (const [local, exported] of bound) {
      const { handler } = wrappers.get(exported);
      if (!admits.has(handler)) continue;
      const pattern = new RegExp(`(^|[^$\\w.])${local}\\s*\\(`, 'g');
      let match;
      while ((match = pattern.exec(source))) {
        const open = match.index + match[0].length - 1;
        const text = argumentText(source, open);
        if (text === null) { sites.push({ file, wrapper: exported, handler, keys: null }); continue; }
        const args = splitArguments(text);
        const keys = args.length === 0 ? [] : payloadKeys(args[0]);
        sites.push({ file, wrapper: exported, handler, keys });
      }
    }
  }
  return sites.sort((left, right) => `${left.file}${left.wrapper}`
    .localeCompare(`${right.file}${right.wrapper}`));
}

/** The whole reading: population, comparisons, and what could not be read. */
export function measureWrapperCalls(repository) {
  const { admits, dispatched, entries } = handlerAllowlists(repository);
  const wrappers = passThroughWrappers(repository);
  const comparable = [...wrappers]
    .filter(([, value]) => admits.has(value.handler))
    .map(([name, value]) => `${name} -> ${value.handler}`)
    .sort();
  const sites = wrapperCallSites(repository, wrappers, admits);
  const rejected = [];
  for (const site of sites) {
    if (site.keys === null) continue;
    for (const key of site.keys) {
      if (!admits.get(site.handler).includes(key)) {
        rejected.push(`${site.file}: ${site.wrapper} sends ${key}, which ${site.handler} refuses`);
      }
    }
  }
  return {
    handlers: entries,
    comparable,
    dispatched: [...wrappers].filter(([, value]) => dispatched.has(value.handler))
      .map(([name]) => name).sort(),
    compared: sites.filter(site => site.keys !== null)
      .map(site => `${site.file}: ${site.wrapper}`).sort(),
    unreadable: sites.filter(site => site.keys === null)
      .map(site => `${site.file}: ${site.wrapper}`).sort(),
    rejected: rejected.sort(),
  };
}

export function summaryLines(report) {
  return [
    `handler allowlist: ${report.comparable.length} pass-through wrappers, `
    + `${report.compared.length} readable call sites, ${report.unreadable.length} unreadable, `
    + `${report.rejected.length} refused`,
  ];
}

function main(repository = process.cwd()) {
  const report = measureWrapperCalls(repository);
  for (const line of summaryLines(report)) console.log(line);
  for (const line of report.rejected) console.log(`  REFUSED ${line}`);
  for (const line of report.unreadable) console.log(`  unreadable ${line}`);
  return report.rejected.length === 0 ? 0 : 1;
}

// Through `pathToFileURL`: a hand-built `file://` string never matches a
// Windows or percent-encoded path, so the module would silently do nothing
// when run directly. `tools-cli-entrypoint.test.mjs` is the gate.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}

export { main };
