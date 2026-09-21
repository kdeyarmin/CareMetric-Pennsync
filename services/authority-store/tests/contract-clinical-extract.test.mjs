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
 * Recording the clinical events a model extracted from a visit note.
 *
 * The property worth the file is divergence 3: the original builds its row as
 * `{ patient_id, visit_id, event_date, ...event, … }` — EVERY key the model
 * returned, spread into a create. Ten named fields are stored here and
 * anything else is ignored, which is D54's rule rather than D59's: a model's
 * extra key is not an operator's typo. The rest is the shape D58 set, with the
 * claim token replaced by the lock it was emulating.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const EXTRACT = 'services/authority-store/supabase/record-migrations/'
  + '20260920450000_contract_clinical_extract.sql';
const ORIGINAL = 'base44/functions/extractClinicalEvents/entry.ts';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const email = n => ['', 'admin-a', 'clinician-a', 'clinician-empty', 'admin-b'][n]
  + '@example.invalid';
const CLINICIAN_A = 2; const CLINICIAN_EMPTY = 3; const ADMIN_B = 4;
const CONTEXT = 'select "public"."pennsync_contract_clinical_extract_context"($1,$2,$3) as result';
const RECORD = 'select "public"."pennsync_contract_clinical_extract_record"($1,$2,$3,$4) as result';
const A = 'agency-a'; const B = 'agency-b';
const EVENT = Object.freeze({
  event_type: 'fall', event_title: 'Unwitnessed fall in bathroom',
  event_description: 'Patient found on floor, denies injury', severity: 'high',
  requires_followup: true, followup_notes: 'Call MD within 24 hours',
  source_text: 'Found on floor', source_section: 'objective',
  extraction_confidence: 92, text_anchor_start: 14, text_anchor_end: 28,
});
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, EXTRACT]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  for (const [id, agency, first, last] of [
    ['patient-a1', A, 'Ada', 'Lovelace'],
    ['patient-a2', A, 'Grace', 'Hopper'],
    ['patient-b1', B, 'Katherine', 'Johnson'],
  ]) {
    await db.query(`insert into ${SCHEMA}."patient"("source_app_id","id","agency_id",
      "first_name","last_name") values ($1,$2,$3,$4,$5)`, [APP, id, agency, first, last]);
  }
  for (const [id, agency, patient, date] of [
    ['visit-a1', A, 'patient-a1', '2026-06-15'], ['visit-a1b', A, 'patient-a1', '2026-07-01'],
    ['visit-a2', A, 'patient-a2', '2026-06-20'], ['visit-b1', B, 'patient-b1', '2026-06-25'],
  ]) {
    await db.query(`insert into ${SCHEMA}."visit"("source_app_id","id","agency_id",
      "patient_id","visit_date") values ($1,$2,$3,$4,$5)`, [APP, id, agency, patient, date]);
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
const context = (n, patient = 'patient-a1', visit = 'visit-a1', agency = A) =>
  as(n, CONTEXT, [agency, patient, visit]);
const record = (n, events, options = {}) => as(n, RECORD, [
  options.agency ?? A, options.patient ?? 'patient-a1', options.visit ?? 'visit-a1',
  JSON.stringify(events)]);
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);
const reset = async () => {
  for (const table of ['clinical_event', 'patient_alert', 'task']) {
    await db.query(`delete from ${SCHEMA}."${table}"`);
  }
  await db.query(`update ${SCHEMA}."visit" set "events_extracted_at" = null`);
};
const events = async () => (await db.query(
  `select * from ${SCHEMA}."clinical_event" order by "event_title"`)).rows;

test('the chart decides, and the visit must be its own', async () => {
  await reset();
  await refusal(context(CLINICIAN_EMPTY), 'PENNSYNC_EXTRACT_PATIENT_NOT_VISIBLE');
  await refusal(context(CLINICIAN_A, 'patient-a2', 'visit-a2'),
    'PENNSYNC_EXTRACT_PATIENT_NOT_VISIBLE');
  await refusal(context(ADMIN_B, 'patient-a1', 'visit-a1', A), 'PENNSYNC_EXTRACT_AGENCY_NOT_HELD');
  await refusal(context(CLINICIAN_A, 'patient-a1', 'visit-a2'), 'PENNSYNC_EXTRACT_VISIT_NOT_FOUND');
  await refusal(context(CLINICIAN_A, 'patient-a1', null), 'PENNSYNC_EXTRACT_SUBJECT_INVALID');
  await refusal(record(CLINICIAN_EMPTY, [EVENT]), 'PENNSYNC_EXTRACT_PATIENT_NOT_VISIBLE');
  const ok = await context(CLINICIAN_A);
  assert.equal(ok.already_processed, false);
  // Divergence 2: the visit's own date comes back; the original takes one
  // from the request body and stamps it on every event.
  assert.equal(String(ok.visit_date).slice(0, 10), '2026-06-15');
  const original = readFileSync(resolve(repository, ORIGINAL), 'utf8');
  assert.match(original, /const \{ visit_id, patient_id, nurse_notes, visit_date \} = await req\.json\(\)/,
    'the original still takes the date from the caller');
});

test('only the ten fields the response schema declares are stored', async () => {
  // Divergence 3, and the whole point of the file. The original spreads every
  // key the model returned into its create.
  await reset();
  const result = await record(CLINICIAN_A, [{
    ...EVENT,
    verified: true, verified_by: 'someone@example.invalid',
    patient_id: 'patient-a2', visit_id: 'visit-a2', id: 'chosen-id',
    event_date: '1999-01-01', created_by: 'someone@example.invalid',
    unknown_column: 'x',
  }]);
  assert.equal(result.events_extracted, 1);
  const [row] = await events();
  assert.equal(row.patient_id, 'patient-a1', 'not the one the model named');
  assert.equal(row.visit_id, 'visit-a1');
  assert.notEqual(row.id, 'chosen-id');
  // PGlite hands back a `Date`, so compare the day rather than the rendering.
  assert.equal(new Date(row.event_date).toISOString().slice(0, 10), '2026-06-15',
    'the visit s date, not the one the model named');
  assert.equal(row.verified, false, 'never what the model said');
  assert.equal(row.verified_by, null);
  assert.equal(row.created_by, email(CLINICIAN_A));
  assert.equal(row.event_title, 'Unwitnessed fall in bathroom');
  assert.equal(row.source_text, 'Found on floor');
  assert.equal(row.source_section, 'objective');
  assert.equal(row.extraction_confidence, 92);
  assert.equal(row.text_anchor_start, 14);
  assert.equal(row.text_anchor_end, 28);
});

test('an out-of-enum value is coerced, as the original coerces it', async () => {
  // Not diverged: the original has this guard and says why — "coerce any AI
  // value outside these sets to a safe default so ClinicalEvent.create won't
  // reject the record".
  await reset();
  await record(CLINICIAN_A, [
    { ...EVENT, event_title: 'A', event_type: 'telepathy', severity: 'catastrophic' },
    { ...EVENT, event_title: 'B', event_type: 'FALL', severity: 'HIGH' },
    { ...EVENT, event_title: 'C' },
  ]);
  assert.deepEqual((await events()).map(e => [e.event_title, e.event_type, e.severity]), [
    ['A', 'other', 'medium'],
    // The original's `Set.has` is case-SENSITIVE, so `FALL` is not `fall`.
    ['B', 'other', 'medium'],
    ['C', 'fall', 'high'],
  ]);
  const original = readFileSync(resolve(repository, ORIGINAL), 'utf8');
  assert.match(original, /ALLOWED_EVENT_TYPES\.has\(event\.event_type\) \? event\.event_type : 'other'/);
  assert.match(original, /ALLOWED_SEVERITIES\.has\(event\.severity\) \? event\.severity : 'medium'/);
});

test('a follow-up event makes a task, and a severe one makes an alert', async () => {
  await reset();
  const result = await record(CLINICIAN_A, [
    { ...EVENT, event_title: 'Fall', event_type: 'fall', severity: 'critical' },
    { ...EVENT, event_title: 'Med change', event_type: 'medication_change',
      severity: 'low', requires_followup: true },
    { ...EVENT, event_title: 'Wound', event_type: 'wound_new', severity: 'high',
      requires_followup: false },
    { ...EVENT, event_title: 'Quiet', event_type: 'other', severity: 'low',
      requires_followup: false },
  ]);
  assert.equal(result.events_extracted, 4);
  assert.equal(result.tasks_created, 2);
  assert.equal(result.alerts_created, 2);
  const tasks = (await db.query(`select * from ${SCHEMA}."task" order by "title"`)).rows;
  assert.deepEqual(tasks.map(t => [t.title, t.type, t.priority, t.due_timeframe]), [
    ['Follow-up: Fall', 'safety', 'high', 'today'],
    ['Follow-up: Med change', 'call', 'medium', '48_hours'],
  ]);
  // Divergence 5: the caller, not the chart's creator.
  assert.deepEqual([...new Set(tasks.map(t => t.assigned_to))], [email(CLINICIAN_A)]);
  assert.deepEqual([...new Set(tasks.map(t => t.agency_id))], [A]);
  // The original leaves `due_date` unset on these, and so does this.
  assert.deepEqual([...new Set(tasks.map(t => t.due_date))], [null]);
  assert.deepEqual([...new Set(tasks.map(t => t.source))], ['ai_generated']);
  const alerts = (await db.query(`select * from ${SCHEMA}."patient_alert" order by "title"`)).rows;
  assert.deepEqual(alerts.map(a => [a.title, a.alert_type, a.severity, a.flagged_urgent]), [
    ['Fall', 'fall_risk', 'critical', true],
    ['Wound', 'urgent_intervention', 'high', false],
  ]);
  assert.deepEqual(alerts[0].contributing_factors, ['fall', 'Detected from visit visit-a1']);
  assert.equal(alerts[0].data_sources.visit_id, 'visit-a1');
  assert.deepEqual(alerts[0].recommended_actions, ['Call MD within 24 hours']);
});

test('the alert-type ladder is the original s, later tests winning', async () => {
  await reset();
  await record(CLINICIAN_A, [
    { ...EVENT, event_title: 'A', event_type: 'medication_change', severity: 'high' },
    { ...EVENT, event_title: 'B', event_type: 'fall', severity: 'high' },
    { ...EVENT, event_title: 'C', event_type: 'vital_change', severity: 'high' },
    { ...EVENT, event_title: 'D', event_type: 'infection', severity: 'high' },
    { ...EVENT, event_title: 'E', event_type: 'cognitive_change', severity: 'high' },
    { ...EVENT, event_title: 'F', event_type: 'surgery', severity: 'high' },
  ]);
  const alerts = (await db.query(`select "title","alert_type" from ${SCHEMA}."patient_alert"
    order by "title"`)).rows;
  assert.deepEqual(alerts.map(a => a.alert_type), ['medication_risk', 'fall_risk',
    'vital_deterioration', 'infection_risk', 'symptom_escalation', 'urgent_intervention']);
});

test('a visit already extracted is a no-op, with no claim to lose', async () => {
  await reset();
  assert.equal((await record(CLINICIAN_A, [EVENT])).events_extracted, 1);
  const second = await record(CLINICIAN_A, [EVENT]);
  assert.equal(second.already_processed, true);
  assert.equal(second.events_extracted, 0);
  assert.equal((await events()).length, 1);
  assert.equal((await context(CLINICIAN_A)).already_processed, true);
  // The stamp lands in the same transaction as the writes.
  const [visit] = (await db.query(
    `select "events_extracted_at" as t from ${SCHEMA}."visit" where "id" = 'visit-a1'`)).rows;
  assert.notEqual(visit.t, null);
  // Divergence 4: no claim column, here or in the contract's text.
  const body = readFileSync(resolve(repository, EXTRACT), 'utf8')
    .split('\n').filter(line => !line.trim().startsWith('--')).join('\n');
  assert.equal(body.includes('events_extract_claimed_by'), false);
  assert.equal((await db.query(
    `select "events_extract_claimed_by" as c from ${SCHEMA}."visit" where "id" = 'visit-a1'`
  )).rows[0].c, null);
});

test('an event with no title is skipped and counted, never written', async () => {
  // Nothing downstream can name it: the task title and the alert title are
  // both built from it.
  await reset();
  const result = await record(CLINICIAN_A, [
    EVENT, { ...EVENT, event_title: '' }, { ...EVENT, event_title: '  ' },
    { ...EVENT, event_title: 42 }, null, 'not an object']);
  assert.equal(result.events_extracted, 1);
  assert.equal(result.events_skipped, 5);
  await refusal(record(CLINICIAN_A, { event_title: 'an object' }), 'PENNSYNC_EXTRACT_INVALID');
  await refusal(record(CLINICIAN_A, Array.from({ length: 201 }, () => EVENT)),
    'PENNSYNC_EXTRACT_TOO_MANY');
});
