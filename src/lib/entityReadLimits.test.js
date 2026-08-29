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
 */

const SRC = join(process.cwd(), 'src');
const BACKEND = join(process.cwd(), 'base44/functions');

/** "file:line" reads that are exempt, each with the reason it can't truncate. */
const ALLOWED_UNLIMITED_READS = new Map([
  ['src/components/oasis/AutomatedPDGMNavigator.jsx', 'AgencySettings is a singleton config row'],
  ['src/components/oasis/PDGMPredictiveForecaster.jsx', 'AgencySettings is a singleton config row'],
  ['src/pages/AgencySettings.jsx', 'AgencySettings is a singleton config row'],
  ['src/components/admin/AIConfigurationManager.jsx', 'AIConfiguration is a singleton config row'],
  ['src/pages/UserSettings.jsx', 'AIConfiguration is a singleton config row'],
  ['src/components/notifications/NotificationPreferences.jsx', 'one NotificationPreference row per user'],
  ['src/components/training/GamificationDashboard.jsx', 'one Leaderboard row per user'],
  ['src/pages/LearningCenter.jsx', 'one Leaderboard row per user'],
  ['src/pages/Timesheets.jsx', 'one EmployeePayrollProfile row per user'],
  ['src/lib/retiredOfflineQueue.js', 'idempotency probes keyed on a unique request id / visit id'],
]);

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

function findUnlimitedReads(files, { allowSingleRecordQueries = true } = {}) {
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
      if (ALLOWED_UNLIMITED_READS.has(rel)) continue;
      const line = src.slice(0, m.index).split('\n').length;
      findings.push(`${rel}:${line} — ${m[1]}.${m[2]}() has no row limit`);
    }
  }
  return findings.sort();
}

test('collection entity reads pass an explicit row limit', () => {
  const unlimited = findUnlimitedReads(collectSourceFiles(SRC));
  assert.deepEqual(
    unlimited,
    [],
    `Entity reads without a limit are silently capped at the server default (~50 rows).\n` +
      `Pass ALL_ROWS / PATIENT_HISTORY_ROWS from src/lib/queryLimits.js, or add the file to\n` +
      `ALLOWED_UNLIMITED_READS with the reason it can only return one row:\n  ` +
      unlimited.join('\n  '),
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
  const unlimited = findUnlimitedReads(
    collectSourceFiles(BACKEND, /\.(ts|js)$/),
    { allowSingleRecordQueries: false },
  );
  assert.deepEqual(
    unlimited,
    [],
    `Backend entity reads without a limit are silently capped at the server default (~50 rows).\n` +
      `Pass an explicit limit as the last argument (sort may be \`undefined\`):\n  ` +
      unlimited.join('\n  '),
  );
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
