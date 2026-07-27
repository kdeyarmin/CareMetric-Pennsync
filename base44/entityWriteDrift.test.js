// Automatic entity WRITE-drift guardrail.
//
// schemaContract.test.js already checks that the fields listed in its curated
// FIELD_USAGE map exist in the schema. That list is hand-maintained, so it only
// covers fields somebody remembered to add — which is why two real drifts sat
// undetected: Task.related_entity/related_entity_id (a referral-follow-up task
// created with no pointer back to its referral) and
// DocumentSignature.signature_fields (every field box the requester positioned,
// discarded on send).
//
// This scans EVERY `entities.<Name>.create({...})` / `.update(id, {...})` /
// `.bulkCreate([{...}])` in production source and asserts each top-level key
// exists in that entity's schema. Base44 silently drops unknown fields, so this
// class of bug is invisible at runtime — the write "succeeds" and the data is
// simply never there.
//
// Only literal payloads are checked: a payload built by a helper
// (`create(toNoteConversionFields({...}))`) or spread from a variable can't be
// resolved statically, and is skipped rather than guessed at.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import JSON5 from 'json5';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const ENTITIES = join(HERE, 'entities');

/**
 * Fields the Base44 PLATFORM maintains on every record. They are real and
 * writable but deliberately absent from the schema files, which describe only
 * each entity's custom properties.
 */
const PLATFORM_FIELDS = new Set([
  'id', 'created_date', 'updated_date', 'created_by', 'created_by_id',
  'updated_by', 'is_sample', '_id',
]);

/** Built-in fields of the platform-managed User entity. */
const PLATFORM_USER_FIELDS = new Set(['full_name', 'email', 'disabled']);

const schemas = new Map();
for (const file of readdirSync(ENTITIES)) {
  if (!['.json', '.jsonc'].includes(extname(file))) continue;
  const raw = readFileSync(join(ENTITIES, file), 'utf8');
  try {
    const parsed = JSON5.parse(raw);
    schemas.set(parsed.name || file.replace(/\.jsonc?$/, ''), parsed);
  } catch {
    // schemaContract.test.js owns reporting unparseable schemas.
  }
}

/** Every property name a schema defines, at any nesting depth. */
function definedFields(schema) {
  const out = new Set();
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node.properties || {})) {
      out.add(key);
      if (value?.properties) walk(value);
      if (value?.items?.properties) walk(value.items);
    }
  })(schema);
  return out;
}

function collectSources(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (['node_modules', '.git', 'dist'].includes(entry)) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...collectSources(p));
    else if (/\.(js|jsx|ts)$/.test(entry) && !/\.(test|spec)\./.test(entry)) out.push(p);
  }
  return out;
}

/** Index of the character closing the bracket opened just before `start`. */
function matchBracket(src, start) {
  let i = start;
  let depth = 1;
  let quote = null;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (quote) {
      if (c === quote && src[i - 1] !== '\\') quote = null;
    } else if (c === '"' || c === "'" || c === '`') {
      quote = c;
    } else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    i++;
  }
  return i - 1;
}

/** Top-level `key:` names of an object literal whose body spans [start, end). */
function objectKeys(body) {
  const keys = [];
  let depth = 0;
  let quote = null;
  let segStart = 0;
  const pushSegment = (seg) => {
    const m = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/|\s)*([A-Za-z_$][\w$]*)\s*:/.exec(seg);
    if (m) keys.push(m[1]);
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      if (c === quote && body[i - 1] !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if ('([{'.includes(c)) { depth++; continue; }
    if (')]}'.includes(c)) { depth--; continue; }
    if (c === ',' && depth === 0) {
      pushSegment(body.slice(segStart, i));
      segStart = i + 1;
    }
  }
  pushSegment(body.slice(segStart));
  return keys;
}

function findWriteDrift() {
  const drift = [];
  const sources = [...collectSources(join(REPO, 'src')), ...collectSources(join(REPO, 'base44/functions'))];

  for (const file of sources) {
    const src = readFileSync(file, 'utf8');
    const rel = file.slice(REPO.length + 1);
    const re = /entities\.([A-Za-z0-9_]+)\s*\.\s*(create|update|bulkCreate)\s*\(/g;
    let m;
    while ((m = re.exec(src))) {
      const [, entity, method] = m;
      const schema = schemas.get(entity);
      if (!schema) continue; // entityReferenceContract.test.js owns unknown entities

      const argsEnd = matchBracket(src, re.lastIndex);
      let rest = src.slice(re.lastIndex, argsEnd);

      if (method === 'update') {
        // Skip the id argument; the payload is the second one.
        const comma = (() => {
          let depth = 0, quote = null;
          for (let i = 0; i < rest.length; i++) {
            const c = rest[i];
            if (quote) { if (c === quote && rest[i - 1] !== '\\') quote = null; continue; }
            if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
            if ('([{'.includes(c)) depth++;
            else if (')]}'.includes(c)) depth--;
            else if (c === ',' && depth === 0) return i;
          }
          return -1;
        })();
        if (comma < 0) continue;
        rest = rest.slice(comma + 1);
      }
      if (method === 'bulkCreate') {
        const bracket = rest.indexOf('[');
        if (bracket < 0) continue;
        rest = rest.slice(bracket + 1);
      }

      // Only a payload that IS an object literal can be checked. Anything else
      // (a helper call, an identifier) is built elsewhere — skip it.
      const trimmed = rest.replace(/^\s*/, '');
      if (!trimmed.startsWith('{')) continue;

      const offset = rest.length - trimmed.length;
      const bodyStart = re.lastIndex + (method === 'update' || method === 'bulkCreate'
        ? src.slice(re.lastIndex, argsEnd).length - rest.length
        : 0) + offset + 1;
      const bodyEnd = matchBracket(src, bodyStart);
      const keys = objectKeys(src.slice(bodyStart, bodyEnd));

      const defined = definedFields(schema);
      for (const key of keys) {
        if (PLATFORM_FIELDS.has(key)) continue;
        if (entity === 'User' && PLATFORM_USER_FIELDS.has(key)) continue;
        if (defined.has(key)) continue;
        const line = src.slice(0, m.index).split('\n').length;
        drift.push(`${rel}:${line} — ${entity}.${key} is written but the schema has no such property`);
      }
    }
  }
  return [...new Set(drift)].sort();
}

test('every literal entity write targets a field the schema defines', () => {
  const drift = findWriteDrift();
  assert.deepEqual(
    drift,
    [],
    'Base44 silently DROPS unknown fields, so these writes never persist.\n' +
      'Add the property to base44/entities/<Entity>.jsonc, or fix the field name:\n  ' +
      drift.join('\n  '),
  );
});

test('the scanner actually resolves literal payloads (guards against a no-op test)', () => {
  // If a refactor broke payload parsing, findWriteDrift() would return [] for
  // the wrong reason and this guardrail would silently stop guarding. Assert the
  // parser still sees a known-good literal write and its real field names.
  const sample = "await base44.entities.Task.create({ title: 'x', bogus_field_xyz: 1 });";
  const keys = objectKeys(sample.slice(sample.indexOf('{') + 1, sample.lastIndexOf('}')));
  assert.deepEqual(keys, ['title', 'bogus_field_xyz']);
  assert.ok(definedFields(schemas.get('Task')).has('title'));
  assert.ok(!definedFields(schemas.get('Task')).has('bogus_field_xyz'));
});
