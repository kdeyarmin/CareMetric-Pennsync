import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { RECORD_MIGRATION_FILE, SCHEMA } from '../../../tools-entity-schema-plan.mjs';
import { BROKER_MIGRATION_FILE } from '../../../tools-record-brokers.mjs';
import { POLICY_SQL_FILES } from '../../../tools-read-purpose-policy.mjs';
import {
  PATIENT_CREATE_RESERVED, PATIENT_CREATE_WRITABLE,
} from '../../pennsync-api/read-purpose-policy.mjs';

/**
 * Creating a patient (D28), and the bridge it is the first caller of.
 *
 * The property this family exists for is the one D28 found by measuring: a
 * clinician who creates a chart must be able to open it. That needs two
 * writes in two ownership domains, and the contract does both in one
 * transaction — so the cases below check not only that it works but that
 * neither half can be observed without the other.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const CLAIM = 'services/authority-store/supabase/record-migrations/20260920110000_claim_new_chart.sql';
const CREATE = 'services/authority-store/supabase/record-migrations/20260920120000_contract_patient_create.sql';
const PATIENT_CONTRACT = 'services/authority-store/supabase/record-migrations/20260920060000_contract_patient_read.sql';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN_A = 1; const CLINICIAN_A = 2; const SOCIAL_A = 3; const ADMIN_B = 4;
const CREATE_SQL = 'select "public"."pennsync_contract_patient_create"($1,$2,$3) as result';
const GET = 'select "public"."pennsync_contract_patient_get"($1,$2,$3) as result';
const A = 'agency-a'; const B = 'agency-b';
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, POLICY_SQL_FILES.patient,
    PATIENT_CONTRACT, CLAIM, CREATE]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  // A member of agency-a who opens charts but may not start one.
  await db.exec(`update pennsync_private.membership set tenant_role = 'social_worker'
    where id = 'membership-3'`);
});
after(async () => db?.close());

/** A create COMMITS, because the row it writes is what the next read looks for. */
async function create(n, request, patient = {}, agency = A) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
    const { rows } = await db.query(CREATE_SQL, [agency, request,
      JSON.stringify({ first_name: 'Ada', last_name: 'Lovelace', ...patient })]);
    await db.exec('commit');
    return rows[0].result;
  } catch (error) { await db.exec('rollback'); throw error; }
}
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

test('a clinician creates a chart and can then open it', async () => {
  // The whole point of D28. Before the bridge this was the failure: the insert
  // succeeded and the creator could not read the row back.
  const answer = await create(CLINICIAN_A, 'req-open-1');
  assert.equal(answer.created, true);
  assert.match(answer.patient.id, /^[a-f0-9]{24}$/);
  assert.equal(answer.patient.agency_id, A);
  assert.equal((await as(CLINICIAN_A, GET, [A, 'display', answer.patient.id]))[0].result?.id,
    answer.patient.id, 'the creator opens the chart they created');
  // And a colleague who was not granted it does not.
  assert.equal((await as(SOCIAL_A, GET, [A, 'display', answer.patient.id]))[0].result, null);
});

test('the contract decides identity, tenancy, provenance and lifecycle', async () => {
  const answer = await create(ADMIN_A, 'req-stamp-1', { care_type: 'hospice' });
  const { rows } = await db.query(
    `select "agency_id","created_by_user_id","created_by_user_email_normalized","created_by",
      "client_request_id","patient_creation_key","status","is_sample","is_archived","care_type"
     from ${SCHEMA}."patient" where "id" = $1`, [answer.patient.id]);
  const row = rows[0];
  assert.equal(row.agency_id, A, 'tenancy is the agency the caller was checked against');
  assert.equal(row.created_by, row.created_by_user_email_normalized, 'provenance is stamped, not sent');
  assert.equal(row.patient_creation_key, `${A}:${row.created_by_user_id}:req-stamp-1`);
  assert.equal(row.status, 'active');
  assert.equal(row.is_sample, false);
  assert.equal(row.is_archived, false);
  // What the caller DID supply is kept.
  assert.equal(row.care_type, 'hospice');
});

test('a payload naming a field the contract decides is refused, not ignored', async () => {
  // Refused rather than stripped, because a caller who names `agency_id`
  // believes it took effect.
  for (const field of PATIENT_CREATE_RESERVED) {
    await refusal(create(ADMIN_A, `req-reserved-${field}`, { [field]: 'agency-b' }),
      'PENNSYNC_PATIENT_FIELD_RESERVED');
  }
  // And a field no client may supply at all — these are the columns the
  // original's own comment calls out as deliberately absent.
  for (const field of ['created_by_user_id', 'patient_creation_key', 'assigned_nurses',
    'data_completeness_score', 'risk_predict_claimed_by', 'merged_into_id']) {
    assert.ok(!PATIENT_CREATE_WRITABLE.includes(field), `${field} is not writable`);
    await refusal(create(ADMIN_A, `req-unknown-${field}`, { [field]: 'x' }),
      'PENNSYNC_PATIENT_FIELD_UNKNOWN');
  }
});

test('only the roles that may create a patient may create one', async () => {
  assert.equal((await create(ADMIN_A, 'req-role-admin')).created, true);
  assert.equal((await create(CLINICIAN_A, 'req-role-clinician')).created, true);
  await refusal(create(SOCIAL_A, 'req-role-social'), 'PENNSYNC_PATIENT_FORBIDDEN');
  // The agency is asked of the authority store, never of the request.
  await refusal(create(ADMIN_B, 'req-role-other', {}, A), 'PENNSYNC_PATIENT_AGENCY_NOT_HELD');
  await refusal(create(ADMIN_A, 'req-role-elsewhere', {}, B), 'PENNSYNC_PATIENT_AGENCY_NOT_HELD');
});

test('a retry answers the same chart, and a reused id with different names is a conflict', async () => {
  const first = await create(CLINICIAN_A, 'req-idem-1', { medical_record_number: 'MRN-1' });
  const again = await create(CLINICIAN_A, 'req-idem-1', { medical_record_number: 'MRN-1' });
  assert.equal(again.created, false, 'a retry does not make a second chart');
  assert.deepEqual(again.patient, first.patient);
  // Different names under the same request id would silently discard this
  // request's data if the first chart were answered.
  await refusal(create(CLINICIAN_A, 'req-idem-1', { first_name: 'Grace' }),
    'PENNSYNC_PATIENT_REQUEST_CONFLICT');
  // The key carries the agency and the user, so another caller's identical
  // request id is a different key and makes its own chart.
  const other = await create(ADMIN_A, 'req-idem-1');
  assert.equal(other.created, true);
  assert.notEqual(other.patient.id, first.patient.id);
});

test('a retry whose chart the caller can no longer open is a conflict, not a second chart', async () => {
  // The lookup reads under the policies and the unique index does not, so a
  // key whose chart this caller cannot open misses the lookup and then hits
  // the index. That is exactly the path a lost concurrency race takes, reached
  // here without two connections — and the answer is the honest one: the
  // caller cannot be shown the chart, so they are not told it exists either.
  const id = (await create(CLINICIAN_A, 'req-revoked-1')).patient.id;
  const grants = async () => (await db.query(
    'select count(*)::int as n from pennsync_private.chart_assignment')).rows[0].n;
  // A COHERENT revocation, per D33's lifecycle check.
  await db.query(`update pennsync_private.chart_assignment
    set status = 'revoked', last_action = 'revoke', last_reason = 'test withdrawal',
      revoked_at = clock_timestamp(), version = version + 1 where patient_id = $1`, [id]);
  const before = await grants();
  await refusal(create(CLINICIAN_A, 'req-revoked-1'), 'PENNSYNC_PATIENT_REQUEST_CONFLICT');
  // One chart for one key, which is what the index is for. Without it this
  // contract would have made a second and answered it as if it were the first.
  assert.equal((await db.query(
    `select count(*)::int as n from ${SCHEMA}."patient" where "patient_creation_key" like $1`,
    ['%:req-revoked-1'])).rows[0].n, 1);
  assert.equal(await grants(), before, 'the refused attempt took its claim with it');
});

test('a malformed request never reaches the table', async () => {
  const before = (await db.query(`select count(*)::int as n from ${SCHEMA}."patient"`)).rows[0].n;
  await refusal(create(ADMIN_A, ''), 'PENNSYNC_PATIENT_REQUEST_ID_INVALID');
  await refusal(create(ADMIN_A, 'has spaces'), 'PENNSYNC_PATIENT_REQUEST_ID_INVALID');
  await refusal(create(ADMIN_A, 'req-noname', { first_name: '' }), 'PENNSYNC_PATIENT_NAME_REQUIRED');
  await refusal(create(ADMIN_A, 'req-badtype', { date_of_birth: 'not-a-date' }),
    'PENNSYNC_PATIENT_FIELD_INVALID');
  await refusal(create(ADMIN_A, 'req-badstatus', { care_type: 'not_a_care_type' }),
    'violates check constraint|PENNSYNC_PATIENT');
  assert.equal((await db.query(`select count(*)::int as n from ${SCHEMA}."patient"`)).rows[0].n, before,
    'nothing was written');
});

test('the chart and its care-team seat are one transaction, so neither is left behind', async () => {
  // A refusal after the claim would otherwise leave a grant with no chart.
  // `req-badtype` fails inside `jsonb_populate_record`, which is after the
  // role and field checks and before the insert — the narrowest window there
  // is, and the one worth proving.
  const grants = async () => (await db.query(
    'select count(*)::int as n from pennsync_private.chart_assignment')).rows[0].n;
  const before = await grants();
  await refusal(create(CLINICIAN_A, 'req-atomic-1', { admission_date: 'not-a-date' }),
    'PENNSYNC_PATIENT_FIELD_INVALID');
  assert.equal(await grants(), before, 'the claim rolled back with the insert');
  // And the successful path leaves exactly one of each.
  const answer = await create(CLINICIAN_A, 'req-atomic-2');
  assert.equal(await grants(), before + 1);
  assert.equal((await db.query(
    'select count(*)::int as n from pennsync_private.chart_assignment where patient_id = $1',
    [answer.patient.id])).rows[0].n, 1);
});

test('the bridge takes an agency and nothing else, so no caller can name a chart', () => {
  // Stated against the signature rather than the behaviour, because the
  // ABSENCE of a parameter is what makes naming an existing chart impossible.
  // A caller who could supply the id would name a chart that already exists
  // and the grant would hand them somebody else's record; a caller who could
  // supply a person would put somebody else on a care team. Neither argument
  // exists, and that is the property to keep.
  const sql = readFileSync(resolve(repository, CLAIM), 'utf8');
  // Read the declared parameters rather than scanning the body, so this says
  // what it means: an earlier version matched `app_id` inside a column name.
  const signature = sql.match(/create function pennsync_private\.claim_new_chart\(([^)]*)\)/);
  assert.ok(signature, 'the bridge is declared');
  assert.deepEqual(signature[1].split(',').map(part => part.trim()), ['p_agency text'],
    'one parameter, and it is the agency');
  // And it has no public wrapper at all: the only caller is a contract, so a
  // client cannot claim without creating and leave a grant behind.
  assert.ok(!/create function "?public"?\./.test(sql), 'the bridge is not client surface');
});

test('a grant records that somebody was given a chart, and cannot be rewritten', async () => {
  // Access is withdrawn by setting `status`, which leaves the record of the
  // grant intact — the same provenance rule its sibling has, and the reason
  // the obvious test cleanup does not work.
  const id = (await create(CLINICIAN_A, 'req-provenance-1')).patient.id;
  await assert.rejects(() => db.query(
    'update pennsync_private.chart_assignment set patient_id = $1 where patient_id = $2',
    ['rewritten', id]));
  await assert.rejects(() => db.query(
    'delete from pennsync_private.chart_assignment where patient_id = $1', [id]));
  await db.query(`update pennsync_private.chart_assignment
    set status = 'revoked', last_action = 'revoke', last_reason = 'test withdrawal',
      revoked_at = clock_timestamp(), version = version + 1 where patient_id = $1`, [id]);
  // And revoking closes the chart, through the read contract the caller uses.
  assert.equal((await as(CLINICIAN_A, GET, [A, 'display', id]))[0].result, null,
    'a revoked seat closes the chart it opened');
});

test('no caller role reaches the bridge, and the contract is the only way in', async () => {
  const { rows } = await db.query(`select r.rolname, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join unnest(array['anon','authenticated','service_role','public']) as r(rolname)
    where n.nspname = 'pennsync_private' and p.proname = 'claim_new_chart'
      and has_function_privilege(r.rolname, p.oid, 'execute')`);
  assert.deepEqual(rows, [], 'the bridge answers to the record owner alone');
  // Usage on the private schema buys the record owner no table anywhere.
  const { rows: tables } = await db.query(`select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'pennsync_private' and c.relkind = 'r'
      and has_table_privilege('pennsync_records_owner', c.oid, 'select,insert,update,delete')`);
  assert.deepEqual(tables, [], 'usage on a schema grants nothing on its objects');
  // And the staging surface still reaches its own inner functions, which a
  // blanket revoke here would have taken away.
  const { rows: staging } = await db.query(
    `select has_function_privilege('authenticated',
       'pennsync_private.context(text,text)', 'execute') as ok`);
  assert.deepEqual(staging, [{ ok: true }], 'the staging surface is untouched');
});
