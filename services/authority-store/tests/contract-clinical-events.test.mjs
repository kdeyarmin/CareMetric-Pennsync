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
 * The two chart reads a model analyses.
 *
 * Both capabilities scan five thousand `User` rows to decide whether the
 * patient is in the caller's agency, and both interpolate the patient straight
 * out of a full service-role row. The chart policies answer the first; D62's
 * purpose projection bounds the second. The third property is the one that
 * would be easy to lose: every column that reaches a prompt is NAMED, so
 * `source_text` — the raw note an event was extracted from — never goes to a
 * model that was asked about a structured summary.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const PURPOSE = 'services/authority-store/supabase/record-migrations/'
  + '20260920050000_patient_purpose_policy.sql';
const CLINICAL = 'services/authority-store/supabase/record-migrations/'
  + '20260920430000_contract_clinical_event_read.sql';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CLINICIAN_A = 2; const CLINICIAN_EMPTY = 3; const ADMIN_B = 4;
const REVIEW = 'select "public"."pennsync_contract_clinical_event_review"($1,$2) as result';
const TRENDS = 'select "public"."pennsync_contract_clinical_trend_context"($1,$2) as result';
const A = 'agency-a'; const B = 'agency-b';
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, PURPOSE, CLINICAL]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  for (const [id, agency, first, last] of [
    ['patient-a1', A, 'Ada', 'Lovelace'],
    ['patient-a2', A, 'Grace', 'Hopper'],
    ['patient-b1', B, 'Katherine', 'Johnson'],
  ]) {
    await db.query(`insert into ${SCHEMA}."patient"("source_app_id","id","agency_id",
      "first_name","last_name","primary_diagnosis","current_medications","address")
      values ($1,$2,$3,$4,$5,'CHF','[{"name":"Lasix"}]'::jsonb,'12 Ada Way')`,
    [APP, id, agency, first, last]);
  }
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
    await db.exec('commit');
    return rows[0].result;
  } catch (error) { await db.exec('rollback'); throw error; }
}
const review = (n, patient = 'patient-a1', agency = A) => as(n, REVIEW, [agency, patient]);
const trends = (n, patient = 'patient-a1', agency = A) => as(n, TRENDS, [agency, patient]);
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);

let nextId = 0;
const event = (patient, overrides = {}) => {
  const row = {
    event_date: '2026-06-01',
    event_type: 'symptom_new', event_title: 'Dyspnea on exertion',
    event_description: 'Short of breath climbing stairs', severity: 'medium',
    structured_data: null, extraction_confidence: 90, verified: false,
    source_text: 'RAW NOTE TEXT THE MODEL MUST NEVER SEE', ...overrides,
  };
  const keys = Object.keys(row);
  return db.query(
    `insert into ${SCHEMA}."clinical_event"("source_app_id","id","patient_id",
      ${keys.map(k => `"${k}"`).join(',')})
     values ($1,$2,$3,${keys.map((unused, i) => `$${i + 4}`).join(',')})`,
    [APP, `event-${nextId += 1}`, patient,
      ...keys.map(k => (row[k] !== null && typeof row[k] === 'object'
        ? JSON.stringify(row[k]) : row[k]))]);
};
const visit = (patient, date, vitals) => db.query(
  `insert into ${SCHEMA}."visit"("source_app_id","id","agency_id","patient_id",
     "visit_date","vital_signs") values ($1,$2,$3,$4,$5,$6)`,
  [APP, `visit-${nextId += 1}`, A, patient, date,
    vitals === null ? null : JSON.stringify(vitals)]);
const reset = async () => {
  for (const table of ['clinical_event', 'visit']) {
    await db.query(`delete from ${SCHEMA}."${table}"`);
  }
};

test('the chart decides, for both reads', async () => {
  await reset();
  await event('patient-a1');
  for (const read of [review, trends]) {
    await refusal(read(CLINICIAN_EMPTY), 'PENNSYNC_CLINICAL_PATIENT_NOT_VISIBLE');
    await refusal(read(CLINICIAN_A, 'patient-a2'), 'PENNSYNC_CLINICAL_PATIENT_NOT_VISIBLE');
    await refusal(read(CLINICIAN_A, 'patient-b1'), 'PENNSYNC_CLINICAL_PATIENT_NOT_VISIBLE');
    await refusal(read(ADMIN_B, 'patient-a1', A), 'PENNSYNC_CLINICAL_AGENCY_NOT_HELD');
    await refusal(read(CLINICIAN_A, 'patient a1!'), 'PENNSYNC_CLINICAL_SUBJECT_INVALID');
  }
  // And the purpose's own role gate is the gate (D62).
  await db.query(`update pennsync_private.membership set tenant_role = 'office_staff'
    where id = 'membership-2'`);
  await refusal(review(CLINICIAN_A), 'PENNSYNC_CLINICAL_PURPOSE_FORBIDDEN');
  await refusal(trends(CLINICIAN_A), 'PENNSYNC_CLINICAL_PURPOSE_FORBIDDEN');
  await db.query(`update pennsync_private.membership set tenant_role = 'clinician'
    where id = 'membership-2'`);
});

test('the patient half is the purpose s projection, and only that', async () => {
  await reset();
  await event('patient-a1');
  for (const read of [review, trends]) {
    const result = await read(CLINICIAN_A);
    assert.deepEqual(Object.keys(result.patient).sort(),
      ['current_medications', 'id', 'patient_name', 'primary_diagnosis']);
    assert.equal(result.patient.patient_name, 'Ada Lovelace');
    assert.equal(result.patient.primary_diagnosis, 'CHF');
    assert.deepEqual(result.patient.current_medications, [{ name: 'Lasix' }]);
    assert.equal(JSON.stringify(result).includes('12 Ada Way'), false);
  }
});

test('an event reaches the prompt by named column, never by star', async () => {
  // The property worth the file: `source_text` is the raw note the event was
  // extracted from, and a `select *` would hand it to a model that was asked
  // about a structured summary.
  await reset();
  await event('patient-a1', { structured_data: { dose: '40mg' } });
  const result = await review(CLINICIAN_A);
  assert.equal(result.events.length, 1);
  assert.deepEqual(Object.keys(result.events[0]).sort(),
    ['description', 'event_date', 'extraction_confidence', 'id', 'severity',
      'structured_data', 'title', 'type']);
  assert.equal(JSON.stringify(result).includes('RAW NOTE TEXT'), false);
  assert.deepEqual(result.events[0].structured_data, { dose: '40mg' });
  const trend = await trends(CLINICIAN_A);
  assert.deepEqual(Object.keys(trend.events[0]).sort(),
    ['date', 'description', 'group', 'severity', 'title']);
  assert.equal(JSON.stringify(trend).includes('RAW NOTE TEXT'), false);
});

test('the review reads the unverified events, newest first', async () => {
  await reset();
  await event('patient-a1', { event_date: '2026-01-01', event_title: 'Older' });
  await event('patient-a1', { event_date: '2026-07-01', event_title: 'Newer' });
  await event('patient-a1', { event_title: 'Verified', verified: true });
  // The original filters `verified: false`, which a null is not.
  await event('patient-a1', { event_title: 'Unset', verified: null });
  await event('patient-a2', { event_title: 'Another chart' });
  const result = await review(CLINICIAN_A);
  assert.deepEqual(result.events.map(e => e.title), ['Newer', 'Older']);
  assert.equal(result.total_events, 2);
});

test('the trends read groups each event once, the way the original filters', async () => {
  await reset();
  await event('patient-a1', { event_type: 'medication_change', event_title: 'M' });
  await event('patient-a1', { event_type: 'symptom_new', event_title: 'S' });
  await event('patient-a1', { event_type: 'lab_result', event_title: 'L' });
  await event('patient-a1', { event_type: 'wound_new', event_title: 'W' });
  await event('patient-a1', { event_type: null, event_title: 'N' });
  // The original tests `event_type?.includes(...)`, a substring, so a
  // `medication_change` is a medication event and a null type is nothing.
  const result = await trends(CLINICIAN_A);
  assert.deepEqual(
    Object.fromEntries(result.events.map(e => [e.title, e.group])),
    { M: 'medication', S: 'symptom', L: 'lab', W: 'other', N: 'other' });
  // A verified event is in the trends read: only the review filters on it.
  await event('patient-a1', { event_title: 'V', verified: true });
  assert.equal((await trends(CLINICIAN_A)).events.length, 6);
});

test('a visit with no vitals never leaves the store', async () => {
  await reset();
  await visit('patient-a1', '2026-05-01', { bp: '140/90' });
  await visit('patient-a1', '2026-06-01', null);
  await visit('patient-a1', '2026-07-01', { bp: '132/84' });
  await visit('patient-a2', '2026-07-02', { bp: '110/70' });
  const result = await trends(CLINICIAN_A);
  assert.deepEqual(result.vitals_history.map(v => v.vitals.bp), ['132/84', '140/90']);
  assert.equal(result.vitals_history.length, 2);
});

test('an empty chart is an empty answer, not a refusal', async () => {
  await reset();
  assert.deepEqual(await review(CLINICIAN_A), {
    success: true, events: [], total_events: 0,
    patient: { id: 'patient-a1', patient_name: 'Ada Lovelace',
      primary_diagnosis: 'CHF', current_medications: [{ name: 'Lasix' }] },
  });
  const trend = await trends(CLINICIAN_A);
  assert.deepEqual(trend.events, []);
  assert.deepEqual(trend.vitals_history, []);
});
