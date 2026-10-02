import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { RECORD_MIGRATION_FILE, SCHEMA } from '../../../tools-entity-schema-plan.mjs';
import { applyRecordMigrations, assertNewestRecordMigration } from './record-migrations.mjs';

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
const DASHBOARD = `${MIGRATIONS}20260920500000_contract_dashboard.sql`;
const FORWARD_NAME = '20260920745000_dashboard_visit_documentation.sql';
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
  // The whole record directory, in the order a deployment applies
  // it. A forward migration is applied by every suite that adopts this walk,
  // which is the only way a contract suite can see one land on it.
  const applied = await applyRecordMigrations(db);
  // This change's forward migration is the newest PENDING file, so the
  // ordering guard is this suite's. The helper admits ONE holder, and which
  // suite that is is a property of the whole tree rather than of any branch:
  // it sat in `contract-compliance-writes.test.mjs`, then moved through
  // `contract-duty-status`, `contract-reference-writes`,
  // `roster-phone-provisioned`, `contract-timesheet-review-approver` and
  // `contract-time-off-review-approver` as each of those merged, and arrives
  // here because `20260920745000` sorts after all of them. That is what
  // `assertNewestRecordMigration` says to do rather than widening the old call
  // with an exception list.
  //
  // This line was stale against the merged tree while naming a true
  // predecessor, and nothing could flag it: the branch that moved the guard on
  // and the branch that wrote this sentence never touched the same file.
  assertNewestRecordMigration(applied, FORWARD_NAME);
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
  // The fifth column is `nurse_notes`, which decides `has_documentation`:
  // `visit-old` carries one, `visit-a2` carries whitespace only, and the rest
  // carry none. No row is added for it, so every count below is unchanged.
  for (const [id, patient, date, status, notes] of [
    ['visit-today', 'patient-a1', today, 'scheduled', null],
    ['visit-old', 'patient-a1', '2026-01-02', 'completed', 'Ambulated 50 feet with a walker.'],
    ['visit-done-today', 'patient-a1', today, 'completed', null],
    ['visit-a2', 'patient-a2', today, 'scheduled', '  \t \n '],
    ['visit-discharged', 'patient-a3', today, 'scheduled', null],
  ]) {
    await db.query(`insert into ${SCHEMA}."visit"("source_app_id","id","agency_id",
      "patient_id","visit_date","visit_time","visit_type","status","nurse_notes")
      values ($1,$2,$3,$4,$5,'09:00','skilled_nursing',$6,$7)`,
    [APP, id, A, patient, date, status, notes]);
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
    visits: ['id', 'patient_id', 'status', 'visit_date', 'visit_time', 'visit_type',
      'has_documentation'],
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

test('the four absent fields, and the two defects that are now fixed', async () => {
  // This test recorded four fields the widgets read that exist in neither
  // store. Two of them were defects and both are now fixed; the columns are
  // still absent, which is why the fixes do not reach for them.
  const priorities = readFileSync(resolve(repository,
    'src/components/dashboard/todayPriorities.js'), 'utf8');
  const store = readFileSync(resolve(repository, RECORD_MIGRATION_FILE), 'utf8');
  const patient = store.slice(store.indexOf('create table "pennsync_records"."patient" ('),
    store.indexOf('\n);', store.indexOf('create table "pennsync_records"."patient" (')));
  const visit = store.slice(store.indexOf('create table "pennsync_records"."visit" ('),
    store.indexOf('\n);', store.indexOf('create table "pennsync_records"."visit" (')));
  const answer = await dashboard(ADMIN_A);

  // D73's rule: a check that reads a file for an ABSENT name has to say
  // whether it means absent from the code or from the page. These mean the
  // code, and the module's own comments name all three dead spellings while
  // explaining why they went — so strip the comments first, and prove the
  // stripper bit by asserting the prose still carries what the code does not.
  const code = priorities.replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
  assert.ok(priorities.includes('risk_level'), 'the prose explains the removal');
  assert.ok(code.length > 0.5 * priorities.length, 'the stripper kept the code');

  // STILL ABSENT, all four. Nothing below invents a column.
  for (const column of ['risk_level', 'hospitalization_risk', 'full_name', 'name']) {
    assert.equal(patient.includes(`"${column}"`), false, `${column} has no column`);
  }
  assert.equal(visit.includes('"note_id"'), false, 'note_id has no column');
  for (const column of ['risk_level', 'hospitalization_risk']) {
    assert.equal(readFileSync(resolve(repository, 'base44/entities/Patient.jsonc'), 'utf8')
      .includes(`"${column}"`), false, `${column} is not in the entity schema either`);
  }
  assert.equal(answer.patients.some(row => Object.hasOwn(row, 'risk_level')), false);
  assert.equal(answer.visits.some(row => Object.hasOwn(row, 'note_id')), false);

  // DEFECT ONE, fixed. "N high-risk patients to review" read three spellings
  // of a column that does not exist, so it could never fire. It now reads
  // PatientAlert, which is what the product writes and what
  // HighRiskPatientsWidget on this same dashboard already reads. The
  // contract is not the answer here and projects nothing new: the alerts
  // come through `getScopedPatientAlerts`, not through this payload.
  for (const dead of ['risk_level', 'riskLevel', 'hospitalization_risk']) {
    assert.equal(code.includes(dead), false,
      `the priority no longer reads patient.${dead}`);
  }
  assert.match(priorities, /highRiskPatientIds\(patientAlerts\)/);

  // DEFECT TWO, fixed. `!visit.note_id` was always true, so the tile counted
  // every completed visit. It now asks `nurse_notes` on the Base44 path and
  // the projected boolean here, and the boolean is what this contract adds.
  assert.equal(code.includes('note_id'), false,
    'the priority no longer reads visit.note_id');
  assert.match(priorities, /visit\?\.has_documentation/);
  const byId = new Map(answer.visits.concat(answer.recent_completed_visits)
    .map(row => [row.id, row]));
  assert.equal(byId.get('visit-done-today').has_documentation, false,
    'a completed visit with no note needs one');
  assert.equal(byId.get('visit-old').has_documentation, true,
    'a completed visit carrying a note does not');
  assert.equal(byId.get('visit-a2').has_documentation, false,
    'whitespace is not documentation');

  // `documentation_source` is NOT the signal, and this is the row that proves
  // it: the column carries a default, so it is non-null on a visit nobody has
  // documented.
  const { rows } = await db.query(`select "documentation_source" as source
    from ${SCHEMA}."visit" where "id" = 'visit-done-today'`);
  assert.equal(rows[0].source, 'smart_note');
  assert.equal(byId.get('visit-done-today').has_documentation, false);

  // The two dead fallbacks in `patientName` are unchanged and still dead: the
  // carried patient has first and last names and neither of the others.
  assert.match(priorities, /patient\?\.full_name \|\| patient\?\.name/);
});

test('the documentation predicate agrees with the browser\'s trim', async () => {
  // D57's rule: do not assert a table of expected answers you worked out
  // yourself. The character class is LIFTED out of the migration and run
  // against the same strings `visitHasDocumentation` sees, so a class that
  // drifts from JavaScript's whitespace set fails here.
  const forward = readFileSync(resolve(repository, MIGRATIONS + FORWARD_NAME), 'utf8');
  const match = forward.match(/nurse_notes" ~\s*\n?\s*'(\[\^[^']+\])'/);
  assert.ok(match, 'the class is where this test reads it from');
  const samples = ['', ' ', '\t', '\n', '\r', '\f', '\v', '  \t \n ', '\u00a0',
    '\u2003', '\u3000', '\ufeff', 'x', ' x ', '0', 'Ambulated 50 feet.'];
  for (const sample of samples) {
    const { rows } = await db.query(`select coalesce($1 ~ '${match[1]}', false) as held`,
      [sample]);
    assert.equal(rows[0].held, sample.trim() !== '',
      `${JSON.stringify(sample)} must agree with String.prototype.trim`);
  }
  // And the control: the class really is doing the work, so a predicate that
  // only knew about the ASCII space would disagree on one of these.
  const naive = await db.query(`select coalesce(btrim($1) <> '', false) as held`, ['\t']);
  assert.equal(naive.rows[0].held, true, 'btrim alone would have said documented');
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
