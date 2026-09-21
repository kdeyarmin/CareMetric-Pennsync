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
 * Storing what a CMS regulation sync found.
 *
 * The property worth the file: `regulatory_update` constrains `source`,
 * `category`, `impact_level` and `status`, and the thing supplying them is a
 * MODEL. The original writes them straight through, so a plausible-but-unlisted
 * answer raises a check violation and the row is lost inside a catch that only
 * logs. Here an unrecognised value falls back to the same default the original
 * uses for an absent one, and the answer says how many were adjusted.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const TIME_OFF = 'services/authority-store/supabase/record-migrations/'
  + '20260920230000_contract_time_off.sql';
const CREDENTIAL_SWEEP = 'services/authority-store/supabase/record-migrations/'
  + '20260920340000_contract_credential_sweep.sql';
const REGULATION = 'services/authority-store/supabase/record-migrations/'
  + '20260920370000_contract_regulatory_update.sql';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN_A = 1; const CLINICIAN_A = 2;
const STORE = 'select "public"."pennsync_contract_regulatory_update_store"($1,$2) as result';
const A = 'agency-a'; const B = 'agency-b';
const GOOD = Object.freeze({
  title: 'OASIS-E1 item set', cms_reference: 'CMS-1780-F',
  effective_date: '2026-01-01', category: 'oasis', impact_level: 'high',
  summary: 'New item set replaces OASIS-E.',
  required_actions: ['Retrain assessors', 'Update templates'],
  documentation_requirements: ['Record the new items at SOC'],
  source_url: 'https://www.cms.gov/example',
});
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  // `time_off_date` and `agency_today` are the shared parsers this reuses.
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE,
    TIME_OFF, CREDENTIAL_SWEEP, REGULATION]) {
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
const store = (n, regs, agency = A) => as(n, STORE, [agency, JSON.stringify(regs)]);
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);
const clear = () => db.query(`delete from ${SCHEMA}."regulatory_update"`);
const rows = async () => (await db.query(
  `select * from ${SCHEMA}."regulatory_update" order by "title"`)).rows;

test('a regulation is stored with the fields the original composes', async () => {
  await clear();
  const result = await store(ADMIN_A, [GOOD]);
  assert.equal(result.regulations_found, 1);
  assert.equal(result.regulations_stored, 1);
  assert.equal(result.regulations_adjusted, 0);
  const [row] = await rows();
  assert.equal(row.title, 'OASIS-E1 item set');
  assert.equal(row.category, 'oasis');
  assert.equal(row.impact_level, 'high');
  assert.equal(row.status, 'pending_review');
  assert.equal(row.reference_url, 'https://www.cms.gov/example');
  assert.equal(row.reviewed_by, null);
  assert.deepEqual(row.affected_areas, ['oasis']);
  assert.deepEqual(row.required_actions, ['Retrain assessors', 'Update templates']);
  // The original's composed detail block, shape for shape.
  assert.match(row.full_details, /^New item set replaces OASIS-E\./);
  assert.match(row.full_details, /Required Actions:\nRetrain assessors\n- Update templates/);
  assert.match(row.full_details, /Documentation Requirements:\nRecord the new items at SOC/);
  // A CMS reference naming Medicare is a Medicare row; everything else is CMS.
  assert.equal(row.source, 'CMS');
  await clear();
  await store(ADMIN_A, [{ ...GOOD, cms_reference: 'Medicare Benefit Policy Manual' }]);
  assert.equal((await rows())[0].source, 'Medicare');
});

test('a value the column would refuse becomes the default, and is counted', async () => {
  // The whole point. A model asked for free text answers "high-impact" where
  // the enum says "high"; the original writes it through and the insert raises
  // a check violation inside a catch that only logs, so the regulation is
  // lost and the reported count is wrong.
  await clear();
  const result = await store(ADMIN_A, [
    { ...GOOD, title: 'A', category: 'reimbursement policy', impact_level: 'VERY HIGH' },
    { ...GOOD, title: 'B', category: 'BILLING', impact_level: 'Critical' },
    { ...GOOD, title: 'C' },
  ]);
  assert.equal(result.regulations_stored, 3, 'nothing is lost');
  assert.equal(result.regulations_adjusted, 1, 'only the first needed adjusting');
  const stored = await rows();
  assert.deepEqual(stored.map(r => [r.title, r.category, r.impact_level]), [
    ['A', 'documentation', 'medium'],
    // Case alone is not an adjustment: the enum is matched case-insensitively.
    ['B', 'billing', 'critical'],
    ['C', 'oasis', 'high'],
  ]);
});

test('an absent field takes the original s default, and a bad date takes today', async () => {
  await clear();
  await store(ADMIN_A, [{ title: 'Bare minimum' }]);
  const [row] = await rows();
  assert.equal(row.category, 'documentation');
  assert.equal(row.impact_level, 'medium');
  assert.equal(row.source, 'CMS');
  assert.deepEqual(row.required_actions, []);
  assert.match(row.full_details, /Required Actions:\nNone specified/);
  assert.match(row.full_details, /Documentation Requirements:\nNone specified/);
  const today = (await db.query(`select ${SCHEMA}.agency_today() as d`)).rows[0].d;
  assert.equal(String(row.effective_date).slice(0, 10), String(today).slice(0, 10));
  await clear();
  await store(ADMIN_A, [{ ...GOOD, effective_date: 'Q1 2026' }]);
  assert.equal(String((await rows())[0].effective_date).slice(0, 10),
    String(today).slice(0, 10));
});

test('a regulation with no title is not a regulation', async () => {
  // The original would store a row with a null title, which nothing can act on.
  await clear();
  const result = await store(ADMIN_A, [GOOD, { summary: 'no title' }, { title: '   ' }]);
  assert.equal(result.regulations_found, 3);
  assert.equal(result.regulations_stored, 1);
  assert.equal((await rows()).length, 1);
});

test('the batch is one transaction, and a bad element stores none of it', async () => {
  // Divergence 3. The original creates each row in its own call inside a
  // try/catch that logs and continues, so a sync can half-succeed and report a
  // count nobody can reconcile.
  await clear();
  await refusal(store(ADMIN_A, [GOOD, 'not an object']), 'PENNSYNC_REGULATION_INVALID');
  assert.equal((await rows()).length, 0, 'the good one did not land either');
  await refusal(store(ADMIN_A, { title: 'an object, not an array' }),
    'PENNSYNC_REGULATION_INVALID');
  await refusal(store(ADMIN_A, Array.from({ length: 201 }, () => GOOD)),
    'PENNSYNC_REGULATION_TOO_MANY');
});

test('only the agency administrator stores, and only into their own agency', async () => {
  await clear();
  await refusal(store(CLINICIAN_A, [GOOD]), 'PENNSYNC_REGULATION_FORBIDDEN');
  await refusal(store(ADMIN_A, [GOOD], B), 'PENNSYNC_REGULATION_FORBIDDEN');
  await store(ADMIN_A, [GOOD]);
  assert.equal((await rows())[0].agency_id, A);
});

test('running the sync twice stores it twice, as the original does', async () => {
  // Deliberately not diverged: deciding what makes two regulations the same
  // row is an entity decision, and D30 is where a uniqueness claim belongs.
  await clear();
  await store(ADMIN_A, [GOOD]);
  await store(ADMIN_A, [GOOD]);
  assert.equal((await rows()).length, 2);
  const source = readFileSync(resolve(repository, REGULATION), 'utf8');
  assert.match(source, /DELIBERATELY NOT MADE/);
});
