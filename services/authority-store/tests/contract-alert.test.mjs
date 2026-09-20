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
 * Patient alerts (`contract_alert_list` / `contract_alert_update`).
 *
 * The property worth the whole file: **the authorization these two originals
 * share is the one D21 and D24 threw out.** `patientBelongsToCaller` is true
 * when the caller's address is the patient's `created_by` or appears in
 * `Patient.assigned_nurses` — and an address stays on that row after the
 * assignment naming it was suspended, so reading it resurrects access somebody
 * revoked. The fixture proves the substitution rather than asserting it: a
 * chart carries a stale `assigned_nurses` entry naming a caller who has no
 * assignment, and that caller sees nothing.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const ALERT = 'services/authority-store/supabase/record-migrations/20260920160000_contract_alert.sql';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const pid = n => `7aac00000000${String(n).padStart(12, '0')}`;
const aid = n => `8cce00000000${String(n).padStart(12, '0')}`;
const ADMIN_A = 1; const CLINICIAN_A = 2; const OFFICE_A = 3; const ADMIN_B = 4;
const LIST = 'select "public"."pennsync_contract_alert_list"($1,$2,$3,$4,$5) as result';
const UPDATE = 'select "public"."pennsync_contract_alert_update"($1,$2,$3,$4) as result';
const A = 'agency-a'; const B = 'agency-b';
const MINE = pid(1); const THEIRS = pid(2); const ELSEWHERE = pid(3);
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, ALERT]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  await db.exec(`update pennsync_private.membership set tenant_role = 'office_staff'
    where id = 'membership-3'`);
  for (const [id, agency] of [[MINE, A], [THEIRS, A], [ELSEWHERE, B]]) {
    await db.query(`insert into ${SCHEMA}."patient"
      ("source_app_id","id","agency_id","status","is_sample","is_archived",
       "first_name","last_name","created_by","assigned_nurses")
      values ($1,$2,$3,'active',false,false,'Ada','Lovelace',$4,$5)`,
    [APP, id, agency, 'user2@example.invalid',
      // The stale address D24 refuses to read: it names the clinician on a
      // chart they have no assignment to.
      JSON.stringify(id === THEIRS ? ['user2@example.invalid'] : [])]);
  }
  // The clinician's real care team is MINE and nothing else.
  await db.query(`insert into pennsync_private.chart_assignment
    (app_id,agency_id,patient_id,membership_id,status,changed_by)
    values ($1,$2,$3,'membership-2','active',$4)`, [APP, A, MINE, uid(1)]);
  const rows = [
    [aid(1), MINE, 'critical', 'active', '2026-09-03'],
    [aid(2), MINE, 'low', 'acknowledged', '2026-09-02'],
    [aid(3), MINE, 'high', 'active', '2026-09-01'],
    [aid(4), THEIRS, 'critical', 'active', '2026-09-04'],
    [aid(5), ELSEWHERE, 'critical', 'active', '2026-09-05'],
  ];
  for (const [id, patient, severity, status, day] of rows) {
    await db.query(`insert into ${SCHEMA}."patient_alert"
      ("source_app_id","id","patient_id","severity","status","title","created_date","flagged_urgent")
      values ($1,$2,$3,$4,$5,$6,$7,false)`,
    [APP, id, patient, severity, status, `Alert ${id.slice(-2)}`, `${day} 00:00:00+00`]);
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
const list = (n, { agency = A, patient = null, status = null, severity = null, limit = null } = {}) =>
  as(n, LIST, [agency, patient, status, severity, limit]);
const act = (n, id, action, notes = null, agency = A) =>
  as(n, UPDATE, [agency, id, action, notes], true);
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);
const column = async (id, name) => (await db.query(
  `select "${name}" as value from ${SCHEMA}."patient_alert" where "id" = $1`, [id])).rows[0].value;

test('a stale assigned_nurses address grants nothing', async () => {
  // THEIRS names the clinician in `assigned_nurses` and `created_by`, which is
  // exactly what both originals authorize on. D24 says the assignment roster
  // decides, and the clinician has no assignment to that chart.
  const nurses = (await db.query(
    `select "assigned_nurses" as value from ${SCHEMA}."patient" where "id" = $1`, [THEIRS])).rows[0].value;
  assert.deepEqual(nurses, ['user2@example.invalid'], 'the fixture really carries the address');
  const seen = await list(CLINICIAN_A);
  assert.deepEqual(seen.alerts.map(row => row.id), [aid(1), aid(2), aid(3)],
    'only the chart the clinician is actually assigned');
  assert.deepEqual((await list(CLINICIAN_A, { patient: THEIRS })).alerts, []);
  await refusal(act(CLINICIAN_A, aid(4), 'acknowledge'), 'PENNSYNC_ALERT_NOT_VISIBLE');
  assert.equal(await column(aid(4), 'status'), 'active', 'nothing moved');
});

test('the chart decides who sees an alert, and the agency scopes the page', async () => {
  // An agency administrator opens every chart in their agency.
  assert.deepEqual((await list(ADMIN_A)).alerts.map(row => row.id), [aid(4), aid(1), aid(2), aid(3)]);
  // `office_staff` opens none, so it sees none — no role check says so.
  assert.deepEqual((await list(OFFICE_A)).alerts, []);
  // The other agency's alert never appears, for anybody here.
  assert.equal((await list(ADMIN_A)).alerts.some(row => row.patient_id === ELSEWHERE), false);
  assert.deepEqual((await list(ADMIN_B, { agency: B })).alerts.map(row => row.id), [aid(5)]);
  // The agency is asked of the authority store, never of the request.
  await refusal(list(ADMIN_A, { agency: B }), 'PENNSYNC_ALERT_AGENCY_NOT_HELD');
  await refusal(list(ADMIN_B), 'PENNSYNC_ALERT_AGENCY_NOT_HELD');
});

test('the page is newest first, bounded, and filterable the way the original is', async () => {
  assert.deepEqual((await list(ADMIN_A, { limit: 2 })).alerts.map(row => row.id), [aid(4), aid(1)]);
  // An unusable limit becomes the default rather than an error, and the
  // ceiling is the ceiling.
  assert.equal((await list(ADMIN_A, { limit: 0 })).alerts.length, 4);
  assert.equal((await list(ADMIN_A, { limit: -3 })).alerts.length, 4);
  assert.equal((await list(ADMIN_A, { limit: 100000 })).alerts.length, 4);
  assert.deepEqual((await list(ADMIN_A, { status: 'acknowledged' })).alerts.map(row => row.id),
    [aid(2)]);
  assert.deepEqual((await list(ADMIN_A, { severity: ['critical', 'high'] })).alerts.map(row => row.id),
    [aid(4), aid(1), aid(3)]);
  assert.deepEqual((await list(ADMIN_A, { patient: MINE, severity: ['low'] })).alerts
    .map(row => row.id), [aid(2)]);
  // A severity nothing carries matches nothing rather than failing.
  assert.deepEqual((await list(ADMIN_A, { severity: ['nonexistent'] })).alerts, []);
  assert.deepEqual((await list(ADMIN_A, { severity: [] })).alerts.length, 4);
});

test('the projection is every business column and not the deployment', async () => {
  const [alert] = (await list(ADMIN_A, { patient: MINE, limit: 1 })).alerts;
  assert.equal(alert.id, aid(1));
  assert.equal(alert.severity, 'critical');
  assert.equal(alert.flagged_urgent, false, 'a boolean, never null');
  // The one thing a `select *` would have handed over.
  assert.equal(Object.hasOwn(alert, 'source_app_id'), false);
  const columns = (await db.query(`select column_name from information_schema.columns
    where table_schema = $1 and table_name = 'patient_alert'`, [SCHEMA]))
    .rows.map(row => row.column_name).filter(name => name !== 'source_app_id').sort();
  assert.deepEqual(Object.keys(alert).sort(), columns, 'every business column is projected');
});

test('each transition writes the fields the original builds, and nothing else', async () => {
  const before = await list(ADMIN_A, { patient: MINE });
  const answer = await act(CLINICIAN_A, aid(1), 'acknowledge');
  assert.equal(answer.alert.status, 'acknowledged');
  assert.match(answer.alert.acknowledged_by, /@/);
  assert.ok(answer.alert.acknowledged_at);
  // The severity and the chart are not a caller's to move, and this is a
  // privileged write: the transition's fields are built here.
  assert.equal(answer.alert.severity, before.alerts[0].severity);
  assert.equal(answer.alert.patient_id, MINE);

  const resolved = await act(CLINICIAN_A, aid(1), 'resolve', 'Escalated and closed.');
  assert.equal(resolved.alert.status, 'resolved');
  assert.equal(resolved.alert.resolution_notes, 'Escalated and closed.');
  assert.ok(resolved.alert.resolved_at);
  // An absent note keeps the one already there rather than clearing it.
  assert.equal((await act(CLINICIAN_A, aid(1), 'resolve')).alert.resolution_notes,
    'Escalated and closed.');

  assert.equal((await act(CLINICIAN_A, aid(3), 'dismiss')).alert.status, 'dismissed');
  assert.equal((await act(CLINICIAN_A, aid(2), 'toggle_flagged_urgent')).alert.flagged_urgent, true);
  assert.equal((await act(CLINICIAN_A, aid(2), 'toggle_flagged_urgent')).alert.flagged_urgent, false);
});

test('a malformed request never reaches the table', async () => {
  for (const [id, action, notes, code] of [
    ['', 'acknowledge', null, 'PENNSYNC_ALERT_ID_INVALID'],
    [aid(1), 'delete', null, 'PENNSYNC_ALERT_ACTION_INVALID'],
    [aid(1), null, null, 'PENNSYNC_ALERT_ACTION_INVALID'],
    // A note is accepted only by `resolve`; the original ignores it elsewhere
    // and this refuses it, so a caller learns it did not take effect.
    [aid(1), 'acknowledge', 'a note', 'PENNSYNC_ALERT_NOTES_UNEXPECTED'],
    [aid(1), 'dismiss', 'a note', 'PENNSYNC_ALERT_NOTES_UNEXPECTED'],
    [aid(1), 'resolve', 'x'.repeat(20001), 'PENNSYNC_ALERT_NOTES_INVALID'],
  ]) await refusal(act(ADMIN_A, id, action, notes), code);
  await refusal(act(ADMIN_A, aid(9999), 'acknowledge'), 'PENNSYNC_ALERT_NOT_VISIBLE');
  for (const [options, code] of [
    [{ patient: 'has spaces' }, 'PENNSYNC_ALERT_PATIENT_INVALID'],
    [{ status: '' }, 'PENNSYNC_ALERT_STATUS_INVALID'],
    [{ status: 'x'.repeat(101) }, 'PENNSYNC_ALERT_STATUS_INVALID'],
    [{ severity: Array.from({ length: 21 }, (u, i) => `s${i}`) }, 'PENNSYNC_ALERT_SEVERITY_INVALID'],
    [{ severity: [''] }, 'PENNSYNC_ALERT_SEVERITY_INVALID'],
    [{ severity: [null] }, 'PENNSYNC_ALERT_SEVERITY_INVALID'],
  ]) await refusal(list(ADMIN_A, options), code);
});

test('the contract is the only way in, and it cannot be reached by a caller as itself', async () => {
  const granted = async name => (await db.query(
    'select has_function_privilege($1,$2,$3) as ok', ['authenticated', name, 'execute'])).rows[0].ok;
  assert.equal(await granted('pennsync_records.alert_row(pennsync_records.patient_alert)'), false);
  assert.equal(await granted(
    'public.pennsync_contract_alert_list(text,text,text,text[],integer)'), true);
  assert.equal(await granted('public.pennsync_contract_alert_update(text,text,text,text)'), true);
  // Neither contract asks about a care team: D24 answers that in the policies,
  // and a copy here would be a second answer to keep in agreement.
  const sql = readFileSync(resolve(repository, ALERT), 'utf8');
  assert.equal(/assigned_nurses/.test(sql.replace(/^--.*$/gm, '')), false,
    'the address list is named only in the header that rejects it');
  assert.equal(/caller_assigned_patients|caller_opens_every_chart/.test(sql), false,
    'the chart narrowing is the policies\' and is not restated');
});
