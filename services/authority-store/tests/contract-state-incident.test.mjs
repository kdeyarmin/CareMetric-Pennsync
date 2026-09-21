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
 * The state-reportable incident.
 *
 * The property worth the file: `state_reportable` and `severity` are the
 * reviewer-only fields D44 keeps off an ordinary submit, and this endpoint
 * sets both ITSELF rather than admitting them from a caller. A field a
 * reviewer decides is not made a caller's by adding an endpoint that wants it
 * set.
 *
 * And the alert names no patient — which bites harder here than anywhere,
 * because `notification_read` is agency-wide and this is the most serious
 * incident class the product has.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const MIGRATIONS = 'services/authority-store/supabase/record-migrations/';
const FILES = ['20260920010000_activity_audit.sql',
  '20260920170000_contract_note_history.sql',
  '20260920230000_contract_time_off.sql', '20260920285000_notification_mint.sql',
  '20260920290000_contract_incident.sql', '20260920510000_contract_state_incident.sql']
  .map(name => `${MIGRATIONS}${name}`);
const ORIGINAL = 'base44/functions/submitStateReportableIncident/entry.ts';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const email = n => ['', 'admin-a', 'clinician-a', 'clinician-empty', 'admin-b'][n]
  + '@example.invalid';
const ADMIN_A = 1; const CLINICIAN_A = 2; const OFFICE_A = 3; const ADMIN_B = 4;
const SUBMIT = 'select "public"."pennsync_contract_state_incident_submit"($1,$2) as result';
const A = 'agency-a'; const B = 'agency-b';
let db; let sequence = 0;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, ...FILES]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  await db.exec(`update pennsync_private.membership set tenant_role = 'office_staff'
    where id = 'membership-3'`);
  for (const [id, agency, first, last] of [
    ['patient-a1', A, 'Ada', 'Lovelace'], ['patient-a2', A, 'Grace', 'Hopper'],
    ['patient-b1', B, 'Katherine', 'Johnson'],
  ]) {
    await db.query(`insert into ${SCHEMA}."patient"("source_app_id","id","agency_id",
      "first_name","last_name","status","created_by","assigned_nurses")
      values ($1,$2,$3,$4,$5,'active','revoked@example.invalid',$6)`,
    [APP, id, agency, first, last, JSON.stringify(['revoked@example.invalid'])]);
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
const submit = (n, overrides = {}, agency = A) => as(n, SUBMIT, [agency, JSON.stringify({
  patient_id: 'patient-a1', event_type: 'Injury of Unknown Origin', event_type_id: 'IE',
  event_date: '2026-06-15', event_time: '14:30', report_text: 'STATE REPORTABLE EVENT REPORT',
  client_request_id: `req-${++sequence}`, ...overrides,
})]);
const column = async (id, name) => (await db.query(
  `select "${name}" as value from ${SCHEMA}."incident" where "id" = $1`, [id])).rows[0]?.value;
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
});

test('the contract sets the two reviewer-only fields, never the caller', async () => {
  // D44's rule, and the reason this is a sibling rather than an argument.
  const incident = readFileSync(resolve(repository, FILES[4]), 'utf8');
  assert.match(incident, /'severity', 'state_reportable', 'ai_tags'/);
  const answer = await submit(CLINICIAN_A, {
    // Every one of these is ignored: the contract decides all three.
    severity: 'low', state_reportable: false, status: 'resolved',
  });
  assert.equal(answer.success, true);
  assert.equal(await column(answer.incident.id, 'severity'), 'high');
  assert.equal(await column(answer.incident.id, 'state_reportable'), true);
  assert.equal(await column(answer.incident.id, 'status'), 'reported');
  // The state code becomes a real incident type, which is the original's own
  // reporting requirement: these events must appear in the aggregates.
  assert.equal(await column(answer.incident.id, 'incident_type'), 'hospitalized');
  assert.equal(await column(answer.incident.id, 'incident_name'),
    'State Reportable: Injury of Unknown Origin');
  assert.match(readFileSync(resolve(repository, ORIGINAL), 'utf8'),
    /IE: 'hospitalized',\s*\n\s*HC: 'medication_error',/);
  const med = await submit(CLINICIAN_A, { event_type_id: 'hc' });
  assert.equal(await column(med.incident.id, 'incident_type'), 'medication_error');
  const other = await submit(CLINICIAN_A, { event_type_id: 'ZZ' });
  assert.equal(await column(other.incident.id, 'incident_type'), 'other');
});

test('the alert names no patient, which matters most in this class', async () => {
  const answer = await submit(CLINICIAN_A);
  assert.equal(answer.notified, 1, 'the agency has one agency_admin');
  const { rows } = await db.query(`select "title","message","metadata","user_email"
    from ${SCHEMA}."notification" where "metadata"->>'incident_id' = $1`,
  [answer.incident.id]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_email, email(ADMIN_A));
  // `notification_read` is agency-WIDE while D24 narrows a chart to its care
  // team, so an office_staff member who opens no chart would otherwise read a
  // patient's name in the most serious incident class the product has.
  const written = JSON.stringify(rows[0]);
  for (const leak of ['Ada', 'Lovelace', 'patient-a1']) {
    assert.equal(written.includes(leak), false, `the alert must not carry ${leak}`);
  }
  // The original's message does carry it, which is what this changes.
  assert.match(readFileSync(resolve(repository, ORIGINAL), 'utf8'),
    /state reportable event for \$\{patientName\}/);
  assert.match(rows[0].title, /^State reportable event: /);
  assert.match(rows[0].message, /submitted a state reportable event on 2026-06-15/);
  // And `office_notified` follows the fan-out, which is a real side effect,
  // while `alert_triggered` stays false because the email is paused.
  assert.equal(await column(answer.incident.id, 'office_notified'), true);
  assert.equal(await column(answer.incident.id, 'alert_triggered'), false);
});

test('both paused halves are reported, in the answer and in the record', async () => {
  const answer = await submit(CLINICIAN_A);
  assert.equal(answer.document_retention_paused, true);
  assert.equal(answer.email_paused, true);
  // D42's rule: the trail must not read as though a message went out.
  const details = await column(answer.incident.id, 'details');
  assert.equal(details.document_retention_paused, true);
  assert.equal(details.email_paused, true);
  // Nothing claims a document that was never retained.
  assert.equal(Object.hasOwn(details, 'document_id'), false);
  assert.equal(await column(answer.incident.id, 'state_reportable_alert_sent_at'), null);
});

test('the chart decides, and a stale address on the patient row does not', async () => {
  const original = readFileSync(resolve(repository, ORIGINAL), 'utf8');
  assert.match(original, /incidentPatient\.assigned_nurses/);
  assert.match(original, /isProtectedSuperAdmin\(user\)/);
  // Comments are stripped first: this file's header NAMES the three gates it
  // deletes, and a scan that counted those would fail on the explanation.
  const sql = readFileSync(resolve(repository, FILES[5]), 'utf8')
    .split('\n').filter(line => !line.trim().startsWith('--')).join('\n');
  // Neither appears at all. `created_by` is excluded from this list on
  // purpose: the contract WRITES it, as the incident's reporter column, and
  // what matters is that it never READS the patient's — so the patient lookup
  // is checked instead, and it projects two names and nothing else.
  for (const gate of ['assigned_nurses', 'SUPER_ADMIN', 'isProtectedSuperAdmin']) {
    assert.equal(sql.includes(gate), false, `${gate} is not read`);
  }
  const lookup = sql.slice(sql.indexOf('into v_name from'),
    sql.indexOf(';', sql.indexOf('into v_name from')));
  assert.match(lookup, /"pennsync_records"\."patient" p/);
  assert.equal(/p\."(created_by|assigned_nurses|account_type|agency_name)"/.test(sql), false,
    'no self-editable field of the patient row is read');
  // Every patient here names `revoked@example.invalid` in both, and that
  // person holds no membership.
  assert.ok((await submit(ADMIN_A, { patient_id: 'patient-a2' })).success);
  await refusal(submit(CLINICIAN_A, { patient_id: 'patient-a2' }),
    'PENNSYNC_STATE_INCIDENT_PATIENT_NOT_VISIBLE');
  await refusal(submit(OFFICE_A), 'PENNSYNC_STATE_INCIDENT_PATIENT_NOT_VISIBLE');
  await refusal(submit(ADMIN_A, { patient_id: 'patient-b1' }),
    'PENNSYNC_STATE_INCIDENT_PATIENT_NOT_VISIBLE');
  await refusal(submit(ADMIN_B, {}, A), 'PENNSYNC_STATE_INCIDENT_AGENCY_NOT_HELD');
});

test('the four required fields are required, and a retry answers the same incident', async () => {
  for (const missing of [{ patient_id: '' }, { event_type: '' }, { event_date: 'not-a-date' },
    { event_date: '2026-02-31' }, { report_text: '' }]) {
    await refusal(submit(CLINICIAN_A, missing), 'PENNSYNC_STATE_INCIDENT_REQUIRED');
  }
  const first = await submit(CLINICIAN_A, {}, A);
  const replay = await as(CLINICIAN_A, SUBMIT, [A, JSON.stringify({
    patient_id: 'patient-a1', event_type: 'Injury of Unknown Origin', event_type_id: 'IE',
    event_date: '2026-06-15', report_text: 'x',
    client_request_id: `req-${sequence}`,
  })]);
  assert.equal(replay.deduplicated, true);
  assert.equal(replay.incident.id, first.incident.id);
  // A retry still reports both pauses, so a caller cannot read a replay as a
  // send that happened the first time.
  assert.equal(replay.document_retention_paused, true);
  assert.equal(replay.email_paused, true);
  assert.equal(replay.notified, 0, 'a replay notifies nobody a second time');
});

test('the stored reporter is the verified address, not the name the form claimed', async () => {
  const answer = await submit(CLINICIAN_A, {
    submitted_by_name: 'Somebody Else', submitted_by_title: 'RN',
  });
  const details = await column(answer.incident.id, 'details');
  assert.equal(details.submitted_by_email, email(CLINICIAN_A));
  assert.equal(details.submitted_by_title, 'RN');
  // The carried `user` table has no name column (D38), and a compliance record
  // naming whoever the form said is worse than one naming the account.
  assert.equal(Object.hasOwn(details, 'submitted_by_name'), false);
  assert.equal(JSON.stringify(details).includes('Somebody Else'), false);
  assert.equal(await column(answer.incident.id, 'created_by'), email(CLINICIAN_A));
  // The patient name on the RECORD comes from the chart, as D44 settled.
  assert.equal(await column(answer.incident.id, 'patient_name'), 'Ada Lovelace');
});
