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
 * Reporting an incident, and moving one through its review.
 *
 * The property the whole file is about: `severity` and `state_reportable` are
 * the inputs to the resolve gate, so the original makes them reviewer-only on
 * a patch — and D40 turned the reviewer from a platform owner, who never
 * reports an agency's incidents, into an `agency_admin`, who does. Two tests
 * here are that finding: an administrator may not soften their OWN incident,
 * and may not review it either.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const AUDIT = 'services/authority-store/supabase/record-migrations/'
  + '20260920010000_activity_audit.sql';
const TIME_OFF = 'services/authority-store/supabase/record-migrations/'
  + '20260920230000_contract_time_off.sql';
const MINT = 'services/authority-store/supabase/record-migrations/'
  + '20260920285000_notification_mint.sql';
const INCIDENT = 'services/authority-store/supabase/record-migrations/'
  + '20260920290000_contract_incident.sql';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const email = n => ['', 'admin-a', 'clinician-a', 'clinician-empty', 'admin-b'][n]
  + '@example.invalid';
const ADMIN_A = 1; const CLINICIAN_A = 2; const CLINICIAN_EMPTY = 3; const ADMIN_B = 4;
const SUBMIT = 'select "public"."pennsync_contract_incident_submit"($1,$2) as result';
const UPDATE = 'select "public"."pennsync_contract_incident_update"'
  + '($1,$2,$3,$4,$5,$6,$7,$8) as result';
const A = 'agency-a'; const B = 'agency-b';
const GOOD = Object.freeze({
  patient_id: 'patient-a1', incident_type: 'fall', incident_date: '2026-09-18',
  report: 'Found on the bedroom floor, alert and oriented.',
});
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  // The time-off migration carries `time_off_date`, which this contract reuses
  // rather than declaring a second date parser.
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, AUDIT, TIME_OFF,
    MINT, INCIDENT]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  for (const [id, agency, first, last] of [
    ['patient-a1', A, 'Ada', 'Lovelace'],
    ['patient-a2', A, 'Grace', 'Hopper'],
    ['patient-b1', B, 'Katherine', 'Johnson'],
  ]) {
    await db.query(`insert into ${SCHEMA}."patient"
      ("source_app_id","id","agency_id","first_name","last_name")
      values ($1,$2,$3,$4,$5)`, [APP, id, agency, first, last]);
  }
});
after(async () => db?.close());

async function as(n, sql, params = [], commit = false) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
    const { rows } = await db.query(sql, params);
    if (commit) await db.exec('commit'); else await db.exec('rollback');
    return rows[0].result;
  } catch (error) { await db.exec('rollback'); throw error; }
}
const submit = (n, incident = GOOD, agency = A) =>
  as(n, SUBMIT, [agency, JSON.stringify(incident)], true);
const update = (n, id, action, options = {}, agency = A) => as(n, UPDATE, [
  agency, id, action, options.patch === undefined ? null : JSON.stringify(options.patch),
  options.to_status ?? null, options.corrective_action_plan ?? null,
  options.resolution_notes ?? null, options.patient_id ?? null,
], true);
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);
const rowOf = async id => (await db.query(
  `select * from ${SCHEMA}."incident" where "id" = $1`, [id])).rows[0];
const trail = async id => (await db.query(
  `select "action","subject_kind","subject_id","detail","actor_email"
   from ${SCHEMA}."activity_audit" where "id" = $1`, [id])).rows[0];

test('the chart decides who may report on it, not a nurse list', async () => {
  // The original reads `assigned_nurses`, `created_by` and an `agency_name`
  // comparison; D21, D24 and D41 threw all three out. `clinician-empty` holds
  // the same role in the same agency as `clinician-a` and opens no chart.
  await refusal(submit(CLINICIAN_EMPTY), 'PENNSYNC_INCIDENT_PATIENT_NOT_VISIBLE');
  await refusal(submit(CLINICIAN_A, { ...GOOD, patient_id: 'patient-a2' }),
    'PENNSYNC_INCIDENT_PATIENT_NOT_VISIBLE');
  await refusal(submit(ADMIN_B, GOOD, A), 'PENNSYNC_INCIDENT_AGENCY_NOT_HELD');
  // An agency's administrator opens every chart under D24, so patient-a2 is
  // theirs to report on although nobody is assigned to it.
  assert.equal((await submit(ADMIN_A, { ...GOOD, patient_id: 'patient-a2' }))
    .incident.patient_id, 'patient-a2');
  // And the assigned clinician reports on their own chart.
  assert.equal((await submit(CLINICIAN_A)).incident.patient_id, 'patient-a1');
});

test('the name on the record comes from the chart, never from the caller', async () => {
  const result = await submit(CLINICIAN_A, { ...GOOD, patient_name: 'Someone Else' });
  assert.equal(result.incident.patient_name, 'Ada Lovelace');
  assert.equal((await rowOf(result.incident.id)).patient_name, 'Ada Lovelace');
});

test('the four required fields, and a date that is one', async () => {
  for (const missing of ['patient_id', 'incident_type', 'report', 'incident_date']) {
    const body = { ...GOOD }; delete body[missing];
    await refusal(submit(CLINICIAN_A, body), 'PENNSYNC_INCIDENT_REQUIRED');
  }
  // The original stores whatever string it was handed; a named refusal beats a
  // raw cast error from the boundary.
  await refusal(submit(CLINICIAN_A, { ...GOOD, incident_date: '18/09/2026' }),
    'PENNSYNC_INCIDENT_REQUIRED');
});

test('the reporter names the severity, and it is kept', async () => {
  // Load-bearing, and the thing a "reviewer-only means reviewer-only" reading
  // of the split gets wrong: the resolve gate reads the STORED severity, so a
  // port that floored it at submission would silently disable the control this
  // contract exists to enforce. The original defaults to medium; so does this.
  assert.equal((await submit(CLINICIAN_A)).incident.severity, 'medium');
  assert.equal((await submit(CLINICIAN_A, { ...GOOD, severity: 'high' }))
    .incident.severity, 'high');
  await refusal(submit(CLINICIAN_A, { ...GOOD, severity: 'catastrophic' }),
    'PENNSYNC_INCIDENT_SEVERITY_INVALID');
});

test('office_notified honours what the reporter ticked', async () => {
  // The original's own fix, in its own words: "Deriving this from
  // immediate_alert meant the stored compliance flag contradicted the form:
  // 'Office notified' ticked on a medium incident saved false, and an unticked
  // high-severity report saved true."
  const ticked = await submit(CLINICIAN_A, { ...GOOD, office_notified: true });
  assert.equal(ticked.incident.office_notified, true);
  assert.equal(ticked.incident.alert_triggered, false);
  const unticked = await submit(CLINICIAN_A,
    { ...GOOD, severity: 'high', office_notified: false, immediate_alert: true });
  assert.equal(unticked.incident.office_notified, false, 'the form wins over the alert');
  // And with the field absent the alert flag is the fallback, as the original
  // leaves it for older callers.
  assert.equal((await submit(CLINICIAN_A, { ...GOOD, immediate_alert: true }))
    .incident.office_notified, true);
});

test('an interrupted offline drain does not file the safety event twice', async () => {
  // The original's reason for storing the key at all: "an interrupted drain
  // (server committed, queue removal failed) creates a second copy of the same
  // safety event on the next pass."
  const first = await submit(CLINICIAN_A, { ...GOOD, client_request_id: 'queue-7' });
  assert.equal(first.deduplicated, undefined);
  const again = await submit(CLINICIAN_A, { ...GOOD, client_request_id: 'queue-7' });
  assert.equal(again.deduplicated, true);
  assert.equal(again.incident.id, first.incident.id);
  assert.equal((await db.query(
    `select count(*)::int as n from ${SCHEMA}."incident" where "client_request_id" = $1`,
    ['queue-7'])).rows[0].n, 1);
});

test('the urgent alert reaches the agency s administrators and names no patient', async () => {
  await db.query(`delete from ${SCHEMA}."notification"`);
  const result = await submit(CLINICIAN_A,
    { ...GOOD, severity: 'high', immediate_alert: true });
  assert.equal(result.notified, 1, 'agency A has one administrator');
  const rows = (await db.query(
    `select "user_email","agency_id","title","message","type","priority","metadata"
     from ${SCHEMA}."notification" order by "user_email"`)).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_email, email(ADMIN_A));
  assert.equal(rows[0].agency_id, A, 'agency B is not in the fan-out at all');
  assert.equal(rows[0].type, 'critical_alert');
  assert.equal(rows[0].priority, 'critical');
  // Divergence 6. `notification_read` is agency-WIDE while D24 narrows a chart
  // to its care team, so a patient name here would be readable by an
  // `office_staff` member who opens no chart.
  const text = `${rows[0].title} ${rows[0].message} ${JSON.stringify(rows[0].metadata)}`;
  for (const leak of ['Ada', 'Lovelace', 'patient-a1']) {
    assert.equal(text.includes(leak), false, `the alert must not carry ${leak}`);
  }
  assert.equal(rows[0].title.includes('fall'), true, 'the category is not a name');
  assert.equal(rows[0].metadata.incident_id, result.incident.id);
  // No alert flag, no fan-out.
  await db.query(`delete from ${SCHEMA}."notification"`);
  assert.equal((await submit(CLINICIAN_A)).notified, 0);
  assert.equal((await db.query(
    `select count(*)::int as n from ${SCHEMA}."notification"`)).rows[0].n, 0);
});

test('a reporter may correct their account and may not soften it', async () => {
  const id = (await submit(CLINICIAN_A, { ...GOOD, severity: 'high' })).incident.id;
  const patched = await update(CLINICIAN_A, id, 'patch',
    { patch: { report: 'Corrected: found seated, not on the floor.' } });
  assert.match(patched.incident.report, /Corrected/);
  for (const field of ['severity', 'state_reportable', 'ai_tags']) {
    await refusal(update(CLINICIAN_A, id, 'patch', { patch: { [field]: 'low' } }),
      'PENNSYNC_INCIDENT_FIELD_PRIVILEGED');
  }
  assert.equal((await rowOf(id)).severity, 'high', 'the gate still reads high');
  await refusal(update(CLINICIAN_A, id, 'patch', { patch: {} }),
    'PENNSYNC_INCIDENT_PATCH_EMPTY');
  await refusal(update(CLINICIAN_A, id, 'patch', { patch: { status: 'resolved' } }),
    'PENNSYNC_INCIDENT_FIELD_UNSUPPORTED');
  // Three of the original's owner-writable fields have no carried column, and
  // are refused by name rather than dropped: a reporter who sent a witness
  // list would otherwise believe it was recorded.
  for (const field of ['witnesses', 'follow_up_required', 'follow_up_notes']) {
    await refusal(update(CLINICIAN_A, id, 'patch', { patch: { [field]: 'x' } }),
      'PENNSYNC_INCIDENT_FIELD_NOT_CARRIED');
  }
});

test('an administrator may not review their own incident (D40)', async () => {
  // In the original the reviewer is the protected platform owner, who never
  // reports an agency's incidents, so the split held by itself. D40 makes the
  // reviewer an `agency_admin`, who can report one like anybody else — and
  // could otherwise file a high-severity event, soften it, and close it with
  // no corrective action.
  const mine = (await submit(ADMIN_A, { ...GOOD, severity: 'high' })).incident.id;
  await refusal(update(ADMIN_A, mine, 'patch', { patch: { severity: 'low' } }),
    'PENNSYNC_INCIDENT_SELF_REVIEW');
  await refusal(update(ADMIN_A, mine, 'transition', { to_status: 'under_review' }),
    'PENNSYNC_INCIDENT_SELF_REVIEW');
  await refusal(update(ADMIN_A, mine, 'reassign_patient', { patient_id: 'patient-a2' }),
    'PENNSYNC_INCIDENT_SELF_REVIEW');
  // The narrative half is still theirs: it is their account of what happened.
  assert.match((await update(ADMIN_A, mine, 'patch',
    { patch: { report: 'Amended by the reporter.' } })).incident.report, /Amended/);
  // And somebody else's incident is theirs to review.
  const theirs = (await submit(CLINICIAN_A, { ...GOOD, severity: 'high' })).incident.id;
  assert.equal((await update(ADMIN_A, theirs, 'patch',
    { patch: { severity: 'low', state_reportable: true } })).incident.severity, 'low');
});

test('a clinician does not review anybody s incident', async () => {
  const id = (await submit(CLINICIAN_A)).incident.id;
  await refusal(update(CLINICIAN_EMPTY, id, 'patch', { patch: { report: 'x' } }),
    'PENNSYNC_INCIDENT_NOT_FOUND');
  await refusal(update(CLINICIAN_A, id, 'transition', { to_status: 'under_review' }),
    'PENNSYNC_INCIDENT_FORBIDDEN');
  await refusal(update(CLINICIAN_A, id, 'reassign_patient', { patient_id: 'patient-a2' }),
    'PENNSYNC_INCIDENT_FORBIDDEN');
  await refusal(update(ADMIN_A, 'has spaces', 'patch', { patch: { report: 'x' } }),
    'PENNSYNC_INCIDENT_SUBJECT_INVALID');
  await refusal(update(ADMIN_A, id, 'delete', {}), 'PENNSYNC_INCIDENT_ACTION_INVALID');
});

test('the patch trail records which fields moved, never their values', async () => {
  // The original's rule, in its own words: "Record only which fields changed:
  // the values can contain incident narrative, witness names, notes, or photo
  // URLs and belong only on Incident itself."
  const id = (await submit(CLINICIAN_A)).incident.id;
  const secret = 'The daughter, Ms Lovelace, was present and objected.';
  const result = await update(CLINICIAN_A, id, 'patch', { patch: { report: secret } });
  const event = await trail(result.audit_event_id);
  assert.equal(event.action, 'incident_patched');
  assert.deepEqual(event.detail.updated_fields, ['report']);
  assert.equal(JSON.stringify(event.detail).includes('Lovelace'), false);
  assert.equal(event.actor_email, email(CLINICIAN_A));
});

test('the lifecycle graph, including its one shortcut', async () => {
  const id = (await submit(CLINICIAN_A)).incident.id;
  await refusal(update(ADMIN_A, id, 'transition', {}), 'PENNSYNC_INCIDENT_STATUS_REQUIRED');
  await refusal(update(ADMIN_A, id, 'transition', { to_status: 'reported' }),
    'PENNSYNC_INCIDENT_STATUS_UNCHANGED');
  await refusal(update(ADMIN_A, id, 'transition', { to_status: 'archived' }),
    'PENNSYNC_INCIDENT_TRANSITION');
  await refusal(update(ADMIN_A, id, 'transition', { to_status: 'invented' }),
    'PENNSYNC_INCIDENT_TRANSITION');
  const reviewing = await update(ADMIN_A, id, 'transition', { to_status: 'under_review' });
  assert.equal(reviewing.status, 'under_review');
  // Both stamped by the original on this status: taking an incident up for
  // review IS the office being notified of it.
  assert.equal(reviewing.incident.investigator_email, email(ADMIN_A));
  assert.equal(reviewing.incident.office_notified, true);
  assert.equal(reviewing.incident.reviewed_by, email(ADMIN_A));
  await update(ADMIN_A, id, 'transition', { to_status: 'corrective_action' });
  // `corrective_action -> resolved` is not in the lifecycle graph; the
  // original adds it as an explicit shortcut and so does this.
  const done = await update(ADMIN_A, id, 'transition',
    { to_status: 'resolved', resolution_notes: 'Rail installed, family briefed.' });
  assert.equal(done.incident.status, 'resolved');
  assert.equal(done.incident.closed_by, email(ADMIN_A));
  assert.ok(done.incident.closed_at);
  // The first reviewer keeps the credit rather than the closer taking it.
  assert.equal(done.incident.reviewed_by, email(ADMIN_A));
  const event = await trail(done.audit_event_id);
  assert.equal(event.action, 'incident_status_changed');
  assert.equal(event.detail.from_status, 'corrective_action');
  assert.equal(event.detail.to_lifecycle, 'final');
});

test('a high-severity incident does not close with nothing recorded', async () => {
  // The reason the whole capability exists.
  const id = (await submit(CLINICIAN_A, { ...GOOD, severity: 'high' })).incident.id;
  await update(ADMIN_A, id, 'transition', { to_status: 'under_review' });
  await refusal(update(ADMIN_A, id, 'transition', { to_status: 'resolved' }),
    'PENNSYNC_INCIDENT_CORRECTIVE_ACTION_REQUIRED');
  const done = await update(ADMIN_A, id, 'transition',
    { to_status: 'resolved', corrective_action_plan: 'Bed rails and hourly rounding.' });
  assert.equal(done.incident.status, 'resolved');
  assert.equal((await trail(done.audit_event_id)).detail.required_corrective_action, true);
  // And the same for a state-reportable incident of any severity: the flag is
  // the other input to the gate.
  const low = (await submit(CLINICIAN_A)).incident.id;
  await update(ADMIN_A, low, 'patch', { patch: { state_reportable: true } });
  await update(ADMIN_A, low, 'transition', { to_status: 'under_review' });
  await refusal(update(ADMIN_A, low, 'transition', { to_status: 'resolved' }),
    'PENNSYNC_INCIDENT_CORRECTIVE_ACTION_REQUIRED');
  // A plain low-severity incident closes with nothing, as the original allows.
  const plain = (await submit(CLINICIAN_A)).incident.id;
  await update(ADMIN_A, plain, 'transition', { to_status: 'under_review' });
  assert.equal((await update(ADMIN_A, plain, 'transition', { to_status: 'resolved' }))
    .incident.status, 'resolved');
});

test('a merge cannot move an incident onto a chart nobody can open', async () => {
  // Divergence 8: the original reassigns to any id at all, so the
  // duplicate-patient merge it exists for could move a safety event out of the
  // agency.
  const id = (await submit(CLINICIAN_A)).incident.id;
  await refusal(update(ADMIN_A, id, 'reassign_patient', { patient_id: 'patient-b1' }),
    'PENNSYNC_INCIDENT_PATIENT_NOT_VISIBLE');
  await refusal(update(ADMIN_A, id, 'reassign_patient', { patient_id: 'no-such-chart' }),
    'PENNSYNC_INCIDENT_PATIENT_NOT_VISIBLE');
  await refusal(update(ADMIN_A, id, 'reassign_patient', {}),
    'PENNSYNC_INCIDENT_SUBJECT_INVALID');
  const moved = await update(ADMIN_A, id, 'reassign_patient', { patient_id: 'patient-a2' });
  assert.equal(moved.incident.patient_id, 'patient-a2');
  // The denormalized name moves with it rather than describing the old chart.
  assert.equal(moved.incident.patient_name, 'Grace Hopper');
  assert.equal((await trail(moved.audit_event_id)).subject_id, 'patient-a2');
});

test('the trail write is in the same transaction as the change (D37)', async () => {
  const source = readFileSync(resolve(repository, INCIDENT), 'utf8');
  // Scoped to the two contract bodies: every contract's owner preamble has an
  // `exception when` of its own.
  const body = source.slice(source.indexOf('create function "pennsync_records".contract_incident_submit'),
    source.indexOf('reset role;'));
  assert.ok(body.length > 1000, 'the slice really covers both contract bodies');
  assert.equal(/exception\s+when/.test(body), false,
    'the original catches its own audit failure and returns audit_recorded:false');
  assert.equal(body.includes('contract_activity_append'), true);
  // And the original's compensation for that is gone from the behaviour: the
  // header quotes the name, the contracts never return it.
  assert.equal(body.includes('audit_recorded'), false);
  assert.equal(body.includes('Record this transition manually'), false);
});
