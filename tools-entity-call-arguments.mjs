/**
 * What each entity call site actually PASSES, and whether its route can serve it.
 */
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { ENTITY_CALL, sourceFiles } from './tools-base44-surface.mjs';

/** Named row limits the screens pass instead of a literal. */
export const LIMIT_CONSTANTS_FILE = 'src/lib/queryLimits.js';

/**
 * The constants a call site names, read from the module that declares them.
 *
 * Refuses an empty read rather than returning one: with no constants every
 * call site naming `ALL_ROWS` would be indeterminate, and the measurement
 * would understate for a reason nothing reports.
 */
export function limitConstants(repository) {
  const source = readFileSync(join(repository, LIMIT_CONSTANTS_FILE), 'utf8');
  const found = new Map();
  for (const match of source.matchAll(/^export const ([A-Z][A-Z0-9_]*)\s*=\s*(\d+)\s*;/gm)) {
    found.set(match[1], Number(match[2]));
  }
  if (!found.size) throw new Error(`ENTITY_ROUTE_LIMITS_UNREADABLE:${LIMIT_CONSTANTS_FILE}`);
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
    for (const match of text.matchAll(ENTITY_CALL)) {
      const after = match.index + match[0].length;
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
        entity: match[1],
        operation,
        arguments: values === null || values.some(value => !value.known)
          ? null : Object.freeze(values.map(value => value.value)),
      }));
    }
  }
  return sites;
}
