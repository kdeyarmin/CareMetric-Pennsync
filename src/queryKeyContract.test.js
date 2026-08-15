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

/**
 * Normalize a queryKey the way React Query compares one: structurally. Quote
 * STYLE and spacing around the brackets/commas are cosmetic — `["a"]`,
 * `['a']` and `[ 'a' ]` are one cache entry at runtime, so the guard has to
 * group them together or it silently reviews two half-populations of the same
 * key, each internally consistent.
 */
const normalizeKey = (s) => normalize(s)
  .replace(/"/g, "'")
  .replace(/\s*([[\],])\s*/g, '$1');

/**
 * Any helper that narrows a result set to the caller's agency. Built fresh per
 * use rather than shared as one /g literal — a /g regex carries `lastIndex`
 * across `.test()` calls and would skip every other match.
 */
const SCOPE_HELPERS = [
  'scopePatientsToCallerAgency',
  'scopePatientsForCurrentCaller',
  'filterPatientsByCallerAgency',
  'filterUsersByCallerAgency',
];
const scopeHelperRe = (flags = '') => new RegExp(`\\b(${SCOPE_HELPERS.join('|')})\\b`, flags);
const usesScopeHelper = (source) => scopeHelperRe().test(source);

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
    // Any digit run, not just 2+: single-digit caps are real and common here
    // (`filter({ id }, '-created_date', 1)`, `list('-usage_count', 5)`), and
    // requiring two digits made a 1-row read and a 5-row read look identical.
    // `\b` keeps it off digits embedded in identifiers (m1830, PAGE_2).
    const limit = /(\b\d+\b|ALL_ROWS|[A-Z][A-Z_]*ROWS)/.exec(rest);
    parts.add(`${m[1]}.${method}`);
    if (sort) parts.add(`sort:${sort[1]}`);
    if (limit) parts.add(`limit:${limit[1]}`);
  }

  for (const m of src.matchAll(/functions\.(?:invoke|fetch)\(\s*['"](\w+)['"]/g)) parts.add(`fn:${m[1]}`);
  for (const m of src.matchAll(/\bauth\.(me)\(/g)) parts.add(`auth:${m[1]}`);
  for (const m of src.matchAll(scopeHelperRe('g'))) parts.add(`scope:${m[1]}`);
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
        rawKey: key,
        key: normalizeKey(key),
        signature: signature(fn),
        scoped: usesScopeHelper(fn),
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

test('an agency-scoped query keys on the agency it was scoped to', () => {
  // The result set depends on WHO asked, so the key has to say who asked.
  // Without it, two admins in different agencies share one cache entry and each
  // renders the roster the other one's filter produced — a silent PHI leak that
  // the collision guard above cannot see, because there is only one call site.
  const unkeyed = collectQueries()
    .filter((s) => s.scoped && !/agencyQueryKey/.test(s.rawKey))
    .map((s) => `  ${s.file}:${s.line}  →  ${s.key}`);

  assert.deepEqual(
    unkeyed,
    [],
    'These queryFns filter by the caller\'s agency but leave the agency out of '
      + 'their cache key. Add agencyQueryKey(currentUser) to the key:\n'
      + unkeyed.join('\n'),
  );
});

/**
 * Fields a `Patient.filter({ … })` predicate constrains on. A read is only
 * exempt from agency scoping when the predicate already pins it to specific
 * charts (`id`) or to the caller's own charts (`assigned_nurses`) — anything
 * else (`status: 'active'`, `care_type`, …) returns other people's charts.
 */
function crossChartPatientReads(text) {
  const reads = [];
  if (/entities\.Patient\.list\(/.test(text)) reads.push('Patient.list');
  for (const m of text.matchAll(/entities\.Patient\.filter\(\s*(?=\{)/g)) {
    const objAt = text.indexOf('{', m.index + m[0].length - 1);
    const fields = [...readBalanced(text, objAt).matchAll(/([A-Za-z_$][\w$]*)\s*:/g)]
      .map((f) => f[1]);
    if (fields.every((f) => f === 'id' || f === '$in' || f === 'assigned_nurses')) continue;
    reads.push(`Patient.filter({ ${fields.join(', ')} })`);
  }
  return reads;
}

test('every cross-chart patient read goes through an agency scope', () => {
  // Reading the roster and handing it straight to the UI is how two dozen views
  // ended up rendering every tenant's charts. The second population read it via
  // `filter({ status: 'active' })` rather than `list()`, which an earlier
  // version of this guard did not cover. New views should use
  // useScopedPatients; the direct callers all narrow rows before returning them.
  const HOOK = 'src/hooks/useScopedPatients.js'; // the one place that may read raw
  const unscoped = [];
  for (const file of collectSources(ROOT)) {
    const rel = file.slice(process.cwd().length + 1).replace(/\\/g, '/');
    if (rel === HOOK) continue;
    const text = readFileSync(file, 'utf8');
    if (usesScopeHelper(text)) continue;
    const reads = crossChartPatientReads(text);
    if (reads.length) unscoped.push(`  ${rel}  →  ${[...new Set(reads)].join(', ')}`);
  }

  assert.deepEqual(
    unscoped,
    [],
    'These files read across patient charts without applying an agency scope. '
      + `Use useScopedPatients() (${HOOK}), or scopePatientsToCallerAgency() when `
      + 'the read is imperative rather than a query. A read pinned to specific '
      + 'ids, or to the caller via assigned_nurses, is already narrow and exempt:\n'
      + unscoped.join('\n'),
  );
});

test('every patient roster query is rooted at the key patient mutations invalidate', () => {
  // Patient create / merge / delete fire invalidateQueries(['patients']). React
  // Query prefix-matches on array elements, so ['allPatients', …] and
  // ['patientsForKPI', …] were never reached and those views served stale rows
  // for a full staleTime after a merge.
  //
  // Cross-chart patient reads only. Single-chart lookups (`where:id`), reads
  // already pinned to the caller (`where:assigned_nurses`), and the user-roster
  // queries that share the scoping helpers all key on their own subjects.
  const isCrossChartRoster = (signature) => {
    if (!/\bPatient\.(list|filter)\b/.test(signature)) return false;
    const where = /where:([\w+$]+)/.exec(signature);
    if (!where) return true; // Patient.list — always the whole roster
    return !where[1].split('+').every((f) => f === 'id' || f === '$in' || f === 'assigned_nurses');
  };

  const stray = collectQueries()
    .filter((s) => isCrossChartRoster(s.signature))
    .filter((s) => !/^\['patients'[,\]]/.test(s.key))
    .map((s) => `  ${s.file}:${s.line}  →  ${s.key}`);

  assert.deepEqual(
    stray,
    [],
    'These patient queries are not rooted at [\'patients\', …] (or [\'patient\', id] '
      + 'for a single chart), so invalidateQueries({ queryKey: [\'patients\'] }) after '
      + 'a create/merge/delete does not reach them:\n'
      + stray.join('\n'),
  );
});

test('roster selectors are stable references, not inline arrows', () => {
  // React Query memoizes `select` by REFERENCE — queryObserver compares
  // `options.select === selectFn`. An inline arrow is a fresh reference on every
  // render, so the filter re-runs every render (plus a structural-sharing pass
  // over its result) instead of once per fetch. Over the rosters here — up to
  // 10,000 rows — that is real work on every keystroke and dialog toggle.
  // Use a module-level selector, or useCallback/useMemo when it closes over
  // props or state.
  const inline = [];
  for (const file of collectSources(ROOT)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/useScopedPatients\s*\(\s*\{/g)) {
      const body = readBalanced(text, text.indexOf('{', m.index + m[0].length - 1));
      const select = optionValue(body, 'select');
      if (!select || !/=>|\bfunction\b/.test(select)) continue;
      inline.push(
        `  ${file.slice(process.cwd().length + 1).replace(/\\/g, '/')}`
          + `:${text.slice(0, m.index).split('\n').length}  →  select: ${normalize(select).slice(0, 60)}`,
      );
    }
  }

  assert.deepEqual(
    inline,
    [],
    'These useScopedPatients call sites pass an inline `select`, which React '
      + 'Query cannot memoize, so it re-filters the whole roster on every render. '
      + 'Import a shared selector from @/hooks/useScopedPatients, or wrap it in '
      + 'useCallback when it closes over props/state:\n'
      + inline.join('\n'),
  );
});

test('every cross-record clinical read goes through an agency scope', () => {
  // Same exposure as the patient roster, one entity over: Visit, Incident,
  // PatientAlert, Document, OASISAssessment and CarePlan all declare a bare
  // `user_condition: { role: "admin" }` read arm, which HOSTED-RLS-PROOF §5b
  // establishes is platform-wide. A facility admin listing Visit gets other
  // tenants' nurse notes and vitals.
  //
  // Message is deliberately absent: it belongs to its PARTICIPANTS, not its
  // author, so the author rule would hide a message addressed to this user by
  // someone outside their agency. It needs participant narrowing instead.
  const ENTITIES = ['Visit', 'Incident', 'PatientAlert', 'Document', 'OASISAssessment', 'CarePlan'];
  // Reads already pinned to one chart, one record, or the caller themselves.
  const NARROW = /\b(patient_id|client_request_id|created_by|nurse_email|user_email|uploaded_by|assigned_to|employee_email|id)\b\s*:/;

  const unscoped = [];
  for (const file of collectSources(ROOT)) {
    const rel = file.slice(process.cwd().length + 1).replace(/\\/g, '/');
    if (rel.startsWith('src/hooks/') || rel.startsWith('src/lib/')) continue;
    const text = readFileSync(file, 'utf8');
    if (/useAgencyScopedQuery|filterRecordsByAuthorAgency/.test(text)) continue;
    const flat = normalize(text);
    for (const ent of ENTITIES) {
      for (const m of flat.matchAll(new RegExp(`entities\\.${ent}\\.(list|filter)\\(`, 'g'))) {
        const args = flat.slice(m.index + m[0].length, m.index + m[0].length + 160);
        if (NARROW.test(args)) continue;
        unscoped.push(`  ${rel}  →  ${ent}.${m[1]}(`);
      }
    }
  }

  assert.deepEqual(
    [...new Set(unscoped)].sort(),
    [],
    'These files read clinical records across patients without an agency scope. '
      + 'Use useAgencyScopedQuery() (src/hooks/useAgencyScopedQuery.js). A read '
      + 'pinned to one chart, one record, or the caller is already narrow and exempt:\n'
      + [...new Set(unscoped)].sort().join('\n'),
  );
});

test('a scoped query key is never used for a literal cache write', () => {
  // useAgencyScopedQuery APPENDS agencyQueryKey to the key it is given, so an
  // optimistic setQueryData(['messages'], …) written against the bare key lands
  // on a different cache entry and silently does nothing. invalidateQueries is
  // fine — it prefix-matches — but the exact-key operations are not.
  const scopedKeys = new Set();
  for (const file of collectSources(ROOT)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/useAgencyScopedQuery\s*\(\s*\{/g)) {
      const body = readBalanced(text, text.indexOf('{', m.index + m[0].length - 1));
      const key = optionValue(body, 'queryKey');
      if (key) scopedKeys.add(normalizeKey(key));
    }
  }

  const broken = [];
  for (const file of collectSources(ROOT)) {
    const rel = file.slice(process.cwd().length + 1).replace(/\\/g, '/');
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(setQueryData|getQueryData)\s*\(\s*(\[[^\]]*\])/g)) {
      if (!scopedKeys.has(normalizeKey(m[2]))) continue;
      broken.push(`  ${rel}:${text.slice(0, m.index).split('\n').length}  →  ${m[1]}(${normalizeKey(m[2])})`);
    }
  }

  assert.deepEqual(
    broken,
    [],
    'These exact-key cache writes target a key that useAgencyScopedQuery extends '
      + 'with the agency, so they write to an entry nothing reads:\n'
      + broken.join('\n'),
  );
});

test('the agency-scoped check has exactly one implementation', () => {
  // Four files hand-rolled `isCallerAgencyScoped` inline. Three of them — every
  // payroll query in Timesheets.jsx — then returned the UNFILTERED rows when it
  // came out false, which is right for a platform admin but also catches an
  // agency_admin whose agency_name is blank. That caller saw every agency's
  // timesheets, pay rates and payroll profiles. The two copies that got it right
  // carried a separate fail-closed line; the ones that didn't, failed open.
  //
  // The rule lives in src/lib/agencyScope.js and nowhere else.
  const copies = [];
  for (const file of collectSources(ROOT)) {
    const rel = file.slice(process.cwd().length + 1).replace(/\\/g, '/');
    if (rel === 'src/lib/agencyScope.js') continue;
    const text = normalize(readFileSync(file, 'utf8')).replace(/["']/g, "'");
    if (!/account_type !== 'super_admin'/.test(text)) continue;
    if (!/account_type === 'agency_admin' \|\| \w+\??\.?role === 'admin'/.test(text)) continue;
    copies.push(`  ${rel}`);
  }

  assert.deepEqual(
    copies,
    [],
    'These files re-derive "is this caller agency-scoped" inline instead of '
      + 'calling isCallerAgencyScoped() from @/lib/agencyScope. Every copy has to '
      + 'remember the agency_admin-without-agency case independently, and the ones '
      + 'that forgot leaked other tenants\' payroll data:\n'
      + copies.join('\n'),
  );
});

test('the signature reducer distinguishes the shapes that matter', () => {
  // Scoped vs unscoped over the same entity is the PHI-leaking case.
  assert.notEqual(
    signature("async () => { const r = await base44.entities.Patient.list('-updated_date', 2000); return filterPatientsByCallerAgency(r, u, me); }"),
    signature("() => base44.entities.Patient.list('-updated_date', 2000)"),
  );
  // Row limits change the result set — including single-digit caps, which a
  // `\d{2,}` limit pattern used to drop, making a 1-row and a 5-row read of
  // the same entity look like the same query.
  assert.notEqual(
    signature("() => base44.entities.FaxContact.list('-created_date', 1000)"),
    signature("() => base44.entities.FaxContact.list('-created_date', 500)"),
  );
  assert.notEqual(
    signature("() => base44.entities.Patient.filter({ id }, '-created_date', 1)"),
    signature("() => base44.entities.Patient.filter({ id }, '-created_date', 5)"),
  );
  // …but a digit inside an identifier is not a limit.
  assert.equal(
    signature("() => base44.entities.OASISAssessment.list('-m1830_bathing', 50)"),
    signature("() => base44.entities.OASISAssessment.list('-m1830_bathing', 50)"),
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

test('keys are grouped the way React Query compares them, not by quote style', () => {
  // React Query keys on the VALUE, so these are one cache entry. Grouping them
  // separately split every shared key into two half-populations, each
  // internally consistent — which is how an active-only automation-rule read
  // sat undetected under the same key as the full rule list.
  assert.equal(normalizeKey(`["clinical-templates"]`), normalizeKey(`['clinical-templates']`));
  assert.equal(normalizeKey(`[ 'patients' , 'updated' , 2000 ]`), normalizeKey(`["patients", "updated", 2000]`));
  // Genuinely different keys stay different.
  assert.notEqual(normalizeKey(`['automationRules']`), normalizeKey(`['automationRules', 'active']`));
});
