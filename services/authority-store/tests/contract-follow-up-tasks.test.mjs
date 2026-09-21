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
 * Recording the follow-up tasks a finalized note implies.
 *
 * Three properties carry the file. The chart decides, replacing an
 * `assigned_nurses` read AND a `SUPER_ADMIN_EMAIL` environment read — the only
 * reason this capability was ever counted against a secret. A value the MODEL
 * supplies is checked against the column's own enum (D54), because the
 * original writes them through a `Promise.all` where one check violation loses
 * the whole batch. And the visit claim token is replaced by the lock it was
 * emulating, with the original's own dedupe doing the work it actually relied
 * on.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const PURPOSE = 'services/authority-store/supabase/record-migrations/'
  + '20260920050000_patient_purpose_policy.sql';
const SWEEP = 'services/authority-store/supabase/record-migrations/'
  + '20260920340000_contract_credential_sweep.sql';
const TIME_OFF = 'services/authority-store/supabase/record-migrations/'
  + '20260920230000_contract_time_off.sql';
const FOLLOW_UP = 'services/authority-store/supabase/record-migrations/'
  + '20260920420000_contract_follow_up_tasks.sql';
const ORIGINAL = 'base44/functions/generateFollowUpTasks/entry.ts';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const email = n => ['', 'admin-a', 'clinician-a', 'clinician-empty', 'admin-b'][n]
  + '@example.invalid';
const CLINICIAN_A = 2; const CLINICIAN_EMPTY = 3; const ADMIN_B = 4;
const CONTEXT = 'select "public"."pennsync_contract_follow_up_context"($1,$2,$3) as result';
const RECORD = 'select "public"."pennsync_contract_follow_up_record"($1,$2,$3,$4) as result';
const A = 'agency-a'; const B = 'agency-b';
const TASK = Object.freeze({
  title: 'Contact MD re: elevated BP', description: 'BP 172/96 at visit',
  type: 'call', priority: 'high', due_timeframe: '24_hours',
  ai_reason: 'Documented hypertensive reading',
});
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, PURPOSE,
    TIME_OFF, SWEEP, FOLLOW_UP]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  for (const [id, agency, first, last] of [
    ['patient-a1', A, 'Ada', 'Lovelace'],
    ['patient-a2', A, 'Grace', 'Hopper'],
    ['patient-b1', B, 'Katherine', 'Johnson'],
  ]) {
    await db.query(`insert into ${SCHEMA}."patient"("source_app_id","id","agency_id",
      "first_name","last_name","primary_diagnosis","secondary_diagnoses","address")
      values ($1,$2,$3,$4,$5,'CHF','["COPD","Diabetes"]'::jsonb,'12 Ada Way')`,
    [APP, id, agency, first, last]);
  }
  for (const [id, agency, patient] of [
    ['visit-a1', A, 'patient-a1'], ['visit-a1b', A, 'patient-a1'],
    ['visit-a2', A, 'patient-a2'], ['visit-b1', B, 'patient-b1'],
  ]) {
    await db.query(`insert into ${SCHEMA}."visit"("source_app_id","id","agency_id","patient_id")
      values ($1,$2,$3,$4)`, [APP, id, agency, patient]);
  }
});
after(async () => db?.close());

async function as(n, sql, params = [], commit = true) {
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
const context = (n, patient = 'patient-a1', visit = 'visit-a1', agency = A) =>
  as(n, CONTEXT, [agency, patient, visit]);
const record = (n, tasks, options = {}) => as(n, RECORD, [
  options.agency ?? A, options.patient ?? 'patient-a1',
  options.visit === undefined ? 'visit-a1' : options.visit, JSON.stringify(tasks)]);
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);
const reset = () => db.query(`delete from ${SCHEMA}."task"`);
const tasks = async () => (await db.query(
  `select * from ${SCHEMA}."task" order by "title"`)).rows;

test('the chart decides, and no environment variable does', async () => {
  // The original reads `created_by` and `assigned_nurses` off the patient row
  // and then admits a `SUPER_ADMIN_EMAIL` read on top — the platform tier D14
  // and D22 removed, and the only reason this was ever counted against a
  // secret.
  await reset();
  await refusal(context(CLINICIAN_EMPTY), 'PENNSYNC_FOLLOW_UP_PATIENT_NOT_VISIBLE');
  await refusal(context(CLINICIAN_A, 'patient-a2', 'visit-a2'),
    'PENNSYNC_FOLLOW_UP_PATIENT_NOT_VISIBLE');
  await refusal(context(ADMIN_B, 'patient-a1', 'visit-a1', A),
    'PENNSYNC_FOLLOW_UP_AGENCY_NOT_HELD');
  await refusal(context(CLINICIAN_A, 'patient-a1', 'visit-a2'),
    'PENNSYNC_FOLLOW_UP_VISIT_NOT_FOUND');
  await refusal(record(CLINICIAN_EMPTY, [TASK]), 'PENNSYNC_FOLLOW_UP_PATIENT_NOT_VISIBLE');
  const ok = await context(CLINICIAN_A);
  assert.equal(ok.patient_name, 'Ada Lovelace');
  assert.equal(ok.primary_diagnosis, 'CHF');
  assert.deepEqual(ok.secondary_diagnoses, ['COPD', 'Diabetes']);
  const original = readFileSync(resolve(repository, ORIGINAL), 'utf8');
  assert.match(original, /Deno\.env\.get\('SUPER_ADMIN_EMAIL'\)/,
    'the environment read is still in the original');
  const body = readFileSync(resolve(repository, FOLLOW_UP), 'utf8')
    .split('\n').filter(line => !line.trim().startsWith('--')).join('\n');
  for (const gone of ['SUPER_ADMIN_EMAIL', 'assigned_nurses', 'created_by ']) {
    assert.equal(body.includes(gone), false, `the contract must not read ${gone}`);
  }
});

test('the context is the read purpose s projection, and nothing else', async () => {
  // D62's rule, applied a second time: a prompt may carry what a read purpose
  // discloses. `address` is on the patient row and outside the projection.
  const ok = await context(CLINICIAN_A);
  assert.deepEqual(Object.keys(ok).sort(),
    ['patient_id', 'patient_name', 'primary_diagnosis', 'secondary_diagnoses',
      'success', 'visit_id']);
  assert.equal(JSON.stringify(ok).includes('12 Ada Way'), false);
  // And the purpose's own role gate is the gate.
  await db.query(`update pennsync_private.membership set tenant_role = 'office_staff'
    where id = 'membership-2'`);
  await refusal(context(CLINICIAN_A), 'PENNSYNC_FOLLOW_UP_PURPOSE_FORBIDDEN');
  await db.query(`update pennsync_private.membership set tenant_role = 'clinician'
    where id = 'membership-2'`);
});

test('a value the model supplies is checked against the column s own enum', async () => {
  // Divergence 4. The original writes them through, so one plausible but
  // unlisted answer raises a check violation inside a `Promise.all` and loses
  // every task in the batch.
  await reset();
  const result = await record(CLINICIAN_A, [
    { ...TASK, title: 'A', type: 'URGENT CALL', priority: 'Critical', due_timeframe: 'asap' },
    { ...TASK, title: 'B', type: 'Schedule', priority: 'HIGH', due_timeframe: 'TODAY' },
    { title: 'C' },
  ]);
  assert.equal(result.tasks_created, 3, 'nothing is lost');
  const stored = await tasks();
  assert.deepEqual(stored.map(t => [t.title, t.type, t.priority, t.due_timeframe]), [
    // An unrecognised value takes the original's own default for an absent one.
    ['A', 'followup', 'critical', 'next_visit'],
    // Case alone is not an adjustment.
    ['B', 'schedule', 'high', 'today'],
    ['C', 'followup', 'medium', 'next_visit'],
  ]);
  // The due date follows the STORED timeframe, so a row cannot say `today` and
  // mean three days from now — which is what the original writes, because it
  // looks the raw answer up in a case-sensitive map and falls to `?? 3`. An
  // unrecognised answer still lands on 3, since `next_visit` is the
  // substituted default and the map gives it 3.
  const [{ d: today }] = (await db.query(
    `select pg_catalog.to_char(${SCHEMA}.agency_today(), 'YYYY-MM-DD') as d`)).rows;
  const day = n => new Date(`${today}T00:00:00Z`).getTime() + n * 86400000;
  assert.equal(new Date(stored[0].due_date).getTime(), day(3), 'asap is the fallback');
  assert.equal(new Date(stored[1].due_date).getTime(), day(0), 'today is today');
  assert.equal(new Date(stored[2].due_date).getTime(), day(3));
});

test('a task with no title is skipped and counted, never written', async () => {
  await reset();
  const result = await record(CLINICIAN_A, [
    TASK, { ...TASK, title: '' }, { ...TASK, title: '   ' }, { ...TASK, title: 42 },
    null, 'not an object']);
  assert.equal(result.tasks_created, 1);
  assert.equal(result.tasks_skipped, 5);
  assert.equal((await tasks()).length, 1);
  await refusal(record(CLINICIAN_A, { title: 'an object, not an array' }),
    'PENNSYNC_FOLLOW_UP_INVALID');
  await refusal(record(CLINICIAN_A, Array.from({ length: 51 }, () => TASK)),
    'PENNSYNC_FOLLOW_UP_TOO_MANY');
});

test('the row carries the agency D61 gave the table, and the caller', async () => {
  await reset();
  const result = await record(CLINICIAN_A, [TASK]);
  const [row] = await tasks();
  assert.equal(row.agency_id, A);
  assert.equal(row.patient_id, 'patient-a1');
  assert.equal(row.related_visit_id, 'visit-a1');
  assert.equal(row.source, 'ai_generated');
  assert.equal(row.status, 'pending');
  assert.equal(row.assigned_to, email(CLINICIAN_A));
  assert.equal(row.description, 'BP 172/96 at visit');
  assert.equal(row.ai_reason, 'Documented hypertensive reading');
  assert.equal(result.tasks[0].id, row.id);
  // The description falls back to the reason and then to empty.
  await reset();
  await record(CLINICIAN_A, [{ title: 'Reason only', ai_reason: 'Because' },
    { title: 'Neither' }]);
  const fallbacks = await tasks();
  assert.equal(fallbacks.find(t => t.title === 'Reason only').description, 'Because');
  assert.equal(fallbacks.find(t => t.title === 'Neither').description, '');
});

test('a visit that already has AI tasks is a no-op, with no claim to lose', async () => {
  // Divergence 3. The original writes a claim token to the visit and reads it
  // back; the lock plus its own dedupe is what it actually relied on.
  await reset();
  assert.equal((await record(CLINICIAN_A, [TASK])).tasks_created, 1);
  const second = await record(CLINICIAN_A, [TASK]);
  assert.equal(second.already_processed, true);
  assert.equal(second.tasks_created, 0);
  assert.match(second.skipped, /already exist for visit/);
  assert.equal((await tasks()).length, 1);
  // A different visit on the same chart is a different note.
  assert.equal((await record(CLINICIAN_A, [TASK], { visit: 'visit-a1b' })).tasks_created, 1);
  // With no visit there is no dedupe, which is the original's behaviour too.
  assert.equal((await record(CLINICIAN_A, [TASK], { visit: null })).tasks_created, 1);
  assert.equal((await record(CLINICIAN_A, [TASK], { visit: null })).tasks_created, 1);
  const body = readFileSync(resolve(repository, FOLLOW_UP), 'utf8')
    .split('\n').filter(line => !line.trim().startsWith('--')).join('\n');
  assert.equal(body.includes('followup_tasks_claimed_by'), false);
  assert.equal((await db.query(
    `select "followup_tasks_claimed_by" as c from ${SCHEMA}."visit" where "id" = 'visit-a1'`
  )).rows[0].c, null);
});
