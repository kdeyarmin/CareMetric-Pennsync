import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { RECORD_MIGRATION_FILE } from '../../../tools-entity-schema-plan.mjs';
import { fileCopyRows, writeFileObjects, locatorKey, planFileCopy, readExport, COPY_CONTRACT }
  from '../../../tools-pennsync-file-copy.mjs';

/**
 * The `file_url` -> `cmfile:` mapping (D77).
 *
 * Four properties are the reason it exists, and each is proved rather than
 * asserted about the file's own comments: an owned handle passes through, an
 * UNMAPPED legacy locator resolves to null rather than to itself, the key is
 * the EXACT string, and a mapping row can never be rewritten.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const MAP = 'services/authority-store/supabase/record-migrations/20260920520000_file_locator_map.sql';
const APP = '6a9881683dc68a0bd54f1ef7';
const HANDLE = 'cmfile:3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const OTHER = 'cmfile:3f2504e0-4f89-41d3-9a0c-0305e82c3302';
const LEGACY = 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/uploads/a.pdf';
const key = value => createHash('sha256').update(value, 'utf8').digest('hex');
const zeros = '0'.repeat(64);
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  for (const file of [RECORD_MIGRATION_FILE, MAP]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
});

after(async () => { await db?.close(); });

const resolveLocator = async value =>
  (await db.query('select pennsync_private.resolve_file_locator($1) as uri', [value])).rows[0].uri;

const record = (locator, uri, digest = zeros) => db.query(
  `insert into pennsync_private.file_object(app_id,locator_key,locator,file_uri,
     content_sha256,byte_size,copy_run,recorded_by)
   values ($1,$2,$3,$4,$5,$6,'run-1','00000000-0000-4000-8000-000000000001')`,
  [APP, key(locator), locator, uri, digest, 11]);

test('an owned handle needs no mapping and comes back unchanged', async () => {
  // The write side already mints these: the integration runtime returns
  // durable private `cmfile:` handles from both uploads. A resolver that
  // demanded a mapping row for one would break the half that already works.
  assert.equal(await resolveLocator(HANDLE), HANDLE);
  // Nothing was recorded to make that true.
  assert.equal((await db.query('select count(*)::int as n from pennsync_private.file_object'))
    .rows[0].n, 0);
  // Case matters: the runtime's own `FILE_URI` is case-insensitive on the
  // uuid, and this pass-through admits the lower-case form the store writes.
  assert.equal(await resolveLocator(HANDLE.toUpperCase()), null);
});

test('an unmapped legacy locator resolves to null, never to itself', async () => {
  // The whole point. Returning the input would hand a Base44 storage URL back
  // to a caller that asked for an owned handle, and the caller would fetch it
  // — which is the dependency the exit exists to remove, arriving silently and
  // exactly for the rows the copy missed. D56: do not widen the allowlist to
  // unblock yourself.
  assert.equal(await resolveLocator(LEGACY), null);
  for (const value of [null, '', 'not a url', 'cmfile:', 'cmfile:not-a-uuid',
    'https://base44.app/x.pdf', 'file:///etc/passwd']) {
    assert.equal(await resolveLocator(value), null, JSON.stringify(value));
  }
});

test('a mapped locator resolves, and the key is the exact string', async () => {
  await record(LEGACY, HANDLE);
  assert.equal(await resolveLocator(LEGACY), HANDLE);
  // A query string is part of an address. Two locators differing only there
  // are two locators, and mapping one says nothing about the other.
  assert.equal(await resolveLocator(`${LEGACY}?v=2`), null);
  assert.equal(await resolveLocator(`${LEGACY} `), null);
  assert.equal(await resolveLocator(LEGACY.toUpperCase()), null);
  // Same bytes at two addresses is one object with two mappings, which the
  // digest column deliberately does not forbid.
  const second = `${LEGACY}?v=2`;
  await record(second, HANDLE);
  assert.equal(await resolveLocator(second), HANDLE);
});

test('a mapping is immutable, because remapping repoints rows nobody edited', async () => {
  // Every carried row holding this locator resolves through this row, so a
  // remap silently points them all at different bytes — a patient's document
  // becoming another patient's, with nothing in either row changed to show it.
  await assert.rejects(
    () => db.query(`update pennsync_private.file_object set file_uri = $1 where locator_key = $2`,
      [OTHER, key(LEGACY)]),
    error => /PENNSYNC_FILE_OBJECT_IMMUTABLE/.test(String(error?.message ?? error)));
  // Not even a column that looks harmless.
  await assert.rejects(
    () => db.query(`update pennsync_private.file_object set copy_run = 'run-2'
      where locator_key = $1`, [key(LEGACY)]),
    error => /PENNSYNC_FILE_OBJECT_IMMUTABLE/.test(String(error?.message ?? error)));
  await assert.rejects(
    () => db.query(`delete from pennsync_private.file_object where locator_key = $1`, [key(LEGACY)]),
    error => /PENNSYNC_FILE_OBJECT_IMMUTABLE/.test(String(error?.message ?? error)));
  assert.equal(await resolveLocator(LEGACY), HANDLE);
});

test('one locator has one destination, caught by the primary key', async () => {
  await assert.rejects(() => record(LEGACY, OTHER),
    error => /duplicate key|unique/i.test(String(error?.message ?? error)));
});

test('the columns refuse a shape that could not address anything', async () => {
  for (const [locator, uri, digest] of [
    ['https://x/1.pdf', 'https://x/1.pdf', zeros],
    ['https://x/2.pdf', 'cmfile:not-a-uuid', zeros],
    ['https://x/3.pdf', HANDLE, 'NOTHEX'],
    ['', HANDLE, zeros],
  ]) {
    await assert.rejects(() => record(locator, uri, digest),
      error => /violates check constraint/i.test(String(error?.message ?? error)),
      `${locator} -> ${uri}`);
  }
});

test('nothing reaches the table directly, and the resolver is the owner\'s alone', async () => {
  const policies = await db.query(`select count(*)::int as n from pg_policies
    where schemaname = 'pennsync_private' and tablename = 'file_object'`);
  // Forced RLS with no policy: PostgreSQL matches no rows rather than raising,
  // so a caller reading it directly sees an empty table, not a refusal.
  assert.equal(policies.rows[0].n, 0);
  const forced = await db.query(`select relrowsecurity, relforcerowsecurity from pg_class
    where oid = 'pennsync_private.file_object'::regclass`);
  assert.equal(forced.rows[0].relrowsecurity, true);
  assert.equal(forced.rows[0].relforcerowsecurity, true);
  // The grant list names the record owner and nobody else. `public` appearing
  // here would make the definer reachable by any caller, which is the one
  // thing the projection rule exists to prevent.
  const grants = await db.query(`select unnest(coalesce(proacl, '{}'))::text as ace
    from pg_proc where oid = 'pennsync_private.resolve_file_locator(text)'::regprocedure`);
  // NOT `.filter(Boolean)`. A PUBLIC grant is the EMPTY-NAME entry (`=X/owner`),
  // so filtering falsy names discarded the one thing this assertion exists to
  // catch — and it did: PostgreSQL grants EXECUTE to PUBLIC by default and the
  // migration revoked only on the table. The test read as though it proved
  // "the record owner alone" while being structurally unable to see PUBLIC.
  const grantees = grants.rows.map(row => row.ace.split('=')[0]);
  assert.equal(grantees.includes(''), false, 'PUBLIC must not hold EXECUTE');
  assert.deepEqual(grantees.filter(name => name && name !== 'postgres').sort(),
    ['pennsync_records_owner']);
  // And the question a grantee list only answers indirectly, asked directly.
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const allowed = await db.query(
      'select has_function_privilege($1, $2, $3) as ok',
      [role, 'pennsync_private.resolve_file_locator(text)', 'execute']);
    assert.equal(allowed.rows[0].ok, false, role);
  }
});

test('the key the planner writes is the key the resolver reads', async () => {
  /*
   * D45's rule, in the shape that makes it necessary: the PLANNER computes
   * `locator_key` in JavaScript and the RESOLVER recomputes it in SQL, and if
   * the two ever disagreed every mapping would be invisible — resolving to
   * null, which is exactly what an unmapped locator does — while both suites
   * went on passing. So the plan is driven all the way through `applyFileCopy`
   * into this database and read back through the function.
   */
  // A RAW non-ASCII character, not a percent-escape. A first draft used
  // `%C3%A9`, which is ASCII text, so both sides agreed under latin1 as well
  // as utf8 and the encoding this test exists to pin was never exercised.
  const locator = 'https://base44.app/files/caf\u00e9-r\u00e9sum\u00e9.pdf?v=3';
  const plan = planFileCopy(readExport(JSON.stringify({
    contract: COPY_CONTRACT,
    app_id: APP,
    references: [{ entity: 'Document', path: 'file_url', row_id: 'doc-x', locator }],
  })), JSON.parse(readFileSync(resolve(repository, 'tools-file-reference-census-expectations.json'), 'utf8')),
  JSON.parse(readFileSync(resolve(repository, 'tools-transition-disposition.json'), 'utf8')));
  assert.equal(plan.copies.length, 1);
  const uri = 'cmfile:3f2504e0-4f89-41d3-9a0c-0305e82c33aa';
  // Through the PLANNER's own row builder and the real insert, not a second
  // one written beside them: the property this test exists for is that the
  // `locator_key` the planner writes is the one the resolver reads. The
  // capability wrapper `applyFileCopy` is refused unconditionally (D77 — the
  // runtime mints handles only their uploader can open), and that refusal is
  // about whether a copy may be RECORDED, not about whether the two halves of
  // the key agree.
  const applied = await writeFileObjects(
    async (sql, params) => { await db.query(sql, params); },
    fileCopyRows(plan, {
      actorId: '00000000-0000-4000-8000-000000000001',
      expectedDigest: plan.digest,
      copyRun: 'cross-check',
      results: { [locator]: { file_uri: uri, content_sha256: zeros, byte_size: 7 } },
    }));
  assert.equal(applied, 1, 'one mapping recorded');
  // The round trip. Both sides hash the UTF-8 bytes of the exact string, so a
  // normalisation OR a different encoding on either side shows up here and
  // nowhere else: the planner's own suite compares its key only to itself, and
  // the migration's suite computes the key the same way this one does.
  assert.equal(await resolveLocator(locator), uri);
  assert.equal(locatorKey(locator),
    (await db.query('select locator_key from pennsync_private.file_object where locator = $1',
      [locator])).rows[0].locator_key);
});
