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
 * The time-off domain — four Base44 capabilities over one carried table.
 *
 * The property the file exists for: **all four originals decide who may act by
 * reading the carried `User` row**, through `is_approved`, `is_manager`,
 * `role`, `account_type` and string comparisons of `agency_name`. Every one of
 * those is a self-editable label D23 says decides nothing. The tests prove the
 * substitution rather than assert it — a person whose carried row claims to be
 * an approved agency administrator of another agency is still refused, because
 * membership is what answers.
 *
 * `time_off_days` is compared against the ORIGINAL's `totalRequestedDays` over
 * a table of ranges, because a business-day count that disagreed would put a
 * different number of days on somebody's leave balance.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const TIME_OFF = 'services/authority-store/supabase/record-migrations/'
  + '20260920230000_contract_time_off.sql';
const ORIGINAL = 'base44/functions/submitTimeOffRequest/entry.ts';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const email = n => ['', 'admin-a', 'clinician-a', 'clinician-empty', 'admin-b'][n]
  + '@example.invalid';
const ADMIN_A = 1; const CLINICIAN_A = 2; const SPARE_A = 3; const ADMIN_B = 4;
const SUBMIT = 'select "public"."pennsync_contract_time_off_submit"($1,$2,$3,$4,$5,$6,$7,$8) as result';
const CANCEL = 'select "public"."pennsync_contract_time_off_cancel"($1,$2) as result';
const REVIEW = 'select "public"."pennsync_contract_time_off_review"($1,$2,$3,$4) as result';
const APPROVED = 'select "public"."pennsync_contract_time_off_approved"($1) as result';
const A = 'agency-a'; const B = 'agency-b';
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, TIME_OFF]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  // The clinician's carried profile claims everything the originals read. None
  // of it may decide anything, which is what the gate test proves.
  await db.query(`insert into ${SCHEMA}."user"
    ("source_app_id","id","is_approved","is_manager","account_type","agency_name","agency_id","role")
    values ($1,$2,true,true,'agency_admin','Agency B','${B}','admin')`,
  [APP, '6aac00000000000000000002']);
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
const submit = (n, {
  agency = A, type = 'vacation', start = '2026-10-05', end = '2026-10-09',
  half = false, reason = 'family trip', coverage = 'Pat covers', manager = null,
} = {}) => as(n, SUBMIT, [agency, type, start, end, half, reason, coverage, manager], true);
const cancel = (n, id, agency = A) => as(n, CANCEL, [agency, id], true);
const review = (n, id, decision, note = 'ok', agency = A) =>
  as(n, REVIEW, [agency, id, decision, note], true);
const approved = (n, agency = A) => as(n, APPROVED, [agency]);
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);
const statusOf = async id => (await db.query(
  `select "status" from ${SCHEMA}."time_off_request" where "id" = $1`, [id])).rows[0]?.status;

test('the business-day count is the original\'s, over a table of ranges', async () => {
  let source = await readFile(resolve(repository, ORIGINAL), 'utf8');
  source = source.replace(/import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/, '');
  source = source.replace(/Deno\.serve\([\s\S]*$/, '');
  source += '\nexport { totalRequestedDays, VALID_TYPES };\n';
  const file = join(tmpdir(), `timeoff_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(file, transpileTs(source).outputText);
  let totalRequestedDays; let VALID_TYPES;
  try { ({ totalRequestedDays, VALID_TYPES } = await import(pathToFileURL(file).href)); }
  finally { await unlink(file).catch(() => {}); }

  const cases = [
    // A single weekday, a single weekend day, a full week, a fortnight, a
    // range that starts and ends on a weekend, and a leap day.
    ['2026-10-05', '2026-10-05'], ['2026-10-10', '2026-10-11'],
    ['2026-10-05', '2026-10-09'], ['2026-10-05', '2026-10-16'],
    ['2026-10-10', '2026-10-18'], ['2028-02-28', '2028-03-01'],
    ['2026-12-24', '2027-01-04'],
  ];
  for (const [start, end] of cases) {
    for (const half of [false, true]) {
      const { rows } = await db.query(
        'select "pennsync_records".time_off_days($1::date,$2::date,$3) as days',
        [start, end, half]);
      assert.equal(Number(rows[0].days), totalRequestedDays(start, end, half),
        `${start}..${end} half=${half}`);
    }
  }
  // And the type list the contract refuses outside of is the original's.
  for (const type of VALID_TYPES) {
    const result = await submit(CLINICIAN_A, { type });
    assert.equal(result.request.request_type, type);
    await db.exec(`delete from ${SCHEMA}."time_off_request"`);
  }
  assert.equal(VALID_TYPES.length, 8);
});

test('a carried profile claiming to be an admin elsewhere decides nothing', async () => {
  // The clinician's `user` row says is_approved, is_manager, account_type
  // agency_admin, agency_name "Agency B", role admin. All five are what the
  // originals read. Membership says clinician in agency A, and that is what
  // answers: no standing in B at all.
  await refusal(submit(CLINICIAN_A, { agency: B }), 'PENNSYNC_TIME_OFF_AGENCY_NOT_HELD');
  await refusal(approved(CLINICIAN_A, B), 'PENNSYNC_TIME_OFF_AGENCY_NOT_HELD');
  // And in agency A they are a clinician, so they cannot review.
  const mine = (await submit(CLINICIAN_A)).request;
  await refusal(review(SPARE_A, mine.id, 'approved'), 'PENNSYNC_TIME_OFF_FORBIDDEN');
  await db.exec(`delete from ${SCHEMA}."time_off_request"`);
});

test('the dates are checked the way the original checks them', async () => {
  await refusal(submit(CLINICIAN_A, { type: 'sabbatical' }), 'PENNSYNC_TIME_OFF_TYPE_INVALID');
  // The overflow day the original rejects because JavaScript rolls it forward.
  await refusal(submit(CLINICIAN_A, { start: '2026-02-31' }), 'PENNSYNC_TIME_OFF_DATE_INVALID');
  await refusal(submit(CLINICIAN_A, { start: '10/05/2026' }), 'PENNSYNC_TIME_OFF_DATE_INVALID');
  await refusal(submit(CLINICIAN_A, { start: null }), 'PENNSYNC_TIME_OFF_DATE_INVALID');
  await refusal(submit(CLINICIAN_A, { start: '2026-10-09', end: '2026-10-05' }),
    'PENNSYNC_TIME_OFF_RANGE_INVALID');
  // The original's own bound: longer than a year is a mistake.
  await refusal(submit(CLINICIAN_A, { start: '2026-01-01', end: '2027-01-05' }),
    'PENNSYNC_TIME_OFF_RANGE_INVALID');
  await refusal(submit(CLINICIAN_A, { half: null }), 'PENNSYNC_TIME_OFF_RANGE_INVALID');
});

test('an approver is proved through membership, never through a profile flag', async () => {
  // Yourself is self-approval.
  await refusal(submit(CLINICIAN_A, { manager: email(CLINICIAN_A) }),
    'PENNSYNC_TIME_OFF_APPROVER_SELF');
  // A colleague who is a clinician is not an approver, whatever their carried
  // row says — and this one's row says agency_admin.
  await refusal(submit(SPARE_A, { manager: email(CLINICIAN_A) }),
    'PENNSYNC_TIME_OFF_APPROVER_INVALID');
  // Somebody outside the agency is not resolvable at all.
  await refusal(submit(CLINICIAN_A, { manager: email(ADMIN_B) }),
    'PENNSYNC_TIME_OFF_APPROVER_UNKNOWN');
  await refusal(submit(CLINICIAN_A, { manager: 'nobody@example.invalid' }),
    'PENNSYNC_TIME_OFF_APPROVER_UNKNOWN');
  // The agency's administrator is.
  const result = await submit(CLINICIAN_A, { manager: email(ADMIN_A) });
  assert.equal(result.request.manager_email, email(ADMIN_A));
  assert.equal(result.request.status, 'pending');
  assert.equal(result.request.employee_email, email(CLINICIAN_A));
  // Divergence 5: the carried profile has no name column, so the name is the
  // address, which is the original's own fallback.
  assert.equal(result.request.employee_name, email(CLINICIAN_A));
  await db.exec(`delete from ${SCHEMA}."time_off_request"`);
});

test('a request is cancelled by its owner or an administrator, and only while open', async () => {
  const mine = (await submit(CLINICIAN_A)).request;
  // A colleague who is neither the owner nor an administrator cannot.
  await refusal(cancel(SPARE_A, mine.id), 'PENNSYNC_TIME_OFF_FORBIDDEN');
  assert.equal(await statusOf(mine.id), 'pending');
  // The owner can.
  assert.equal((await cancel(CLINICIAN_A, mine.id)).request.status, 'cancelled');
  // And a cancelled request is not cancellable again.
  await refusal(cancel(CLINICIAN_A, mine.id), 'PENNSYNC_TIME_OFF_TRANSITION');

  // The administrator can cancel somebody else's.
  const theirs = (await submit(SPARE_A)).request;
  assert.equal((await cancel(ADMIN_A, theirs.id)).request.status, 'cancelled');
  // A request in another agency is simply not there.
  await refusal(cancel(ADMIN_A, 'no-such-request'), 'PENNSYNC_TIME_OFF_NOT_FOUND');
  await refusal(cancel(ADMIN_A, 'has spaces'), 'PENNSYNC_TIME_OFF_SUBJECT_INVALID');
  await db.exec(`delete from ${SCHEMA}."time_off_request"`);
});

test('nobody reviews their own leave, whatever their role', async () => {
  // The administrator's own request. They are an `agency_admin`, so the role
  // gate admits them — and the self check is what refuses.
  const own = (await submit(ADMIN_A)).request;
  await refusal(review(ADMIN_A, own.id, 'approved'), 'PENNSYNC_TIME_OFF_SELF');
  assert.equal(await statusOf(own.id), 'pending');

  const theirs = (await submit(CLINICIAN_A)).request;
  await refusal(review(CLINICIAN_A, theirs.id, 'sideways'),
    'PENNSYNC_TIME_OFF_DECISION_INVALID');
  const reviewed = await review(ADMIN_A, theirs.id, 'approved', 'have a good trip');
  assert.equal(reviewed.request.status, 'approved');
  assert.equal(reviewed.request.reviewed_by, email(ADMIN_A));
  assert.equal(reviewed.request.review_notes, 'have a good trip');
  assert.ok(reviewed.request.reviewed_at);
  // Reviewed once is reviewed.
  await refusal(review(ADMIN_A, theirs.id, 'denied'), 'PENNSYNC_TIME_OFF_TRANSITION');
  await db.exec(`delete from ${SCHEMA}."time_off_request"`);
});

test('a named manager reviews the request that named them, and no other', async () => {
  // A `manager` is not an `agency_admin`: the original's second reviewer is an
  // address match on the request, not a role, so this proves the request has
  // to have named them.
  await db.exec(`update pennsync_private.membership set tenant_role = 'manager'
    where id = 'membership-3'`);
  try {
    const named = (await submit(CLINICIAN_A, { manager: email(SPARE_A) })).request;
    const unnamed = (await submit(CLINICIAN_A)).request;
    await refusal(review(SPARE_A, unnamed.id, 'approved'), 'PENNSYNC_TIME_OFF_FORBIDDEN');
    assert.equal((await review(SPARE_A, named.id, 'denied')).request.status, 'denied');
  } finally {
    await db.exec(`update pennsync_private.membership set tenant_role = 'clinician'
      where id = 'membership-3'`);
    await db.exec(`delete from ${SCHEMA}."time_off_request"`);
  }
});

test('the approved list is the policy\'s answer, not a collected set of addresses', async () => {
  // The original collects every `User` whose `agency_name` matches and filters
  // the requests by their addresses. Here the policy scopes the rows, so a
  // request in another agency is invisible without any address work.
  const first = (await submit(CLINICIAN_A, { start: '2026-11-02', end: '2026-11-06' })).request;
  const second = (await submit(SPARE_A, { start: '2026-10-05', end: '2026-10-09' })).request;
  await review(ADMIN_A, first.id, 'approved');
  await review(ADMIN_A, second.id, 'denied');
  await db.query(`insert into ${SCHEMA}."time_off_request"
    ("source_app_id","id","agency_id","employee_email","status","start_date","end_date")
    values ($1,'other-agency',$2,$3,'approved','2026-10-01','2026-10-02')`,
  [APP, B, email(ADMIN_B)]);

  const result = await approved(CLINICIAN_A);
  // Approved only, agency only, in start-date order.
  assert.deepEqual(result.requests.map(row => row.id), [first.id]);
  assert.equal(result.requests[0].status, 'approved');
  // Agency B's administrator sees their own and not agency A's.
  assert.deepEqual((await approved(ADMIN_B, B)).requests.map(row => row.id), ['other-agency']);
});
