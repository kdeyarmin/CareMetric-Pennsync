import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

/**
 * Contract: every Base44 entity read whose result is treated as a complete
 * collection must pass an explicit row limit.
 *
 * `Entity.list(sort, limit)` / `Entity.filter(query, sort, limit)` only send a
 * `limit` param when one is given. Omit it and the SERVER decides the page size
 * (~50 rows) and returns that truncated page with no error and no "there's more"
 * signal — so a compliance rule library silently stops evaluating rules past the
 * 50th, an active-patient census stops counting, and staff drop out of rosters
 * and assignee pickers. See src/lib/queryLimits.js.
 *
 * Reads that can only ever return a single row (keyed on a unique id, or a
 * one-row-per-user/singleton config record) don't need a limit and are listed in
 * ALLOWED_UNLIMITED_READS below. Adding an entry there is a claim that the query
 * cannot return more rows than the server's default page.
 *
 * READ WHAT AN ENTRY BUYS, AND WHICH SCANS IT REACHES. It exempts every read in
 * that file from the FRONTEND scan, and from nothing else. It used to reach the
 * backend scan as well: `findUnlimitedReads` closed over the map, and both tests
 * call that one scanner, so the backend test — which turns the single-record
 * exemption off in writing, and says in its own comment why — inherited this one
 * in silence. The map is a parameter now and each caller states what it grants;
 * the backend caller passes NO_EXEMPTIONS. Nothing was escaping: all the entries
 * were under `src/`, which the backend scan does not read. An entry added
 * tomorrow on a `base44/functions/` file would have.
 */

const SRC = join(process.cwd(), 'src');
const BACKEND = join(process.cwd(), 'base44/functions');

/**
 * Files whose unlimited reads are exempt from the FRONTEND scan, each with the
 * reason it can't truncate. An entry exempts every read in the file, not one
 * line, so its reason has to cover all of them.
 *
 * Three entries were dropped here as dead: `AutomatedPDGMNavigator.jsx` (its one
 * read passes a limit of 10), `PDGMPredictiveForecaster.jsx` and
 * `AgencySettings.jsx` (neither reads an entity at all any more). All three
 * named a singleton `AgencySettings` read that no longer exists. The check below
 * fails on a dead entry now, so the next one surfaces instead of accumulating.
 */
const ALLOWED_UNLIMITED_READS = new Map([
  ['src/components/admin/AIConfigurationManager.jsx', 'AIConfiguration is a singleton config row'],
  ['src/pages/UserSettings.jsx', 'AIConfiguration is a singleton config row'],
  ['src/components/notifications/NotificationPreferences.jsx', 'one NotificationPreference row per user'],
  ['src/pages/Timesheets.jsx', 'one EmployeePayrollProfile row per user'],
  ['src/lib/retiredOfflineQueue.js', 'idempotency probes keyed on a unique request id / visit id'],
]);

/** What a scan that grants nothing passes, named so the intent reads at the call. */
const NO_EXEMPTIONS = new Map();

function collectSourceFiles(dir, extensions = /\.(js|jsx)$/) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      out.push(...collectSourceFiles(p, extensions));
    } else if (extensions.test(entry) && !/\.(test|spec)\./.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

/** Split a call's argument text on top-level commas. */
/**
 * Index just past a comment starting at `i`, or `i` itself if none starts there.
 *
 * The scanners below track quote state, so a comment must be skipped rather than
 * read character-by-character: an apostrophe in an ordinary contraction
 * ("Don't refetch on window focus" sits directly above an AgencySettings.list
 * call) would otherwise open a phantom string literal and desynchronise the
 * parse, making the guard silently stop seeing later reads.
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

function splitArgs(text) {
  const out = [];
  let depth = 0;
  let cur = '';
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    if (!quote) {
      const skipped = skipComment(text, i);
      if (skipped !== i) { cur += text.slice(i, skipped); i = skipped - 1; continue; }
    }
    const c = text[i];
    if (quote) {
      cur += c;
      if (c === quote && text[i - 1] !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      cur += c;
      continue;
    }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth--;
    if (c === ',' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** A query pinned to a unique record id returns at most one row. */
function isSingleRecordQuery(query) {
  if (!query) return false;
  const body = query.replace(/\s+/g, ' ').trim();
  if (/^\{\s*id\s*:\s*\{/.test(body)) return false; // { id: { $in: [...] } } is a set
  if (/^\{\s*id\s*:[^,}]+\}$/.test(body)) return true;
  if (/^\{\s*client_request_id\s*:[^,}]+\}$/.test(body)) return true;
  return false;
}

/**
 * Every unlimited entity read in `files`, minus what `exempt` lets past.
 *
 * `exempt` has no default on purpose. A shared scanner that closes over one
 * exemption list hands it to every caller, including the ones that declared
 * themselves stricter; making it a required argument is what forces each caller
 * to say which reads it grants.
 */
function findUnlimitedReads(files, { allowSingleRecordQueries = true, exempt } = {}) {
  if (!(exempt instanceof Map)) {
    throw new TypeError(
      'findUnlimitedReads needs an `exempt` Map. Pass ALLOWED_UNLIMITED_READS to honour the '
        + 'frontend exemptions, or NO_EXEMPTIONS to grant nothing.',
    );
  }
  const findings = [];
  for (const file of files) {
    const rel = file.slice(process.cwd().length + 1);
    const src = readFileSync(file, 'utf8');
    const re = /entities\.([A-Za-z0-9_]+)\s*\.\s*(list|filter)\s*\(/g;
    let m;
    while ((m = re.exec(src))) {
      // Walk to the matching close paren.
      let i = re.lastIndex;
      let depth = 1;
      let quote = null;
      while (i < src.length && depth > 0) {
        if (!quote) {
          // See skipComment: an apostrophe in a comment must not open a string.
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
      const args = splitArgs(src.slice(re.lastIndex, i - 1));
      const limitIndex = m[2] === 'list' ? 1 : 2;
      const limit = args[limitIndex]?.trim();
      if (limit && limit !== 'undefined') continue;
      if (allowSingleRecordQueries && m[2] === 'filter' && isSingleRecordQuery(args[0])) continue;
      if (exempt.has(rel)) continue;
      const line = src.slice(0, m.index).split('\n').length;
      findings.push(`${rel}:${line} — ${m[1]}.${m[2]}() has no row limit`);
    }
  }
  return findings.sort();
}

/**
 * THE production assertion. The two scans and the planted control below all
 * raise this one rather than each recomputing the predicate, so weakening it
 * turns the control red (D120).
 */
function assertNoUnlimitedReads(unlimited, advice) {
  assert.deepEqual(unlimited, [], `${advice}\n  ${unlimited.join('\n  ')}`);
}

test('collection entity reads pass an explicit row limit', () => {
  assertNoUnlimitedReads(
    findUnlimitedReads(collectSourceFiles(SRC), { exempt: ALLOWED_UNLIMITED_READS }),
    'Entity reads without a limit are silently capped at the server default (~50 rows).\n'
      + 'Pass ALL_ROWS / PATIENT_HISTORY_ROWS from src/lib/queryLimits.js, or add the file to\n'
      + 'ALLOWED_UNLIMITED_READS with the reason it can only return one row:',
  );
});

test('EVERY backend function entity read passes an explicit row limit', () => {
  // Stricter than the frontend rule: backend functions get no single-record
  // exemption at all. A limit is a ceiling, not a fetch size — on a genuinely
  // single-row lookup it costs nothing — and requiring it everywhere means no
  // reviewer has to re-derive whether a given key is unique, which is exactly
  // the judgement call that let these truncations survive. Backend files are
  // self-contained Deno entries (shared helpers are inlined by codegen), so the
  // limit is an inline literal rather than an import from lib/queryLimits.js.
  //
  // It grants no file-level exemption either. That is now stated at the call
  // rather than implied by the list living somewhere else: NO_EXEMPTIONS.
  assertNoUnlimitedReads(
    findUnlimitedReads(collectSourceFiles(BACKEND, /\.(ts|js)$/), {
      allowSingleRecordQueries: false,
      exempt: NO_EXEMPTIONS,
    }),
    'Backend entity reads without a limit are silently capped at the server default (~50 rows).\n'
      + 'Pass an explicit limit as the last argument (sort may be `undefined`):',
  );
});

test('the exemption map is the caller\'s, proved by handing one to a scan that grants none', () => {
  // The planted input is the MAP, and everything else is held fixed: one real
  // file with one real unlimited read, scanned under the backend caller's own
  // options. `assertNoUnlimitedReads` is the same function the two scans above
  // raise, so a weakening there reds this (D120).
  const planted = 'src/components/admin/AIConfigurationManager.jsx';
  const files = [join(process.cwd(), planted)];
  const options = { allowSingleRecordQueries: false };
  const advice = 'planted control';

  // Granted the exemption, the scan is silent — so the mechanism works when a
  // caller asks for it, and the next assertion is about the map and not about
  // the file having nothing to find.
  assertNoUnlimitedReads(
    findUnlimitedReads(files, { ...options, exempt: new Map([[planted, 'planted']]) }),
    advice,
  );

  // Handed none, the same scan over the same file reports it. Before the map was
  // a parameter this second call was unreachable: the scanner consulted
  // ALLOWED_UNLIMITED_READS whatever the caller passed.
  assert.throws(
    () => assertNoUnlimitedReads(findUnlimitedReads(files, { ...options, exempt: NO_EXEMPTIONS }), advice),
    new RegExp(planted.replace(/[.]/g, '\\.')),
  );

  // And a caller that states nothing gets nothing, rather than the last list
  // that happened to be in scope.
  assert.throws(() => findUnlimitedReads(files, options), /needs an `exempt` Map/);
});

test('an apostrophe inside a comment does not blind the argument scanner', () => {
  // Regression guard. splitArgs tracks quote state, so before skipComment() a
  // contraction in a comment ("Don't refetch...", which sits directly above a
  // real AgencySettings.list call) opened a phantom string literal and swallowed
  // the following commas — the limit argument stopped being seen, and the guard
  // could report a limited read as unlimited or miss an unlimited one entirely.
  const args = splitArgs("{ status: 'active' }, /* the caller's sort */ '-created_date', 500");
  assert.equal(args.length, 3, 'all three arguments are still split apart');
  assert.equal(args[2].trim(), '500', 'the limit argument survives the comment');

  const withLineComment = splitArgs("{ id }, // don't sort here\n undefined, 100");
  assert.equal(withLineComment.length, 3);
  assert.equal(withLineComment[2].trim(), '100');
});

test('the exemption list stays honest about why each read is safe', () => {
  for (const [file, reason] of ALLOWED_UNLIMITED_READS) {
    assert.ok(reason && reason.length > 10, `${file} needs a real reason for its exemption`);
  }
});

test('every exemption still suppresses something, so a dead one is removed rather than kept', () => {
  // A reason long enough to read is not evidence the entry still does anything.
  // Three entries here named a singleton `AgencySettings` read that had since
  // been given a limit or deleted outright, and nothing said so: an exemption
  // that stops being load-bearing reads exactly like one that is.
  //
  // The comparison is the frontend caller's own options, because "dead" is a
  // property of the scan this list serves and of no other. An empty list would
  // make this loop run zero times, which is correct rather than vacuous — the
  // scan above still runs over all of `src/`, and an empty list grants nothing.
  const dead = [...ALLOWED_UNLIMITED_READS.keys()].filter(
    rel => findUnlimitedReads([join(process.cwd(), rel)], { exempt: NO_EXEMPTIONS }).length === 0,
  );
  assert.deepEqual(
    dead,
    [],
    'these files are exempted from a finding they no longer produce; delete the entries:\n  '
      + dead.join('\n  '),
  );
});
