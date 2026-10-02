import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { readdir } from 'node:fs/promises';
import { SCHEMA } from '../../../tools-entity-schema-plan.mjs';
import {
  RECORD_MIGRATION_DIRECTORY, applyRecordMigrations, recordMigrationNames,
} from './record-migrations.mjs';

/**
 * A timesheet's named approver has to still hold the role (D33's shape).
 *
 * `contract_timesheet_review` admitted anybody whose address equalled the
 * sheet's stored `manager_email`, and `manager_email` is a snapshot taken when
 * the sheet was SUBMITTED. The submit validates the nominee's role
 * authoritatively, so the address was never a forgeable claim — what it was is
 * STALE, and the one way it goes stale while the caller still has an identity in
 * the agency is a DEMOTION.
 *
 * The suite is deliberately about that bound as much as about the fix. Four of
 * its cases assert refusals that were ALREADY closed, by `caller_tenant_role`
 * and by the actor table, because a suite that only exercised the new conjunct
 * would leave a reader thinking this change closed them.
 */
const NAME = '20260920730000_timesheet_review_approver_role.sql';
const ORIGINAL = '20260920360000_contract_timesheet.sql';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rid = n => `6aac00000000${String(n).padStart(12, '0')}`;
/**
 * 1 is `agency_admin` in agency-a, 2 and 3 clinicians there, 4 `agency_admin` in
 * agency-b — from `fixtures.sql`. The shared fixtures hold NO `manager` in any
 * agency, which is the role this whole change is about, so 5 and 6 are added
 * here: 5 a `manager` and 6 a `clinician` who will be NAMED on a sheet. Added in
 * this suite rather than in `fixtures.sql`, which around fifty others share and
 * whose populations would all shift.
 */
const ADMIN_A = 1; const CLINICIAN_A = 2; const ADMIN_B = 4;
const MANAGER_A = 5; const NAMED_CLINICIAN_A = 6;
const EMAIL = Object.freeze({
  [ADMIN_A]: 'admin-a@example.invalid',
  [CLINICIAN_A]: 'clinician-a@example.invalid',
  [ADMIN_B]: 'admin-b@example.invalid',
  [MANAGER_A]: 'manager-a@example.invalid',
  [NAMED_CLINICIAN_A]: 'named-clinician-a@example.invalid',
});
const ADDED = Object.freeze([[MANAGER_A, 'manager'], [NAMED_CLINICIAN_A, 'clinician']]);
const SUBMIT = 'select "public"."pennsync_contract_timesheet_submit"($1,$2,$3) as result';
const REVIEW = 'select "public"."pennsync_contract_timesheet_review"($1,$2,$3,$4) as result';
const A = 'agency-a';
/** On the biweekly cycle anchored to Sun 2026-06-14. */
const PERIOD = Object.freeze({ pay_period_start: '2026-09-06', pay_period_end: '2026-09-19' });
const SHEET = Object.freeze({ ...PERIOD, regular_hours: 72, overtime_hours: 4, miles: 210 });

let db;
let applied;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  applied = await applyRecordMigrations(db);
  // The applied set is the WHOLE directory, which is the invariant the sibling
  // contract suites carry and the one that makes a forward file's effect on
  // anything else observable at all. `includes` alone would pass against a store
  // built from two files, so the pair is load-bearing in both directions: the
  // equality says nothing was skipped, and the two `includes` say which two
  // files this suite is actually about.
  assert.deepEqual(applied, await recordMigrationNames(),
    'the applied set is the record directory, sorted, and nothing else');
  for (const name of [ORIGINAL, NAME]) {
    assert.ok(applied.includes(name), `${name} must be applied: this suite measures it`);
  }
  // The guard is RETIRED here, by the helper's own instruction: this migration
  // has MERGED, and `20260920740000_time_off_review_approver_role` — which this
  // merge brings in — now sorts after it. The helper admits exactly one holder,
  // so the call moves on to `contract-time-off-review-approver.test.mjs` and is
  // held there alone; keeping it would fail this `before` and take every test in
  // this suite down with it, naming a contract that had done nothing wrong.
  //
  // Note that git could not tell anybody this. Neither side of the merge touched
  // this file, so it merged clean while still holding a call its own migration
  // had just made false — the red would have arrived with no conflict marker
  // pointing at it. The two sibling suites that carry this comment were each
  // found the same way.
  //
  // Retiring it is NOT asserting nothing. The set equality and the two
  // `includes` above are this suite's own properties and are what still catch
  // this file, or the contract it measures, being renamed away.
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));

  await db.exec(`insert into auth.users(id,email,email_confirmed_at) values
    ${ADDED.map(([n]) => `('${uid(n)}','${EMAIL[n]}',clock_timestamp())`).join(',\n    ')};
    insert into auth.sessions(id,user_id,not_after) select
      ('${sid(0).slice(0, -12)}'||right(id::text,12))::uuid,id,clock_timestamp()+interval '1 hour'
      from auth.users where id in (${ADDED.map(([n]) => `'${uid(n)}'`).join(',')});
    insert into pennsync_private.identity_map(app_id,auth_user_id,base44_user_id,
      expected_email,source_evidence_sha256,verified_at)
      select '${APP}',id,'6aac00000000'||right(id::text,12),email,repeat('a',64),clock_timestamp()
      from auth.users where id in (${ADDED.map(([n]) => `'${uid(n)}'`).join(',')});
    insert into pennsync_private.membership(app_id,id,agency_id,auth_user_id,
      base44_user_id,tenant_role,status) values
    ${ADDED.map(([n, role]) => `('${APP}','membership-approver-${n}','${A}','${uid(n)}',`
      + `'${rid(n)}','${role}','active')`).join(',\n    ')};`);
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
const submit = (who, approver) => as(who, SUBMIT, [A, null,
  JSON.stringify({ ...SHEET, ...(approver ? { manager_email: EMAIL[approver] } : {}) })]);
const review = (who, id, decision = 'approved') => as(who, REVIEW, [A, id, decision, null]);
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);
const clear = async () => {
  for (const t of ['timesheet', 'notification']) await db.query(`delete from ${SCHEMA}."${t}"`);
};
/** Move somebody's tenant role without going through the membership contract. */
const setRole = (n, role) => db.query(
  'update pennsync_private.membership set tenant_role = $1 where id = $2',
  [role, `membership-approver-${n}`]);
/**
 * Move a membership's status, satisfying `membership_check`.
 *
 * That constraint is a coherence rule rather than a formality — `suspended`
 * requires `suspended_at`, `revoked` requires `revoked_at` AND `revoked_by` — so
 * a fixture setting the status alone is refused. Worth keeping in the fixture
 * rather than relaxing: the table is the rule the original's `validateMemberships`
 * re-derived per read (D34).
 */
const setStatus = (n, status) => db.query(
  `update pennsync_private.membership set status = $1,
     activated_at = coalesce(activated_at, clock_timestamp()),
     suspended_at = case when $1 = 'suspended' then clock_timestamp()
       when $1 = 'revoked' then suspended_at else null end,
     revoked_at = case when $1 = 'revoked' then clock_timestamp() end,
     revoked_by = case when $1 = 'revoked' then $3::uuid end
   where id = $2`,
  [status, `membership-approver-${n}`, uid(ADMIN_A)]);

/**
 * The function body of ONE named function in a migration's text.
 *
 * `$contract$` is used by more than one function in the original, so the body is
 * taken from the first delimiter AFTER the declaration rather than by splitting
 * the file.
 */
function bodyOf(sql, name) {
  const declaration = sql.indexOf(`function "pennsync_records".${name}(`);
  assert.ok(declaration > 0, `${name} must be declared in this file`);
  const open = sql.indexOf('$contract$', declaration);
  const close = sql.indexOf('$contract$', open + 10);
  assert.ok(open > 0 && close > open, `${name} must have a $contract$ body`);
  return sql.slice(open + 10, close);
}

test('the body is the original with ONE region changed, and that region is the gate', async () => {
  const read = name => readFile(new URL(name, RECORD_MIGRATION_DIRECTORY), 'utf8');
  const mine = bodyOf(await read(NAME), 'contract_timesheet_review');
  const theirs = bodyOf(await read(ORIGINAL), 'contract_timesheet_review');
  assert.notEqual(mine, theirs, 'a forward file that changed nothing is not a port');

  // Common prefix and suffix, so what is left is exactly what moved. Asserting
  // "one region" rather than diffing line by line: a retype that drifted a
  // column anywhere else in the body would leave TWO regions, and the whole
  // reason this file is a lift is that such a drift is silent. The body is long
  // enough for that to be a real risk, and the length is not quoted here because
  // this test is what reads it.
  let head = 0;
  while (head < mine.length && mine[head] === theirs[head]) head += 1;
  let tail = 0;
  while (tail < mine.length - head && tail < theirs.length - head
    && mine[mine.length - 1 - tail] === theirs[theirs.length - 1 - tail]) tail += 1;

  const mineMiddle = mine.slice(head, mine.length - tail);
  const theirsMiddle = theirs.slice(head, theirs.length - tail);
  // The original's side of the change: the one-conjunct gate.
  assert.match(theirsMiddle, /is distinct from v_email$/,
    'the region that moved must be the review gate');
  assert.ok(!/manager_email/.test(mine.slice(0, head) + mine.slice(mine.length - tail)),
    'no OTHER mention of manager_email may be outside the changed region');
  // Ours: the role is named, and the agency it is read in is the sheet's.
  assert.match(mineMiddle, /v_role = 'manager'/);
  assert.match(mineMiddle, /v_email is not null/);

  // The `then`, the `raise` and the refusal CODE are in the shared suffix rather
  // than in either region, which is a stronger statement than asserting the code
  // on both sides: the two gates refuse through literally the same statement, so
  // no caller can tell from a refusal which version is deployed.
  const suffix = mine.slice(mine.length - tail);
  assert.match(suffix, /^ then\n\s+raise exception using errcode='42501', message='PENNSYNC_TIMESHEET_REVIEW_FORBIDDEN';/);
});

test('a named manager approves, and the same person demoted cannot', async () => {
  await clear();
  // The case this change exists for, in the order it happens: the sheet is
  // submitted while the nominee is a manager — the submit validates that and
  // would refuse otherwise — and the demotion comes afterwards. So the row is
  // legitimate and goes stale, which is why no sweep and no data migration is
  // needed: the role is read at REVIEW time.
  const first = await submit(CLINICIAN_A, MANAGER_A);
  assert.ok(first.timesheet.id);
  assert.equal((await review(MANAGER_A, first.timesheet.id)).decision, 'approved');

  await clear();
  const second = await submit(CLINICIAN_A, MANAGER_A);
  await setRole(MANAGER_A, 'clinician');
  try {
    await refusal(review(MANAGER_A, second.timesheet.id),
      'PENNSYNC_TIMESHEET_REVIEW_FORBIDDEN');
    // And the sheet is still awaiting review rather than having been touched.
    const { rows } = await db.query(
      `select "status", "reviewed_by" from ${SCHEMA}."timesheet" where "id" = $1`,
      [second.timesheet.id]);
    assert.equal(rows[0].status, 'submitted');
    assert.equal(rows[0].reviewed_by, null);
  } finally { await setRole(MANAGER_A, 'manager'); }
});

test('a clinician named on a sheet is refused even though the address matches', async () => {
  await clear();
  // The submit refuses a clinician nominee, so this row cannot be made through
  // the contract — which is the point: it is the shape an EXISTING row has, and
  // the shape a Base44-era row carried in could have. Planted directly for that
  // reason, and the submit's own refusal is asserted first so the two halves are
  // not confused for each other.
  await refusal(submit(CLINICIAN_A, NAMED_CLINICIAN_A),
    'PENNSYNC_TIMESHEET_APPROVER_INVALID');

  const id = 'sheet-named-clinician';
  await db.query(`insert into ${SCHEMA}."timesheet"
    ("source_app_id","id","agency_id","employee_email","manager_email","status",
     "pay_period_start","pay_period_end")
    values ($1,$2,$3,$4,$5,'submitted',$6,$7)`,
  [APP, id, A, EMAIL[CLINICIAN_A], EMAIL[NAMED_CLINICIAN_A],
    PERIOD.pay_period_start, PERIOD.pay_period_end]);
  await refusal(review(NAMED_CLINICIAN_A, id), 'PENNSYNC_TIMESHEET_REVIEW_FORBIDDEN');
  // The administrator leg is untouched, so the sheet is not stranded.
  assert.equal((await review(ADMIN_A, id)).decision, 'approved');
});

test('a manager who is not named, and an administrator who is not, are unchanged', async () => {
  await clear();
  const sheet = await submit(CLINICIAN_A, MANAGER_A);
  // A manager of this agency who is not this sheet's approver stays refused: the
  // narrowing adds a conjunct to the named leg and does not widen the role leg.
  await refusal(review(NAMED_CLINICIAN_A, sheet.timesheet.id),
    'PENNSYNC_TIMESHEET_REVIEW_FORBIDDEN');
  // And an `agency_admin` who is named nowhere still reviews, by the first
  // conjunct, which is why the second names only `manager`.
  assert.equal((await review(ADMIN_A, sheet.timesheet.id)).decision, 'approved');
});

test('never your own, whatever role you hold', async () => {
  await clear();
  // Unchanged by this file and asserted here because the new gate sits above it:
  // a reordering that let the role leg answer first would make an administrator
  // able to approve their own sheet.
  const own = await submit(ADMIN_A, MANAGER_A);
  await refusal(review(ADMIN_A, own.timesheet.id), 'PENNSYNC_TIMESHEET_REVIEW_SELF');
});

test('suspension and revocation were already closed, by the membership not the gate', async () => {
  // The bound on this change, asserted so the suite cannot be read as claiming
  // more than it does. `caller_tenant_role` filters `status = 'active' and
  // revoked_at is null`, and the contract's FIRST check refuses when it answers
  // null — so these two never reached the approver gate at all, before or after.
  for (const status of ['suspended', 'revoked']) {
    await clear();
    const sheet = await submit(CLINICIAN_A, MANAGER_A);
    await setStatus(MANAGER_A, status);
    try {
      await refusal(review(MANAGER_A, sheet.timesheet.id),
        'PENNSYNC_TIMESHEET_AGENCY_NOT_HELD');
    } finally { await setStatus(MANAGER_A, 'active'); }
  }
});

test('the v_email guard is unreachable, and the premise that makes it so is pinned', async () => {
  // Sabotaging `v_email is not null` fails nothing, and that is correct rather
  // than a gap: `v_role` is non-null only when `caller_identity()` resolved an
  // `identity_map` row, and `expected_email` on that table is `not null`, so
  // `caller_email()` cannot be null where `v_role` is not. The guard is kept
  // because the condition is INVERTED and `if not (null)` admits rather than
  // refuses — so it is a guard on the shape, not on a reachable state.
  //
  // What is asserted is the PREMISE, from the catalog rather than from the file:
  // if that column ever becomes nullable the conjunct stops being unreachable and
  // becomes the only thing holding, and somebody should find out here.
  const { rows } = await db.query(`select a.attnotnull
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'pennsync_private' and c.relname = 'identity_map'
      and a.attname = 'expected_email' and a.attnum > 0 and not a.attisdropped`);
  assert.equal(rows.length, 1, 'identity_map.expected_email must exist');
  assert.equal(rows[0].attnotnull, true,
    'expected_email is what makes caller_email() non-null wherever a tenant role '
    + 'resolves; if it becomes nullable, the v_email conjunct becomes load-bearing');
});

test('an approver named in one agency cannot review from another', async () => {
  await clear();
  const sheet = await submit(CLINICIAN_A, MANAGER_A);
  // `agency_admin` in agency-b, holding nothing in agency-a. The sheet is loaded
  // with `agency_id = p_agency`, so this is a NOT_FOUND-class refusal rather
  // than a gate one, and it is asserted because reading the role without the
  // agency is the mistake a one-conjunct fix makes.
  await refusal(review(ADMIN_B, sheet.timesheet.id), 'PENNSYNC_TIMESHEET_AGENCY_NOT_HELD');
});
