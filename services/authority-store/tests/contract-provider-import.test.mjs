import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { RECORD_MIGRATION_FILE, SCHEMA } from '../../../tools-entity-schema-plan.mjs';
import { BROKER_MIGRATION_FILE } from '../../../tools-record-brokers.mjs';

/**
 * The record half of the provider directory import.
 *
 * Two properties carry it. The gate is D40's for the second time, and this
 * original had the widening half made already — it admits an `agency_admin`
 * by a self-editable label beside the built-in `admin` and the platform tier,
 * and membership answers all three. And the duplicate scan D41 and D43 keep
 * deleting is here in its WRITING form: the original maps every provider in
 * the DEPLOYMENT and then updates whatever it matched, so one agency's import
 * could rewrite another agency's directory entry.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const IMPORT = 'services/authority-store/supabase/record-migrations/'
  + '20260920400000_contract_provider_import.sql';
const ORIGINAL = 'base44/functions/importProvidersCsv/entry.ts';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const email = n => ['', 'admin-a', 'clinician-a', 'clinician-empty', 'admin-b'][n]
  + '@example.invalid';
const ADMIN_A = 1; const CLINICIAN_A = 2; const ADMIN_B = 4;
const IMPORT_RPC = 'select "public"."pennsync_contract_provider_import"($1,$2) as result';
const A = 'agency-a'; const B = 'agency-b';
const ROW = Object.freeze({
  full_name: 'John Md Smith', credentials: 'MD', specialty: 'Cardiology',
  practice_name: 'Penn Cardiology', company: '', top_unit: '', parent_unit: '',
  sub_unit: '', phone_number: '2155550101', fax_number: '2155550100',
  npi_number: '1234567890', state_license: 'PA-1',
});
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, IMPORT]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
});
after(async () => db?.close());

async function as(n, sql, params = [], commit = true) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
    const { rows } = await db.query(sql, params);
    if (commit) await db.exec('commit'); else await db.exec('rollback');
    return rows[0].result;
  } catch (error) { await db.exec('rollback'); throw error; }
}
const run = (n, rows, agency = A) => as(n, IMPORT_RPC, [agency, JSON.stringify(rows)]);
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);
const reset = () => db.query(`delete from ${SCHEMA}."physician"`);
const directory = async (agency = A) => (await db.query(
  `select * from ${SCHEMA}."physician" where "agency_id" = $1 order by "full_name"`,
  [agency])).rows;

test('only an agency administrator imports, and only into their own agency', async () => {
  // The original's three tiers — `role === 'admin'`, the self-editable
  // `account_type === 'agency_admin'` and `super_admin` — collapse onto the
  // one question membership can answer (D40).
  await reset();
  await refusal(run(CLINICIAN_A, [ROW]), 'PENNSYNC_PROVIDER_IMPORT_FORBIDDEN');
  await refusal(run(ADMIN_B, [ROW], A), 'PENNSYNC_PROVIDER_IMPORT_FORBIDDEN');
  await refusal(run(ADMIN_A, [ROW], B), 'PENNSYNC_PROVIDER_IMPORT_FORBIDDEN');
  const result = await run(ADMIN_A, [ROW]);
  assert.deepEqual(result, { success: true, created_providers: 1, updated_providers: 0 });
  const [row] = await directory();
  assert.equal(row.agency_id, A, 'stamped from the envelope');
  assert.equal(row.created_by, email(ADMIN_A));
});

test('the row is written the way the original composes it', async () => {
  await reset();
  await run(ADMIN_A, [ROW]);
  const [row] = await directory();
  assert.equal(row.full_name, 'John Md Smith');
  assert.equal(row.credentials, 'MD');
  assert.equal(row.provider_type, 'MD', 'the original writes the credentials twice');
  assert.equal(row.specialty, 'Cardiology');
  assert.equal(row.practice_name, 'Penn Cardiology');
  assert.equal(row.phone_number, '2155550101');
  assert.equal(row.fax_number, '2155550100');
  assert.equal(row.npi_number, '1234567890');
  assert.equal(row.state_license, 'PA-1');
  assert.equal(row.preferred_contact_method, 'fax');
  assert.equal(row.is_active, true);
  assert.equal(row.accepts_home_health, true);
  assert.equal(row.notes, 'Imported from provider CSV');
  // Read from the original rather than remembered.
  const original = readFileSync(resolve(repository, ORIGINAL), 'utf8');
  assert.match(original, /notes: 'Imported from provider CSV'/);
  assert.match(original, /preferred_contact_method: 'fax'/);
});

test('an NPI matches before a name and fax do, and an update rewrites the row', async () => {
  await reset();
  await run(ADMIN_A, [ROW]);
  const moved = { ...ROW, full_name: 'Jonathan Smith', specialty: 'Electrophysiology',
    fax_number: '2155559999' };
  const result = await run(ADMIN_A, [moved]);
  assert.deepEqual(result, { success: true, created_providers: 0, updated_providers: 1 });
  const rows = await directory();
  assert.equal(rows.length, 1, 'the NPI says it is the same provider');
  assert.equal(rows[0].full_name, 'Jonathan Smith');
  assert.equal(rows[0].specialty, 'Electrophysiology');
  assert.equal(rows[0].fax_number, '2155559999');
  // With no NPI on either side, the name and fax are what match.
  await reset();
  const noNpi = { ...ROW, npi_number: '' };
  await run(ADMIN_A, [noNpi]);
  assert.equal((await run(ADMIN_A, [{ ...noNpi, specialty: 'Nephrology' }])).updated_providers, 1);
  assert.equal((await directory()).length, 1);
  assert.equal((await directory())[0].specialty, 'Nephrology');
  // A different fax with no NPI is a different provider.
  assert.equal((await run(ADMIN_A, [{ ...noNpi, fax_number: '2155558888' }])).created_providers, 1);
  assert.equal((await directory()).length, 2);
});

test("another agency's directory is not this agency's to rewrite", async () => {
  // Divergence 2, and the defect behind it: the original maps every provider
  // in the deployment by NPI and then updates whatever it matched.
  await reset();
  await db.query(`insert into ${SCHEMA}."physician"
    ("source_app_id","id","agency_id","full_name","fax_number","npi_number","specialty")
    values ($1,'phys-b',$2,'John Md Smith','2155550100','1234567890','Agency B specialty')`,
  [APP, B]);
  const result = await run(ADMIN_A, [{ ...ROW, specialty: 'Cardiology' }]);
  assert.equal(result.created_providers, 1, 'a create, not an update of theirs');
  assert.equal(result.updated_providers, 0);
  assert.equal((await directory(B))[0].specialty, 'Agency B specialty', 'untouched');
  assert.equal((await directory(A))[0].specialty, 'Cardiology');
});

test('a duplicate within one import is imported once', async () => {
  await reset();
  const result = await run(ADMIN_A, [ROW, { ...ROW, specialty: 'Second listing' },
    { ...ROW, npi_number: '', specialty: 'Third listing' },
    { ...ROW, npi_number: '', full_name: 'JOHN MD SMITH' }]);
  // The first two share an NPI; the last two share name-and-fax, and the third
  // also matches the row the first created.
  assert.equal(result.created_providers, 1);
  assert.equal(result.updated_providers, 1);
  assert.equal((await directory()).length, 1);
});

test('a row with no name or no fax writes nothing at all', async () => {
  await reset();
  const result = await run(ADMIN_A, [
    { ...ROW, full_name: '' }, { ...ROW, fax_number: '' }, {}, ROW]);
  assert.equal(result.created_providers, 1);
  assert.deepEqual((await directory()).map(r => r.full_name), ['John Md Smith']);
});

test('a field the contract decides is refused, never dropped', async () => {
  // The same discipline the generated write contracts apply: a caller cannot
  // name `agency_id`, an `id`, or the referral counters.
  await reset();
  for (const bad of [{ ...ROW, agency_id: B }, { ...ROW, id: 'chosen' },
    { ...ROW, referral_count: 99 }, { ...ROW, notes: 'mine' },
    { ...ROW, is_active: false }, { ...ROW, expiration_date: 'typo' }]) {
    await refusal(run(ADMIN_A, [bad]), 'PENNSYNC_PROVIDER_IMPORT_FIELD_UNSUPPORTED');
  }
  await refusal(run(ADMIN_A, { full_name: 'an object, not an array' }),
    'PENNSYNC_PROVIDER_IMPORT_INVALID');
  await refusal(run(ADMIN_A, [ROW, 'not an object']), 'PENNSYNC_PROVIDER_IMPORT_INVALID');
  assert.deepEqual(await directory(), [], 'and the good row did not land either');
});

test('the import is one transaction, so a refusal leaves no half-directory', async () => {
  // Divergence 3. The original creates and updates in chunks of three with a
  // 150 ms pause, so a failure halfway leaves a partly-imported directory.
  await reset();
  const many = Array.from({ length: 7 }, (unused, index) => ({
    ...ROW, npi_number: `900000000${index}`, full_name: `Provider ${index}`,
    fax_number: `21555510${String(index).padStart(2, '0')}`,
  }));
  await refusal(run(ADMIN_A, [...many, { bad_field: 'x' }]),
    'PENNSYNC_PROVIDER_IMPORT_FIELD_UNSUPPORTED');
  assert.deepEqual(await directory(), []);
  assert.equal((await run(ADMIN_A, many)).created_providers, 7);
  const original = readFileSync(resolve(repository, ORIGINAL), 'utf8');
  assert.match(original, /processInChunks\(items, handler, chunkSize = 3\)/,
    'the chunked writer is still what this replaces');
});
