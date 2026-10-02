import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { SCHEMA } from '../../../tools-entity-schema-plan.mjs';
import {
  RECORD_MIGRATION_DIRECTORY, applyRecordMigrations, recordMigrationNames,
} from './record-migrations.mjs';

/**
 * A leave request's named approver has to still hold the role (D33's shape).
 *
 * `contract_time_off_review` admitted anybody whose address equalled the
 * request's stored `manager_email`, and `manager_email` is a snapshot taken when
 * the request was SUBMITTED. The submit validates the nominee's role
 * authoritatively through `pennsync_private.agency_colleague`, so the address was
 * never a forgeable claim — what it was is STALE, and the one way it goes stale
 * while the caller still has an identity in the agency is a DEMOTION.
 *
 * This is the sibling of `contract-timesheet-review-approver.test.mjs` and it is
 * not a copy: the two gates differ inside the line being changed, so the cases
 * that matter here are the ones about THIS contract's own conditions.
 *
 * The suite is deliberately about the bound as much as about the fix. Four of
 * its cases assert refusals that were ALREADY closed, by `caller_tenant_role` and
 * by the actor table, because a suite that only exercised the new conjunct would
 * leave a reader thinking this change closed them.
 */
const NAME = '20260920740000_time_off_review_approver_role.sql';
const ORIGINAL = '20260920230000_contract_time_off.sql';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rid = n => `6aac00000000${String(n).padStart(12, '0')}`;
/**
 * 1 is `agency_admin` in agency-a, 2 a clinician there, 4 `agency_admin` in
 * agency-b — from `fixtures.sql`. The shared fixtures hold NO `manager` in any
 * agency, which is the role this whole change is about, so 5 and 6 are added
 * here: 5 a `manager` and 6 a `clinician` who will be NAMED on a request. Added
 * in this suite rather than in `fixtures.sql`, which around fifty others share
 * and whose populations would all shift.
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
const SUBMIT = 'select "public"."pennsync_contract_time_off_submit"($1,$2,$3,$4,$5,$6,$7,$8) as result';
const REVIEW = 'select "public"."pennsync_contract_time_off_review"($1,$2,$3,$4) as result';
const A = 'agency-a';

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
  // equality says nothing was skipped, and the `includes` below say which two
  // files this suite is actually about.
  assert.deepEqual(applied, await recordMigrationNames(),
    'the applied set is the record directory, sorted, and nothing else');
  for (const name of [ORIGINAL, NAME]) {
    assert.ok(applied.includes(name), `${name} must be applied: this suite measures it`);
  }
  // The ordering guard is retired here, which is what the helper's own docstring
  // asks for once this migration has MERGED: it is part of what a store already
  // holds, so a later file sorting after it is a correct tree rather than a base
  // that moved. It has moved on to
  // `20260920745000_dashboard_visit_documentation.sql`, in
  // `contract-dashboard.test.mjs`.
  //
  // Retiring the CALL is all that happens here. The three assertions above are
  // this suite's own and are untouched: the set equality says the store it built
  // is the whole record directory, and the two `includes` say which files this
  // suite measures. A predecessor that dropped that half along with the guard
  // would stop observing its own migration's application, which is the half the
  // guard was never doing.
  //
  // Git cannot flag this. Neither branch of the merge that created the second
  // holder touched this file, so it merges clean while being made false by the
  // migration arriving beside it.
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
    ${ADDED.map(([n, role]) => `('${APP}','membership-leave-${n}','${A}','${uid(n)}',`
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
const submit = (who, approver, agency = A) => as(who, SUBMIT, [agency, 'vacation',
  '2026-10-05', '2026-10-09', false, 'family trip', 'Pat covers',
  approver ? EMAIL[approver] : null]);
const review = (who, id, decision = 'approved', agency = A) =>
  as(who, REVIEW, [agency, id, decision, null]);
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);
/**
 * Rows gone, and the added memberships back to the state the fixture built.
 *
 * The role and status restore is not tidiness. Several cases below MOVE a
 * membership, and a case that fails on its first assertion never reaches the
 * line that would put it back — so a single real failure would cascade into
 * every later case and the suite would report six broken things instead of one.
 * Found by sabotaging the gate and watching seven cases go red for one defect.
 */
const reset = async () => {
  await db.query(`delete from ${SCHEMA}."time_off_request"`);
  await db.query(`update pennsync_private.membership set tenant_role = $2,
      status = 'active', activated_at = coalesce(activated_at, clock_timestamp()),
      suspended_at = null, revoked_at = null, revoked_by = null
    where id = $1`, ['membership-leave-5', 'manager']);
  await db.query(`update pennsync_private.membership set tenant_role = $2,
      status = 'active', activated_at = coalesce(activated_at, clock_timestamp()),
      suspended_at = null, revoked_at = null, revoked_by = null
    where id = $1`, ['membership-leave-6', 'clinician']);
};
/** Move somebody's tenant role without going through the membership contract. */
const setRole = (n, role) => db.query(
  'update pennsync_private.membership set tenant_role = $1 where id = $2',
  [role, `membership-leave-${n}`]);
/**
 * Move a membership's status, satisfying `membership_check`.
 *
 * That constraint is a coherence rule rather than a formality — `suspended`
 * requires `suspended_at`, `revoked` requires `revoked_at` AND `revoked_by` — so
 * a fixture setting the status alone is refused.
 */
const setStatus = (n, status) => db.query(
  `update pennsync_private.membership set status = $1,
     activated_at = coalesce(activated_at, clock_timestamp()),
     suspended_at = case when $1 = 'suspended' then clock_timestamp()
       when $1 = 'revoked' then suspended_at else null end,
     revoked_at = case when $1 = 'revoked' then clock_timestamp() end,
     revoked_by = case when $1 = 'revoked' then $3::uuid end
   where id = $2`,
  [status, `membership-leave-${n}`, uid(ADMIN_A)]);

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
  const mine = bodyOf(await read(NAME), 'contract_time_off_review');
  const theirs = bodyOf(await read(ORIGINAL), 'contract_time_off_review');
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

  assert.match(mineMiddle, /v_role = 'manager'/,
    'the one region that moved must be the role conjunct');
  assert.doesNotMatch(theirsMiddle, /v_role = 'manager'/,
    'and the original must not already have it');
  // The two conditions this contract already had are in the SHARED SUFFIX, not in
  // the changed region, and that is a stronger statement than finding them in the
  // new text: they are the original's own bytes rather than retyped ones. They
  // are also the two differences from the timesheet's gate, so a reader who
  // assumed the sibling's shape would have dropped them.
  const suffix = mine.slice(mine.length - tail);
  assert.match(suffix, /^coalesce\(v_row\."manager_email", ''\) <> ''/,
    "the empty-string guard must be the original's own bytes, not retyped");
  assert.match(suffix,
    /pg_catalog\.lower\(v_row\."manager_email"\) = pg_catalog\.lower\(v_email\)/,
    'and both sides stay lowercased, as the original has them');

  // The refusal is in that shared suffix too, which is stronger than asserting
  // the code on both sides: the two gates refuse through literally the same
  // statement, so no caller can tell from a refusal which version is deployed.
  assert.match(suffix,
    /\n {4}raise exception using errcode='42501', message='PENNSYNC_TIME_OFF_FORBIDDEN';/,
    'the raise must be shared, not reproduced on each side');
  // The whole of what moved: the comment above the gate, and one conjunct.
  assert.match(mineMiddle, /^ AND who still\n/,
    'the region must open in the comment the change rewrote');
  assert.match(mineMiddle, /or \(v_role = 'manager'\n\s+and $/,
    'and close on the conjunct itself, with nothing else in between');
  // And the stored approver is still asked about in exactly one statement: the
  // lift added no mention and lost none, and both sit inside the gate. A fix
  // that re-checked the role somewhere else as well would pass the one-region
  // test above and fail this one.
  assert.equal((mine.match(/manager_email/g) ?? []).length,
    (theirs.match(/manager_email/g) ?? []).length,
    'the lift neither added nor removed a mention of the stored approver');
  const gate = /if not \(v_role = 'agency_admin'[\s\S]*?\) then/.exec(mine);
  assert.ok(gate, 'the gate statement must be findable');
  assert.equal((gate[0].match(/manager_email/g) ?? []).length,
    (mine.match(/manager_email/g) ?? []).length,
    'and every mention of it is inside that one statement');
});

test('a named manager decides the request that named them, and the same person demoted cannot', async () => {
  await reset();
  await setRole(MANAGER_A, 'manager');
  const first = await submit(CLINICIAN_A, MANAGER_A);
  assert.equal((await review(MANAGER_A, first.request.id)).success, true);

  // The whole change, in one case: the same person, the same stored address, the
  // same request shape, and the only thing that moved is their tenant role.
  const second = await submit(CLINICIAN_A, MANAGER_A);
  await setRole(MANAGER_A, 'clinician');
  await refusal(review(MANAGER_A, second.request.id), 'PENNSYNC_TIME_OFF_FORBIDDEN');
});

test('a clinician named on a request is refused even though the address matches', async () => {
  await reset();
  // The submit refuses a clinician as a nominee, so the row has to be planted to
  // reach the state a DEMOTION produces: an address on a request belonging to
  // somebody who does not hold an approver role now. Planting it is the point —
  // the product cannot create this row, and before this change the gate could
  // not tell it apart from one the submit had accepted.
  await refusal(submit(CLINICIAN_A, NAMED_CLINICIAN_A), 'PENNSYNC_TIME_OFF_APPROVER_INVALID');
  const filed = await submit(CLINICIAN_A, MANAGER_A);
  await db.query(
    `update ${SCHEMA}."time_off_request" set "manager_email" = $1 where "id" = $2`,
    [EMAIL[NAMED_CLINICIAN_A], filed.request.id]);
  await refusal(review(NAMED_CLINICIAN_A, filed.request.id), 'PENNSYNC_TIME_OFF_FORBIDDEN');
});

test('an administrator decides without being named, and a manager who is not named does not', async () => {
  await reset();
  const filed = await submit(CLINICIAN_A, MANAGER_A);
  // Unchanged by this file: the first leg never asked about the stored address.
  assert.equal((await review(ADMIN_A, filed.request.id)).success, true);

  const other = await submit(CLINICIAN_A, null);
  // A manager who is not named is refused — and this is the empty-approver case,
  // which is what the original's `coalesce(..., '') <> ''` guard is for. It
  // answered the same way before this change, and is asserted so the guard is
  // covered rather than merely carried through the lift.
  await refusal(review(MANAGER_A, other.request.id), 'PENNSYNC_TIME_OFF_FORBIDDEN');
  assert.equal((await review(ADMIN_A, other.request.id)).success, true);
});

test('never your own leave, whatever role you hold', async () => {
  await reset();
  // Pre-existing and untouched, asserted because an administrator who could
  // approve their own leave is the reason that check exists, and a change to the
  // gate above it is exactly where it would be lost.
  const own = await submit(ADMIN_A, MANAGER_A);
  await refusal(review(ADMIN_A, own.request.id), 'PENNSYNC_TIME_OFF_SELF');
});

test('suspension and revocation were already closed, by the membership not the gate', async () => {
  await reset();
  const filed = await submit(CLINICIAN_A, MANAGER_A);
  // Both refuse at `caller_tenant_role`, BEFORE the gate this file changes, which
  // is why naming them as holes this change closes would overstate it.
  await setStatus(MANAGER_A, 'suspended');
  await refusal(review(MANAGER_A, filed.request.id), 'PENNSYNC_TIME_OFF_AGENCY_NOT_HELD');
  await setStatus(MANAGER_A, 'revoked');
  await refusal(review(MANAGER_A, filed.request.id), 'PENNSYNC_TIME_OFF_AGENCY_NOT_HELD');
  await setStatus(MANAGER_A, 'active');
  assert.equal((await review(MANAGER_A, filed.request.id)).success, true);
});

test('an approver named in one agency cannot decide from another', async () => {
  await reset();
  const filed = await submit(CLINICIAN_A, MANAGER_A);
  // `caller_tenant_role` takes the agency as its argument and `agency-b`'s
  // administrator holds nothing in `agency-a`, so this is a NOT_HELD-class
  // refusal rather than a gate one. Asserted because reading the role without
  // the agency is the mistake a one-conjunct fix makes.
  await refusal(review(ADMIN_B, filed.request.id), 'PENNSYNC_TIME_OFF_AGENCY_NOT_HELD');
});

test('replacing the function kept its owner and its grants', async () => {
  // `create or replace` is the whole mechanism this file relies on, and it is
  // only sufficient because the signature does not move. If it ever did, the
  // function would be CREATED instead — new owner, default `PUBLIC` execute —
  // and nothing else here would notice.
  const { rows } = await db.query(
    `select p.proname, pg_catalog.pg_get_userbyid(p.proowner) as owner, p.proacl::text as acl
     from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'pennsync_records'
       and p.proname in ('contract_time_off_review', 'contract_time_off_cancel')`);
  const found = Object.fromEntries(rows.map(r => [r.proname, r]));
  assert.equal(found.contract_time_off_review.owner, 'pennsync_records_owner');

  // The control is its SIBLING in the same original file, which this change does
  // not touch. Comparing against it rather than against a typed-out string means
  // the expectation is derived: if `create or replace` had reset the ACL, the two
  // would differ, and if the original's grants ever move the control moves with
  // them. A replace that CREATED the function instead would show a `PUBLIC`
  // execute, which neither has.
  assert.equal(found.contract_time_off_review.acl, found.contract_time_off_cancel.acl,
    'the replaced function must hold exactly the grants its untouched sibling does');
  assert.doesNotMatch(found.contract_time_off_review.acl ?? '', /(^|,|\{)=X/,
    'PUBLIC must hold no execute on either');
});
