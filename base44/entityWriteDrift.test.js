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

/**
 * The entity's ROOT property names — the only keys a top-level write may use.
 *
 * Deliberately NOT flattened across nesting depth. Collecting nested names into
 * one set makes the guard accept a bogus root key that happens to match a nested
 * one: DocumentSignature defines `required`, `position` and `size` only inside
 * `signature_fields` items, so a flattened set would wave through
 * `DocumentSignature.create({ position: … })` even though Base44 discards it. A
 * guard that passes on a real drift is worse than no guard — it manufactures
 * confidence. The scanner only extracts top-level payload keys, so root
 * properties are exactly the right comparison set.
 */
function definedFields(schema) {
  return new Set(Object.keys(schema?.properties || {}));
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

/**
 * Index just past a comment starting at `i`, or `i` itself if none starts there.
 *
 * Both scanners below MUST skip comments while tracking quotes. An apostrophe in
 * an ordinary contraction ("the schema's enum", "doesn't persist") would
 * otherwise open a phantom string literal and desynchronise the rest of the
 * parse — silently dropping every field after it, so the guard passes because it
 * stopped looking rather than because the code is clean.
 */
function skipComment(src, i) {
  if (src[i] === '/' && src[i + 1] === '/') {
    const nl = src.indexOf('\n', i);
    return nl === -1 ? src.length : nl;
  }
  if (src[i] === '/' && src[i + 1] === '*') {
    const end = src.indexOf('*/', i + 2);
    return end === -1 ? src.length : end + 2;
  }
  return i;
}

/** Index of the character closing the bracket opened just before `start`. */
function matchBracket(src, start) {
  let i = start;
  let depth = 1;
  let quote = null;
  while (i < src.length && depth > 0) {
    if (!quote) {
      const skipped = skipComment(src, i);
      if (skipped !== i) { i = skipped; continue; }
    }
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
  return objectEntries(body).map((e) => e.key);
}

/**
 * Top-level `key: value` pairs of an object literal body.
 *
 * `literal` carries the value ONLY when it is a plain quoted string; anything
 * computed (a variable, a ternary, a template with interpolation) is left null
 * because it can't be resolved statically. That is what keeps the enum check
 * below free of false positives.
 */
function objectEntries(body) {
  const entries = [];
  let depth = 0;
  let quote = null;
  let segStart = 0;
  const pushSegment = (seg) => {
    const m = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/|\s)*([A-Za-z_$][\w$]*)\s*:([\s\S]*)$/.exec(seg);
    if (!m) return;
    const rawValue = m[2].trim();
    const asString = /^'([^'\\]*)'$|^"([^"\\]*)"$|^`([^`\\${]*)`$/.exec(rawValue);
    entries.push({
      key: m[1],
      literal: asString ? (asString[1] ?? asString[2] ?? asString[3]) : null,
    });
  };
  for (let i = 0; i < body.length; i++) {
    if (!quote) {
      // See skipComment: an apostrophe in a comment must not open a string.
      const skipped = skipComment(body, i);
      if (skipped !== i) { i = skipped - 1; continue; }
    }
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
  return entries;
}

function findWriteDrift() {
  const drift = [];
  const sources = [...collectSources(join(REPO, 'src')), ...collectSources(join(REPO, 'base44/functions'))];

  for (const file of sources) {
    const src = readFileSync(file, 'utf8');
    const rel = file.slice(REPO.length + 1);
    // `auth.updateMe({...})` writes the User entity just as surely as
    // `entities.User.update(...)`, but it was outside this scan — which is how
    // `saved_signature` (absent from User.jsonc) was written and silently
    // dropped while the UI reported "Signature saved to your profile". Its
    // payload is the FIRST argument, so it is shaped like `create`.
    const re = /(?:entities\.([A-Za-z0-9_]+)\s*\.\s*(create|update|bulkCreate)|auth\s*\.\s*updateMe)\s*\(/g;
    let m;
    while ((m = re.exec(src))) {
      const entity = m[1] || 'User';
      const method = m[2] || 'create';
      const schema = schemas.get(entity);
      if (!schema) continue; // entityReferenceContract.test.js owns unknown entities

      const argsEnd = matchBracket(src, re.lastIndex);
      let rest = src.slice(re.lastIndex, argsEnd);

      if (method === 'update') {
        // Skip the id argument; the payload is the second one.
        // skipComment here too: `update(/* the caller's row */ id, {...})` would
        // otherwise open a phantom string on the apostrophe, never find the
        // comma, and skip the payload — reintroducing the exact false negative
        // this file exists to prevent, in the update form specifically.
        const comma = (() => {
          let depth = 0, quote = null;
          for (let i = 0; i < rest.length; i++) {
            if (!quote) {
              const skipped = skipComment(rest, i);
              if (skipped !== i) { i = skipped - 1; continue; }
            }
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
      const entries = objectEntries(src.slice(bodyStart, bodyEnd));

      const defined = definedFields(schema);
      for (const { key, literal } of entries) {
        if (PLATFORM_FIELDS.has(key)) continue;
        if (entity === 'User' && PLATFORM_USER_FIELDS.has(key)) continue;
        const line = src.slice(0, m.index).split('\n').length;

        if (!defined.has(key)) {
          drift.push(`${rel}:${line} — ${entity}.${key} is written but the schema has no such property`);
          continue;
        }

        // The field exists — now check the VALUE against its enum. A field name
        // can be perfectly valid while the value written to it is not a member
        // of the allowed set, which Base44 rejects or drops just as silently.
        const allowed = schema.properties?.[key]?.enum;
        if (Array.isArray(allowed) && literal !== null && !allowed.includes(literal)) {
          drift.push(
            `${rel}:${line} — ${entity}.${key} is written as ${JSON5.stringify(literal)}, ` +
              `which is not in its schema enum [${allowed.map((v) => JSON5.stringify(v)).join(', ')}]`,
          );
        }
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

test('an apostrophe inside a comment does not blind the scanner', () => {
  // Regression guard. The scanners track quote state; before skipComment(), a
  // contraction in a comment ("the schema's enum") opened a phantom string
  // literal and every field AFTER it silently vanished from the scan — so the
  // guard reported "no drift" because it had stopped looking. This was a live
  // hole: it was triggered by an ordinary explanatory comment.
  const body = [
    "title: 'x',",
    "// 'followup' is the schema's enum value and it doesn't persist otherwise",
    "type: 'followup',",
    'status: \'pending\'',
  ].join('\n');

  const keys = objectEntries(body).map((e) => e.key);
  assert.deepEqual(keys, ['title', 'type', 'status'], 'fields after the comment are still seen');
  assert.equal(objectEntries(body).find((e) => e.key === 'type').literal, 'followup');
});

test('the enum check resolves string literals and ignores computed values', () => {
  // The value half of this guard is only as good as its literal extraction. If
  // that broke, every enum write would look "not a literal" and be skipped —
  // the guard would pass for the wrong reason, exactly the failure mode the
  // field-name half already guards against.
  const entries = objectEntries(
    "title: 'x', type: 'followup', priority: computed, status: `pending`, note: `hi ${name}`",
  );
  const byKey = Object.fromEntries(entries.map((e) => [e.key, e.literal]));

  assert.equal(byKey.type, 'followup', 'single-quoted literal is resolved');
  assert.equal(byKey.status, 'pending', 'plain template literal is resolved');
  assert.equal(byKey.priority, null, 'a variable is NOT treated as a literal');
  assert.equal(byKey.note, null, 'an interpolated template is NOT treated as a literal');

  // And the schema side still exposes the enum this check reads.
  assert.ok(Array.isArray(schemas.get('Task')?.properties?.type?.enum));
  assert.ok(schemas.get('Task').properties.type.enum.includes('followup'));
  assert.ok(!schemas.get('Task').properties.type.enum.includes('referral_follow_up'));
});

test('a nested property name is NOT accepted as a top-level write key', () => {
  // Regression guard for an over-permissive field set. DocumentSignature defines
  // `position`, `size` and `required` only inside signature_fields[] items; a
  // set flattened across nesting depth would accept them at the record root and
  // wave through a write Base44 actually discards.
  const docSig = schemas.get('DocumentSignature');
  assert.ok(docSig, 'DocumentSignature schema is present');

  const root = definedFields(docSig);
  assert.ok(root.has('signature_fields'), 'the array field itself is a root property');
  for (const nestedOnly of ['position', 'size', 'required']) {
    assert.ok(
      !root.has(nestedOnly),
      `'${nestedOnly}' is nested inside signature_fields[] and must not count as a root field`,
    );
  }
});
