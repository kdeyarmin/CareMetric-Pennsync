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
import { VISIT_CREATE_RESERVED, VISIT_CREATE_WRITABLE } from '../../pennsync-api/read-purpose-policy.mjs';

/**
 * Scheduling a visit (`contract_visit_create`).
 *
 * Two authorizations, and the cases keep them apart because each looks
 * sufficient alone:
 *
 * - **The role** is the original's, and it is NARROWER than D24. A
 *   `social_worker` or `spiritual_care` worker opens the charts they are
 *   assigned to — D24 says so — and the original does not let them schedule.
 *   So the role gate is doing real work rather than restating the policies.
 * - **The chart** is D24, through the `patient` and `visit` policies. Nothing
 *   in the contract asks who is on the care team.
 *
 * And one thing that is neither: a visit is SCHEDULING INPUT. Documentation,
 * workflow status and handoff history are server-owned, which is why the
 * writable set is five fields out of a forty-seven column table.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const VISIT = 'services/authority-store/supabase/record-migrations/20260920140000_contract_visit_create.sql';
const VISIT_READ = 'services/authority-store/supabase/record-migrations/20260920080000_contract_visit_read.sql';
// The visit read contract asks `patient_purpose_gate`, which the patient
// contract owns: a visit is only reachable through the chart it names.
const PATIENT_CONTRACT = 'services/authority-store/supabase/record-migrations/20260920060000_contract_patient_read.sql';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const pid = n => `7aac00000000${String(n).padStart(12, '0')}`;
const ADMIN_A = 1; const CLINICIAN_A = 2; const SOCIAL_A = 3; const ADMIN_B = 4;
const CREATE = 'select "public"."pennsync_contract_visit_create"($1,$2,$3,$4) as result';
const GET = 'select "public"."pennsync_contract_visit_get"($1,$2,$3) as result';
const PATIENT_GET = 'select "public"."pennsync_contract_patient_get"($1,$2,$3) as result';
const A = 'agency-a'; const B = 'agency-b';
/** Assigned to the clinician, in the agency but not assigned, and elsewhere. */
const MINE = pid(1); const THEIRS = pid(2); const ELSEWHERE = pid(3);
const SCHEDULED = { visit_date: '2026-10-01', visit_type: 'routine_visit' };
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE,
    POLICY_SQL_FILES.patient, PATIENT_CONTRACT, POLICY_SQL_FILES.visit, VISIT_READ, VISIT]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  // Agency-a gets a social worker, who opens an assigned chart under D24 and
  // may not schedule on it.
  await db.exec(`update pennsync_private.membership set tenant_role = 'social_worker'
    where id = 'membership-3'`);
  for (const [id, agency, status] of [
    [MINE, A, 'active'], [THEIRS, A, 'active'], [ELSEWHERE, B, 'active'],
    [pid(4), A, 'discharged'], [pid(5), A, 'active'],
  ]) {
    await db.query(`insert into ${SCHEMA}."patient"
      ("source_app_id","id","agency_id","status","is_sample","is_archived","first_name","last_name")
      values ($1,$2,$3,$4,false,false,'Ada','Lovelace')`, [APP, id, agency, status]);
  }
  await db.query(`update ${SCHEMA}."patient" set "is_archived" = true where "id" = $1`, [pid(5)]);
  // The clinician's care team, and the social worker's.
  for (const [id, membership] of [[MINE, 'membership-2'], [pid(4), 'membership-2'],
    [pid(5), 'membership-2'], [MINE, 'membership-3']]) {
    await db.query(`insert into pennsync_private.chart_assignment
      (app_id,agency_id,patient_id,membership_id,status,changed_by)
      values ($1,$2,$3,$4,'active',$5)`, [APP, A, id, membership, uid(1)]);
  }
});
after(async () => db?.close());

/** A create COMMITS, because the row it writes is what the next read looks for. */
async function create(n, patientId, request, visit = SCHEDULED, agency = A) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
    const { rows } = await db.query(CREATE, [agency, patientId, request, JSON.stringify(visit)]);
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
const visits = async () => (await db.query(
  `select count(*)::int as n from ${SCHEMA}."visit"`)).rows[0].n;

test('a clinician schedules on a chart they are assigned, and can then open it', async () => {
  const answer = await create(CLINICIAN_A, MINE, 'req-visit-1',
    { ...SCHEDULED, visit_time: '09:00' });
  assert.equal(answer.created, true);
  assert.match(answer.visit.id, /^[a-f0-9]{24}$/);
  assert.equal(answer.visit.patient_id, MINE);
  assert.equal(answer.visit.agency_id, A);
  assert.equal(answer.visit.status, 'scheduled');
  assert.equal(answer.visit.visit_time, '09:00');
  assert.equal(answer.visit.client_request_id, 'req-visit-1');
  // The read contract beside it serves what this one wrote.
  const seen = (await as(CLINICIAN_A, GET, [A, 'schedule', answer.visit.id]))[0].result;
  assert.equal(seen?.id, answer.visit.id);
});

test('the contract decides lifecycle, provenance and tenancy', async () => {
  const answer = await create(ADMIN_A, THEIRS, 'req-visit-stamp');
  const { rows } = await db.query(
    `select "agency_id","created_by_user_id","created_by_user_email_normalized","created_by",
      "status","emr_handoff_status","emr_handoff_history","documentation_review_ack",
      "is_sample","client_request_id" from ${SCHEMA}."visit" where "id" = $1`, [answer.visit.id]);
  const row = rows[0];
  assert.equal(row.agency_id, A);
  assert.equal(row.created_by, row.created_by_user_email_normalized);
  assert.equal(row.status, 'scheduled');
  // Server-owned from the first row, which is what makes the update
  // capability's transitions meaningful.
  assert.equal(row.emr_handoff_status, 'not_started');
  assert.deepEqual(row.emr_handoff_history, []);
  assert.equal(row.documentation_review_ack, null);
  assert.equal(row.is_sample, false);
  assert.equal(row.client_request_id, 'req-visit-stamp');
});

test('the role gate is the original\'s and is narrower than the chart', async () => {
  // The social worker IS on this chart's care team — D24 puts them there and
  // the patient read contract shows it. The original still does not let them
  // schedule, which is the whole reason this contract carries a role gate of
  // its own rather than leaning on the policies.
  assert.equal((await as(SOCIAL_A, PATIENT_GET, [A, 'display', MINE]))[0].result?.id, MINE,
    'D24 opens this chart to the social worker');
  await refusal(create(SOCIAL_A, MINE, 'req-visit-social'), 'PENNSYNC_VISIT_FORBIDDEN');
  // An admin and a manager reach every chart; a clinician reaches theirs.
  assert.equal((await create(ADMIN_A, THEIRS, 'req-visit-admin')).created, true);
  assert.equal((await create(CLINICIAN_A, MINE, 'req-visit-clin')).created, true);
  // The agency is asked of the authority store, never of the request.
  await refusal(create(ADMIN_B, MINE, 'req-visit-other'), 'PENNSYNC_VISIT_AGENCY_NOT_HELD');
  await refusal(create(ADMIN_A, ELSEWHERE, 'req-visit-elsewhere', SCHEDULED, B),
    'PENNSYNC_VISIT_AGENCY_NOT_HELD');
});

test('a chart the caller cannot open is the same answer as one that does not exist', async () => {
  const before = await visits();
  await refusal(create(CLINICIAN_A, THEIRS, 'req-visit-unassigned'),
    'PENNSYNC_VISIT_PATIENT_NOT_VISIBLE');
  await refusal(create(CLINICIAN_A, pid(9999), 'req-visit-missing'),
    'PENNSYNC_VISIT_PATIENT_NOT_VISIBLE');
  await refusal(create(ADMIN_A, ELSEWHERE, 'req-visit-crosstenant'),
    'PENNSYNC_VISIT_PATIENT_NOT_VISIBLE');
  assert.equal(await visits(), before, 'nothing was written');
});

test('a visit is scheduled against an active chart and against nothing else', async () => {
  // The original schedules against `status === 'active'`. A discharged chart
  // is still readable and is not something to put a future visit on.
  await refusal(create(CLINICIAN_A, pid(4), 'req-visit-discharged'),
    'PENNSYNC_VISIT_PATIENT_UNAVAILABLE');
  await refusal(create(CLINICIAN_A, pid(5), 'req-visit-archived'),
    'PENNSYNC_VISIT_PATIENT_UNAVAILABLE');
});

test('a payload naming a field the contract decides is refused, not ignored', async () => {
  for (const field of VISIT_CREATE_RESERVED) {
    await refusal(create(ADMIN_A, MINE, `req-res-${field}`, { ...SCHEDULED, [field]: 'x' }),
      'PENNSYNC_VISIT_FIELD_RESERVED');
  }
  // `status` is among them, so even the one value the original accepted is
  // refused here — that is divergence 2, and it is how a caller learns the
  // field is not theirs.
  assert.ok(VISIT_CREATE_RESERVED.includes('status'));
  // And the columns a create may never write at all: documentation, workflow
  // and handoff are `updateAuthorizedVisit`'s, through transitions.
  for (const field of ['nurse_notes', 'emr_handoff_status', 'emr_handoff_history',
    'documentation_review_ack', 'compliance_score', 'created_by_user_id', 'is_sample',
    'ai_process_claimed_by', 'audio_url']) {
    assert.ok(!VISIT_CREATE_WRITABLE.includes(field), `${field} is not writable`);
    await refusal(create(ADMIN_A, MINE, `req-unk-${field}`, { ...SCHEDULED, [field]: 'x' }),
      'PENNSYNC_VISIT_FIELD_UNKNOWN');
  }
  // Five fields, and they are scheduling input.
  assert.deepEqual([...VISIT_CREATE_WRITABLE].sort(),
    ['end_time', 'start_time', 'visit_date', 'visit_time', 'visit_type']);
});

test('a retry answers the same visit, and a changed one is a conflict', async () => {
  const first = await create(CLINICIAN_A, MINE, 'req-idem-v1', { ...SCHEDULED, visit_time: '10:00' });
  const again = await create(CLINICIAN_A, MINE, 'req-idem-v1', { ...SCHEDULED, visit_time: '10:00' });
  assert.equal(again.created, false);
  assert.deepEqual(again.visit, first.visit);
  // A queue item replayed with a different time is not the same request.
  await refusal(create(CLINICIAN_A, MINE, 'req-idem-v1', { ...SCHEDULED, visit_time: '11:00' }),
    'PENNSYNC_VISIT_REQUEST_CONFLICT');
  await refusal(create(CLINICIAN_A, MINE, 'req-idem-v1',
    { ...SCHEDULED, visit_date: '2026-10-02', visit_time: '10:00' }),
  'PENNSYNC_VISIT_REQUEST_CONFLICT');
  // A visit whose handoff has since moved is no longer the same request
  // either: answering it would say the queue item took effect as sent.
  await db.query(
    `update ${SCHEMA}."visit" set "emr_handoff_status" = 'copied_to_emr' where "id" = $1`,
    [first.visit.id]);
  await refusal(create(CLINICIAN_A, MINE, 'req-idem-v1', { ...SCHEDULED, visit_time: '10:00' }),
    'PENNSYNC_VISIT_REQUEST_CONFLICT');
  // The triple carries the caller, so another one's identical queue id is a
  // different request and makes its own visit.
  const other = await create(ADMIN_A, MINE, 'req-idem-v1', { ...SCHEDULED, visit_time: '10:00' });
  assert.equal(other.created, true);
  assert.notEqual(other.visit.id, first.visit.id);
});

test('a visit with no request id is created and not deduped', async () => {
  // The original accepts one and simply does not dedupe it, unlike the
  // patient create, which requires a request id.
  const before = await visits();
  const first = await create(CLINICIAN_A, MINE, null);
  const second = await create(CLINICIAN_A, MINE, null);
  assert.equal(first.created, true);
  assert.equal(second.created, true);
  assert.notEqual(first.visit.id, second.visit.id);
  assert.equal(first.visit.client_request_id, null);
  assert.equal(await visits(), before + 2);
});

test('a malformed request never reaches the table', async () => {
  const before = await visits();
  for (const [patient, request, visit, code] of [
    ['', 'req-bad-1', SCHEDULED, 'PENNSYNC_VISIT_PATIENT_INVALID'],
    [MINE, 'has spaces', SCHEDULED, 'PENNSYNC_VISIT_REQUEST_ID_INVALID'],
    [MINE, 'req-bad-2', { visit_type: 'routine_visit' }, 'PENNSYNC_VISIT_DATE_INVALID'],
    [MINE, 'req-bad-3', { ...SCHEDULED, visit_date: '2026-02-30' }, 'PENNSYNC_VISIT_DATE_INVALID'],
    [MINE, 'req-bad-4', { ...SCHEDULED, visit_date: '10/01/2026' }, 'PENNSYNC_VISIT_DATE_INVALID'],
    [MINE, 'req-bad-5', { visit_date: '2026-10-01' }, 'PENNSYNC_VISIT_TYPE_INVALID'],
    [MINE, 'req-bad-6', { ...SCHEDULED, visit_type: 'not_a_type' }, 'PENNSYNC_VISIT_TYPE_INVALID'],
    [MINE, 'req-bad-7', { ...SCHEDULED, visit_time: 'x'.repeat(201) }, 'PENNSYNC_VISIT_FIELD_INVALID'],
    [MINE, 'req-bad-8', { ...SCHEDULED, visit_time: 9 }, 'PENNSYNC_VISIT_FIELD_INVALID'],
  ]) await refusal(create(ADMIN_A, patient, request, visit), code);
  await refusal(create(ADMIN_A, MINE, 'req-bad-9', null), 'PENNSYNC_VISIT_PAYLOAD_INVALID');
  await refusal(create(ADMIN_A, MINE, 'req-bad-10', ['visit_date']), 'PENNSYNC_VISIT_PAYLOAD_INVALID');
  assert.equal(await visits(), before, 'nothing was written');
});

test('the contract is the only way in, and it cannot be reached by a caller as itself', async () => {
  const sql = readFileSync(resolve(repository, VISIT), 'utf8');
  assert.match(sql, /grant execute on function\s+"pennsync_records"\.contract_visit_create/);
  const granted = async name => (await db.query(
    'select has_function_privilege($1,$2,$3) as ok', ['authenticated', name, 'execute'])).rows[0].ok;
  assert.equal(await granted('pennsync_records.visit_created(pennsync_records.visit)'), false);
  assert.equal(await granted('pennsync_records.visit_create_writable(text)'), false);
  assert.equal(await granted('public.pennsync_contract_visit_create(text,text,text,jsonb)'), true);
  // The original deletes the visit it just created when authority changed
  // underneath it. One transaction has nothing to compensate, so there is no
  // delete path at all — and a contract that can delete a clinical row is
  // worth not having.
  assert.equal(/delete\s+from/i.test(sql), false, 'no delete path');
});
