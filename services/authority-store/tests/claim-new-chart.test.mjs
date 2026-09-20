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
 * The production grant path (D28).
 *
 * Creating a chart and being on its care team are two writes to two owners,
 * and this is the bridge. Three of its properties are the whole security
 * argument and each has a case here:
 *
 * - **The identity is minted, never accepted.** The function takes an agency
 *   and nothing else. A caller who could name the id would name a chart that
 *   already exists, and the grant would hand them somebody else's record —
 *   which is why there is no parameter for one to name.
 * - **The seat is the caller's own.** Nothing here takes a subject, so it
 *   cannot put another person on a care team.
 * - **A grant with no patient behind it authorizes nothing.** That is what
 *   makes "grant first, then insert" the safe order, and it is proved against
 *   the record store's own narrowing rather than asserted.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const CLAIM = 'services/authority-store/supabase/record-migrations/20260920110000_claim_new_chart.sql';
/** Read back through the real capability, not through a grant a caller has not got. */
const PATIENT_POLICY = 'services/authority-store/supabase/record-migrations/20260920050000_patient_purpose_policy.sql';
const PATIENT_CONTRACT = 'services/authority-store/supabase/record-migrations/20260920060000_contract_patient_read.sql';
const GET = 'select "public"."pennsync_contract_patient_get"($1,$2,$3) as result';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** 1 agency_admin in agency-a, 2 and 3 clinicians there, 4 agency_admin in agency-b. */
const ADMIN_A = 1; const CLINICIAN_A = 2; const ADMIN_B = 4;
const A = 'agency-a'; const B = 'agency-b';
const HEX24 = /^[a-f0-9]{24}$/;
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, PATIENT_POLICY,
    PATIENT_CONTRACT, CLAIM]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  // A member of agency-a whose role may open charts but may not start one.
  await db.exec(`update pennsync_private.membership set tenant_role = 'social_worker'
    where id = 'membership-3'`);
});
after(async () => db?.close());

async function as(n, sql, params = []) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
    const { rows } = await db.query(sql, params);
    return rows;
  } finally { await db.exec('rollback'); }
}
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);
/**
 * A claim COMMITS, unlike `as` above, because the row it writes is the thing
 * under test. `set local role` reverts at commit on its own.
 */
async function claim(n, agency = A) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
    const { rows } = await db.query('select "public"."pennsync_claim_new_chart"($1) as id', [agency]);
    await db.exec('commit');
    return rows[0].id;
  } catch (error) { await db.exec('rollback'); throw error; }
}

test('the function takes an agency and nothing else, so no caller can name a chart', () => {
  // Stated against the signature rather than the behaviour, because the
  // absence of a parameter is what makes naming an existing chart impossible.
  // A second argument here would be the whole defect.
  const sql = readFileSync(resolve(repository, CLAIM), 'utf8');
  assert.match(sql, /create function public\.pennsync_claim_new_chart\(p_agency text\) returns text/);
  assert.match(sql, /create function pennsync_private\.claim_new_chart\(p_agency text\) returns text/);
  // And no parameter names a person either: the seat is the caller's own.
  assert.ok(!/p_membership|p_user|p_subject|p_patient/.test(sql), 'nothing takes a subject');
});

test('a claim mints an identity and the care-team seat that goes with it', async () => {
  const id = await claim(CLINICIAN_A);
  assert.match(id, HEX24, 'a Base44-shaped identity');
  // It named the caller's own membership, and nobody else's.
  assert.deepEqual((await db.query(
    `select membership_id, status, agency_id from pennsync_private.chart_assignment
     where patient_id = $1`, [id])).rows,
  [{ membership_id: 'membership-2', status: 'active', agency_id: A }]);
  // Liveness is proved the way a caller would see it rather than by asking
  // the helper: `caller_assigned_patients` is granted to the record owner
  // alone, so a test that called it directly would be testing a path no
  // caller has.
  await db.query(`insert into ${SCHEMA}."patient"
    ("source_app_id","id","agency_id","status","is_sample","is_archived","first_name","last_name")
    values ($1,$2,$3,'active',false,false,'First','Last')`, [APP, id, A]);
  try {
    // Read back through the capability a caller actually has, rather than by
    // granting the test privileges no caller holds.
    assert.equal((await as(CLINICIAN_A, GET, [A, 'display', id]))[0].result?.id, id,
      'the creator opens the chart they created');
    // And a colleague who was not granted it does not.
    assert.equal((await as(3, GET, [A, 'display', id]))[0].result, null);
  } finally { await db.query(`delete from ${SCHEMA}."patient" where "id" = $1`, [id]); }
});

test('every claim is its own chart, and two callers never collide', async () => {
  const ids = [await claim(ADMIN_A), await claim(ADMIN_A), await claim(CLINICIAN_A)];
  for (const id of ids) assert.match(id, HEX24);
  assert.equal(new Set(ids).size, 3, 'a claim is not idempotent, and must not be');
});

test('only the roles that may create a patient may claim a chart', async () => {
  // The original admits `agency_admin`, `manager` and `clinician` to
  // `PATIENT_CREATE_ROLES` and no others. A social worker opens the charts
  // they are assigned to and does not start one.
  assert.match(await claim(ADMIN_A), HEX24);
  assert.match(await claim(CLINICIAN_A), HEX24);
  await refusal(claim(3), 'PENNSYNC_CHART_FORBIDDEN');
  // The agency is asked of this store, never of the request.
  await refusal(claim(ADMIN_B, A), 'PENNSYNC_CHART_AGENCY_NOT_HELD');
  await refusal(claim(ADMIN_A, B), 'PENNSYNC_CHART_AGENCY_NOT_HELD');
  await refusal(claim(ADMIN_A, 'no-such-agency'), 'PENNSYNC_CHART_AGENCY_NOT_HELD');
});

test('a grant with no patient behind it authorizes nothing', async () => {
  // This is what makes "grant first, then insert" the safe order: a failure
  // between the two writes leaves a row that opens no chart, because the
  // record store's narrowing is a filter rather than a lookup. The other
  // order leaves a chart its creator cannot open.
  const id = await claim(CLINICIAN_A);
  assert.equal((await db.query(
    'select count(*)::int as n from pennsync_private.chart_assignment where patient_id = $1',
    [id])).rows[0].n, 1, 'the grant is recorded');
  assert.equal((await as(CLINICIAN_A, GET, [A, 'display', id]))[0].result, null,
    'and it authorizes nothing, because there is no chart behind it');
  // The row is left in place deliberately: a grant can never be deleted, only
  // revoked, and a dangling one is harmless. Tidying it away here would be
  // testing against a table rule the next test proves.
});

test('nothing but this function writes the table, and a grant cannot be rewritten', async () => {
  const { rows } = await db.query(`select r.rolname, has_table_privilege(r.rolname,
      'pennsync_private.chart_assignment', 'select, insert, update, delete') as any
    from unnest(array['anon','authenticated','service_role','public']) as r(rolname)`);
  assert.deepEqual(rows.filter(row => row.any), [], 'no caller role touches the table');
  // And the provenance trigger still holds: which person and which chart were
  // granted can never be rewritten, and the row can never be deleted.
  const id = await claim(ADMIN_A);
  try {
    await assert.rejects(() => db.query(
      'update pennsync_private.chart_assignment set patient_id = $1 where patient_id = $2',
      ['rewritten', id]));
    await assert.rejects(() => db.query(
      'delete from pennsync_private.chart_assignment where patient_id = $1', [id]));
    // Withdrawing access is a status change, which leaves the grant on record.
    await db.query(
      "update pennsync_private.chart_assignment set status = 'revoked' where patient_id = $1", [id]);
    assert.equal((await db.query(
      'select status from pennsync_private.chart_assignment where patient_id = $1', [id])).rows[0].status,
    'revoked');
  } finally {
    await db.query("update pennsync_private.chart_assignment set status = 'active' where patient_id = $1", [id]);
  }
});
