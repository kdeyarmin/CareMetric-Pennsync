import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { SCHEMA } from '../../../tools-entity-schema-plan.mjs';
import { applyRecordMigrations, recordMigrationNames } from './record-migrations.mjs';

/**
 * Submitting a timesheet, and reviewing one.
 *
 * The property the file is about: almost nothing an employee sends decides
 * what they are paid. The service line and points eligibility are the payroll
 * profile's, the points are the agency's configured per-type values times the
 * visit counts, the paid time off carries in from approved requests, and the
 * phone reimbursement is the profile's. The tests check each of those against
 * a caller who sends something else.
 *
 * And `timesheet_read`/`timesheet_update` are agency-WIDE, so every ownership
 * rule here is the contract's (D45).
 */
// The file whose BEHAVIOUR this suite measures; it no longer decides what is
// applied. The store is the whole record directory now, so a forward migration
// over this contract is in the build the moment it is committed — there is none
// today, measured rather than assumed, which makes this the case where the swap
// should change nothing at all.
const MEASURED = ['20260920360000_contract_timesheet.sql'];
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const email = n => ['', 'admin-a', 'clinician-a', 'clinician-empty', 'admin-b'][n]
  + '@example.invalid';
const ADMIN_A = 1; const CLINICIAN_A = 2; const CLINICIAN_EMPTY = 3; const ADMIN_B = 4;
const SUBMIT = 'select "public"."pennsync_contract_timesheet_submit"($1,$2,$3) as result';
const REVIEW = 'select "public"."pennsync_contract_timesheet_review"($1,$2,$3,$4) as result';
const LIST = 'select "public"."pennsync_contract_notification_list"($1) as result';
const A = 'agency-a'; const B = 'agency-b';
// On the biweekly cycle anchored to Sun 2026-06-14: Sun 2026-09-06 → Sat 2026-09-19.
const PERIOD = Object.freeze({ pay_period_start: '2026-09-06', pay_period_end: '2026-09-19' });
const GOOD = Object.freeze({ ...PERIOD, regular_hours: 72, overtime_hours: 4, miles: 210 });
let db;
/** The record migrations this suite's store was built from; the last test reads it. */
let applied;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  applied = await applyRecordMigrations(db);
  for (const name of MEASURED) {
    assert.ok(applied.includes(name),
      `${name} must be applied: this suite measures its behaviour`);
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
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
const submit = (n, sheet = GOOD, id = null, agency = A) =>
  as(n, SUBMIT, [agency, id, JSON.stringify(sheet)]);
const review = (n, id, decision, note = null, agency = A) =>
  as(n, REVIEW, [agency, id, decision, note]);
const list = (n, agency = A) => as(n, LIST, [agency]);
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);
const clear = async () => {
  for (const t of ['timesheet', 'notification', 'employee_payroll_profile',
    'visit_point_config', 'time_off_request']) {
    await db.query(`delete from ${SCHEMA}."${t}"`);
  }
};
const profile = (who, overrides = {}) => {
  const row = { service_type: 'home_health', earns_points: true, active: true,
    phone_reimbursement: 45, ...overrides };
  const keys = Object.keys(row);
  return db.query(`insert into ${SCHEMA}."employee_payroll_profile"
    ("source_app_id","id","agency_id","employee_email",${keys.map(k => `"${k}"`).join(',')})
    values ($1,$2,$3,$4,${keys.map((_, i) => `$${i + 5}`).join(',')})`,
  [APP, `pay-${who}`, A, email(who), ...keys.map(k => row[k])]);
};
const pointConfig = (overrides = {}) => {
  const row = { soc_points: 5, roc_points: 4, recert_points: 3, routine_points: 1,
    discharge_points: 2, active: true, ...overrides };
  const keys = Object.keys(row);
  return db.query(`insert into ${SCHEMA}."visit_point_config"
    ("source_app_id","id","agency_id",${keys.map(k => `"${k}"`).join(',')})
    values ($1,'cfg-a',$2,${keys.map((_, i) => `$${i + 3}`).join(',')})`,
  [APP, A, ...keys.map(k => row[k])]);
};

test('a pay period must be on the payroll calendar', async () => {
  await clear();
  // Sun 2026-09-06 → Sat 2026-09-19 is on the biweekly cycle anchored to
  // Sun 2026-06-14; the original keeps this "in step with the frontend's
  // payPeriodSchedule.js so submitted periods always match the payroll
  // calendar".
  assert.ok((await submit(CLINICIAN_A)).timesheet.id);
  await db.query(`delete from ${SCHEMA}."timesheet"`);
  for (const bad of [
    { pay_period_start: '2026-09-07', pay_period_end: '2026-09-20' }, // Monday
    { pay_period_start: '2026-09-13', pay_period_end: '2026-09-26' }, // off cycle
    { pay_period_start: '2026-09-06', pay_period_end: '2026-09-12' }, // one week
  ]) {
    await refusal(submit(CLINICIAN_A, { ...GOOD, ...bad }),
      'PENNSYNC_TIMESHEET_PERIOD_UNALIGNED');
  }
  await refusal(submit(CLINICIAN_A, { ...GOOD, pay_period_start: 'last tuesday' }),
    'PENNSYNC_TIMESHEET_PERIOD_INVALID');
  await refusal(submit(CLINICIAN_A,
    { ...GOOD, pay_period_start: '2026-09-19', pay_period_end: '2026-09-06' }),
  'PENNSYNC_TIMESHEET_PERIOD_INVALID');
});

test('the payroll profile decides the pay line, not the employee', async () => {
  await clear();
  // No profile: home health, and no points, because `earns_points` is the
  // profile's and there is none.
  const none = await submit(CLINICIAN_A);
  assert.equal(none.timesheet.service_type, 'home_health');
  assert.equal(none.earns_points, false);
  assert.equal(Number(none.timesheet.phone_reimbursement), 0);
  await db.query(`delete from ${SCHEMA}."timesheet"`);
  // Hospice earns no points whatever the profile says.
  await profile(CLINICIAN_A, { service_type: 'hospice', earns_points: true });
  const hospice = await submit(CLINICIAN_A);
  assert.equal(hospice.timesheet.service_type, 'hospice');
  assert.equal(hospice.earns_points, false);
  // The standing phone reimbursement is the profile's, and the client cannot
  // send it at all.
  assert.equal(Number(hospice.timesheet.phone_reimbursement), 45);
  await refusal(submit(CLINICIAN_A, { ...GOOD, phone_reimbursement: 500 }),
    'PENNSYNC_TIMESHEET_FIELD_UNSUPPORTED');
  // An inactive profile still sets the pay line and adds no reimbursement.
  await db.query(`delete from ${SCHEMA}."timesheet"`);
  await db.query(`update ${SCHEMA}."employee_payroll_profile"
    set "active" = false where "id" = $1`, [`pay-${CLINICIAN_A}`]);
  const inactive = await submit(CLINICIAN_A);
  assert.equal(inactive.timesheet.service_type, 'hospice');
  assert.equal(Number(inactive.timesheet.phone_reimbursement), 0);
});

test('points are the agency s schedule times the counts, never the caller s number', async () => {
  await clear();
  await profile(CLINICIAN_A);
  await pointConfig();
  const sent = await submit(CLINICIAN_A, { ...GOOD, regular_points: 9999,
    visit_counts: { soc: 2, roc: 1, recert: 0, routine: 10, discharge: 1 } });
  assert.equal(sent.earns_points, true);
  // 2×5 + 1×4 + 0×3 + 10×1 + 1×2 = 26.
  assert.equal(Number(sent.timesheet.regular_points), 26);
  assert.equal(sent.point_config_missing, false);
});

test('an agency with no point schedule computes zero, and says so', async () => {
  // Divergence 2. The original, finding no config for the caller's agency,
  // adopts the newest row in the DEPLOYMENT so that "nurses with an agency
  // don't silently compute 0 points" — the read side of the bug D43 deleted
  // from the write side, where a platform admin's save "silently overwrote
  // that agency's point math".
  await clear();
  await profile(CLINICIAN_A);
  // Another agency's schedule, which the original's fallback could reach.
  await db.query(`insert into ${SCHEMA}."visit_point_config"
    ("source_app_id","id","agency_id","soc_points","active")
    values ($1,'cfg-b',$2,99,true)`, [APP, B]);
  const result = await submit(CLINICIAN_A,
    { ...GOOD, visit_counts: { soc: 3, roc: 0, recert: 0, routine: 0, discharge: 0 } });
  assert.equal(Number(result.timesheet.regular_points), 0,
    'agency B’s schedule is not this agency’s');
  assert.equal(result.point_config_missing, true, 'and the answer says why');
});

test('daily entries are authoritative and period totals are discarded', async () => {
  await clear();
  await profile(CLINICIAN_A);
  await pointConfig();
  const result = await submit(CLINICIAN_A, { ...GOOD, entry_mode: 'daily',
    regular_hours: 999, overtime_hours: 999,
    visit_counts: { soc: 50, roc: 50, recert: 50, routine: 50, discharge: 50 },
    daily_entries: [
      { date: '2026-09-07', regular_hours: 8, on_call_hours: 2,
        visit_counts: { soc: 1, routine: 3 } },
      { date: '2026-09-08', regular_hours: 7.5, overtime_hours: 1.5,
        visit_counts: { roc: 2 } },
    ] });
  assert.equal(Number(result.timesheet.regular_hours), 15.5, 'the sum, not the 999');
  assert.equal(Number(result.timesheet.overtime_hours), 1.5);
  assert.equal(Number(result.timesheet.on_call_hours), 2);
  assert.deepEqual(result.timesheet.visit_counts,
    { soc: 1, roc: 2, recert: 0, routine: 3, discharge: 0 });
  // 1×5 + 2×4 + 3×1 = 16, from the DAILY counts rather than the sent ones.
  assert.equal(Number(result.timesheet.regular_points), 16);
  assert.equal(result.timesheet.daily_entries.length, 2);
  // Vacation and miles stay period-level, as the original's DAILY_SUM_FIELDS
  // says: they are not summed from the rows.
  assert.equal(Number(result.timesheet.miles), 210);
});

test('a daily entry must be a unique real day inside the period', async () => {
  await clear();
  const daily = entries => submit(CLINICIAN_A,
    { ...GOOD, entry_mode: 'daily', daily_entries: entries });
  await refusal(daily([{ date: '2026-09-07' }, { date: '2026-09-07' }]),
    'PENNSYNC_TIMESHEET_DAILY_DUPLICATE');
  await refusal(daily([{ date: '2026-10-01' }]), 'PENNSYNC_TIMESHEET_DAILY_INVALID');
  await refusal(daily([{ date: 'friday' }]), 'PENNSYNC_TIMESHEET_DAILY_INVALID');
  await refusal(daily(Array.from({ length: 15 },
    (_, i) => ({ date: `2026-09-${String(6 + i).padStart(2, '0')}` }))),
  'PENNSYNC_TIMESHEET_DAILY_INVALID');
  await refusal(daily([{ date: '2026-09-07', regular_hours: -3 }]),
    'PENNSYNC_TIMESHEET_NUMBER_INVALID');
});

test('approved paid time off carries in, and unpaid and unapproved do not', async () => {
  await clear();
  const timeOff = (id, type, start, end, status, half = false) =>
    db.query(`insert into ${SCHEMA}."time_off_request"
      ("source_app_id","id","agency_id","employee_email","request_type",
       "start_date","end_date","status","half_day")
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [APP, id, A, email(CLINICIAN_A), type, start, end, status, half]);
  // Mon 2026-09-07 to Fri 2026-09-11 is five business days.
  await timeOff('pto-1', 'vacation', '2026-09-07', '2026-09-11', 'approved');
  // Unpaid, and a pending one: neither carries.
  await timeOff('pto-2', 'unpaid', '2026-09-14', '2026-09-15', 'approved');
  await timeOff('pto-3', 'sick', '2026-09-14', '2026-09-15', 'pending');
  // Outside the period entirely.
  await timeOff('pto-4', 'vacation', '2026-08-03', '2026-08-07', 'approved');
  const result = await submit(CLINICIAN_A);
  assert.equal(Number(result.timesheet.auto_pto_hours), 40, 'five days at eight hours');
  // A half day fully inside the period counts as half.
  await db.query(`delete from ${SCHEMA}."timesheet"`);
  await timeOff('pto-5', 'personal', '2026-09-16', '2026-09-16', 'approved', true);
  assert.equal(Number((await submit(CLINICIAN_A)).timesheet.auto_pto_hours), 44);
  // A weekend request adds nothing: business days only.
  await db.query(`delete from ${SCHEMA}."timesheet"`);
  await timeOff('pto-6', 'vacation', '2026-09-12', '2026-09-13', 'approved');
  assert.equal(Number((await submit(CLINICIAN_A)).timesheet.auto_pto_hours), 44);
});

test('one timesheet per employee, service line and period', async () => {
  // The original's own reason: "Prevents a duplicate row from being
  // double-counted in payroll."
  await clear();
  const first = await submit(CLINICIAN_A);
  await refusal(submit(CLINICIAN_A), 'PENNSYNC_TIMESHEET_PERIOD_EXISTS');
  // Editing that one is fine.
  const edited = await submit(CLINICIAN_A, { ...GOOD, regular_hours: 80 }, first.timesheet.id);
  assert.equal(edited.timesheet.id, first.timesheet.id);
  assert.equal(Number(edited.timesheet.regular_hours), 80);
  // A different pay line is a different sheet.
  await profile(CLINICIAN_A, { service_type: 'hospice' });
  assert.notEqual((await submit(CLINICIAN_A)).timesheet.id, first.timesheet.id);
});

test('an approver is a colleague who may approve, and never yourself', async () => {
  await clear();
  await refusal(submit(CLINICIAN_A, { ...GOOD, manager_email: email(CLINICIAN_A) }),
    'PENNSYNC_TIMESHEET_APPROVER_SELF');
  await refusal(submit(CLINICIAN_A, { ...GOOD, manager_email: email(ADMIN_B) }),
    'PENNSYNC_TIMESHEET_APPROVER_UNKNOWN');
  // `clinician-empty` is a colleague, but a clinician approves nobody.
  await refusal(submit(CLINICIAN_A, { ...GOOD, manager_email: email(CLINICIAN_EMPTY) }),
    'PENNSYNC_TIMESHEET_APPROVER_INVALID');
  const result = await submit(CLINICIAN_A, { ...GOOD, manager_email: email(ADMIN_A) });
  assert.equal(result.timesheet.manager_email, email(ADMIN_A));
});

test('submitting tells the approvers, through the facility', async () => {
  await clear();
  const result = await submit(CLINICIAN_A, { ...GOOD, manager_email: email(ADMIN_A) });
  assert.equal(result.notified, 1, 'agency A has one administrator');
  assert.equal(result.delivery_paused, true, 'the email half is Core.SendEmail');
  const seen = await list(ADMIN_A);
  assert.equal(seen.notifications.length, 1, 'and the reader can find it');
  assert.equal(seen.notifications[0].title, 'Timesheet submitted');
  assert.equal(seen.notifications[0].action_url, '/Timesheets');
  // A draft tells nobody.
  await db.query(`delete from ${SCHEMA}."timesheet"`);
  await db.query(`delete from ${SCHEMA}."notification"`);
  assert.equal((await submit(CLINICIAN_A, { ...GOOD, status: 'draft' })).notified, 0);
  await refusal(submit(CLINICIAN_A, { ...GOOD, status: 'approved' }),
    'PENNSYNC_TIMESHEET_STATUS_INVALID');
});

test('a reviewer is an administrator or the assigned approver, and never the owner', async () => {
  await clear();
  const sheet = (await submit(CLINICIAN_A, { ...GOOD, manager_email: email(ADMIN_A) }))
    .timesheet;
  await refusal(review(CLINICIAN_EMPTY, sheet.id, 'approved'),
    'PENNSYNC_TIMESHEET_REVIEW_FORBIDDEN');
  await refusal(review(CLINICIAN_A, sheet.id, 'approved'),
    'PENNSYNC_TIMESHEET_REVIEW_FORBIDDEN');
  await refusal(review(ADMIN_A, sheet.id, 'maybe'), 'PENNSYNC_TIMESHEET_DECISION_INVALID');
  const done = await review(ADMIN_A, sheet.id, 'approved', 'Looks right.');
  assert.equal(done.timesheet.status, 'approved');
  assert.equal(done.timesheet.reviewed_by, email(ADMIN_A));
  assert.equal(done.timesheet.review_notes, 'Looks right.');
  // Only a submitted sheet is awaiting review.
  await refusal(review(ADMIN_A, sheet.id, 'rejected'),
    'PENNSYNC_TIMESHEET_NOT_AWAITING_REVIEW');
  // And an approved sheet is locked against its owner.
  await refusal(submit(CLINICIAN_A, GOOD, sheet.id), 'PENNSYNC_TIMESHEET_APPROVED_LOCKED');
});

test('an administrator cannot review their own timesheet', async () => {
  // Both originals refuse this, "even as an admin".
  await clear();
  const mine = (await submit(ADMIN_A)).timesheet;
  await refusal(review(ADMIN_A, mine.id, 'approved'), 'PENNSYNC_TIMESHEET_REVIEW_SELF');
});

test('the decision reaches the employee, and a rejection reopens the sheet', async () => {
  await clear();
  const sheet = (await submit(CLINICIAN_A)).timesheet;
  await db.query(`delete from ${SCHEMA}."notification"`);
  const rejected = await review(ADMIN_A, sheet.id, 'rejected', 'Mileage needs a receipt.');
  assert.equal(rejected.notified, 1);
  assert.equal(rejected.delivery_paused, true);
  const seen = await list(CLINICIAN_A);
  assert.equal(seen.notifications.length, 1);
  assert.equal(seen.notifications[0].title, 'Timesheet needs changes');
  assert.match(seen.notifications[0].message,
    /was rejected: Mileage needs a receipt\.$/);
  assert.equal(seen.notifications[0].type, 'compliance_alert');
  // Resubmitting clears the review rather than leaving it stale — the
  // original's reason for setting the fields EMPTY rather than undefined.
  const again = await submit(CLINICIAN_A, { ...GOOD, miles: 180 }, sheet.id);
  assert.equal(again.timesheet.status, 'submitted');
  assert.equal(again.timesheet.reviewed_by, null);
  assert.equal(again.timesheet.review_notes, null);
});

test('another agency reaches none of this one s timesheets', async () => {
  await clear();
  const sheet = (await submit(CLINICIAN_A)).timesheet;
  await refusal(submit(CLINICIAN_A, GOOD, null, B), 'PENNSYNC_TIMESHEET_AGENCY_NOT_HELD');
  await refusal(review(ADMIN_B, sheet.id, 'approved', null, B),
    'PENNSYNC_TIMESHEET_NOT_FOUND');
  await refusal(review(ADMIN_B, sheet.id, 'approved'),
    'PENNSYNC_TIMESHEET_AGENCY_NOT_HELD');
});

test('the swap widened the store and left this contract reachable unchanged', async () => {
  // The STRONG form of the post-swap check, and it is available here because no
  // forward migration touches this contract — measured, not assumed: one file in
  // the record directory mentions `contract_timesheet` or the `timesheet` table,
  // and nothing after it redefines a timesheet function. So the derived build
  // must leave this capability's reachable surface exactly as the hand-kept
  // six-file build did, while the store around it grows.
  //
  // Proved by building BOTH and comparing, rather than by asserting that nothing
  // moved. A test that only checked the current set would pass whether or not the
  // widening had changed it (D127's lesson: an assertion that cannot distinguish
  // the two answers is not evidence).
  assert.deepEqual(applied, await recordMigrationNames());
  const names = await recordMigrationNames();
  assert.ok(names.length > 6, 'the store is the directory, not the old six files');

  const timesheetSurface = async client => (await client.query(
    `select p.proname, pg_get_function_identity_arguments(p.oid) as args
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.proname like '%timesheet%'
      order by 1, 2`)).rows;
  const derived = await timesheetSurface(db);
  assert.ok(derived.length > 0, 'the contract must be reachable at all');

  // The hand-kept build this file used to carry, rebuilt here as the control.
  const control = new PGlite();
  try {
    await control.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
    const dir = new URL('../supabase/migrations/', import.meta.url);
    for (const name of (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()) {
      await control.exec(await readFile(new URL(name, dir), 'utf8'));
    }
    await applyRecordMigrations(control, {
      omit: names.filter(name => ![
        '20260919170000_record_store.sql', '20260919180000_record_brokers.sql',
        '20260920170000_contract_note_history.sql', '20260920230000_contract_time_off.sql',
        '20260920285000_notification_mint.sql', '20260920300000_contract_notification.sql',
        '20260920360000_contract_timesheet.sql',
      ].includes(name)),
    });
    assert.deepEqual(derived, await timesheetSurface(control),
      'widening the store must not change what this contract exposes');
  } finally {
    await control.close();
  }
});
