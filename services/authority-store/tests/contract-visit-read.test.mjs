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
  VISIT_EXACT_PURPOSE_POLICY, VISIT_LIST_PURPOSE_POLICY,
} from '../../pennsync-api/read-purpose-policy.mjs';

/**
 * The authorized visit read (`contract_visit_list` / `contract_visit_get`).
 *
 * The same two authorizations as the patient read and one thing that is only
 * visible here: `visit` carries its own `agency_id` AND a `patient_id`, so D24
 * wrote the chart narrowing onto the table rather than leaving it to be
 * inherited. The fixture therefore includes a visit with a NULL patient — a
 * visit with no subject is not yet anybody's chart and stays agency-scoped —
 * which is the case a narrowing written only for the reference path would get
 * wrong in the dangerous direction.
 *
 * The other thing under test is the shared purpose name. `compliance_review`
 * exists on both capabilities and means fourteen fields on one visit and
 * eight on a row of a list. If either contract could answer the other's
 * purpose, a list would widen by six fields per row under a name that already
 * works.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const CONTRACT = 'services/authority-store/supabase/record-migrations/20260920080000_contract_visit_read.sql';
const PATIENT_POLICY = POLICY_SQL_FILES.patient;
const PATIENT_CONTRACT = 'services/authority-store/supabase/record-migrations/20260920060000_contract_patient_read.sql';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const pid = n => `7aac00000000${String(n).padStart(12, '0')}`;
const vid = n => `8aac00000000${String(n).padStart(12, '0')}`;
const ADMIN_A = 1; const CLINICIAN_A = 2; const ADMIN_B = 4;
const LIST = 'select "public"."pennsync_contract_visit_list"($1,$2,$3,$4,$5,$6) as result';
const GET = 'select "public"."pennsync_contract_visit_get"($1,$2,$3) as result';
const A = 'agency-a'; const B = 'agency-b';
let db;

/** Two patients in agency-a: 1 is the clinician's, 2 is not. */
const PATIENTS = [
  { id: pid(1), agency_id: A }, { id: pid(2), agency_id: A }, { id: pid(3), agency_id: B },
];
/**
 * Six visits on the clinician's patient, two on the one they are not assigned
 * to, one with no patient at all, and one in the other agency.
 */
const VISITS = [
  ...Array.from({ length: 6 }, (unused, index) =>
    ({ id: vid(index + 1), agency_id: A, patient_id: pid(1), status: 'completed' })),
  { id: vid(7), agency_id: A, patient_id: pid(2), status: 'completed' },
  { id: vid(8), agency_id: A, patient_id: pid(2), status: 'scheduled' },
  { id: vid(9), agency_id: A, patient_id: null, status: 'scheduled' },
  { id: vid(10), agency_id: A, patient_id: pid(1), status: 'cancelled' },
  { id: vid(11), agency_id: A, patient_id: pid(1), status: 'completed', is_sample: true },
  { id: vid(12), agency_id: B, patient_id: pid(3), status: 'completed' },
];

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, PATIENT_POLICY,
    PATIENT_CONTRACT, POLICY_SQL_FILES.visit, CONTRACT]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  for (const row of PATIENTS) {
    await db.query(`insert into ${SCHEMA}."patient"
      ("source_app_id","id","agency_id","status","is_sample","is_archived","first_name","last_name")
      values ($1,$2,$3,'active',false,false,'First','Last')`, [APP, row.id, row.agency_id]);
  }
  for (const row of VISITS) {
    await db.query(`insert into ${SCHEMA}."visit"
      ("source_app_id","id","agency_id","patient_id","status","is_sample",
       "visit_type","visit_date","compliance_score","compliance_issues","updated_date")
      values ($1,$2,$3,$4,$5,$6,'routine_visit','2026-09-01',82,'[]'::jsonb,'2026-09-02T00:00:00Z')`,
    [APP, row.id, row.agency_id, row.patient_id, row.status, row.is_sample ?? false]);
  }
  // The clinician's care team: patient 1 only.
  await db.query(`insert into pennsync_private.chart_assignment
    (app_id,agency_id,patient_id,membership_id,status,changed_by)
    values ($1,$2,$3,'membership-2','active',$4)`, [APP, A, pid(1), uid(1)]);
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
const listAs = async (n, { agency = A, purpose = 'schedule', patient = null, status = null,
  pageSize = 25, after = null } = {}) =>
  (await as(n, LIST, [agency, purpose, patient, status, pageSize, after]))[0].result;
const getAs = async (n, id, { agency = A, purpose = 'schedule' } = {}) =>
  (await as(n, GET, [agency, purpose, id]))[0].result;

test('the purpose decides the fields, and a list row is narrower than one visit', () => {
  // Pinned from the committed policy so the assertion below is about the
  // contract rather than about what this test believes the policy says.
  assert.equal(VISIT_LIST_PURPOSE_POLICY.compliance_review.fields.length, 8);
  assert.equal(VISIT_EXACT_PURPOSE_POLICY.compliance_review.fields.length, 14);
});

test('the projection is exactly the purpose, on both capabilities', async () => {
  const [row] = (await listAs(ADMIN_A, { purpose: 'schedule' })).visits;
  assert.deepEqual(Object.keys(row).sort(), [...VISIT_LIST_PURPOSE_POLICY.schedule.fields].sort());
  const one = await getAs(ADMIN_A, vid(1), { purpose: 'compliance_review' });
  assert.deepEqual(Object.keys(one).sort(),
    [...VISIT_EXACT_PURPOSE_POLICY.compliance_review.fields].sort());
  // The same word, six more fields. That is why the two policies exist.
  const listed = (await listAs(ADMIN_A, { purpose: 'compliance_review' })).visits[0];
  assert.ok(Object.keys(one).length > Object.keys(listed).length);
  assert.ok(!Object.hasOwn(listed, 'compliance_issues'),
    'a compliance worklist does not carry every visit findings');
});

test('neither capability answers the other vocabulary', async () => {
  // `vitals_trend` is a list purpose and `documentation` is on both. A single
  // read asked for a list-only purpose is refused, and the reverse too.
  await refusal(getAs(ADMIN_A, vid(1), { purpose: 'vitals_trend' }), 'PENNSYNC_VISIT_PURPOSE_INVALID');
  await refusal(listAs(ADMIN_A, { purpose: 'nonexistent' }), 'PENNSYNC_VISIT_PURPOSE_INVALID');
  // And a patient purpose is not a visit purpose, even though both exist.
  await refusal(listAs(ADMIN_A, { purpose: 'roster' }), 'PENNSYNC_VISIT_PURPOSE_INVALID');
});

test('D24 narrows visits to the care team, and a visit with no subject stays agency-scoped', async () => {
  const admin = (await listAs(ADMIN_A, { pageSize: 50 })).visits.map(row => row.id);
  const clinician = (await listAs(CLINICIAN_A, { pageSize: 50 })).visits.map(row => row.id);
  // The admin opens every visit in the agency; the clinician opens patient 1's.
  assert.ok(admin.includes(vid(7)) && admin.includes(vid(8)), 'an agency_admin opens every visit');
  assert.ok(!clinician.includes(vid(7)) && !clinician.includes(vid(8)),
    'a clinician does not open a visit of a patient they are not assigned to');
  assert.deepEqual(clinician, [vid(1), vid(2), vid(3), vid(4), vid(5), vid(6), vid(9), vid(10)],
    'their own patient visits, plus the one with no subject');
  // The unsubjected visit is the case a narrowing written only for the
  // reference path gets wrong: a visit taken before a patient exists is not
  // yet anybody's chart, so it is agency-scoped rather than invisible.
  assert.ok(clinician.includes(vid(9)) && admin.includes(vid(9)));
  assert.notEqual(await getAs(CLINICIAN_A, vid(9)), null);
  assert.equal(await getAs(CLINICIAN_A, vid(7)), null, 'and not-yours is null, not a refusal');
});

test('the agency is asked of the authority store, and a stranger is refused', async () => {
  assert.ok(!(await listAs(ADMIN_A, { pageSize: 50 })).visits.some(row => row.id === vid(12)));
  await refusal(listAs(ADMIN_B, { agency: A }), 'PENNSYNC_VISIT_AGENCY_NOT_HELD');
  await refusal(getAs(ADMIN_B, vid(1), { agency: A }), 'PENNSYNC_VISIT_AGENCY_NOT_HELD');
  assert.equal(await getAs(ADMIN_A, vid(12)), null, 'another agency visit is not there');
});

test('a sample visit is never a read, and the filters are the ones the column can hold', async () => {
  const listed = (await listAs(ADMIN_A, { pageSize: 50 })).visits.map(row => row.id);
  assert.ok(!listed.includes(vid(11)), 'sample data is not a visit');
  assert.equal(await getAs(ADMIN_A, vid(11)), null);
  // The patient filter is what a chart's visit history is.
  assert.deepEqual((await listAs(ADMIN_A, { patient: pid(2), pageSize: 50 })).visits.map(row => row.id),
    [vid(7), vid(8)]);
  assert.deepEqual((await listAs(ADMIN_A, { status: 'cancelled', pageSize: 50 })).visits
    .map(row => row.id), [vid(10)]);
  for (const status of ['merged', 'deleted', '']) {
    await refusal(listAs(ADMIN_A, { status }), 'PENNSYNC_VISIT_STATUS_INVALID');
  }
  await refusal(listAs(ADMIN_A, { patient: 'nope' }), 'PENNSYNC_VISIT_SUBJECT_INVALID');
  await refusal(getAs(ADMIN_A, 'nope'), 'PENNSYNC_VISIT_SUBJECT_INVALID');
  await refusal(getAs(ADMIN_A, null), 'PENNSYNC_VISIT_SUBJECT_INVALID');
});

test('the page is bounded by the purpose and the walk tiles without repeating', async () => {
  assert.equal(VISIT_LIST_PURPOSE_POLICY.compliance_review.page_size, 25);
  await refusal(listAs(ADMIN_A, { purpose: 'compliance_review', pageSize: 26 }),
    'PENNSYNC_VISIT_PAGE_SIZE_INVALID');
  assert.ok((await listAs(ADMIN_A, { purpose: 'schedule', pageSize: 50 })).visits.length > 0);
  for (const pageSize of [0, -1, null]) {
    await refusal(listAs(ADMIN_A, { pageSize }), 'PENNSYNC_VISIT_PAGE_SIZE_INVALID');
  }
  const seen = [];
  let after = null;
  for (let page = 0; page < 12; page += 1) {
    const result = await listAs(ADMIN_A, { pageSize: 3, after });
    seen.push(...result.visits.map(row => row.id));
    after = result.next;
    if (after === null) break;
  }
  assert.equal(after, null, 'the walk ends');
  assert.deepEqual(seen, [...new Set(seen)], 'nobody is repeated');
  assert.deepEqual(seen, (await listAs(ADMIN_A, { pageSize: 50 })).visits.map(row => row.id));
});

test('a continuation that no longer names a visible row is refused', async () => {
  await refusal(listAs(ADMIN_A, { after: 'not-an-id' }), 'PENNSYNC_VISIT_CURSOR_INVALID');
  await refusal(listAs(ADMIN_A, { after: vid(99) }), 'PENNSYNC_VISIT_CURSOR_UNKNOWN');
  // It follows the filter as well as the caller: visit 10 is cancelled, so it
  // cannot continue a completed-only walk.
  assert.ok((await listAs(ADMIN_A, { after: vid(10), pageSize: 3 })).visits !== undefined);
  await refusal(listAs(ADMIN_A, { after: vid(10), status: 'completed' }), 'PENNSYNC_VISIT_CURSOR_UNKNOWN');
  await refusal(listAs(ADMIN_A, { after: vid(11) }), 'PENNSYNC_VISIT_CURSOR_UNKNOWN');
});

test('no caller role may reach the policy or the gate; the contracts are the way in', async () => {
  const { rows } = await db.query(`select p.proname, r.rolname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join unnest(array['anon','authenticated','service_role','public']) as r(rolname)
    where n.nspname = $1 and p.proname like 'visit_%'
      and has_function_privilege(r.rolname, p.oid, 'execute')`, [SCHEMA]);
  assert.deepEqual(rows, [], 'the policy and the gate answer to the contracts alone');
  for (const name of ['pennsync_contract_visit_list', 'pennsync_contract_visit_get']) {
    const { rows: granted } = await db.query(
      `select has_function_privilege('authenticated', p.oid, 'execute') as ok
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = $1`, [name]);
    assert.deepEqual(granted.map(row => row.ok), [true], name);
  }
});
