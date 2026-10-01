/**
 * What each entity call site actually PASSES, and whether its route can serve it.
 */
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { entityCalls, sourceFiles } from './tools-base44-surface.mjs';
import { codeOnly } from './tools-ported-call-sites.mjs';

/**
 * The file whose constants prove this scan is still working.
 *
 * It is NOT the population any more — every production source file is. It is
 * kept by name because it is the one module guaranteed to declare a limit, so
 * an empty read of it means the matcher or the walk has broken. Widening the
 * population without keeping a canary would have retired that refusal by
 * accident: with 33 names across a dozen modules `found.size` can no longer
 * reach zero, and a guard that cannot fire has stopped guarding.
 */
export const LIMIT_CONSTANTS_FILE = 'src/lib/queryLimits.js';

const EXPORTED_LIMIT = /^export const ([A-Z][A-Z0-9_]*)\s*=\s*(\d+)\s*;/gm;

/** `const|let|var NAME =`, with the `export` kept so a local one can be told apart. */
const PLAIN_BINDING = /(?:^|[^\w.])(export\s+)?(const|let|var)\s+([A-Z][A-Z0-9_]*)\s*=/gm;
/** `const { A, B: C } =` and `const [A] =`, whose bound name is not the key. */
const PATTERN_BINDING = /(?:^|[^\w.])(?:export\s+)?(?:const|let|var)\s*[{[]([^}\]]*)[}\]]\s*=/gm;
/** An import clause, whose bindings are the default, the namespace and the aliases. */
const IMPORT_CLAUSE = /(?:^|[^\w.])import\s+(?!type\s)([^;'"]*?)\s+from\s/gm;

/**
 * Every name a module BINDS, with the shape that bound it, so a refusal can say
 * which one fired.
 *
 * `exported` is true only for a binding that could legitimately BE the limit —
 * an `export const` this file also declares as an integer. Everything else
 * rebinds the name to something the reader cannot see, which is the defect.
 * An `export let` is therefore reported rather than exempted: `EXPORTED_LIMIT`
 * matches `const` alone, so an exported `let ALL_ROWS = 50` never enters the
 * table and a site importing it gets a number the table denies. So is an
 * `export const ALL_ROWS = compute()`, for the same reason from the other side
 * — exported, const, and not an integer, so not the limit it shadows.
 */
function* bindingsIn(text, exportedHere) {
  for (const match of text.matchAll(PLAIN_BINDING)) {
    const [, exported, keyword, name] = match;
    if (exported && keyword === 'const' && exportedHere.has(name)) continue;
    if (keyword !== 'const') yield [name, `${exported ? 'exported ' : ''}${keyword} binding`];
    else yield [name, exported ? 'exported non-integer const' : 'local const'];
  }
  for (const match of text.matchAll(PATTERN_BINDING)) {
    for (const part of match[1].split(',')) {
      // `key: bound` binds the right-hand name; `bound = fallback` binds the left.
      const name = part.split(':').pop().split('=')[0].replace(/[.\s]/g, '');
      if (/^[A-Z][A-Z0-9_]*$/.test(name)) yield [name, 'destructured binding'];
    }
  }
  for (const match of text.matchAll(IMPORT_CLAUSE)) {
    const clause = match[1];
    const named = clause.match(/\{([^}]*)\}/);
    for (const part of named ? named[1].split(',') : []) {
      // A plain `{ ALL_ROWS }` re-imports the limit itself and is not a shadow;
      // `{ X as ALL_ROWS }` binds the name to a different export and is.
      const alias = part.match(/\bas\s+([A-Za-z_$][\w$]*)/);
      if (alias && /^[A-Z][A-Z0-9_]*$/.test(alias[1])) yield [alias[1], 'aliased import'];
    }
    const outside = clause.replace(/\{[^}]*\}/, '');
    const namespace = outside.match(/\*\s*as\s+([A-Z][A-Z0-9_]*)/);
    if (namespace) yield [namespace[1], 'namespace import'];
    const fallback = outside.match(/^\s*([A-Z][A-Z0-9_]*)\s*,?/);
    if (fallback && !namespace) yield [fallback[1], 'default import'];
  }
}

const limitsIn = text => [...text.matchAll(EXPORTED_LIMIT)]
  .map(match => [match[1], Number(match[2])]);

/**
 * The integer constants a call site may name, from EVERY production module
 * that exports one.
 *
 * This used to read exactly one file, and the cost was not the one site it
 * missed but what every site's classification was DERIVED from.
 * `ADR_CASE_READ_LIMIT` is declared in `src/components/adr/adrCaseRead.js`, so
 * `ADRCenter.jsx` read INDETERMINATE — which makes the whole call unreadable
 * and the site unserved — while its contract existed, was reachable and was
 * tested. The limit was the SOURCE MODULE and never the module boundary:
 * `PATIENT_HISTORY_ROWS` has always resolved across files. A screen\'s
 * classification therefore depended on where somebody had happened to put a
 * number, and nothing reported it.
 *
 * Three properties are load-bearing rather than tidy.
 *
 * It refuses AMBIGUITY instead of picking. Two modules exporting one name with
 * DIFFERENT values means the name does not identify a number, and choosing
 * either would hand a call site a limit its own import never had. Equal values
 * are not ambiguous and pass.
 *
 * It refuses a SHADOW, which is the same problem from the other side. This
 * resolves a NAME and does not follow imports, so a module declaring its own
 * non-exported `const ALL_ROWS = 50` would be read with somebody else\'s 5000.
 * Both were measured clear on 2026-09-29 (33 names, no collision, no shadow),
 * and both are refusals here rather than sentences in this comment, because a
 * reading of a tree on a day is not a property of the tree. Checked every run
 * is the difference between an assumption and a guarantee.
 *
 * The shadow half first covered `const` ALONE, which is a quarter of the shapes
 * that bind a name. A `let`, a `var`, a destructured `const { ALL_ROWS } = …`
 * and an `import { X as ALL_ROWS }` each rebind the name identically and each
 * was read with the exported module\'s number, silently. All four were probed
 * against the 33 names and all four were absent, so it was latent rather than
 * live — and latent is the state this repository has been burned by before: the
 * paused-handler check needed three shapes before it was right, and its own
 * rule is to re-derive the shapes from the TREE rather than from the check. A
 * guard written to stop exactly this class, covering a quarter of it, is the
 * shape that comes back. `bindingsIn` covers all four, plus two the probe found
 * next door — an `export let`, which `EXPORTED_LIMIT` never admits to the
 * table, and an `export const` whose value is not an integer literal.
 *
 * What it does NOT cover is written here rather than left to be assumed, which
 * is the same rule from the other side: a binding in a nested destructuring
 * pattern, and a name bound by a function parameter or a `catch`. Both were
 * judged not worth the parser, and a reader widening this should re-derive the
 * shapes from the tree rather than from this list.
 *
 * And the canary above keeps the empty-read refusal biting after the widening
 * made `found.size` unable to reach zero.
 *
 * Every file is read through `codeOnly` first, because both scans match raw
 * text and neither regular expression knows what a binding is. Measured on
 * 2026-09-29, all three shapes fired: `// Example: const ALL_ROWS = 50;` in a
 * production module threw `ENTITY_ROUTE_LIMIT_SHADOWED`, and a line-anchored
 * `export const FAKE_LIMIT = 7;` inside a block comment or a multi-line
 * template populated the table with a name that binds nothing. The first turns
 * a comment into a build failure; the second two hand a call site a number no
 * import could ever resolve. Masking is shared with the call-site ratchet
 * rather than rewritten here, and the planted controls below keep it biting.
 */
export function limitConstants(repository) {
  if (!limitsIn(codeOnly(readFileSync(join(repository, LIMIT_CONSTANTS_FILE), 'utf8'))).length) {
    throw new Error(`ENTITY_ROUTE_LIMITS_UNREADABLE:${LIMIT_CONSTANTS_FILE}`);
  }
  const files = [...sourceFiles(join(repository, 'src'))]
    .map(file => [relative(repository, file), codeOnly(readFileSync(file, 'utf8'))]);

  const found = new Map();
  const declaredIn = new Map();
  for (const [where, text] of files) {
    for (const [name, value] of limitsIn(text)) {
      if (found.has(name) && found.get(name) !== value) {
        throw new Error(`ENTITY_ROUTE_LIMIT_AMBIGUOUS:${name}:${declaredIn.get(name)}:${where}`);
      }
      found.set(name, value);
      if (!declaredIn.has(name)) declaredIn.set(name, where);
    }
  }
  for (const [where, text] of files) {
    const exportedHere = new Set(limitsIn(text).map(([name]) => name));
    for (const [name, shape] of bindingsIn(text, exportedHere)) {
      if (found.has(name)) {
        throw new Error(`ENTITY_ROUTE_LIMIT_SHADOWED:${name}:${where}:${shape}`);
      }
    }
  }
  return found;
}

/**
 * The text between the parentheses of a call whose `(` is at or after `from`.
 *
 * Scanned rather than matched: an argument list holds strings, template
 * literals, comments, objects and nested calls, and a regular expression that
 * stopped at the first `)` would cut `filter({ a: f(1) })` in half and read the
 * remainder as a different argument. Returns null when the call is not
 * balanced inside the file, which counts as indeterminate rather than empty.
 */
export function argumentText(text, from) {
  let index = from;
  while (index < text.length && /\s/.test(text[index])) index += 1;
  if (text[index] !== '(') return null;
  let depth = 0;
  let quote = null;
  for (let at = index; at < text.length; at += 1) {
    const character = text[at];
    if (quote) {
      if (character === '\\') { at += 1; continue; }
      if (character === quote) quote = null;
      continue;
    }
    if (character === '/' && text[at + 1] === '/') { at = text.indexOf('\n', at); if (at < 0) return null; continue; }
    if (character === '/' && text[at + 1] === '*') { at = text.indexOf('*/', at); if (at < 0) return null; at += 1; continue; }
    if (character === "'" || character === '"' || character === '`') { quote = character; continue; }
    if ('([{'.includes(character)) { depth += 1; continue; }
    if (')]}'.includes(character)) {
      depth -= 1;
      if (depth === 0) return text.slice(index + 1, at);
    }
  }
  return null;
}

/** Top-level commas only: `filter({a: 1, b: 2}, '-x')` is two arguments. */
export function splitArguments(text) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let at = 0; at < text.length; at += 1) {
    const character = text[at];
    if (quote) {
      if (character === '\\') { at += 1; continue; }
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') { quote = character; continue; }
    if ('([{'.includes(character)) { depth += 1; continue; }
    if (')]}'.includes(character)) { depth -= 1; continue; }
    if (character === ',' && depth === 0) { parts.push(text.slice(start, at)); start = at + 1; }
  }
  const tail = text.slice(start);
  if (parts.length || tail.trim()) parts.push(tail);
  return parts.map(part => part.trim()).filter((part, index, all) => !(index === all.length - 1 && part === ''));
}

const INDETERMINATE = Object.freeze({ known: false });
const known = value => Object.freeze({ known: true, value });

/**
 * A value the screen computes at run time, standing in for itself.
 *
 * Most filters name a runtime variable — `{ patient_id: patientId }` — and
 * refusing to read those would make two thirds of the frontend unmeasurable.
 * What a route decides is the SHAPE: which fields a predicate names, which
 * operator it uses, what order was asked for and how many rows. None of those
 * is the value, and all of them are written down at the call site.
 *
 * So an unknown expression INSIDE an object or an array becomes this, while an
 * unknown expression that is itself a whole argument stays indeterminate — a
 * sort or a limit passed as a variable really is unmeasurable here. It is a
 * string no column holds, so a route that did compare a value would refuse
 * rather than match, which is the fail-closed direction.
 */
export const UNKNOWN_VALUE = '\u0000pennsync-unknown';

/**
 * One argument expression as a value, or "not known".
 *
 * A literal evaluator rather than an execution: a gate that ran source out of
 * `src/` to find out what it passes would be running the thing it is checking.
 * It understands exactly the shapes these call sites use — literals, the named
 * row limits, arrays and plain objects of the same — and anything else is
 * INDETERMINATE, which counts as not served. Fail closed: an argument this
 * cannot read might be the one the route would refuse.
 */
export function evaluateArgument(text, constants, nested = false) {
  const source = text.trim();
  if (!source) return INDETERMINATE;
  if (source === 'undefined') return known(undefined);
  if (source === 'null') return known(null);
  if (source === 'true') return known(true);
  if (source === 'false') return known(false);
  if (/^-?\d+(\.\d+)?$/.test(source)) return known(Number(source));
  if (/^'[^'\\]*'$/.test(source) || /^"[^"\\]*"$/.test(source)) return known(source.slice(1, -1));
  if (constants.has(source)) return known(constants.get(source));
  if (source.startsWith('[') && source.endsWith(']')) {
    const items = splitArguments(source.slice(1, -1)).map(item => evaluateArgument(item, constants, true));
    return items.every(item => item.known) ? known(items.map(item => item.value)) : INDETERMINATE;
  }
  if (source.startsWith('{') && source.endsWith('}')) {
    const object = {};
    for (const entry of splitArguments(source.slice(1, -1))) {
      const split = entry.indexOf(':');
      if (split < 0) return INDETERMINATE;
      const rawKey = entry.slice(0, split).trim();
      const key = /^'[^'\\]*'$/.test(rawKey) || /^"[^"\\]*"$/.test(rawKey) ? rawKey.slice(1, -1) : rawKey;
      if (!/^[$A-Za-z_][$A-Za-z0-9_]*$/.test(key)) return INDETERMINATE;
      const value = evaluateArgument(entry.slice(split + 1), constants, true);
      if (!value.known) return INDETERMINATE;
      object[key] = value.value;
    }
    return known(object);
  }
  return nested ? known(UNKNOWN_VALUE) : INDETERMINATE;
}

/**
 * The argument positions that hold a ROW IDENTIFIER, by operation.
 *
 * An opaque id is the one top-level argument whose VALUE decides nothing a
 * route can be wrong about. The rule above — an unknown inside an object
 * stands in for itself, an unknown as a whole argument does not — is right
 * because the top-level arguments of a read are a sort and a limit, and those
 * ARE shape. `Entity.update(recordId, fields)` is the other case entirely: the
 * route reads `fields`, and `recordId` is a value the store resolves. Treating
 * it as unreadable made the whole site unreadable and hid the payload beside
 * it, which is a measurement problem dressed as caution.
 *
 * Narrow on purpose, by operation AND position. A placeholder id put through a
 * route that checks an id's shape is REFUSED rather than served, which is the
 * fail-closed direction, and no read's sort or limit is in this table.
 */
export const IDENTIFIER_POSITIONS = Object.freeze({
  get: Object.freeze([0]),
  update: Object.freeze([0]),
  delete: Object.freeze([0]),
});

/** Whether this argument is an id whose value the route cannot depend on. */
export function isIdentifierPosition(operation, index) {
  return (IDENTIFIER_POSITIONS[operation] ?? []).includes(index);
}

/**
 * Every entity call site with the arguments it passes.
 *
 * Re-scanned here with the ratchet's own walker and matcher rather than taken
 * from `measureDestinations`, which reports no position. `measureRoutes`
 * cross-checks the two totals, so a drift between them is a refusal rather
 * than a quietly different population.
 */
export function callArguments(repository) {
  const constants = limitConstants(repository);
  const sites = [];
  for (const file of sourceFiles(join(repository, 'src'))) {
    const text = readFileSync(file, 'utf8');
    for (const site of entityCalls(text)) {
      const after = site.end;
      const tail = text.slice(after).match(/^\s*([a-zA-Z][A-Za-z0-9_]*)/);
      const operation = tail ? tail[1] : '';
      const raw = tail ? argumentText(text, after + tail[0].length) : null;
      const parts = raw === null ? null : splitArguments(raw);
      const values = parts === null ? null : parts.map((part, index) => {
        const value = evaluateArgument(part, constants);
        return value.known || !isIdentifierPosition(operation, index) ? value : known(UNKNOWN_VALUE);
      });
      sites.push(Object.freeze({
        file: relative(repository, file),
        entity: site.entity,
        operation,
        arguments: values === null || values.some(value => !value.known)
          ? null : Object.freeze(values.map(value => value.value)),
      }));
    }
  }
  return sites;
}
