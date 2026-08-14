import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

/**
 * Contract: one React Query key = one query.
 *
 * React Query dedupes by key, so two `useQuery` call sites that share a key
 * also share a single cache entry — whichever one runs first decides what BOTH
 * of them render, for the whole `staleTime` window. When their `queryFn`s
 * disagree, that is a live data bug, not a style problem. Real instances this
 * guard was written for:
 *
 *   - `['patients','updated',2000]` was read by both agency-scoped and
 *     unscoped patient rosters, so a compliance view could render another
 *     tenant's charts depending on which tab the user opened first.
 *   - `['myVisits']` was used both for `Visit.filter({ created_by: me })` and
 *     for an agency-wide `Visit.list()`, so "patients I have charted on" could
 *     silently mean everyone's charts.
 *   - `['announcements']` served both the admin's full list and the staff
 *     widget's `is_active: true` list, showing retired announcements to staff.
 *   - `['clinical-templates']` served both a paged fetch-everything helper and
 *     a capped `list(sort, 200)`, which broke the phrase seeder's
 *     "create only what's missing" check into creating duplicates.
 *
 * HOW: each `queryFn` is reduced to a SIGNATURE describing the data it
 * produces — entity + method + sort + row limit + filter fields, backend
 * function names, and whether an agency-scoping helper is applied. Two sites
 * may share a key only when their signatures match, so harmless spelling
 * differences (`await` vs `.then`, `filter({}, …)` vs `list(…)`) stay legal
 * while a different result set fails the build.
 */

const ROOT = join(process.cwd(), 'src');

function collectSources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) collectSources(p, out);
    else if (/\.(js|jsx)$/.test(entry) && !/\.(test|spec)\.(js|jsx)$/.test(entry)) out.push(p);
  }
  return out;
}

/** Text of the balanced `{ … }` object literal that starts at `open`. */
function readBalanced(text, open, chars = '{}') {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === chars[0]) depth += 1;
    else if (text[i] === chars[1]) {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return text.slice(open);
}

/** Value of a top-level `name:` property inside an options object literal. */
function optionValue(body, name) {
  const at = new RegExp(`(^|[{,\\s])${name}\\s*:`).exec(body);
  if (!at) return null;
  let i = at.index + at[0].length;
  let depth = 0;
  for (; i < body.length; i += 1) {
    const c = body[i];
    if ('([{'.includes(c)) depth += 1;
    else if (')]}'.includes(c)) {
      if (depth === 0) break;
      depth -= 1;
    } else if (c === ',' && depth === 0) break;
  }
  return body.slice(at.index + at[0].length, i).trim();
}

const normalize = (s) => s.replace(/\s+/g, ' ').trim();

/** Control flow and plumbing — present in a queryFn but not part of its result set. */
const IGNORED_CALLS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'await', 'async',
  'then', 'catch_', 'map', 'filter', 'find', 'sort', 'slice', 'reduce', 'flat',
  'flatMap', 'some', 'every', 'includes', 'join', 'concat', 'push', 'trim',
  'resolve', 'reject', 'all', 'allSettled', 'json', 'parse', 'stringify',
]);

/**
 * Reduce a queryFn body to the shape of the data it returns. Anything that
 * changes the rows (entity, method, sort, limit, filter fields, backend
 * function, agency scoping) contributes; syntax does not.
 */
function signature(fn) {
  const parts = new Set();
  const src = normalize(fn);

  for (const m of src.matchAll(/entities\.([A-Z]\w*)\.(list|filter)\(/g)) {
    const args = readBalanced(src, src.indexOf('(', m.index + m[0].length - 1), '()');
    const inner = args.slice(1, -1);
    let method = m[2];
    let rest = inner;
    if (method === 'filter') {
      const objAt = inner.indexOf('{');
      if (objAt !== -1) {
        const obj = readBalanced(inner, objAt);
        const fields = [...obj.matchAll(/([A-Za-z_$][\w$]*)\s*:/g)].map((f) => f[1]).sort();
        // `filter({}, sort, limit)` returns the same rows as `list(sort, limit)`.
        if (fields.length === 0) method = 'list';
        else parts.add(`where:${fields.join('+')}`);
        rest = inner.slice(objAt + obj.length);
      }
    }
    const sort = /['"](-?\w+)['"]/.exec(rest);
    const limit = /(\b\d{2,}\b|ALL_ROWS|[A-Z][A-Z_]*ROWS)/.exec(rest);
    parts.add(`${m[1]}.${method}`);
    if (sort) parts.add(`sort:${sort[1]}`);
    if (limit) parts.add(`limit:${limit[1]}`);
  }

  for (const m of src.matchAll(/functions\.(?:invoke|fetch)\(\s*['"](\w+)['"]/g)) parts.add(`fn:${m[1]}`);
  for (const m of src.matchAll(/\bauth\.(me)\(/g)) parts.add(`auth:${m[1]}`);
  for (const m of src.matchAll(/\b(filterPatientsByCallerAgency|filterUsersByCallerAgency)\b/g)) parts.add(`scope:${m[1]}`);
  // A queryFn can also delegate to a helper module (`await import('@/lib/x')`,
  // `queryFn: fetchAllClinicalTemplates`). Record what it reaches for, not how
  // it was typed, so quote style and `await` placement don't read as different
  // data.
  for (const m of src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) parts.add(`import:${m[1]}`);
  for (const m of src.matchAll(/(^|[^.\w$])([a-z][\w$]*)\s*\(/g)) {
    if (!IGNORED_CALLS.has(m[2])) parts.add(`call:${m[2]}`);
  }
  // Bare helper reference with no call at all (`queryFn: fetchAllTemplates`).
  if (parts.size === 0) parts.add(`ref:${src.replace(/"/g, "'")}`);

  return [...parts].sort().join('|');
}

function collectQueries() {
  const sites = [];
  for (const file of collectSources(ROOT)) {
    const text = readFileSync(file, 'utf8');
    const rel = file.slice(process.cwd().length + 1).replace(/\\/g, '/');
    for (const m of text.matchAll(/useQuery\s*\(\s*\{/g)) {
      const body = readBalanced(text, text.indexOf('{', m.index + m[0].length - 1));
      const key = optionValue(body, 'queryKey');
      const fn = optionValue(body, 'queryFn');
      if (!key || !fn) continue;
      sites.push({
        file: rel,
        line: text.slice(0, m.index).split('\n').length,
        key: normalize(key),
        signature: signature(fn),
      });
    }
  }
  return sites;
}

test('no two useQuery sites share a key while fetching different data', () => {
  const byKey = new Map();
  for (const site of collectQueries()) {
    if (!byKey.has(site.key)) byKey.set(site.key, []);
    byKey.get(site.key).push(site);
  }

  const collisions = [];
  for (const [key, sites] of byKey) {
    const signatures = new Set(sites.map((s) => s.signature));
    if (signatures.size < 2) continue;
    collisions.push(
      `  ${key}\n`
        + sites.map((s) => `    ${s.file}:${s.line}  →  ${s.signature}`).join('\n'),
    );
  }

  assert.deepEqual(
    collisions,
    [],
    'These React Query keys are shared by call sites that fetch different data. '
      + 'Whichever mounts first wins for both, so the pages disagree at random. '
      + 'Give each distinct query its own key (append the sort/limit/scope that '
      + 'makes it different), or make the queryFns identical:\n'
      + collisions.join('\n'),
  );
});

test('the signature reducer distinguishes the shapes that matter', () => {
  // Scoped vs unscoped over the same entity is the PHI-leaking case.
  assert.notEqual(
    signature("async () => { const r = await base44.entities.Patient.list('-updated_date', 2000); return filterPatientsByCallerAgency(r, u, me); }"),
    signature("() => base44.entities.Patient.list('-updated_date', 2000)"),
  );
  // Row limits change the result set.
  assert.notEqual(
    signature("() => base44.entities.FaxContact.list('-created_date', 1000)"),
    signature("() => base44.entities.FaxContact.list('-created_date', 500)"),
  );
  // A filtered subset is not the full list.
  assert.notEqual(
    signature("() => base44.entities.Announcement.filter({ is_active: true }, '-created_date', ALL_ROWS)"),
    signature("() => base44.entities.Announcement.list('-created_date', ALL_ROWS)"),
  );
  // A backend function is not a direct entity read.
  assert.notEqual(
    signature("async () => (await base44.functions.invoke('getScopedPatientAlerts', {})).data"),
    signature("() => base44.entities.PatientAlert.filter({ patient_id: id }, undefined, ROWS)"),
  );
  // Pure spelling differences must NOT be flagged.
  assert.equal(
    signature("() => base44.entities.Visit.filter({}, '-visit_date', 500)"),
    signature("() => base44.entities.Visit.list('-visit_date', 500)"),
  );
  assert.equal(
    signature("async () => { return await base44.entities.Visit.list('-visit_date', 500); }"),
    signature("() => base44.entities.Visit.list('-visit_date', 500)"),
  );
});
