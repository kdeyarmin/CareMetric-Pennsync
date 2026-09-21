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
 * The chart export's read.
 *
 * Its whole point is that it has NO gate of its own: the original's three
 * tests — an address on the patient row, an `assigned_nurses` entry, and the
 * platform owner — are the three things D21, D22 and D24 removed, and the
 * policies answer what is left. So what is proved here is that the chart rule
 * really is the gate, and that a stale `assigned_nurses` address opens
 * nothing.
 *
 * And the projection, column by column, because this is the widest one in the
 * application and it reaches a model's prompt (D64).
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const MIGRATIONS = 'services/authority-store/supabase/record-migrations/';
const EXPORT = `${MIGRATIONS}20260920480000_contract_chart_export.sql`;
const ORIGINAL = 'base44/functions/generatePatientChartPDF/entry.ts';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN_A = 1; const CLINICIAN_A = 2; const OFFICE_A = 3; const ADMIN_B = 4;
const CONTEXT = 'select "public"."pennsync_contract_chart_export_context"($1,$2,$3,$4) as result';
const A = 'agency-a'; const B = 'agency-b';
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, EXPORT]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  await db.exec(`update pennsync_private.membership set tenant_role = 'office_staff'
    where id = 'membership-3'`);
  // patient-a1 is the clinician's chart; patient-a2 is nobody's but the
  // administrator's. Both carry the whole projection, and `assigned_nurses`
  // names a person with no membership at all — which is the address the
  // original would have honoured.
  for (const [id, agency, first, last] of [
    ['patient-a1', A, 'Ada', 'Lovelace'], ['patient-a2', A, 'Grace', 'Hopper'],
    ['patient-b1', B, 'Katherine', 'Johnson'],
  ]) {
    await db.query(`insert into ${SCHEMA}."patient"("source_app_id","id","agency_id",
      "first_name","middle_name","last_name","date_of_birth","medical_record_number",
      "address","phone","email","physician_name","physician_phone","physician_email",
      "emergency_contact_name","emergency_contact_phone","emergency_contact_relationship",
      "primary_diagnosis","secondary_diagnoses","allergies","past_medical_history",
      "baseline_vitals","functional_status","social_history","advance_directives",
      "assigned_nurses","created_by","status","is_sample","is_archived")
      values ($1,$2,$3,$4,'Q',$5,'1815-12-10','MRN-1','1 Main St','555-0100',
        'p@example.invalid','Dr Who','555-0199','dr@example.invalid',
        'Next Kin','555-0111','sibling','CHF',$6,'Penicillin',$7,
        $8,$9,$10,$11,$12,'revoked@example.invalid',
        'active',false,false)`,
    [APP, id, agency, first, last, JSON.stringify(['COPD']), JSON.stringify(['Stroke 2019']),
      JSON.stringify({ heart_rate: 72, blood_pressure_systolic: 120 }),
      JSON.stringify({ ambulation: 'walker' }), JSON.stringify({ primary_language: 'Welsh' }),
      JSON.stringify({ has_living_will: true }),
      JSON.stringify(['revoked@example.invalid'])]);
  }
  for (const [id, patient, date, type] of [
    ['visit-a1', 'patient-a1', '2026-06-15', 'skilled_nursing'],
    ['visit-a2', 'patient-a1', '2026-07-01', 'skilled_nursing'],
    ['visit-a3', 'patient-a2', '2026-06-20', 'skilled_nursing'],
  ]) {
    await db.query(`insert into ${SCHEMA}."visit"("source_app_id","id","agency_id",
      "patient_id","visit_date","visit_type") values ($1,$2,$3,$4,$5,$6)`,
    [APP, id, A, patient, date, type]);
  }
  for (const [id, patient, date] of [
    ['incident-a1', 'patient-a1', '2026-06-16'], ['incident-a2', 'patient-a1', '2026-07-02'],
  ]) {
    // `incident` carries no `agency_id` of its own: its tenancy is the CHART,
    // through `patient_id`, which is what `incident_read` asks.
    await db.query(`insert into ${SCHEMA}."incident"("source_app_id","id","patient_id",
      "incident_date","incident_type","severity")
      values ($1,$2,$3,$4,'fall','high')`, [APP, id, patient, date]);
  }
});
after(async () => db?.close());

async function as(n, sql, params = []) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
    const { rows } = await db.query(sql, params);
    await db.exec('commit');
    return rows[0].result;
  } catch (error) { await db.exec('rollback'); throw error; }
}
const context = (n, options = {}) => as(n, CONTEXT, [options.agency ?? A,
  options.patient === undefined ? 'patient-a1' : options.patient,
  options.visits ?? true, options.incidents ?? true]);
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
});

test('the chart rule IS the gate, and a stale assigned_nurses address opens nothing', async () => {
  // The clinician is on patient-a1's care team and opens it.
  assert.equal((await context(CLINICIAN_A)).patient.first_name, 'Ada');
  // And is on nobody else's, so patient-a2 is not visible to them although it
  // is in their agency.
  await refusal(context(CLINICIAN_A, { patient: 'patient-a2' }),
    'PENNSYNC_CHART_EXPORT_PATIENT_NOT_VISIBLE');
  // An `agency_admin` opens every chart.
  assert.equal((await context(ADMIN_A, { patient: 'patient-a2' })).patient.first_name, 'Grace');
  // `office_staff` opens none, which is what refuses an export they could
  // previously have been granted by an address on the row.
  await refusal(context(OFFICE_A), 'PENNSYNC_CHART_EXPORT_PATIENT_NOT_VISIBLE');
  // Every chart here names `revoked@example.invalid` in `assigned_nurses` AND
  // in `created_by` — the original's two other gates. Neither is read: that
  // person holds no membership, and the contract asks the policies.
  const source = readFileSync(resolve(repository, ORIGINAL), 'utf8');
  assert.match(source, /patient\.assigned_nurses/);
  assert.match(source, /normalizeProtectedEmail\(patient\.created_by\) === callerEmail/);
  const sql = readFileSync(resolve(repository, EXPORT), 'utf8');
  for (const gate of ['assigned_nurses', 'created_by', 'SUPER_ADMIN']) {
    assert.equal(sql.includes(`"${gate}"`), false, `${gate} is not read`);
  }
});

test('another tenant reaches nothing, and an unheld agency is a different refusal', async () => {
  await refusal(context(ADMIN_B, { agency: A }), 'PENNSYNC_CHART_EXPORT_AGENCY_NOT_HELD');
  await refusal(context(ADMIN_A, { agency: B, patient: 'patient-b1' }),
    'PENNSYNC_CHART_EXPORT_AGENCY_NOT_HELD');
  // Held, but the chart belongs to the other agency: not visible rather than
  // not held, and neither answer says whether the id is real.
  await refusal(context(ADMIN_A, { patient: 'patient-b1' }),
    'PENNSYNC_CHART_EXPORT_PATIENT_NOT_VISIBLE');
  await refusal(context(ADMIN_A, { patient: 'patient-nowhere' }),
    'PENNSYNC_CHART_EXPORT_PATIENT_NOT_VISIBLE');
  for (const patient of [null, '', 'x'.repeat(201)]) {
    await refusal(context(ADMIN_A, { patient }), 'PENNSYNC_CHART_EXPORT_SUBJECT_INVALID');
  }
});

test('the projection is exactly the columns the prompt interpolates', async () => {
  const answer = await context(ADMIN_A);
  assert.deepEqual(Object.keys(answer).sort(), ['incidents', 'patient', 'visits']);
  // Read from the ORIGINAL's prompt rather than retyped: a field added to the
  // template upstream fails here instead of reaching a model as undefined.
  const source = readFileSync(resolve(repository, ORIGINAL), 'utf8');
  // From the two locals the template needs through the end of the template,
  // because `secondary_diagnoses` and `past_medical_history` are joined into
  // `secondaryDiagnoses` and `pastMedicalHistory` a few lines above it — a
  // regex over the template alone would have missed both and the projection
  // would have looked two columns too wide.
  const start = source.indexOf('const secondaryDiagnoses');
  const template = source.slice(start, source.indexOf('`;', source.indexOf('const prompt = `')));
  const named = new Set([...template.matchAll(/patient\.([a-z_]+)/g)].map(m => m[1]));
  assert.equal(named.size, 22, 'the original reads twenty-two patient columns');
  assert.deepEqual([...named].sort(),
    Object.keys(answer.patient).filter(key => key !== 'id').sort());
  // `id` is the only column the projection adds, and no other does.
  assert.equal(answer.patient.id, 'patient-a1');
  // The four JSON groups travel whole, because the service reaches into them.
  assert.deepEqual(answer.patient.baseline_vitals, { heart_rate: 72, blood_pressure_systolic: 120 });
  assert.deepEqual(answer.patient.advance_directives, { has_living_will: true });
  // Nothing the prompt does not name is disclosed.
  for (const column of ['assigned_nurses', 'created_by', 'agency_id', 'status',
    'current_medications', 'wounds', 'clinical_notes']) {
    assert.equal(Object.hasOwn(answer.patient, column), false, `${column} is not projected`);
  }
  // And the visit and incident rows carry only what the prompt prints.
  for (const visit of answer.visits) {
    assert.deepEqual(Object.keys(visit).sort(), ['visit_date', 'visit_type']);
  }
  for (const incident of answer.incidents) {
    assert.deepEqual(Object.keys(incident).sort(),
      ['incident_date', 'incident_type', 'severity']);
  }
});

test('the two flags decide what is read, newest first, and never another chart', async () => {
  const full = await context(ADMIN_A);
  assert.deepEqual(full.visits.map(visit => visit.visit_date),
    ['2026-07-01', '2026-06-15']);
  assert.equal(full.incidents.length, 2);
  // patient-a2's visit is not in patient-a1's chart.
  assert.equal(full.visits.length, 2);
  const neither = await context(ADMIN_A, { visits: false, incidents: false });
  assert.deepEqual(neither.visits, []);
  assert.deepEqual(neither.incidents, []);
  assert.equal(neither.patient.first_name, 'Ada', 'the chart itself still comes back');
  const visitsOnly = await context(ADMIN_A, { visits: true, incidents: false });
  assert.equal(visitsOnly.visits.length, 2);
  assert.deepEqual(visitsOnly.incidents, []);
  // A null flag is the original's default rather than a refusal: its handler
  // defaults an ABSENT flag to true, and the contract's parameter carries that.
  const defaulted = await as(ADMIN_A, CONTEXT, [A, 'patient-a1', null, null]);
  assert.equal(defaulted.visits.length, 2);
  assert.equal(defaulted.incidents.length, 2);
});
