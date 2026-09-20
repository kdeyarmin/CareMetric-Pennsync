import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { RECORD_MIGRATION_FILE, SCHEMA } from '../../../tools-entity-schema-plan.mjs';
import { BROKER_MIGRATION_FILE } from '../../../tools-record-brokers.mjs';
import { transpileTs } from '../../../tools-transpile-ts.mjs';

/**
 * Predicting a patient's supply needs.
 *
 * Two properties are worth the file. The authorization is the D21/D24
 * reconstruction one more time — the original's own comment calls its
 * `assigned_nurses` scan an "RLS-independent code check" — and the arithmetic
 * is almost the whole capability, so it is not asserted against retyped
 * expectations here: the parity test lifts the original's own block out of
 * `entry.ts`, runs it, and requires the contract to agree with it term for
 * term. Change the original and this test changes with it.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const TIME_OFF = 'services/authority-store/supabase/record-migrations/'
  + '20260920230000_contract_time_off.sql';
const CREDENTIAL_SWEEP = 'services/authority-store/supabase/record-migrations/'
  + '20260920340000_contract_credential_sweep.sql';
const SUPPLY = 'services/authority-store/supabase/record-migrations/'
  + '20260920380000_contract_supply_prediction.sql';
const ORIGINAL = 'base44/functions/predictSupplyNeeds/entry.ts';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const email = n => ['', 'admin-a', 'clinician-a', 'clinician-empty', 'admin-b'][n]
  + '@example.invalid';
const ADMIN_A = 1; const CLINICIAN_A = 2; const CLINICIAN_EMPTY = 3; const ADMIN_B = 4;
const GENERATE = 'select "public"."pennsync_contract_supply_prediction_generate"($1,$2)'
  + ' as result';
const A = 'agency-a'; const B = 'agency-b';
let db; let months; let today; let stale;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  // The credential sweep carries `agency_today`, which this contract reuses
  // rather than declaring a second notion of the store's own day.
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
  // Every date in this file is relative to the store's own day, so the suite
  // does not start failing when the calendar moves past a hard-coded window.
  ({ rows: [{ today, months, stale }] } = await db.query(`select
    pg_catalog.to_char(${SCHEMA}.agency_today(), 'YYYY-MM-DD') as today,
    array(select pg_catalog.to_char(
      (${SCHEMA}.agency_today() - (k || ' months')::interval)::date, 'YYYY-MM')
      from pg_catalog.generate_series(5, 1, -1) k) as months,
    pg_catalog.to_char(${SCHEMA}.agency_today() - interval '8 months', 'YYYY-MM')
      as stale`));
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
const generate = (n, patient = 'patient-a1', agency = A) =>
  as(n, GENERATE, [agency, patient]);
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);

let nextId = 0;
const supply = (id, agency, name, quantity, threshold) => db.query(
  `insert into ${SCHEMA}."supply_item"("source_app_id","id","agency_id","name",
     "current_quantity","low_stock_threshold") values ($1,$2,$3,$4,$5,$6)`,
  [APP, id, agency, name, quantity, threshold]);
const log = (patient, supplyId, date, quantity) => db.query(
  `insert into ${SCHEMA}."supply_usage_log"("source_app_id","id","patient_id",
     "supply_id","usage_date","quantity_used") values ($1,$2,$3,$4,$5,$6)`,
  [APP, `log-${nextId += 1}`, patient, supplyId, date, quantity]);
// The original's own `usageData` shape, so the parity harness is fed exactly
// what the handler feeds its arithmetic.
const series = async (patient, supplyId, values, day = '15') => {
  const entries = [];
  for (const [index, quantity] of values.entries()) {
    const date = `${months[index]}-${day}`;
    await log(patient, supplyId, date, quantity);
    entries.push({ date, quantity });
  }
  return entries;
};
const reset = async () => {
  for (const table of ['supply_prediction', 'supply_usage_log', 'supply_item']) {
    await db.query(`delete from ${SCHEMA}."${table}"`);
  }
};
const stored = async () => (await db.query(
  `select * from ${SCHEMA}."supply_prediction" order by "supply_id"`)).rows;

/**
 * The original's arithmetic, lifted out of the handler rather than retyped.
 *
 * `predictSupplyNeeds` keeps all of it inline in `Deno.serve`, so there is no
 * named function to import the way D38's business-day port imports
 * `totalRequestedDays`. The block between its own two comments is a closed
 * expression over `usageData`, `supply`, `supplyId`, `patientId` and `now`, so
 * it lifts cleanly — and the anchors are asserted, so a rewrite upstream fails
 * this test loudly instead of quietly proving nothing.
 */
async function originalArithmetic() {
  const source = await readFile(resolve(repository, ORIGINAL), 'utf8');
  const start = source.indexOf('      // Calculate monthly usage');
  const end = source.indexOf('      // Save prediction');
  assert.ok(start > 0 && end > start, "the original's arithmetic block moved");
  const module = 'export function predictOne(usageData, supply, supplyId, patientId, now) {\n'
    + source.slice(start, end) + '\n  return prediction;\n}\n';
  const file = join(tmpdir(), `supply_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(file, transpileTs(module).outputText);
  try { return (await import(pathToFileURL(file).href)).predictOne; }
  finally { await unlink(file).catch(() => {}); }
}

test('the chart decides who may ask, not a nurse list', async () => {
  // The original reads `created_by`, `assigned_nurses`, `account_type` and
  // `agency_name`, and lists five thousand `User` rows to decide the last one.
  // `clinician-empty` holds the same role in the same agency as `clinician-a`
  // and opens no chart.
  await reset();
  await supply('sup-1', A, 'Gauze 4x4', 100, 10);
  await series('patient-a1', 'sup-1', [10, 10, 10, 10, 10]);
  await series('patient-a2', 'sup-1', [10, 10, 10, 10, 10]);

  await refusal(generate(CLINICIAN_EMPTY), 'PENNSYNC_SUPPLY_PATIENT_NOT_VISIBLE');
  await refusal(generate(CLINICIAN_A, 'patient-a2'), 'PENNSYNC_SUPPLY_PATIENT_NOT_VISIBLE');
  await refusal(generate(CLINICIAN_A, 'patient-b1'), 'PENNSYNC_SUPPLY_PATIENT_NOT_VISIBLE');
  await refusal(generate(ADMIN_B, 'patient-a1', A), 'PENNSYNC_SUPPLY_AGENCY_NOT_HELD');
  await refusal(generate(CLINICIAN_A, 'no-such-patient'), 'PENNSYNC_SUPPLY_PATIENT_NOT_VISIBLE');
  await refusal(generate(CLINICIAN_A, 'patient a1!'), 'PENNSYNC_SUPPLY_SUBJECT_INVALID');

  // An agency's administrator opens every chart under D24; the assigned
  // clinician opens the one they are assigned to.
  assert.equal((await generate(ADMIN_A, 'patient-a2')).predictions_generated, 1);
  assert.equal((await generate(CLINICIAN_A)).predictions_generated, 1);
  assert.equal((await stored()).every(row => row.created_by === email(ADMIN_A)
    || row.created_by === email(CLINICIAN_A)), true);
});

test('the floor counts usage rows, exactly as the original counts them', async () => {
  // The original's comment says "Need at least 2 data points" and its code says
  // `usageData.length < 2`, which counts LOG ROWS — while the `data_points` it
  // reports counts distinct MONTHS. Two logs in one month is therefore a
  // prediction with one data point and the confidence ceiling. Porting the
  // comment instead of the code would stop producing it.
  await reset();
  await supply('sup-one', A, 'One month', 100, 10);
  await supply('sup-lone', A, 'Single entry', 100, 10);
  await log('patient-a1', 'sup-one', `${months[4]}-10`, 12);
  await log('patient-a1', 'sup-one', `${months[4]}-20`, 8);
  await log('patient-a1', 'sup-lone', `${months[4]}-10`, 12);

  const result = await generate(CLINICIAN_A);
  assert.equal(result.predictions_generated, 1, 'one log row is not a series');
  const [prediction] = result.predictions;
  assert.equal(prediction.supply_id, 'sup-one');
  assert.equal(prediction.analysis_data.data_points, 1);
  assert.equal(prediction.usage_trend, 'stable');
  assert.equal(prediction.confidence_score, 95, 'no variance is the ceiling');
  assert.equal(prediction.predicted_monthly_usage, 20);
  assert.deepEqual(prediction.analysis_data.monthly_breakdown, { [months[4]]: 20 });
});

test("the arithmetic is the original's, term for term", async () => {
  const predictOne = await originalArithmetic();
  await reset();
  // Increasing, decreasing, stable, a variance past the confidence floor, a
  // series that predicts nothing, and one already below its threshold.
  const cases = [
    ['sup-inc', 'Wound gel', 100, 10, [10, 10, 10, 20, 30]],
    ['sup-dec', 'Saline', 100, 10, [30, 30, 20, 10, 10]],
    ['sup-flat', 'Gloves', 250, 25, [10, 10, 10, 10, 10]],
    ['sup-noisy', 'Catheters', 400, 40, [1, 50, 1, 50, 1]],
    ['sup-zero', 'Oxygen tubing', 5, 10, [0, 0, 0, 0, 0]],
    ['sup-short', 'Dressings', 5, 50, [12, 14, 13, 15, 11]],
    ['sup-frac', 'Syringes', 33, 7, [1, 4, 2, 5, 3]],
  ];
  const fed = new Map();
  for (const [id, name, quantity, threshold, values] of cases) {
    await supply(id, A, name, quantity, threshold);
    fed.set(id, {
      entries: await series('patient-a1', id, values),
      supply: { id, name, current_quantity: quantity, low_stock_threshold: threshold },
    });
  }
  const result = await generate(CLINICIAN_A);
  assert.equal(result.predictions_generated, cases.length);

  // Noon UTC on the store's own day: the original's reorder date is LOCAL
  // `setDate` arithmetic serialised through a UTC `toISOString`, and from noon
  // the two agree in every zone. That seam is divergence 2, and pinning it here
  // is what lets the rest of the object be compared exactly.
  const now = new Date(`${today}T12:00:00Z`);
  for (const prediction of result.predictions) {
    const { entries, supply: item } = fed.get(prediction.supply_id);
    const expected = predictOne(entries, item, prediction.supply_id, 'patient-a1', now);
    delete expected.generated_date;
    const actual = { ...prediction };
    delete actual.generated_date;
    assert.deepEqual(actual, expected, prediction.supply_id);
  }
  // And the three branches really are all exercised.
  const trend = Object.fromEntries(result.predictions.map(p => [p.supply_id, p.usage_trend]));
  assert.equal(trend['sup-inc'], 'increasing');
  assert.equal(trend['sup-dec'], 'decreasing');
  assert.equal(trend['sup-flat'], 'stable');
  const byId = Object.fromEntries(result.predictions.map(p => [p.supply_id, p]));
  assert.equal(byId['sup-noisy'].confidence_score, 50, 'the floor, not 41.8');
  assert.equal(byId['sup-flat'].confidence_score, 95, 'the ceiling');
  assert.ok(byId['sup-short'].estimated_days_until_reorder_needed < 0,
    'already past its threshold');
  assert.equal(byId['sup-zero'].predicted_next_order_date, null);
});

test('a prediction with no reorder date sorts last, not unpredictably', async () => {
  // Divergence 3. The original sorts on `a.days - b.days`, which is NaN for
  // every comparison involving the null a zero predicted usage produces.
  await reset();
  for (const [id, values] of [['sup-a-zero', [0, 0, 0, 0, 0]],
    ['sup-b-slow', [1, 1, 1, 1, 1]], ['sup-c-fast', [40, 40, 40, 40, 40]]]) {
    await supply(id, A, id, 100, 10);
    await series('patient-a1', id, values);
  }
  const result = await generate(CLINICIAN_A);
  assert.deepEqual(result.predictions.map(p => p.supply_id),
    ['sup-c-fast', 'sup-b-slow', 'sup-a-zero']);
  assert.equal(result.predictions.at(-1).estimated_days_until_reorder_needed, null);
});

test("another agency's inventory names no figure in this one's prediction", async () => {
  // Divergence 4. The original lists the five thousand newest supplies in the
  // DEPLOYMENT and matches by id, so the figures a prediction is built from
  // need not belong to the caller's agency at all — and this agency's own
  // supply can fall off that page and silently produce nothing.
  await reset();
  await supply('sup-b-only', B, 'Agency B gauze', 999, 1);
  await series('patient-a1', 'sup-b-only', [10, 10, 10, 10, 10]);
  await series('patient-a1', 'sup-absent', [10, 10, 10, 10, 10]);
  assert.equal((await generate(CLINICIAN_A)).predictions_generated, 0);
  assert.deepEqual(await stored(), []);
});

test('the window is six months, and the bucket is the stored date', async () => {
  // Divergence 2. A log on the last day of a month belongs to that month; the
  // original reads a UTC-midnight Date through LOCAL getters, so behind UTC it
  // lands in the month before.
  await reset();
  await supply('sup-win', A, 'Nebulizer kits', 100, 10);
  await log('patient-a1', 'sup-win', `${stale}-15`, 500);
  await log('patient-a1', 'sup-win', `${months[3]}-01`, 4);
  await log('patient-a1', 'sup-win', `${months[3]}-28`, 6);
  await log('patient-a1', 'sup-win', `${months[4]}-15`, 10);
  const [prediction] = (await generate(CLINICIAN_A)).predictions;
  assert.deepEqual(prediction.analysis_data.months_analyzed, [months[3], months[4]]);
  assert.deepEqual(prediction.analysis_data.monthly_breakdown,
    { [months[3]]: 10, [months[4]]: 10 });
  assert.equal(prediction.analysis_data.data_points, 2, 'the stale month is outside');
});

test('the row written is the row returned, and a re-run writes another', async () => {
  // Deliberately not diverged: `SupplyPrediction` claims no uniqueness in its
  // own schema, so whether a re-run replaces or appends is an entity decision.
  await reset();
  await supply('sup-keep', A, 'Lancets', 120, 20);
  await series('patient-a1', 'sup-keep', [10, 12, 11, 13, 14]);
  const [prediction] = (await generate(CLINICIAN_A)).predictions;
  const [row] = await stored();
  assert.equal(row.patient_id, 'patient-a1');
  assert.equal(row.supply_name, 'Lancets');
  assert.equal(row.created_by, email(CLINICIAN_A));
  for (const field of ['predicted_monthly_usage', 'confidence_score', 'usage_trend',
    'recommended_quantity', 'current_inventory', 'estimated_days_until_reorder_needed']) {
    assert.equal(Number.isFinite(prediction[field]) ? Number(row[field]) : row[field],
      prediction[field], field);
  }
  assert.deepEqual(row.analysis_data, prediction.analysis_data);
  await generate(CLINICIAN_A);
  assert.equal((await stored()).length, 2);
  const source = readFileSync(resolve(repository, SUPPLY), 'utf8');
  assert.match(source, /DELIBERATELY NOT MADE/);
});

test('a patient with no usage at all is an empty answer, not a refusal', async () => {
  await reset();
  const result = await generate(CLINICIAN_A);
  assert.deepEqual(result, {
    success: true, patient_id: 'patient-a1', predictions_generated: 0, predictions: [],
  });
});
