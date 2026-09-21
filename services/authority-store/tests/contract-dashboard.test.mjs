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
 * The dashboard's five collections.
 *
 * This is the port that was PARKED on "inventing two field lists is a
 * decision, not a transcription", and the test below is what unparked it: the
 * projection is re-derived from the dashboard's OWN consumers, so it cannot go
 * stale silently. It also records what that derivation found — four fields
 * those widgets read that exist in neither store, one of which makes a
 * priority that can never fire and one of which makes another over-report.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const MIGRATIONS = 'services/authority-store/supabase/record-migrations/';
const SWEEP = `${MIGRATIONS}20260920340000_contract_credential_sweep.sql`;
const DASHBOARD = `${MIGRATIONS}20260920500000_contract_dashboard.sql`;
const ORIGINAL = 'base44/functions/getDashboardData/entry.ts';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN_A = 1; const CLINICIAN_A = 2; const OFFICE_A = 3; const ADMIN_B = 4;
const DASH = 'select "public"."pennsync_contract_dashboard"($1) as result';
const A = 'agency-a'; const B = 'agency-b';
let db; let today;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  // `agency_today()` is the credential sweep's, and the dashboard's day is the
  // agency's wall clock for the same reason.
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, SWEEP, DASHBOARD]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  await db.exec(`update pennsync_private.membership set tenant_role = 'office_staff'
    where id = 'membership-3'`);
  today = (await db.query('select "pennsync_records".agency_today()::text as day')).rows[0].day;

  for (const [id, agency, status] of [['patient-a1', A, 'active'], ['patient-a2', A, 'active'],
    ['patient-a3', A, 'discharged'], ['patient-b1', B, 'active']]) {
    await db.query(`insert into ${SCHEMA}."patient"("source_app_id","id","agency_id",
      "first_name","last_name","status","primary_diagnosis","address","updated_date",
      "created_by","assigned_nurses")
      values ($1,$2,$3,'P','Q',$4,'CHF','1 Main St',clock_timestamp(),
        'revoked@example.invalid',$5)`,
    [APP, id, agency, status, JSON.stringify(['revoked@example.invalid'])]);
  }
  for (const [id, patient, date, status] of [
    ['visit-today', 'patient-a1', today, 'scheduled'],
    ['visit-old', 'patient-a1', '2026-01-02', 'completed'],
    ['visit-done-today', 'patient-a1', today, 'completed'],
    ['visit-a2', 'patient-a2', today, 'scheduled'],
    ['visit-discharged', 'patient-a3', today, 'scheduled'],
  ]) {
    await db.query(`insert into ${SCHEMA}."visit"("source_app_id","id","agency_id",
      "patient_id","visit_date","visit_time","visit_type","status")
      values ($1,$2,$3,$4,$5,'09:00','skilled_nursing',$6)`,
    [APP, id, A, patient, date, status]);
  }
  for (const [id, patient] of [['incident-a1', 'patient-a1'], ['incident-a2', 'patient-a2']]) {
    await db.query(`insert into ${SCHEMA}."incident"("source_app_id","id","patient_id",
      "incident_date","incident_type","incident_name","severity","status")
      values ($1,$2,$3,$4,'fall','Bathroom fall','high','reported')`, [APP, id, patient, today]);
  }
  for (const [id, patient, status] of [['plan-a1', 'patient-a1', 'active'],
    ['plan-a1-old', 'patient-a1', 'met'], ['plan-a2', 'patient-a2', 'active']]) {
    await db.query(`insert into ${SCHEMA}."care_plan"("source_app_id","id","patient_id",
      "status","target_date","problem","updated_date")
      values ($1,$2,$3,$4,$5,'Ambulation goal',clock_timestamp())`,
    [APP, id, patient, status, today]);
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
const dashboard = (n, agency = A) => as(n, DASH, [agency]);
const ids = list => list.map(row => row.id).sort();
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
});

test('the projection is what the dashboard\'s own widgets read', async () => {
  // THE test for this port. Every column is re-derived from the consumers, so
  // a widget that starts reading a new one fails here rather than silently
  // receiving undefined.
  const consumers = ['src/components/dashboard/todayPriorities.js',
    'src/components/dashboard/coreWorkQueues.js',
    'src/components/dashboard/RealTimePatientAlerts.jsx',
    'src/components/scheduling/SmartRouteOptimizer.jsx']
    .map(file => readFileSync(resolve(repository, file), 'utf8')).join('\n');
  const answer = await dashboard(ADMIN_A);
  const shapes = {
    patients: ['id', 'first_name', 'last_name', 'status', 'primary_diagnosis',
      'address', 'updated_date'],
    visits: ['id', 'patient_id', 'status', 'visit_date', 'visit_time', 'visit_type'],
    incidents: ['id', 'patient_id', 'status', 'incident_date', 'incident_name',
      'incident_type'],
    care_plans: ['id', 'patient_id', 'status', 'target_date', 'problem'],
  };
  for (const [collection, fields] of Object.entries(shapes)) {
    assert.ok(answer[collection].length > 0, `${collection} has rows to check`);
    for (const row of answer[collection]) {
      assert.deepEqual(Object.keys(row).sort(), [...fields].sort(), collection);
    }
    // Every projected column is one a widget names.
    for (const field of fields) {
      if (field === 'updated_date') continue; // the sort key, not displayed
      assert.ok(new RegExp(`\\b${field}\\b`).test(consumers), `${field} is read by a widget`);
    }
  }
  assert.deepEqual(Object.keys(answer.recent_completed_visits[0] ?? {}).sort(),
    [...shapes.visits].sort(), 'completed visits are visits');
});

test('four fields the widgets read exist in neither store, and two are defects', async () => {
  // Recorded rather than invented, which is what this port turns on.
  const priorities = readFileSync(resolve(repository,
    'src/components/dashboard/todayPriorities.js'), 'utf8');
  const store = readFileSync(resolve(repository, RECORD_MIGRATION_FILE), 'utf8');
  const patient = store.slice(store.indexOf('create table "pennsync_records"."patient" ('),
    store.indexOf('\n);', store.indexOf('create table "pennsync_records"."patient" (')));
  const visit = store.slice(store.indexOf('create table "pennsync_records"."visit" ('),
    store.indexOf('\n);', store.indexOf('create table "pennsync_records"."visit" (')));

  // "N high-risk patients to review" reads three spellings and none exists.
  assert.match(priorities, /patient\?\.risk_level \|\| patient\?\.riskLevel/);
  assert.match(priorities, /patient\?\.hospitalization_risk === 'high'/);
  for (const column of ['risk_level', 'hospitalization_risk']) {
    assert.equal(patient.includes(`"${column}"`), false, `${column} has no column`);
    assert.equal(readFileSync(resolve(repository, 'base44/entities/Patient.jsonc'), 'utf8')
      .includes(`"${column}"`), false, `${column} is not in the entity schema either`);
  }
  // So the priority can never fire, in Base44 today as much as here.
  const answer = await dashboard(ADMIN_A);
  assert.equal(answer.patients.some(row => Object.hasOwn(row, 'risk_level')), false);

  // "N completed visits need notes" is `!visit.note_id`, and there is no such
  // column — so the negation is always true and it OVER-reports.
  assert.match(priorities, /visit\?\.status === 'completed' && !visit\?\.note_id/);
  assert.equal(visit.includes('"note_id"'), false, 'note_id has no column');
  assert.equal(answer.visits.some(row => Object.hasOwn(row, 'note_id')), false);

  // And `patientName`'s two fallbacks are dead: the carried patient has first
  // and last names and neither of the others (D38's family).
  assert.match(priorities, /patient\?\.full_name \|\| patient\?\.name/);
  for (const column of ['"full_name"', '"name"']) {
    assert.equal(patient.includes(column), false, `${column} has no column`);
  }
});

test('the scope is the chart, not an address on the patient row', async () => {
  // Every patient here names `revoked@example.invalid` in BOTH `created_by`
  // and `assigned_nurses` — the original's whole scope — and that person holds
  // no membership.
  const source = readFileSync(resolve(repository, ORIGINAL), 'utf8');
  assert.match(source, /function patientBelongsToCaller/);
  assert.match(source, /patient\.assigned_nurses/);
  const sql = readFileSync(resolve(repository, DASHBOARD), 'utf8');
  for (const gate of ['assigned_nurses', 'created_by', 'SUPER_ADMIN']) {
    assert.equal(sql.includes(`"${gate}"`), false, `${gate} is not read`);
  }
  // An agency_admin opens every chart; a clinician opens the one they are
  // assigned; office_staff opens none.
  assert.deepEqual(ids((await dashboard(ADMIN_A)).patients), ['patient-a1', 'patient-a2']);
  assert.deepEqual(ids((await dashboard(CLINICIAN_A)).patients), ['patient-a1']);
  const empty = await dashboard(OFFICE_A);
  for (const collection of ['patients', 'visits', 'incidents', 'recent_completed_visits',
    'care_plans']) {
    assert.deepEqual(empty[collection], [], collection);
  }
  // A discharged patient is in nobody's dashboard: the original filters
  // `status: 'active'` and so does this.
  assert.equal((await dashboard(ADMIN_A)).patients.some(row => row.id === 'patient-a3'), false);
  await refusal(dashboard(ADMIN_B, A), 'PENNSYNC_DASHBOARD_AGENCY_NOT_HELD');
  assert.deepEqual(ids((await dashboard(ADMIN_B, B)).patients), ['patient-b1']);
});

test('every collection is keyed to the patients the first one returned', async () => {
  const mine = await dashboard(CLINICIAN_A);
  assert.deepEqual(ids(mine.patients), ['patient-a1']);
  // Today's visits only, for that patient only.
  assert.deepEqual(ids(mine.visits), ['visit-done-today', 'visit-today']);
  assert.deepEqual(ids(mine.incidents), ['incident-a1']);
  // Completed at any date, which is what the alert widgets need: "no visit in
  // N days" is impossible from today's alone.
  assert.deepEqual(ids(mine.recent_completed_visits), ['visit-done-today', 'visit-old']);
  // Active plans only.
  assert.deepEqual(ids(mine.care_plans), ['plan-a1']);
  // The admin's dashboard reaches both charts and still no other agency.
  const all = await dashboard(ADMIN_A);
  assert.deepEqual(ids(all.incidents), ['incident-a1', 'incident-a2']);
  assert.deepEqual(ids(all.care_plans), ['plan-a1', 'plan-a2']);
  assert.equal(all.visits.every(visit => visit.visit_date === all.today), true);
  // The day is the agency's wall clock, which the original's `todayEastern()`
  // is; a UTC date would be tomorrow's after 8pm in New York.
  assert.equal(all.today, today);
  assert.match(readFileSync(resolve(repository, ORIGINAL), 'utf8'),
    /timeZone: 'America\/New_York'/);
});

test('an empty scope answers five empty lists rather than reading anything', async () => {
  // The original returns early when it has no patient ids; so does this, and
  // the shape is the same either way so a widget cannot tell which branch ran.
  const empty = await dashboard(OFFICE_A);
  assert.deepEqual(Object.keys(empty).sort(), ['care_plans', 'incidents', 'patients',
    'recent_completed_visits', 'today', 'visits']);
  const full = await dashboard(ADMIN_A);
  assert.deepEqual(Object.keys(full).sort(), Object.keys(empty).sort());
});
