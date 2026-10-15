import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import {
  applyRecordMigrations, assertNewestRecordMigration, recordMigrationNames,
} from './record-migrations.mjs';

/**
 * The forward migration that carries the Claude model default to a store that
 * ran the earlier text (D88).
 *
 * Removing OpenAI regenerated `record_store.sql` and `column_defaults.sql`, and
 * the migrate tool plans by NAME, so a store that had already run them kept
 * `'gpt-4o'` while every store built from the tree got `'claude-sonnet-5-5'`.
 * Hosted staging was such a store. The two properties here are the two halves
 * of that: where the old default stands, this migration replaces it and leaves
 * the rows already stored alone; where the tree's default stands, it changes
 * nothing.
 *
 * THIS SUITE HOLDS THE RECORD-MIGRATION ORDERING GUARD, over
 * `20260920900000_ai_model_default.sql`, because that is the newest file in the
 * record directory. It took the guard from `contract-fax-log.test.mjs` by
 * overtaking it. When some later migration overtakes this one, the guard moves
 * there and the call here is retired, not widened.
 */
const NEWEST = '20260920900000_ai_model_default.sql';
const APP = '6a9881683dc68a0bd54f1ef7';
const TABLE = '"pennsync_records"."ai_model_configuration"';
const DEFAULT = `select column_default from information_schema.columns
  where table_schema = 'pennsync_records' and table_name = 'ai_model_configuration'
    and column_name = 'model'`;

/** Every migration except this one: the store as it stood before it. */
async function storeWithoutNewest() {
  const db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  const applied = await applyRecordMigrations(db, { omit: [NEWEST] });
  assert.ok(!applied.includes(NEWEST));
  return db;
}

/** This migration alone, through the same walk, on a store that has the rest. */
async function applyNewest(db) {
  const others = (await recordMigrationNames()).filter(name => name !== NEWEST);
  assert.deepEqual(await applyRecordMigrations(db, { omit: others }), [NEWEST]);
}
const modelDefault = async db => (await db.query(DEFAULT)).rows[0]?.column_default;
const insertWithoutModel = (db, id) =>
  db.query(`insert into ${TABLE} ("source_app_id","id") values ($1,$2)`, [APP, id]);
const modelOf = async (db, id) =>
  (await db.query(`select "model" from ${TABLE} where "id" = $1`, [id])).rows[0]?.model;

before(async () => {
  // The guard belongs to whichever suite owns the newest record migration.
  assertNewestRecordMigration(await recordMigrationNames(), NEWEST);
});

test('a store that ran the old default moves to Claude and keeps the rows it holds', async () => {
  const db = await storeWithoutNewest();
  // What `column_defaults.sql` set before it was regenerated, and what hosted
  // staging still held when this was written.
  await db.exec(`alter table ${TABLE} alter column "model" set default 'gpt-4o'`);
  await insertWithoutModel(db, 'stored-before');
  assert.equal(await modelOf(db, 'stored-before'), 'gpt-4o');

  await applyNewest(db);

  assert.equal(await modelDefault(db), "'claude-sonnet-5-5'::text");
  // It sets a default and backfills nothing.
  assert.equal(await modelOf(db, 'stored-before'), 'gpt-4o');
  await insertWithoutModel(db, 'stored-after');
  assert.equal(await modelOf(db, 'stored-after'), 'claude-sonnet-5-5');
  await db.close();
});

test('a store built from the current tree already has the default and keeps it', async () => {
  const db = await storeWithoutNewest();
  assert.equal(await modelDefault(db), "'claude-sonnet-5-5'::text");
  await applyNewest(db);
  assert.equal(await modelDefault(db), "'claude-sonnet-5-5'::text");
  await db.close();
});
