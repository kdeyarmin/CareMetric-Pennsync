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
 * Recording the supplies a visit consumed.
 *
 * The property the file exists for is the DEFECT this port found, and the test
 * proves it rather than asserting it: the original creates a reorder `Task`
 * with no `patient_id` and a `SupplyLowStockAlert` pointing at that task, and
 * in this store `task` reaches tenancy through `patient_id` while
 * `supply_low_stock_alert` reaches it through `task_id` — so both would be
 * written where nobody can read them. One test seeds exactly that pair and
 * shows the caller sees neither; the next shows the contract's pair, stamped
 * with the authorized chart, is visible to the clinician it is assigned to.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const TIME_OFF = 'services/authority-store/supabase/record-migrations/'
  + '20260920230000_contract_time_off.sql';
const CREDENTIAL_SWEEP = 'services/authority-store/supabase/record-migrations/'
  + '20260920340000_contract_credential_sweep.sql';
const SUPPLY = 'services/authority-store/supabase/record-migrations/'
  + '20260920390000_contract_visit_supply.sql';
const ORIGINAL = 'base44/functions/analyzeVisitForSupplyUsage/entry.ts';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const email = n => ['', 'admin-a', 'clinician-a', 'clinician-empty', 'admin-b'][n]
  + '@example.invalid';
const ADMIN_A = 1; const CLINICIAN_A = 2; const CLINICIAN_EMPTY = 3; const ADMIN_B = 4;
const CONTEXT = 'select "public"."pennsync_contract_visit_supply_context"($1,$2,$3) as result';
const RECORD = 'select "public"."pennsync_contract_visit_supply_record"($1,$2,$3,$4) as result';
const A = 'agency-a'; const B = 'agency-b';
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  // The credential sweep carries `agency_today`, this contract's notion of day.
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, TIME_OFF,
    CREDENTIAL_SWEEP, SUPPLY]) {
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
  for (const [id, agency, patient] of [
    ['visit-a1', A, 'patient-a1'], ['visit-a1b', A, 'patient-a1'],
    ['visit-a2', A, 'patient-a2'], ['visit-b1', B, 'patient-b1'],
  ]) {
    await db.query(`insert into ${SCHEMA}."visit"
      ("source_app_id","id","agency_id","patient_id") values ($1,$2,$3,$4)`,
    [APP, id, agency, patient]);
  }

  // See `reads` below: lent to this database only, so a test can ask a table
  // what the caller can see.
  await db.exec(`grant usage on schema ${SCHEMA} to authenticated;
    grant select on all tables in schema ${SCHEMA} to authenticated;
    grant execute on function ${SCHEMA}.caller_identity(), ${SCHEMA}.caller_identified(),
      ${SCHEMA}.caller_agencies(), ${SCHEMA}.caller_user_id(), ${SCHEMA}.caller_roster_ids(),
      ${SCHEMA}.caller_tenant_role(text), ${SCHEMA}.caller_opens_every_chart(text),
      ${SCHEMA}.caller_assigned_patients(text),
      ${SCHEMA}.caller_email(), ${SCHEMA}.deployment_app() to authenticated;`);
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
/**
 * Read a record table under a caller's own policies.
 *
 * `record-tenant-isolation.test.mjs`'s idiom, for its reason: the policies are
 * what decide, and the store grants their helpers to the record owner alone,
 * so a suite that wants to ask a table directly lends them to `authenticated`
 * in its OWN database. The role stays `authenticated` because
 * `pennsync_private.actor` requires it — a `set role` to the owner makes every
 * caller helper answer null, which would prove nothing about visibility.
 */
async function reads(n, sql, params = []) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
    const { rows } = await db.query(sql, params);
    await db.exec('commit');
    return rows;
  } catch (error) { await db.exec('rollback'); throw error; }
}
const context = (n, patient = 'patient-a1', visit = 'visit-a1', agency = A) =>
  as(n, CONTEXT, [agency, patient, visit]);
const record = (n, supplies, options = {}) => as(n, RECORD, [
  options.agency ?? A, options.patient ?? 'patient-a1',
  options.visit === undefined ? 'visit-a1' : options.visit, JSON.stringify(supplies)]);
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);

let nextId = 0;
const supply = (id, agency, name, quantity, threshold, extra = {}) => db.query(
  `insert into ${SCHEMA}."supply_item"("source_app_id","id","agency_id","name",
     "current_quantity","low_stock_threshold","reorder_quantity","unit","status","created_date")
   values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
  [APP, id, agency, name, quantity, threshold, extra.reorder ?? 50,
    extra.unit ?? 'boxes', extra.status ?? 'in_stock',
    extra.created ?? new Date(Date.now() - (nextId += 1) * 1000).toISOString()]);
const reset = async () => {
  for (const table of ['supply_low_stock_alert', 'task', 'supply_usage_log', 'supply_item']) {
    await db.query(`delete from ${SCHEMA}."${table}"`);
  }
};
const logs = async () => (await db.query(
  `select * from ${SCHEMA}."supply_usage_log" order by "supply_id","id"`)).rows;
const itemOf = async id => (await db.query(
  `select * from ${SCHEMA}."supply_item" where "id" = $1`, [id])).rows[0];

test('the chart decides who may record against it, not a nurse list', async () => {
  await reset();
  await supply('sup-1', A, 'Gauze 4x4', 100, 10);
  const one = [{ name: 'gauze', quantity: 2, unit: 'boxes', purpose: 'wound care' }];
  await refusal(context(CLINICIAN_EMPTY), 'PENNSYNC_VISIT_SUPPLY_PATIENT_NOT_VISIBLE');
  await refusal(record(CLINICIAN_EMPTY, one), 'PENNSYNC_VISIT_SUPPLY_PATIENT_NOT_VISIBLE');
  await refusal(context(CLINICIAN_A, 'patient-a2', 'visit-a2'),
    'PENNSYNC_VISIT_SUPPLY_PATIENT_NOT_VISIBLE');
  await refusal(context(ADMIN_B, 'patient-a1', 'visit-a1', A),
    'PENNSYNC_VISIT_SUPPLY_AGENCY_NOT_HELD');
  // A visit is only ever a subject of its own chart.
  await refusal(context(CLINICIAN_A, 'patient-a1', 'visit-a2'),
    'PENNSYNC_VISIT_SUPPLY_VISIT_NOT_FOUND');
  await refusal(record(CLINICIAN_A, one, { visit: 'visit-b1' }),
    'PENNSYNC_VISIT_SUPPLY_VISIT_NOT_FOUND');
  await refusal(context(CLINICIAN_A, 'patient a1!'), 'PENNSYNC_VISIT_SUPPLY_SUBJECT_INVALID');
  const ok = await context(CLINICIAN_A);
  assert.deepEqual(ok, { success: true, patient_id: 'patient-a1', visit_id: 'visit-a1',
    patient_name: 'Ada Lovelace' });
  // An agency administrator opens every chart under D24.
  assert.equal((await context(ADMIN_A, 'patient-a2', 'visit-a2')).visit_id, 'visit-a2');
});

test('a reorder task names no patient, and the agency can still read it', async () => {
  // The defect this port found, and what D61 did with it. The original creates
  // a `Task` with no `patient_id` and an alert naming that task; until D61 both
  // tables reached tenancy ONLY through that optional column, so the pair was
  // in no tenant and this test asserted that nobody could read it. D61 gave the
  // two tables an `agency_id`, so the row is visible to the agency it belongs
  // to — and to nobody outside it.
  await reset();
  await db.query(`insert into ${SCHEMA}."task"
    ("source_app_id","id","agency_id","title","status","assigned_to")
    values ($1,'agency-task',$2,'Reorder Gauze','pending',$3)`,
  [APP, A, email(CLINICIAN_A)]);
  await db.query(`insert into ${SCHEMA}."supply_low_stock_alert"
    ("source_app_id","id","agency_id","supply_id","status","task_id")
    values ($1,'agency-alert',$2,'sup-1','active','agency-task')`, [APP, A]);
  for (const caller of [CLINICIAN_A, ADMIN_A, CLINICIAN_EMPTY]) {
    assert.equal((await reads(caller,
      `select "id" from ${SCHEMA}."task" where "id" = 'agency-task'`)).length, 1,
    'a task with no subject is the agency\'s, not nobody\'s');
    assert.equal((await reads(caller,
      `select "id" from ${SCHEMA}."supply_low_stock_alert" where "id" = 'agency-alert'`)).length, 1);
  }
  // And it stops at the agency boundary.
  assert.deepEqual(await reads(ADMIN_B,
    `select "id" from ${SCHEMA}."task" where "id" = 'agency-task'`), []);
  assert.deepEqual(await reads(ADMIN_B,
    `select "id" from ${SCHEMA}."supply_low_stock_alert" where "id" = 'agency-alert'`), []);
  // The column is NOT NULL, so the orphan this test used to demonstrate can no
  // longer be written at all.
  await assert.rejects(() => db.query(`insert into ${SCHEMA}."task"
    ("source_app_id","id","title") values ($1,'orphan-task','Reorder')`, [APP]),
  error => /agency_id/.test(String(error?.message ?? error)));
});

test('the reorder task is the agency s, and the assignee can read it', async () => {
  await reset();
  await supply('sup-low', A, 'Wound gel', 12, 10, { unit: 'tubes', reorder: 24 });
  const result = await record(CLINICIAN_A, [
    { name: 'wound gel', quantity: 4, unit: 'tubes', purpose: 'dressing change' }]);
  assert.equal(result.usageLogs, 1);
  assert.equal(result.alertsCreated, 1);
  const [alert] = result.alerts;
  assert.equal(alert.supply_id, 'sup-low');
  assert.equal(alert.severity, 'warning');
  assert.equal(alert.current_quantity, 8);
  assert.equal(alert.reorder_task_created, true);

  // The whole point: the clinician the task is assigned to can read it, and
  // the alert that names it.
  const [task] = await reads(CLINICIAN_A,
    `select * from ${SCHEMA}."task" where "id" = $1`, [alert.task_id]);
  assert.equal(task.agency_id, A, 'stamped with the agency D61 gave the table');
  assert.equal(task.patient_id, null, 'and no subject, exactly as the original has it');
  assert.equal(task.assigned_to, email(CLINICIAN_A));
  assert.equal(task.title, 'Reorder Wound gel');
  assert.equal(task.priority, 'medium');
  assert.equal(task.status, 'pending');
  assert.match(task.description, /^Wound gel is running low\. Current: 8 tubes, /);
  assert.match(task.description, /recommend reordering 24 units\.$/);
  assert.equal((await reads(CLINICIAN_A,
    `select "id" from ${SCHEMA}."supply_low_stock_alert" where "id" = $1`,
    [alert.id])).length, 1);
  // A colleague who opens no chart still sees it, because a reorder task is
  // the agency's inventory problem rather than anybody's chart.
  assert.equal((await reads(CLINICIAN_EMPTY,
    `select "id" from ${SCHEMA}."task" where "id" = $1`, [alert.task_id])).length, 1);
  assert.deepEqual(await reads(ADMIN_B,
    `select "id" from ${SCHEMA}."task" where "id" = $1`, [alert.task_id]), []);

  const [log] = await logs();
  assert.equal(log.supply_id, 'sup-low');
  assert.equal(log.supply_name, 'Wound gel');
  assert.equal(log.patient_id, 'patient-a1');
  assert.equal(log.visit_id, 'visit-a1');
  assert.equal(log.quantity_used, 4);
  assert.equal(log.unit, 'tubes');
  assert.equal(log.notes, 'dressing change');
  assert.equal(log.documented_by, email(CLINICIAN_A));
  assert.equal(log.extracted_from_note, true);
  assert.equal(log.extraction_confidence, 85);
  const item = await itemOf('sup-low');
  assert.equal(item.current_quantity, 8);
  assert.equal(item.status, 'low_stock');
});

test('the severity tiers are the originals, and a null threshold raises nothing', async () => {
  await reset();
  await supply('sup-out', A, 'Catheter kit', 3, 10);
  await supply('sup-crit', A, 'Saline flush', 40, 100);
  await supply('sup-none', A, 'Tape', 1, null);
  const result = await record(CLINICIAN_A, [
    { name: 'catheter kit', quantity: 5 },   // 3 - 5 -> 0, out_of_stock
    { name: 'saline flush', quantity: 25 },  // 40 - 25 -> 15 <= 30, critical
    { name: 'tape', quantity: 1 },           // threshold null: no alert at all
  ]);
  assert.equal(result.usageLogs, 3);
  const by = Object.fromEntries(result.alerts.map(a => [a.supply_id, a]));
  assert.equal(by['sup-out'].severity, 'out_of_stock');
  assert.equal(by['sup-crit'].severity, 'critical');
  assert.equal(by['sup-none'], undefined, 'a null threshold is falsy there and here');
  assert.equal(result.alertsCreated, 2);
  assert.equal((await itemOf('sup-out')).current_quantity, 0, 'never below zero');
  assert.equal((await itemOf('sup-out')).status, 'out_of_stock');
  // Zero is `out_of_stock` whatever the threshold, and a null threshold still
  // raises no alert — both are the original's, one line apart in its source.
  assert.equal((await itemOf('sup-none')).current_quantity, 0);
  assert.equal((await itemOf('sup-none')).status, 'out_of_stock');
  // Out of stock and critical are both high priority; warning is medium.
  const priorities = await reads(CLINICIAN_A,
    `select "priority" from ${SCHEMA}."task" order by "title"`);
  assert.deepEqual(priorities.map(r => r.priority), ['high', 'high']);
});

test('the same visit twice records once, with no claim token to lose', async () => {
  // Divergence 3. The original writes a claim to the visit and reads it back;
  // here the record contract locks the visit row and skips what is already
  // logged against it, so a retry is a no-op.
  await reset();
  await supply('sup-keep', A, 'Gloves', 100, 10);
  const one = [{ name: 'gloves', quantity: 5 }];
  assert.equal((await record(CLINICIAN_A, one)).usageLogs, 1);
  assert.equal((await record(CLINICIAN_A, one)).usageLogs, 0, 'the retry logs nothing');
  assert.equal((await logs()).length, 1);
  assert.equal((await itemOf('sup-keep')).current_quantity, 95, 'decremented once');
  // A different visit on the same chart is a different consumption.
  assert.equal((await record(CLINICIAN_A, one, { visit: 'visit-a1b' })).usageLogs, 1);
  assert.equal((await itemOf('sup-keep')).current_quantity, 90);
  // With no visit there is no dedupe, which is the original's behaviour too.
  assert.equal((await record(CLINICIAN_A, one, { visit: null })).usageLogs, 1);
  assert.equal((await record(CLINICIAN_A, one, { visit: null })).usageLogs, 1);
  assert.equal((await itemOf('sup-keep')).current_quantity, 80);
  // And the claim column is never touched, here or in the contract's text.
  const source = readFileSync(resolve(repository, SUPPLY), 'utf8');
  const body = source.split('\n').filter(line => !line.trim().startsWith('--')).join('\n');
  assert.equal(body.includes('supply_usage_claimed_by'), false);
  assert.equal((await db.query(
    `select "supply_usage_claimed_by" as c from ${SCHEMA}."visit" where "id" = 'visit-a1'`
  )).rows[0].c, null);
});

test('two line items for one supply both log and both decrement', async () => {
  // Not diverged. The original builds its already-logged set once, before the
  // loop, so a second match in the SAME run is a second consumption.
  await reset();
  await supply('sup-two', A, 'Syringes', 100, 10);
  const result = await record(CLINICIAN_A, [
    { name: 'syringes', quantity: 3 }, { name: 'syringes', quantity: 4 }]);
  assert.equal(result.usageLogs, 2);
  assert.equal((await itemOf('sup-two')).current_quantity, 93);
  assert.equal(result.alertsCreated, 0);
});

test('a malformed extraction is skipped, never refused', async () => {
  // The original guards each element and says why: "an unchecked value would
  // throw on .toLowerCase() or write NaN into the shared SupplyItem inventory."
  // Refusing the batch would throw away the extractions that were good.
  await reset();
  await supply('sup-ok', A, 'Bandage', 100, 10);
  const result = await record(CLINICIAN_A, [
    null, 'not an object', 42, {}, { name: 'bandage' }, { quantity: 3 },
    { name: '', quantity: 3 }, { name: 'bandage', quantity: 0 },
    { name: 'bandage', quantity: -2 }, { name: 'bandage', quantity: 'three' },
    { name: 'nothing we stock', quantity: 3 },
    { name: 'bandage', quantity: 6 },
  ]);
  assert.equal(result.usageLogs, 1, 'only the last one is a usage record');
  assert.equal((await itemOf('sup-ok')).current_quantity, 94);
  await refusal(record(CLINICIAN_A, { name: 'an object, not an array' }),
    'PENNSYNC_VISIT_SUPPLY_INVALID');
  await refusal(record(CLINICIAN_A, Array.from({ length: 101 }, () => ({ name: 'x', quantity: 1 }))),
    'PENNSYNC_VISIT_SUPPLY_TOO_MANY');
});

test("another agency's supply absorbs none of this agency's usage", async () => {
  // Divergence 5. The original matches against the five thousand newest
  // supplies in the DEPLOYMENT, and this capability WRITES to what it matches.
  await reset();
  await supply('sup-b', B, 'Nebulizer mask', 500, 10);
  assert.equal((await record(CLINICIAN_A, [{ name: 'nebulizer mask', quantity: 5 }])).usageLogs, 0);
  assert.equal((await itemOf('sup-b')).current_quantity, 500, 'untouched');
  assert.deepEqual(await logs(), []);
});

test('the match is the original s containment, in either direction, newest first', async () => {
  await reset();
  // "gauze" is contained by both names; the newer row is the one `.find()` hits.
  await supply('sup-old', A, 'Sterile gauze pads', 100, 10,
    { created: '2026-01-01T00:00:00Z' });
  await supply('sup-new', A, 'Gauze', 100, 10, { created: '2026-06-01T00:00:00Z' });
  assert.equal((await record(CLINICIAN_A, [{ name: 'sterile gauze pads 4x4', quantity: 1 }]))
    .usageLogs, 1);
  // The extracted name CONTAINS 'Gauze', so the newer row matches first — the
  // containment is symmetric there and here.
  assert.equal((await itemOf('sup-new')).current_quantity, 99);
  assert.equal((await itemOf('sup-old')).current_quantity, 100);
  // A name with pattern characters in it is a literal, not a LIKE expression.
  assert.equal((await record(CLINICIAN_A, [{ name: '%', quantity: 1 }],
    { visit: 'visit-a1b' })).usageLogs, 0);
});

test('an alert already open for a supply is not opened again', async () => {
  // Divergence 6: over the alerts this caller can see, which is what the
  // original's filter saw and no more than the policies allow.
  await reset();
  await supply('sup-once', A, 'Dressings', 12, 10);
  assert.equal((await record(CLINICIAN_A, [{ name: 'dressings', quantity: 3 }])).alertsCreated, 1);
  assert.equal((await record(CLINICIAN_A, [{ name: 'dressings', quantity: 3 }],
    { visit: 'visit-a1b' })).alertsCreated, 0);
  assert.equal((await reads(CLINICIAN_A,
    `select "id" from ${SCHEMA}."supply_low_stock_alert"`)).length, 1);
  // A second line item in ONE run sees the alert this run just opened.
  await reset();
  await supply('sup-same', A, 'Pads', 12, 10);
  const result = await record(CLINICIAN_A, [
    { name: 'pads', quantity: 3 }, { name: 'pads', quantity: 1 }]);
  assert.equal(result.usageLogs, 2);
  assert.equal(result.alertsCreated, 1);
});

test('the port keeps the original s own guards, read from its source', async () => {
  const original = readFileSync(resolve(repository, ORIGINAL), 'utf8');
  // The three the contract reproduces, quoted from the file rather than
  // remembered: the extraction guard, the claim it replaces, and the
  // patient-less task it corrects.
  assert.match(original, /Need at least|guard against a missing name/);
  assert.match(original, /supply_usage_claimed_by/);
  assert.match(original, /extraction_confidence: 85/);
  // The task the original creates names no patient. If that ever changes
  // upstream, divergence 2 stops being a correction and this test says so.
  const taskCreate = original.slice(original.indexOf('entities.Task.create('));
  assert.equal(taskCreate.slice(0, taskCreate.indexOf('});')).includes('patient_id'), false,
    "the original's reorder task still names no patient");
});
