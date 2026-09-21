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
 * The chart a model reads to suggest clinical tasks.
 *
 * A READ with nothing behind it (D64), and three deletions: the
 * `SUPER_ADMIN_EMAIL` comparison, the `assigned_nurses` check, and the two
 * service-role compensations — a patient lookup that asks for two rows so it
 * can refuse ambiguity, and a re-check that every visit, alert and task it
 * loaded really names that patient. `id` is half the primary key here and the
 * predicate is the contract's own.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const PURPOSE = 'services/authority-store/supabase/record-migrations/'
  + '20260920050000_patient_purpose_policy.sql';
const TIME_OFF = 'services/authority-store/supabase/record-migrations/'
  + '20260920230000_contract_time_off.sql';
const SWEEP = 'services/authority-store/supabase/record-migrations/'
  + '20260920340000_contract_credential_sweep.sql';
const TASK_CONTEXT = 'services/authority-store/supabase/record-migrations/'
  + '20260920440000_contract_clinical_task_context.sql';
const ORIGINAL = 'base44/functions/analyzeAndGenerateClinicalTasks/entry.ts';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CLINICIAN_A = 2; const CLINICIAN_EMPTY = 3; const ADMIN_B = 4;
const CONTEXT = 'select "public"."pennsync_contract_clinical_task_context"($1,$2) as result';
const A = 'agency-a'; const B = 'agency-b';
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, PURPOSE,
    TIME_OFF, SWEEP, TASK_CONTEXT]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  for (const [id, agency, first, last] of [
    ['patient-a1', A, 'Ada', 'Lovelace'],
    ['patient-a2', A, 'Grace', 'Hopper'],
    ['patient-b1', B, 'Katherine', 'Johnson'],
  ]) {
    await db.query(`insert into ${SCHEMA}."patient"("source_app_id","id","agency_id",
      "first_name","last_name","primary_diagnosis","secondary_diagnoses",
      "current_medications","allergies","address")
      values ($1,$2,$3,$4,$5,'CHF','["COPD"]'::jsonb,'[{"name":"Lasix"}]'::jsonb,
        'penicillin','12 Ada Way')`, [APP, id, agency, first, last]);
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
const context = (n, patient = 'patient-a1', agency = A) => as(n, CONTEXT, [agency, patient]);
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);

let nextId = 0;
const visit = (patient, date, overrides = {}) => db.query(
  `insert into ${SCHEMA}."visit"("source_app_id","id","agency_id","patient_id","visit_date",
     "visit_type","nurse_notes","vital_signs","family_update_text")
   values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
  [APP, `visit-${nextId += 1}`, A, patient, date, overrides.visit_type ?? 'routine_visit',
    overrides.nurse_notes ?? null,
    overrides.vital_signs === undefined ? null : JSON.stringify(overrides.vital_signs),
    'SHOULD NOT REACH A PROMPT']);
const alert = (patient, overrides = {}) => db.query(
  `insert into ${SCHEMA}."patient_alert"("source_app_id","id","patient_id",
     "alert_type","severity","message","status","created_date","resolution_notes")
   values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
  [APP, `alert-${nextId += 1}`, patient, overrides.alert_type ?? 'vital_deterioration',
    overrides.severity ?? 'high', overrides.message ?? 'BP trending up',
    overrides.status ?? 'active', overrides.created_date ?? '2026-06-01T00:00:00Z',
    'SHOULD NOT REACH A PROMPT']);
const task = (patient, overrides = {}) => db.query(
  `insert into ${SCHEMA}."task"("source_app_id","id","agency_id","patient_id","title",
     "type","priority","due_date","status","description")
   values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
  [APP, `task-${nextId += 1}`, A, patient, overrides.title ?? 'Call MD',
    overrides.type ?? 'call', overrides.priority ?? 'high',
    overrides.due_date ?? '2026-07-01', overrides.status ?? 'pending',
    'SHOULD NOT REACH A PROMPT']);
const reset = async () => {
  for (const table of ['task', 'patient_alert', 'visit']) {
    await db.query(`delete from ${SCHEMA}."${table}"`);
  }
};

test('the chart decides, and no environment variable does', async () => {
  await reset();
  await refusal(context(CLINICIAN_EMPTY), 'PENNSYNC_TASK_CONTEXT_PATIENT_NOT_VISIBLE');
  await refusal(context(CLINICIAN_A, 'patient-a2'), 'PENNSYNC_TASK_CONTEXT_PATIENT_NOT_VISIBLE');
  await refusal(context(ADMIN_B, 'patient-a1', A), 'PENNSYNC_TASK_CONTEXT_AGENCY_NOT_HELD');
  await refusal(context(CLINICIAN_A, 'patient a1!'), 'PENNSYNC_TASK_CONTEXT_SUBJECT_INVALID');
  await db.query(`update pennsync_private.membership set tenant_role = 'office_staff'
    where id = 'membership-2'`);
  await refusal(context(CLINICIAN_A), 'PENNSYNC_TASK_CONTEXT_PURPOSE_FORBIDDEN');
  await db.query(`update pennsync_private.membership set tenant_role = 'clinician'
    where id = 'membership-2'`);
  const original = readFileSync(resolve(repository, ORIGINAL), 'utf8');
  assert.match(original, /Deno\.env\.get\('SUPER_ADMIN_EMAIL'\)/);
  const body = readFileSync(resolve(repository, TASK_CONTEXT), 'utf8')
    .split('\n').filter(line => !line.trim().startsWith('--')).join('\n');
  for (const gone of ['SUPER_ADMIN_EMAIL', 'assigned_nurses', 'account_type']) {
    assert.equal(body.includes(gone), false, `the contract must not read ${gone}`);
  }
});

test('every list is the four fields the original maps, and no more', async () => {
  // D64's rule. `visit`, `patient_alert` and `task` all carry a patient name
  // and far more besides; a contract returning the rows would hand all of it
  // to a model.
  await reset();
  await visit('patient-a1', '2026-07-01', { vital_signs: { bp: '150/92' } });
  await alert('patient-a1');
  await task('patient-a1');
  const result = await context(CLINICIAN_A);
  assert.deepEqual(Object.keys(result.visits[0]).sort(), ['date', 'notes', 'type', 'vitals']);
  assert.deepEqual(Object.keys(result.alerts[0]).sort(),
    ['created', 'message', 'severity', 'type']);
  assert.deepEqual(Object.keys(result.tasks[0]).sort(),
    ['due_date', 'priority', 'title', 'type']);
  assert.equal(JSON.stringify(result).includes('SHOULD NOT REACH A PROMPT'), false);
  assert.deepEqual(Object.keys(result.patient).sort(),
    ['allergies', 'current_medications', 'id', 'patient_name', 'primary_diagnosis',
      'secondary_diagnoses']);
  assert.equal(JSON.stringify(result).includes('12 Ada Way'), false);
  assert.match(result.today, /^\d{4}-\d{2}-\d{2}$/);
});

test('the note excerpt is cut in the store, not after it leaves', async () => {
  // Divergence 4: the original sends the row and calls `.substring(0, 300)`
  // in the handler, so the other nine hundred characters have already left.
  await reset();
  await visit('patient-a1', '2026-07-01', { nurse_notes: `${'A'.repeat(300)}SECRET TAIL` });
  const result = await context(CLINICIAN_A);
  assert.equal(result.visits[0].notes.length, 300);
  assert.equal(JSON.stringify(result).includes('SECRET TAIL'), false);
  const original = readFileSync(resolve(repository, ORIGINAL), 'utf8');
  assert.match(original, /nurse_notes\?\.substring\(0, 300\)/,
    'the original still truncates after the row has been fetched');
});

test('only the last five visits, the active alerts and the open tasks', async () => {
  await reset();
  for (const day of ['01', '02', '03', '04', '05', '06', '07']) {
    await visit('patient-a1', `2026-07-${day}`, { nurse_notes: `note-${day}` });
  }
  await alert('patient-a1', { message: 'Active one' });
  await alert('patient-a1', { message: 'Resolved one', status: 'resolved' });
  await task('patient-a1', { title: 'Pending one' });
  await task('patient-a1', { title: 'In progress one', status: 'in_progress' });
  await task('patient-a1', { title: 'Completed one', status: 'completed' });
  await visit('patient-a2', '2026-07-09');
  await alert('patient-a2', { message: 'Another chart' });
  const result = await context(CLINICIAN_A);
  assert.deepEqual(result.visits.map(v => v.notes),
    ['note-07', 'note-06', 'note-05', 'note-04', 'note-03']);
  assert.deepEqual(result.alerts.map(a => a.message), ['Active one']);
  assert.deepEqual(result.tasks.map(t => t.title).sort(), ['In progress one', 'Pending one']);
});

test('an empty chart is an empty answer, not a refusal', async () => {
  await reset();
  const result = await context(CLINICIAN_A);
  assert.deepEqual(result.visits, []);
  assert.deepEqual(result.alerts, []);
  assert.deepEqual(result.tasks, []);
  assert.equal(result.patient.patient_name, 'Ada Lovelace');
});
