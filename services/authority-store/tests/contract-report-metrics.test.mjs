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
 * The AI report's corpus (D91).
 *
 * What is worth breaking a build over here is that this contract COUNTS rather
 * than projects, so a mistake is invisible: a wrong predicate does not produce
 * a wrong-looking row, it produces a number that is simply too big or too
 * small, and a PDF full of plausible numbers is exactly the failure D41's
 * cross-tenant audit leak was.
 *
 * So every count is proved by seeding a row that MUST be excluded and watching
 * the figure not move: another agency's chart, another agency's note, a visit
 * outside the window, an alert that is not critical.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const DIR = 'services/authority-store/supabase/record-migrations/';
const CARRIED = [`${DIR}20260920560000_contract_report_metrics.sql`];
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN_A = 1; const CLINICIAN_A = 2; const ADMIN_B = 4;
const EMAIL_A = 'clinician-a@example.invalid';
const A = 'agency-a'; const B = 'agency-b';
const Q = 'select "public"."pennsync_contract_report_metrics"($1,$2,$3) as result';
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, ...CARRIED]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
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

const END = new Date('2026-09-20T12:00:00.000Z');
const START = new Date('2026-08-21T12:00:00.000Z');
const report = (who, agency = A, start = START, end = END) =>
  as(who, Q, [agency, start.toISOString(), end.toISOString()]);
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);

const insert = (table, row) => {
  const keys = Object.keys(row);
  return db.query(
    `insert into ${SCHEMA}."${table}" ("source_app_id",${keys.map(k => `"${k}"`).join(',')})
     values ($1,${keys.map((_, i) => `$${i + 2}`).join(',')})`,
    [APP, ...keys.map(k => row[k])]);
};
const clear = async () => {
  for (const table of ['visit', 'incident', 'compliance_audit', 'note_conversion',
    'patient_alert', 'task', 'patient']) {
    await db.query(`delete from ${SCHEMA}."${table}"`);
  }
};
const chart = (id, agency, status = 'active') =>
  insert('patient', { id, agency_id: agency, status });

test('only an agency_admin of that agency may ask', async () => {
  // D40's gate. The original's is `isAdminLike`, which is `role === 'admin'`
  // and nothing else — the tier D14 and D22 removed.
  await refusal(report(CLINICIAN_A), 'PENNSYNC_REPORT_FORBIDDEN');
  await refusal(report(ADMIN_B, A), 'PENNSYNC_REPORT_AGENCY_NOT_HELD');
  await refusal(report(ADMIN_A, B), 'PENNSYNC_REPORT_AGENCY_NOT_HELD');
  assert.equal((await report(ADMIN_A)).visits_total, 0);
});

test('the window is validated and its ceiling is re-applied in SQL', async () => {
  // The original clamps `date_range_days` to 1..365 in JavaScript; a caller
  // reaching the RPC directly has no such clamp (D71).
  await refusal(report(ADMIN_A, A, END, START), 'PENNSYNC_REPORT_RANGE_INVALID');
  await refusal(report(ADMIN_A, A, START, START), 'PENNSYNC_REPORT_RANGE_INVALID');
  await refusal(as(ADMIN_A, Q, [A, null, END.toISOString()]), 'PENNSYNC_REPORT_RANGE_INVALID');
  await refusal(
    report(ADMIN_A, A, new Date('2025-01-01T00:00:00.000Z'), END),
    'PENNSYNC_REPORT_RANGE_TOO_WIDE');
  // Exactly 365 days is the largest window the original can ask for.
  const edge = new Date(END.getTime() - 365 * 86400000);
  assert.equal((await report(ADMIN_A, A, edge, END)).visits_total, 0);
});

test('the training leg answers where it is served, not zero', async () => {
  // D84. `TrainingAssignment` is `hub`, and a 0 would read as "nobody trained".
  const answer = await report(ADMIN_A);
  assert.equal(answer.training_completed, 'served_by_hub');
  assert.equal(answer.training_score, 'served_by_hub');
  assert.equal(answer.code, 'PENNSYNC_REPORT_TRAINING_LEG_ON_HUB');
});

test('every count excludes another agency, and the window excludes its edges', async () => {
  await clear();
  await chart('p-a1', A);
  await chart('p-a2', A, 'discharged');
  await chart('p-b1', B);
  const inside = '2026-09-01';
  const before = '2026-08-01';
  await insert('visit', { id: 'v-in', agency_id: A, patient_id: 'p-a1',
    visit_date: inside, status: 'completed', created_by: EMAIL_A });
  await insert('visit', { id: 'v-old', agency_id: A, patient_id: 'p-a1',
    visit_date: before, status: 'completed', created_by: EMAIL_A });
  await insert('visit', { id: 'v-other', agency_id: B, patient_id: 'p-b1',
    visit_date: inside, status: 'completed', created_by: EMAIL_A });
  await insert('visit', { id: 'v-open', agency_id: A, patient_id: 'p-a1',
    visit_date: inside, status: 'scheduled', created_by: EMAIL_A });

  const answer = await report(ADMIN_A);
  assert.equal(answer.visits_total, 2, 'the old visit and the other agency are both out');
  assert.equal(answer.visits_completed, 1);
  assert.equal(answer.patients_total, 2, 'agency B has its own chart');
  assert.equal(answer.patients_active, 1, 'the discharged chart still counts in the total');
});

test('a visit naming another agency\'s chart is counted for neither', async () => {
  // The original's `patientIds.has(v.patient_id)` from the other side. A row
  // whose `agency_id` says one thing and whose chart says another is not the
  // agency's work, and the contract asks BOTH.
  await clear();
  await chart('p-a1', A);
  await chart('p-b1', B);
  await insert('visit', { id: 'v-crossed', agency_id: A, patient_id: 'p-b1',
    visit_date: '2026-09-01', status: 'completed', created_by: EMAIL_A });
  assert.equal((await report(ADMIN_A)).visits_total, 0);
  assert.equal((await report(ADMIN_B, B)).visits_total, 0);
});

test('incident types are counted by name and windowed by their own date', async () => {
  await clear();
  await chart('p-a1', A);
  await chart('p-b1', B);
  for (const [id, type, date, patient] of [
    ['i-1', 'fall', '2026-09-01', 'p-a1'],
    ['i-2', 'fall', '2026-09-02', 'p-a1'],
    ['i-3', 'hospitalized', '2026-09-03', 'p-a1'],
    ['i-4', 'medication_error', '2026-09-04', 'p-a1'],
    ['i-5', 'infection_suspected', '2026-09-05', 'p-a1'],
    ['i-old', 'fall', '2026-01-01', 'p-a1'],
    ['i-other', 'fall', '2026-09-01', 'p-b1'],
  ]) {
    await insert('incident', { id, patient_id: patient, incident_type: type, incident_date: date });
  }
  const answer = await report(ADMIN_A);
  assert.equal(answer.falls, 2);
  assert.equal(answer.hospitalizations, 1);
  assert.equal(answer.medication_errors, 1);
});

test('audit scores sum whole and their statuses are counted apart', async () => {
  // An audit's tenant is its VISIT, not its patient — its read policy is an
  // `exists` over `visit.visit_id`, and the first draft of this contract asked
  // the patient column and counted zero. Read the policy.
  await clear();
  await chart('p-a1', A);
  await chart('p-b1', B);
  await insert('visit', { id: 'v-a', agency_id: A, patient_id: 'p-a1',
    visit_date: '2026-09-01', status: 'completed', created_by: EMAIL_A });
  await insert('visit', { id: 'v-b', agency_id: B, patient_id: 'p-b1',
    visit_date: '2026-09-01', status: 'completed', created_by: EMAIL_A });
  for (const [id, score, status, patient, visit] of [
    ['a-1', 90, 'passed', 'p-a1', 'v-a'],
    ['a-2', 70.5, 'flagged', 'p-a1', 'v-a'],
    ['a-3', 40, 'critical', 'p-a1', 'v-a'],
    ['a-4', null, 'pending_review', 'p-a1', 'v-a'],
    ['a-other', 10, 'critical', 'p-b1', 'v-b'],
  ]) {
    await insert('compliance_audit', { id, patient_id: patient, visit_id: visit,
      compliance_score: score, status, created_date: '2026-09-01T00:00:00Z' });
  }
  const answer = await report(ADMIN_A);
  assert.equal(answer.audits_total, 4);
  assert.equal(answer.audit_score_sum, 200.5, 'a null score coalesces to 0 and still counts');
  assert.equal(answer.audits_passed, 1);
  assert.equal(answer.audits_flagged, 1);
  assert.equal(answer.audits_critical, 1);
});

test('the original\'s null-patient branch is live for an audit and dead for an alert', async () => {
  // The original keeps `!x.patient_id || patientIds.has(...)` for both. Which
  // of those branches can ever be taken is a property of the POLICIES and it
  // differs: an audit reaches its tenant through its visit, so an audit with no
  // patient is still readable and still counts; an alert's only path is the
  // patient, so one with no patient is in no tenant and nobody has ever read
  // it. What is unreachable for an audit is a null VISIT.
  await clear();
  await chart('p-a1', A);
  await insert('visit', { id: 'v-a', agency_id: A, patient_id: 'p-a1',
    visit_date: '2026-09-01', status: 'completed', created_by: EMAIL_A });
  await insert('compliance_audit', { id: 'a-nopatient', patient_id: null, visit_id: 'v-a',
    compliance_score: 99, status: 'passed', created_date: '2026-09-01T00:00:00Z' });
  await insert('compliance_audit', { id: 'a-novisit', patient_id: 'p-a1', visit_id: null,
    compliance_score: 50, status: 'passed', created_date: '2026-09-01T00:00:00Z' });
  await insert('patient_alert', { id: 'al-orphan', patient_id: null,
    severity: 'critical', status: 'active' });
  const answer = await report(ADMIN_A);
  assert.equal(answer.audits_total, 1, 'the visitless audit is in no tenant');
  assert.equal(answer.audit_score_sum, 99);
  assert.equal(answer.critical_alerts, 0);
});

test('a note or task with no chart is kept, because its own column carries the tenant', async () => {
  await clear();
  await chart('p-a1', A);
  await insert('note_conversion', { id: 'n-chartless', agency_id: A, patient_id: null,
    nurse_email: EMAIL_A, quality_score: 80, compliance_improvement: 5,
    created_date: '2026-09-01T00:00:00Z' });
  await insert('task', { id: 't-chartless', agency_id: A, patient_id: null, status: 'completed' });
  const answer = await report(ADMIN_A);
  assert.equal(answer.notes_total, 1);
  assert.equal(answer.tasks_total, 1);
  assert.equal(answer.tasks_completed, 1);
});

test('only a critical, active alert counts', async () => {
  await clear();
  await chart('p-a1', A);
  for (const [id, severity, status] of [
    ['al-1', 'critical', 'active'],
    ['al-2', 'critical', 'resolved'],
    ['al-3', 'high', 'active'],
  ]) {
    await insert('patient_alert', { id, patient_id: 'p-a1', severity, status });
  }
  assert.equal((await report(ADMIN_A)).critical_alerts, 1);
});

test('the two groupings partition every row they count', async () => {
  // This is the property the service depends on: it rebuilds arrays from these
  // groups, so a row the groups drop is a row the report loses. A visit with no
  // author and a note from somebody off the roster both group under ''.
  await clear();
  await chart('p-a1', A);
  await insert('visit', { id: 'v-1', agency_id: A, patient_id: 'p-a1',
    visit_date: '2026-09-01', status: 'completed', created_by: EMAIL_A });
  await insert('visit', { id: 'v-anon', agency_id: A, patient_id: 'p-a1',
    visit_date: '2026-09-02', status: 'scheduled', created_by: null });
  await insert('note_conversion', { id: 'n-1', agency_id: A, patient_id: 'p-a1',
    nurse_email: EMAIL_A, quality_score: 60, compliance_improvement: 3,
    created_date: '2026-09-01T00:00:00Z' });
  await insert('note_conversion', { id: 'n-stranger', agency_id: A, patient_id: 'p-a1',
    nurse_email: 'someone-else@example.invalid', quality_score: 40,
    compliance_improvement: 1, created_date: '2026-09-02T00:00:00Z' });

  const answer = await report(ADMIN_A);
  const visitSum = answer.nurse_visits.reduce((n, g) => n + g.total, 0);
  const doneSum = answer.nurse_visits.reduce((n, g) => n + g.completed, 0);
  assert.equal(visitSum, answer.visits_total);
  assert.equal(doneSum, answer.visits_completed);
  const noteSum = answer.nurse_notes.reduce((n, g) => n + g.count, 0);
  assert.equal(noteSum, answer.notes_total);
  assert.equal(answer.nurse_notes.reduce((n, g) => n + g.quality_sum, 0),
    answer.note_quality_sum);
  assert.equal(answer.nurse_notes.reduce((n, g) => n + g.improvement_sum, 0),
    answer.note_improvement_sum);
  assert.ok(answer.nurse_visits.some(g => g.email === ''), 'an unauthored visit groups under \'\'');
});

test('an address differing only in case is the same person', async () => {
  // The original compares `v.created_by === nurse.email` and would have dropped
  // this nurse's visits from the staff table. `identity_map` constrains the
  // roster address to `lower(btrim(...))`, so the two are the same mailbox.
  await clear();
  await chart('p-a1', A);
  await insert('visit', { id: 'v-cased', agency_id: A, patient_id: 'p-a1',
    visit_date: '2026-09-01', status: 'completed', created_by: ` Clinician-A@Example.INVALID ` });
  const answer = await report(ADMIN_A);
  assert.deepEqual(answer.nurse_visits, [{ email: EMAIL_A, total: 1, completed: 1 }]);
});

test('the roster is the population, and it is this agency\'s', async () => {
  const answer = await report(ADMIN_A);
  assert.deepEqual(answer.roster,
    ['admin-a@example.invalid', 'clinician-a@example.invalid', 'clinician-empty@example.invalid']);
  assert.equal(answer.roster_size, 3);
  const other = await report(ADMIN_B, B);
  assert.deepEqual(other.roster, ['admin-b@example.invalid']);
});

test('the daily trend buckets by UTC day and stays inside the window', async () => {
  await clear();
  await chart('p-a1', A);
  for (const [id, at] of [
    ['n-a', '2026-09-01T23:59:59Z'],
    ['n-b', '2026-09-02T00:00:01Z'],
    ['n-c', '2026-09-02T10:00:00Z'],
  ]) {
    await insert('note_conversion', { id, agency_id: A, patient_id: 'p-a1',
      nurse_email: EMAIL_A, quality_score: 10, compliance_improvement: 1, created_date: at });
  }
  const answer = await report(ADMIN_A);
  assert.deepEqual(answer.daily_notes,
    [{ day: '2026-09-01', count: 1 }, { day: '2026-09-02', count: 2 }]);
});

test('a caller holding TWO agencies gets one agency\'s figures, not both', async () => {
  // D51's trap, and the reason every predicate here names the agency although
  // the policies already scope the read: `caller_agencies()` returns EVERY
  // agency the caller holds, so a contract that leaves the scoping to the
  // policies answers with both tenants' rows added together.
  //
  // Nothing in the shared fixtures holds two memberships, so four sabotages of
  // the agency naming passed until this test existed — including the audit's,
  // whose path runs through the visit and is the easiest to get wrong.
  await clear();
  await db.query(
    `insert into pennsync_private.membership(app_id,id,agency_id,auth_user_id,
       base44_user_id,tenant_role,status)
     select app_id,'membership-1b','agency-b',auth_user_id,base44_user_id,
       'agency_admin','active'
     from pennsync_private.identity_map where expected_email = $1
     on conflict do nothing`, ['admin-a@example.invalid']);
  try {
    await chart('p-a1', A);
    await chart('p-b1', B);
    for (const [id, agency, patient] of [['v-a', A, 'p-a1'], ['v-b', B, 'p-b1']]) {
      await insert('visit', { id, agency_id: agency, patient_id: patient,
        visit_date: '2026-09-01', status: 'completed', created_by: EMAIL_A });
      await insert('compliance_audit', { id: `au-${id}`, patient_id: patient, visit_id: id,
        compliance_score: 50, status: 'passed', created_date: '2026-09-01T00:00:00Z' });
      await insert('note_conversion', { id: `n-${id}`, agency_id: agency, patient_id: patient,
        nurse_email: EMAIL_A, quality_score: 20, compliance_improvement: 2,
        created_date: '2026-09-01T00:00:00Z' });
      await insert('task', { id: `t-${id}`, agency_id: agency, patient_id: patient,
        status: 'completed' });
      await insert('incident', { id: `i-${id}`, patient_id: patient,
        incident_type: 'fall', incident_date: '2026-09-01' });
      await insert('patient_alert', { id: `al-${id}`, patient_id: patient,
        severity: 'critical', status: 'active' });
    }

    // Both charts are readable to this caller now, so every figure below would
    // be 2 if any predicate trusted the policies alone.
    const answer = await report(ADMIN_A, A);
    for (const key of ['visits_total', 'patients_total', 'falls', 'audits_total',
      'notes_total', 'critical_alerts', 'tasks_total']) {
      assert.equal(answer[key], 1, `${key} should count agency A only`);
    }
    assert.equal(answer.audit_score_sum, 50);
    assert.deepEqual(answer.daily_notes, [{ day: '2026-09-01', count: 1 }]);
    assert.equal(answer.nurse_visits.reduce((n, g) => n + g.total, 0), 1);

    const other = await report(ADMIN_A, B);
    assert.equal(other.visits_total, 1);
    assert.equal(other.patients_total, 1);
  } finally {
    await db.query("delete from pennsync_private.membership where id = 'membership-1b'");
  }
});
