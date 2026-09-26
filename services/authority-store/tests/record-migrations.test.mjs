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
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
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
