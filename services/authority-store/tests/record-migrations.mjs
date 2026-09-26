/**
 * The record migration directory, as a list rather than as a constant.
 *
 * A contract suite typically builds the authority half by reading
 * `supabase/migrations/` with `readdir` and then applies record files BY NAME —
 * the record store, the broker family and its own contract — so a FORWARD
 * migration over that contract is not applied by it unless somebody remembers
 * to add it. D88 makes a forward file the only legal way to change a store that
 * has already applied the original, so the gap sits on the only remaining path:
 * a change that adds one can ship with every suite green.
 *
 * Of the suites that name this directory, two apply it whole, and only
 * `contract-clinical-library.test.mjs` exercises contract BEHAVIOUR that way.
 * This module is that loop, named once, so a suite adopting it stops carrying a
 * hand-kept list.
 *
 * Two properties are load-bearing rather than tidy.
 *
 * It FAILS CLOSED on an empty listing. A helper that returned `[]` would make
 * every adopting suite build a store with no record schema at all, and the
 * refusals such a suite asserts would still pass — a contract that does not
 * exist refuses everything. So an empty directory raises rather than returning
 * nothing, and `record-migrations.test.mjs` proves that against a real empty
 * one rather than asserting the comment.
 *
 * It takes the DIRECTORY as a parameter with a default. That is what lets the
 * tests drive the empty case and a filtered case through the same code path the
 * suites use, instead of through a second copy of the walk that could agree
 * with itself while disagreeing with this one.
 *
 * The order is the deployment's: sorted by file name within this directory, and
 * the authority directory applies whole before it — by CONSTRUCTION in
 * `tools-pennsync-migrate.mjs`, which walks the two directories in that order
 * whatever the timestamps say. A caller is responsible for the authority half
 * first; this module deliberately does not apply it, because a suite's
 * authority build sometimes has fixtures wedged into it.
 */
import { readdir, readFile } from 'node:fs/promises';

export const RECORD_MIGRATION_DIRECTORY = new URL(
  '../supabase/record-migrations/', import.meta.url);

/**
 * Every record migration's file name, in apply order.
 *
 * @param {URL} directory the directory to read; the default is the real one.
 * @returns {Promise<string[]>} sorted `.sql` names, never empty.
 */
export async function recordMigrationNames(directory = RECORD_MIGRATION_DIRECTORY) {
  const names = (await readdir(directory)).filter(file => file.endsWith('.sql')).sort();
  if (names.length === 0) {
    throw new Error('PENNSYNC_TEST_RECORD_MIGRATIONS_EMPTY: '
      + `no .sql files under ${directory.href}. A suite building from an empty `
      + 'record directory would assert refusals against a store with no '
      + 'contracts in it, which passes for the wrong reason.');
  }
  return names;
}

/**
 * Apply every record migration to an open database, in apply order.
 *
 * @param {{exec: (sql: string) => Promise<unknown>}} db an open PGlite or pg client.
 * @param {{directory?: URL, omit?: string[]}} options `omit` is for the
 *   helper's OWN sabotage test, which has to prove that dropping a file makes
 *   an adopting suite fail; a suite has no reason to pass it.
 * @returns {Promise<string[]>} the names applied, so a caller can assert them.
 */
export async function applyRecordMigrations(db, options = {}) {
  const { directory = RECORD_MIGRATION_DIRECTORY, omit = [] } = options;
  const skip = new Set(omit);
  const applied = [];
  for (const name of await recordMigrationNames(directory)) {
    if (skip.has(name)) continue;
    await db.exec(await readFile(new URL(name, directory), 'utf8'));
    applied.push(name);
  }
  return applied;
}
