/**
 * The apply-list helper's own suite.
 *
 * It exists because the helper's failure mode is SILENT: a walk that returned
 * nothing, or that quietly dropped a file, would leave an adopting suite
 * building a store with no contracts in it, and every refusal such a suite
 * asserts would still pass — a function that does not exist refuses everybody.
 * So each property is proved by driving this code path, never by reading it:
 * the empty case against a real empty directory, the dropping case against a
 * planted one.
 *
 * Note what is deliberately NOT asserted: the number of migrations. That figure
 * moves whenever anyone commits a forward file, and a test pinning it would
 * fail on somebody else's merge while saying nothing about this module. What is
 * pinned is the RELATION — the names equal the directory's own `.sql` listing,
 * sorted — which is the property a suite relies on.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  RECORD_MIGRATION_DIRECTORY, applyRecordMigrations, recordMigrationNames,
} from './record-migrations.mjs';

/** A directory URL for a fresh temporary directory, with the trailing slash the walk needs. */
const temporaryDirectory = async () =>
  pathToFileURL(`${await mkdtemp(join(tmpdir(), 'pennsync-record-migrations-'))}/`);

test('the names are the directory listing, sorted, and nothing else', async () => {
  const names = await recordMigrationNames();
  // Read independently rather than through the module, so a filter that agreed
  // with itself would still be caught.
  const own = (await readdir(RECORD_MIGRATION_DIRECTORY))
    .filter(file => file.endsWith('.sql')).sort();
  assert.deepEqual(names, own);
  assert.deepEqual(names, [...names].sort(), 'apply order is the sorted file name');
  assert.ok(names.every(name => name.endsWith('.sql')));
});

test('the store, the broker family and a forward file are all in the list', async () => {
  const names = await recordMigrationNames();
  // Three anchors rather than a count: the generated store, the generated
  // broker family, and one hand-written forward migration — the three shapes a
  // suite's hand-kept list used to name separately. A walk that returned only
  // the oldest files, or only the generated ones, fails here.
  for (const anchor of [
    '20260919170000_record_store.sql',
    '20260919180000_record_brokers.sql',
    '20260920630000_roster_display_name.sql',
  ]) {
    assert.ok(names.includes(anchor), `${anchor} must be in the apply list`);
  }
});

test('an empty directory raises rather than returning nothing', async () => {
  const directory = await temporaryDirectory();
  await assert.rejects(() => recordMigrationNames(directory),
    /PENNSYNC_TEST_RECORD_MIGRATIONS_EMPTY/);
  // And the applier inherits the refusal rather than applying zero files: a
  // caller that got an empty array back would report success.
  await assert.rejects(() => applyRecordMigrations({ exec: async () => {} }, { directory }),
    /PENNSYNC_TEST_RECORD_MIGRATIONS_EMPTY/);
});

test('a directory holding no SQL raises too, however many files it has', async () => {
  const directory = await temporaryDirectory();
  // The filter is on the extension, so a directory of notes is empty for this
  // purpose. Asserting it separately because "the directory has files" and
  // "the directory has migrations" are different questions and a walk could
  // pass the first while failing the caller.
  await writeFile(new URL('README.md', directory), '# not a migration\n');
  await writeFile(new URL('20260101000000_migration.sql.bak', directory), 'select 1;\n');
  await assert.rejects(() => recordMigrationNames(directory),
    /PENNSYNC_TEST_RECORD_MIGRATIONS_EMPTY/);
});

test('the applier applies every file in order and answers what it applied', async () => {
  const directory = await temporaryDirectory();
  for (const name of ['30000000000000_c.sql', '10000000000000_a.sql', '20000000000000_b.sql']) {
    await writeFile(new URL(name, directory), `-- ${name}\n`);
  }
  const executed = [];
  const applied = await applyRecordMigrations(
    { exec: async sql => { executed.push(sql.trim()); } }, { directory });
  assert.deepEqual(applied,
    ['10000000000000_a.sql', '20000000000000_b.sql', '30000000000000_c.sql']);
  // The CONTENTS reached the database in that order, not just the names. A
  // walk that sorted its answer while executing in readdir order would pass an
  // assertion over `applied` alone.
  assert.deepEqual(executed,
    ['-- 10000000000000_a.sql', '-- 20000000000000_b.sql', '-- 30000000000000_c.sql']);
});

test('omit drops exactly what it names, which is what makes a suite sabotageable', async () => {
  const directory = await temporaryDirectory();
  for (const name of ['10000000000000_a.sql', '20000000000000_b.sql']) {
    await writeFile(new URL(name, directory), `-- ${name}\n`);
  }
  const executed = [];
  const applied = await applyRecordMigrations(
    { exec: async sql => { executed.push(sql.trim()); } },
    { directory, omit: ['20000000000000_b.sql'] });
  assert.deepEqual(applied, ['10000000000000_a.sql']);
  assert.deepEqual(executed, ['-- 10000000000000_a.sql']);
  // A name that is not there is not an error and not a silent pass either: the
  // answer still says what was applied, so a suite asserting its own forward
  // files catches a typo in its own list rather than in the helper's.
  const second = await applyRecordMigrations({ exec: async () => {} },
    { directory, omit: ['nope.sql'] });
  assert.deepEqual(second, ['10000000000000_a.sql', '20000000000000_b.sql']);
});

test('the order is the deployment tool\'s, pinned against its source', async () => {
  // The helper sorts WITHIN the record directory and leaves the authority half
  // to its caller, because that is what the provisioner does. Pinning it here
  // rather than restating it in a comment, since a suite that applied contracts
  // in a different order from the deployment would prove the wrong store.
  //
  // This reads the provisioner as TEXT and does not import it, deliberately.
  // `test:authority-store` runs in the isolated job, which installs only
  // `services/authority-store` — a suite there importing a root tool that pulls
  // `json5` dies at load, before any assertion, and `testRegistryContract`
  // fails the build for exactly that. So this is a weaker pin than calling the
  // function, and it says so: it asserts the two properties the order depends
  // on are still written where the order comes from, and a behavioural check
  // belongs in a root-context suite if anyone wants one.
  const source = await readFile(
    new URL('../../../tools-pennsync-provision.mjs', import.meta.url), 'utf8');
  assert.match(source,
    /readdirSync\(directory\)\.filter\(name => name\.endsWith\('\.sql'\)\)\.sort\(\)/,
    'the provisioner sorts by file name within a directory; the helper must too');
  const order = source.indexOf('[...read(MIGRATION_DIRECTORY), ...read(RECORD_MIGRATION_DIRECTORY)]');
  assert.ok(order > 0, 'the provisioner must still build one list from the two directories');
  // And the record directory is the SECOND of the two, which is why a caller
  // applies the authority half before calling this module rather than after.
  assert.ok(source.indexOf('read(MIGRATION_DIRECTORY)', order)
    < source.indexOf('read(RECORD_MIGRATION_DIRECTORY)', order),
    'authority first: a record policy is written in terms of pennsync_private');
});

/**
 * The suites this helper exists for, derived rather than described.
 *
 * The module's own docblock used to say how many suites applied the directory
 * whole. That was true when it was typed and went stale the moment somebody
 * adopted the walk, with nothing failing — D79's shape, arriving in the file
 * whose job is to stop a hand-kept list going stale. So the claim is a check
 * now: a suite that hands a record migration to a store BY NAME must apply the
 * whole directory as well, or be named below with a reason.
 *
 * The rule is about what reaches a STORE, not about what a suite reads. Half
 * the adopting suites still name a migration file to read its SQL as text and
 * assert something about it, which is a different act and stays allowed.
 */
const SUITE_DIRECTORY = new URL('./', import.meta.url);

/** Constants the suites import rather than declare, resolved for the scan. */
const IMPORTED_PATHS = Object.freeze({
  RECORD_MIGRATION_FILE: 'record-migrations/20260919170000_record_store.sql',
  BROKER_MIGRATION_FILE: 'record-migrations/20260919180000_record_brokers.sql',
  POLICY_SQL_FILES: 'record-migrations/20260920050000_patient_purpose_policy.sql',
});

/**
 * Suites allowed to apply a named record migration without the whole walk.
 *
 * Each owes a reason, and the reason has to be that the suite's SUBJECT is a
 * particular file rather than the store built from it — never that adopting the
 * walk turned something red. `record-brokers` is the worked example of the
 * distinction: converting it made a passing test fail, and the test was right.
 * It asserts that nothing but the broker family's five operations is reachable,
 * which is a true claim about a store holding the broker family and a false one
 * about a store holding fifty contracts beside it. The store-wide version of
 * that question is `contract-operational-tables`'s, which does apply the walk.
 */
const PINNED_BY_NAME = Object.freeze({
  'record-brokers.test.mjs':
    'its subject is the broker family migration, and it asserts the reachable '
    + 'set of a store built from it — a claim the rest of the directory falsifies '
    + 'without saying anything about the family.',
});

/** Source with line and block comments removed, so a mention in prose is not a call. */
const withoutComments = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

/**
 * The index just past the argument list a call opens at `from`.
 *
 * It skips string literals, template literals and regular expressions, because
 * each can hold an unbalanced parenthesis or a lone quote and a matcher that
 * counted those swallows the rest of the file. Both cases were found rather
 * than foreseen: SQL quoting first, then `SCHEMA.replace(/"/g, '')`, whose
 * regular expression holds one double quote. Each made the scan report a text
 * read several calls later as though a store had been handed a migration.
 */
const endOfArguments = (source, from) => {
  let depth = 1;
  let i = from;
  let previous = '(';
  for (; i < source.length && depth > 0; i += 1) {
    const c = source[i];
    if (c === "'" || c === '"' || c === '`') {
      i += 1;
      while (i < source.length && source[i] !== c) i += source[i] === '\\' ? 2 : 1;
      previous = c;
      continue;
    }
    // A `/` opens a regular expression only where a value may start; after a
    // name, a closing bracket or a literal it is division.
    if (c === '/' && '(,=:[!&|?{;+*%<>~^'.includes(previous)) {
      i += 1;
      while (i < source.length && source[i] !== '/') i += source[i] === '\\' ? 2 : 1;
      previous = '/';
      continue;
    }
    if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    if (!/\s/.test(c)) previous = c;
  }
  return i;
};

/** The text of every `exec(...)`/`query(...)` argument list in a source file. */
const storeCalls = source => {
  const calls = [];
  const opener = /\b(?:exec|query)\(/g;
  let match;
  while ((match = opener.exec(source)) !== null) {
    const i = endOfArguments(source, match.index + match[0].length);
    calls.push(source.slice(match.index + match[0].length, i - 1));
  }
  return calls;
};

/**
 * The PATH expressions of the file reads inside a store call.
 *
 * Only a call that reads a file can name a migration, and only its path
 * argument can — the rest of a store call is inline SQL, whose keywords look
 * exactly like constant names. A first version scanned the whole argument and
 * reported `SELECT`, `SCHEMA` and `JSON.stringify` as unresolvable paths, which
 * is a check failing closed on its own noise rather than on a finding.
 */
const readPaths = argument => {
  const paths = [];
  const opener = /\breadFile(?:Sync)?\(/g;
  let match;
  while ((match = opener.exec(argument)) !== null) {
    const i = endOfArguments(argument, match.index + match[0].length);
    let inner = argument.slice(match.index + match[0].length, i - 1);
    // `new URL(path, base)` and `resolve(repository, path)` both hide the path
    // one level down; the encoding differs and the answer does not.
    const url = inner.match(/new URL\(([\s\S]*?),\s*(import\.meta\.url|[A-Za-z_$][\w$]*)\s*\)/);
    const resolved = inner.match(/\bresolve\(\s*[A-Za-z_$][\w$]*\s*,([\s\S]*?)\)/);
    let base = null;
    if (url) { inner = url[1]; base = url[2] === 'import.meta.url' ? null : url[2]; }
    else if (resolved) inner = resolved[1];
    paths.push({ path: inner.trim(), base });
  }
  return paths;
};

/**
 * Does this path expression name a record migration?
 *
 * A literal path is read directly; an identifier is resolved against the
 * suite's own `const` declarations and against the constants it imports. An
 * identifier that resolves to nothing is REPORTED rather than assumed
 * harmless, because a scan that fails open is the thing this test replaces.
 */
const namesARecordMigration = ({ path, base }, source) => {
  // A relative name under a directory variable is decided by the DIRECTORY: the
  // authority half of every build walks `../supabase/migrations/` with the same
  // `new URL(name, dir)` shape this rule is looking for.
  if (base) {
    const declaration = source.match(new RegExp(`\\bconst ${base}\\s*=\\s*([\\s\\S]*?);\\n`));
    if (declaration) return /record-migrations\//.test(declaration[1]);
    return [base];
  }
  if (/record-migrations\//.test(path)) return true;
  // The shape this check exists for: `for (const file of [A, B, C])` over a
  // hand-kept list, applied one file at a time. The path is a loop variable, so
  // resolving it means resolving the list. Without this the canonical case
  // reported as UNRESOLVABLE — a loud failure, but filed under "teach the scan
  // a constant" when the answer is "convert the suite", which is the wrong
  // instruction to leave in front of whoever hits it.
  const bound = /^[A-Za-z_$][\w$]*$/.test(path)
    && source.match(new RegExp(`for \\(const ${path} of \\[([\\s\\S]*?)\\]\\)`));
  if (bound) return namesARecordMigration({ path: bound[1], base: null }, source);
  // A plain string literal with nothing substituted into it says all it says.
  if (/^(['"])[^'"`]*\1$/.test(path)) return false;
  // A composed path — `join(repository, DIRECTORY, file)` — is decided by the
  // components that resolve. A loop variable never will, and reporting one as
  // unresolvable would make the check unusable; what matters is that SOMETHING
  // in the expression was read, so that a path made entirely of names this scan
  // has never heard of is still reported rather than waved through.
  const unresolved = [];
  let resolvedSomething = false;
  for (const identifier of new Set(path.match(/\b[A-Za-z_$][\w$]*(?:\.\w+)?\b/g) ?? [])) {
    const root = identifier.split('.')[0];
    if (root in IMPORTED_PATHS) {
      if (/record-migrations\//.test(IMPORTED_PATHS[root])) return true;
      resolvedSomething = true;
      continue;
    }
    const declaration = source.match(
      new RegExp(`\\bconst ${root}\\s*=\\s*([\\s\\S]*?);\\n`));
    if (!declaration) { unresolved.push(identifier); continue; }
    if (/record-migrations\//.test(declaration[1])) return true;
    resolvedSomething = true;
  }
  if (resolvedSomething) return false;
  return unresolved.length > 0 ? unresolved : false;
};

test('a suite applying a record migration by name applies the whole directory', async () => {
  const suites = (await readdir(SUITE_DIRECTORY))
    .filter(name => name.endsWith('.test.mjs') && name !== 'record-migrations.test.mjs')
    .sort();
  assert.ok(suites.length > 50, `expected the suite directory, got ${suites.length} files`);

  const offenders = [];
  const unresolvable = [];
  let adopters = 0;
  for (const name of suites) {
    const raw = await readFile(new URL(name, SUITE_DIRECTORY), 'utf8');
    const source = withoutComments(raw);
    const walks = /applyRecordMigrations\(/.test(source);
    if (walks) adopters += 1;
    for (const argument of storeCalls(source)) {
      for (const path of readPaths(argument)) {
        const verdict = namesARecordMigration(path, source);
        if (Array.isArray(verdict)) unresolvable.push(`${name}: ${path.path}`);
        else if (verdict && !walks && !(name in PINNED_BY_NAME)) offenders.push(name);
      }
    }
  }

  assert.deepEqual([...new Set(offenders)], [],
    'these suites hand a record migration to a store by name without applying the '
    + 'whole directory, so a forward migration over the contract they exercise '
    + 'would never reach them: adopt applyRecordMigrations, or add the suite to '
    + 'PINNED_BY_NAME with the reason its subject is that particular file.');
  assert.deepEqual([...new Set(unresolvable)], [],
    'the scan could not resolve these identifiers to a path, so it cannot say '
    + 'whether they name a record migration; teach it the constant rather than '
    + 'letting the check fail open.');
  assert.ok(adopters > 1, `only ${adopters} suites apply the directory whole`);
});

/**
 * A pin that no longer bites is a pin nobody will remove.
 *
 * The list above is an exemption, so it needs the control every exemption
 * needs: each entry has to be a suite that EXISTS and that the scan would
 * otherwise report. Without this, a suite that later adopted the walk would
 * keep its exemption for ever, and the next reader would take the entry as a
 * standing reason not to convert it.
 */
test('every pinned suite exists, still needs its pin, and owes a real reason', async () => {
  const suites = new Set((await readdir(SUITE_DIRECTORY)).filter(n => n.endsWith('.test.mjs')));
  for (const [name, reason] of Object.entries(PINNED_BY_NAME)) {
    assert.ok(suites.has(name), `${name} is pinned and does not exist`);
    assert.ok(reason.length >= 40, `${name} owes a real reason, not "${reason}"`);
    const source = withoutComments(await readFile(new URL(name, SUITE_DIRECTORY), 'utf8'));
    assert.ok(!/applyRecordMigrations\(/.test(source),
      `${name} applies the whole directory now, so its pin is stale — delete it`);
    const named = storeCalls(source)
      .flatMap(readPaths)
      .some(path => namesARecordMigration(path, source) === true);
    assert.ok(named,
      `${name} no longer hands a record migration to a store by name, so the `
      + 'scan would not report it and the pin exempts nothing — delete it');
  }
});
