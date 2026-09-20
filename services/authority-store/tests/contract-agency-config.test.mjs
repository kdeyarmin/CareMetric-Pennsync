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
 * Two agency configuration rows: visit point values and a payroll profile.
 *
 * The property both share, and the reason they are one file: each original is
 * a single-row-per-scope upsert whose SCOPE it reconstructs in JavaScript, and
 * each carries a bug in its own comments from having got that wrong. The
 * point-config one records that its legacy-row fallback let "a platform admin
 * (no agency) saving config silently overwrite that agency's point math"; the
 * payroll one re-reads its own table after a create to collapse duplicates it
 * may just have made.
 *
 * The tests seed another agency's row in both cases and check it is untouched
 * — which is the failure those comments describe.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const TIME_OFF = 'services/authority-store/supabase/record-migrations/'
  + '20260920230000_contract_time_off.sql';
const CONFIG = 'services/authority-store/supabase/record-migrations/'
  + '20260920280000_contract_agency_config.sql';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const email = n => ['', 'admin-a', 'clinician-a', 'clinician-empty', 'admin-b'][n]
  + '@example.invalid';
const ADMIN_A = 1; const CLINICIAN_A = 2; const ADMIN_B = 4;
const POINTS = 'select "public"."pennsync_contract_visit_points_save"($1,$2) as result';
const PAYROLL = 'select "public"."pennsync_contract_payroll_profile_save"($1,$2,$3) as result';
const A = 'agency-a'; const B = 'agency-b';
const GOOD_POINTS = Object.freeze({
  soc_points: 5, roc_points: 4, recert_points: 3, routine_points: 1,
  discharge_points: 2, notes: 'effective October',
});
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  // The time-off migration carries `agency_colleague`, which the payroll
  // contract reuses rather than declaring a second colleague lookup.
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, TIME_OFF, CONFIG]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  for (const [id, name] of [[A, 'Keystone Home Health'], [B, 'Allegheny Care Partners']]) {
    await db.query(`insert into ${SCHEMA}."agency"
      ("source_app_id","id","agency_name","status") values ($1,$2,$3,'active')`,
    [APP, id, name]);
  }
  // Agency B's point config, which the original's legacy-row scan could reach.
  await db.query(`insert into ${SCHEMA}."visit_point_config"
    ("source_app_id","id","agency_id","agency_name","soc_points","active","notes")
    values ($1,'cfg-b',$2,null,99,true,'agency B math')`, [APP, B]);
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
const points = (n, config = GOOD_POINTS, agency = A) =>
  as(n, POINTS, [agency, JSON.stringify(config)], true);
const payroll = (n, target, profile = {}, agency = A) =>
  as(n, PAYROLL, [agency, target, JSON.stringify(profile)], true);
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);
const configRows = async agency => (await db.query(
  `select "id","soc_points","notes","agency_name" from ${SCHEMA}."visit_point_config"
   where "agency_id" = $1 order by "id"`, [agency])).rows;

test('only the agency administrator may save, under D40', async () => {
  await refusal(points(CLINICIAN_A), 'PENNSYNC_CONFIG_FORBIDDEN');
  await refusal(points(ADMIN_A, GOOD_POINTS, B), 'PENNSYNC_CONFIG_FORBIDDEN');
  await refusal(payroll(CLINICIAN_A, email(CLINICIAN_A)), 'PENNSYNC_CONFIG_FORBIDDEN');
});

test('an empty body does not wipe the point config to zeros', async () => {
  // The original's own guard, and its own words for why: "an accidental
  // invocation with no body would overwrite the facility's point config with
  // all zeros."
  await refusal(points(ADMIN_A, {}), 'PENNSYNC_CONFIG_EMPTY');
  await refusal(points(ADMIN_A, { soc_points: 5, sock_points: 9 }),
    'PENNSYNC_CONFIG_FIELD_UNSUPPORTED');
  // A non-number becomes zero rather than refusing, as `toNonNegativeNumber`
  // does — it is a save, not a validation form.
  const saved = await points(ADMIN_A, { ...GOOD_POINTS, roc_points: -4, recert_points: 'x' });
  assert.equal(saved.config.roc_points, 0);
  assert.equal(saved.config.recert_points, 0);
  assert.equal(saved.config.soc_points, 5);
});

test('saving one agency s point math never touches another s', async () => {
  // The failure the original's comment records: its legacy-row scan adopted a
  // lone TENANT-scoped row, so a platform admin with no agency overwrote that
  // agency's config. Agency B's row is unscoped by `agency_name` here —
  // exactly the shape that scan looked for.
  const before = await configRows(B);
  assert.equal(before.length, 1);
  await points(ADMIN_A);
  const after = await configRows(B);
  assert.deepEqual(after, before, 'agency B is untouched');
  const mine = await configRows(A);
  assert.equal(mine.length, 1, 'one row per agency');
  assert.equal(Number(mine[0].soc_points), 5);
  // The display name comes from the CARRIED agency row, not the caller's
  // profile.
  assert.equal(mine[0].agency_name, 'Keystone Home Health');
});

test('saving twice updates the one row rather than adding another', async () => {
  await points(ADMIN_A, { ...GOOD_POINTS, soc_points: 7, notes: 'revised' });
  const rows = await configRows(A);
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].soc_points), 7);
  assert.equal(rows[0].notes, 'revised');
  // And agency B's administrator writes their own row, not agency A's.
  await points(ADMIN_B, { ...GOOD_POINTS, soc_points: 11 }, B);
  const theirs = await configRows(B);
  assert.equal(theirs.length, 1);
  assert.equal(Number(theirs[0].soc_points), 11);
  assert.equal(Number((await configRows(A))[0].soc_points), 7, 'agency A is untouched');
});

test('a payroll profile is for a colleague, proved through membership', async () => {
  // The original looks the target up in `User` and compares THEIR
  // `agency_name` string to the caller's — a self-editable field deciding who
  // may be paid what.
  await refusal(payroll(ADMIN_A, email(ADMIN_B)), 'PENNSYNC_CONFIG_EMPLOYEE_UNKNOWN');
  await refusal(payroll(ADMIN_A, 'nobody@example.invalid'), 'PENNSYNC_CONFIG_EMPLOYEE_UNKNOWN');
  await refusal(payroll(ADMIN_A, '   '), 'PENNSYNC_CONFIG_EMPLOYEE_REQUIRED');
  const saved = await payroll(ADMIN_A, email(CLINICIAN_A),
    { employee_name: 'Ada', service_type: 'home_health', earns_points: true,
      phone_reimbursement: 25 });
  assert.equal(saved.profile.employee_email, email(CLINICIAN_A));
  assert.equal(saved.profile.earns_points, true);
  assert.equal(saved.profile.phone_reimbursement, 25);
  assert.equal(saved.profile.active, true, 'active unless explicitly false');
});

test('hospice earns no points, and only an explicit true does', async () => {
  // Both derived the way the original derives them.
  const hospice = await payroll(ADMIN_A, email(CLINICIAN_A),
    { service_type: 'hospice', earns_points: true });
  assert.equal(hospice.profile.service_type, 'hospice');
  assert.equal(hospice.profile.earns_points, false, 'hospice never earns points');
  const vague = await payroll(ADMIN_A, email(CLINICIAN_A),
    { service_type: 'home_health', earns_points: 'yes' });
  assert.equal(vague.profile.earns_points, false, 'only an explicit true counts');
  const unknown = await payroll(ADMIN_A, email(CLINICIAN_A), { service_type: 'moonlighting' });
  assert.equal(unknown.profile.service_type, 'home_health', 'anything but hospice');
  // Still one row: the original re-reads its own table after a create to
  // collapse duplicates it may have made, which an upsert makes unnecessary.
  assert.equal((await db.query(
    `select count(*)::int as n from ${SCHEMA}."employee_payroll_profile"
     where "agency_id" = $1`, [A])).rows[0].n, 1);
});
