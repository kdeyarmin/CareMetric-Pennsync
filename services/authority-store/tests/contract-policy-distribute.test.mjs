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
 * Distributing a policy version (`contract_policy_distribute`).
 *
 * Three properties are worth the file.
 *
 * The GATE: the original admits a built-in admin, a claimed `agency_admin` and
 * a claimed `super_admin`, and only two of those can ever arrive. The built-in
 * admin is the platform tier D14 and D22 removed, and for that caller the
 * original's own agency filter is SKIPPED, so the tier was structurally the
 * cross-tenant distribution. What is left is the agency administrator, who was
 * always a live performer here.
 *
 * The KEY: the original claims idempotency it never had a constraint for, and
 * emulates it with a prefetched set plus a create-read-delete compensation.
 * D78 enumerates the key and this catches it by name.
 *
 * The ENVELOPE, which is D45's rule and the reason for the last test in this
 * file: a capability that writes a row another capability reads is not proved
 * by either suite alone. D44's fan-out stamped three of the six columns the
 * reader filters on and both suites passed while every alert it wrote was
 * addressed to nobody. So the last test distributes through this contract and
 * reads through `pennsync_contract_notification_list`.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const DIR = 'services/authority-store/supabase/record-migrations/';
// `pennsync_private.caller_membership` arrives with the note-history contract
// (D34), and both the mint and the notification reader refuse to apply without
// it — by name, in their own preambles, rather than by failing on first use.
const CARRIED = [
  `${DIR}20260920010000_activity_audit.sql`,
  `${DIR}20260920170000_contract_note_history.sql`,
  `${DIR}20260920285000_notification_mint.sql`,
  `${DIR}20260920300000_contract_notification.sql`,
  `${DIR}20260920540000_contract_policy_distribute.sql`,
];
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN_A = 1; const CLINICIAN_A = 2; const ADMIN_B = 4;
const A = 'agency-a'; const B = 'agency-b';
const POLICY = 'policy-1';
const DISTRIBUTE =
  'select "public"."pennsync_contract_policy_distribute"($1,$2,$3,$4,$5) as result';
// The whole of agency-a's active roster, which is what an unfiltered call means.
const ROSTER = ['admin-a@example.invalid', 'clinician-a@example.invalid',
  'clinician-empty@example.invalid'];
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, ...CARRIED]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  for (const [id, agency, version] of [[POLICY, A, '3'], ['policy-b', B, '1']]) {
    await db.query(`insert into ${SCHEMA}."policy_library"
      ("source_app_id","id","agency_id","title","policy_number","doc_url","version","status")
      values ($1,$2,$3,'Hand Hygiene','HH-1','https://example.invalid/p.pdf',$4,'active')`,
    [APP, id, agency, version]);
  }
});
after(async () => db?.close());

async function as(n, sql, params = [], commit = false) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
    const { rows } = await db.query(sql, params);
    if (commit) await db.exec('commit'); else await db.exec('rollback');
    return rows[0].result;
  } catch (error) { await db.exec('rollback'); throw error; }
}
const distribute = (n, { agency = A, policy = POLICY, due = null, emails = null,
  filters = null, commit = false } = {}) =>
  as(n, DISTRIBUTE, [agency, policy, due, emails, filters], commit);
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);
const assignedTo = async () => (await db.query(
  `select "user_id" from ${SCHEMA}."policy_acknowledgment"
   where "policy_id" = $1 order by "user_id"`, [POLICY])).rows.map(row => row.user_id);

test('an agency administrator distributes to the whole roster', async () => {
  const result = await distribute(ADMIN_A, { due: '2026-12-01' });
  assert.equal(result.success, true);
  // The policy row's own version, not a default.
  assert.equal(result.policy_version, '3');
  assert.equal(result.distributed, 3);
  assert.equal(result.skipped, 0);
  assert.equal(result.candidates, 3);
});

test('the cohort is the authority store roster, not a scan of profile rows', async () => {
  await distribute(ADMIN_A, { commit: true });
  assert.deepEqual(await assignedTo(), ROSTER);
  const [row] = (await db.query(
    `select "policy_title","policy_number","policy_version","doc_url","user_name",
            "distributed_by","status","acknowledged","agency_id"
     from ${SCHEMA}."policy_acknowledgment" where "user_id" = $1`,
    ['clinician-a@example.invalid'])).rows;
  assert.equal(row.policy_version, '3');
  assert.equal(row.status, 'assigned');
  assert.equal(row.acknowledged, false);
  assert.equal(row.agency_id, A);
  assert.equal(row.distributed_by, 'admin-a@example.invalid');
  // The carried `user` table has no `full_name` (D38), so the original's
  // `user.full_name` is only ever the address here. Snapshotted, not joined.
  assert.equal(row.user_name, 'clinician-a@example.invalid');
  assert.equal(row.policy_title, 'Hand Hygiene');
});

test('a second distribution of the same version assigns nobody again', async () => {
  // The original prefetches a set and then compensates for the gap it leaves.
  // This is the constraint doing it, and the caller is told which it was.
  const result = await distribute(ADMIN_A);
  assert.equal(result.distributed, 0);
  assert.equal(result.skipped, 3);
  assert.equal(result.candidates, 3);
  assert.deepEqual(await assignedTo(), ROSTER, 'and no duplicate row was written');
});

test('a new version assigns afresh and leaves the old version standing', async () => {
  await db.query(`update ${SCHEMA}."policy_library" set "version" = '4' where "id" = $1`,
    [POLICY]);
  try {
    const result = await distribute(ADMIN_A, { commit: true });
    assert.equal(result.policy_version, '4');
    assert.equal(result.distributed, 3);
    const versions = (await db.query(
      `select distinct "policy_version" from ${SCHEMA}."policy_acknowledgment"
       where "policy_id" = $1 order by 1`, [POLICY])).rows.map(row => row.policy_version);
    assert.deepEqual(versions, ['3', '4'], 'prior-version rows remain as history');
  } finally {
    await db.query(`delete from ${SCHEMA}."policy_acknowledgment" where "policy_version" = '4'`);
    await db.query(`update ${SCHEMA}."policy_library" set "version" = '3' where "id" = $1`,
      [POLICY]);
  }
});

test('an explicit address list narrows the cohort exactly', async () => {
  await db.query(`delete from ${SCHEMA}."policy_acknowledgment" where "policy_id" = $1`, [POLICY]);
  const result = await distribute(ADMIN_A,
    { emails: JSON.stringify(['CLINICIAN-A@example.invalid ']), commit: true });
  assert.equal(result.candidates, 1);
  assert.equal(result.distributed, 1);
  // Lowered and trimmed before matching, because `identity_map.expected_email`
  // is constrained to that form and the comparison has to meet it there.
  assert.deepEqual(await assignedTo(), ['clinician-a@example.invalid']);
  // An address that is not on the roster selects nobody rather than inventing
  // a row for somebody this agency does not hold.
  const stranger = await distribute(ADMIN_A, { emails: JSON.stringify(['nobody@example.invalid']) });
  assert.equal(stranger.candidates, 0);
  assert.equal(stranger.distributed, 0);
  await db.query(`delete from ${SCHEMA}."policy_acknowledgment" where "policy_id" = $1`, [POLICY]);
});

test('every cohort filter with no carried column is refused BY NAME', async () => {
  // D44's rule. Dropping them would not fail: it would distribute a compliance
  // assignment to MORE people than were asked for, and every one of them would
  // then be overdue on a policy nobody meant to give them.
  for (const key of ['role', 'department', 'business_line', 'location']) {
    await refusal(distribute(ADMIN_A, { filters: JSON.stringify({ [key]: 'anything' }) }),
      `PENNSYNC_POLICY_FILTER_UNPORTED:${key}`);
  }
  // `all` is the original's own "no filter" sentinel, so a request that
  // narrows nothing is served rather than refused for naming the key.
  const result = await distribute(ADMIN_A,
    { filters: JSON.stringify({ role: 'all', department: 'all' }) });
  assert.equal(result.distributed, 3);
  // A key the original never had is a malformed request, not an unported one.
  // This half IS a narrowing — the original ignores a key it does not know —
  // and it is the safe direction: a misspelled filter that distributes to
  // everybody is the failure D44 refuses fields to avoid.
  await refusal(distribute(ADMIN_A, { filters: JSON.stringify({ shoe_size: '9' }) }),
    'PENNSYNC_POLICY_FILTERS_INVALID');
  // And an unported filter alongside an EXPLICIT list is served, because the
  // original consults its filters only in the `else` of `userEmails.length > 0`
  // — that request never had the filter applied in Base44 either, so refusing
  // it would be this port inventing a rule. Driven off the original's own
  // branch rather than off what the refusal looks like it should cover.
  const both = await distribute(ADMIN_A, {
    emails: JSON.stringify(['clinician-a@example.invalid']),
    filters: JSON.stringify({ department: 'Nursing' }),
  });
  assert.equal(both.candidates, 1, 'the list decided, as it does upstream');
});

test('an empty address list is the whole roster, not an empty cohort', async () => {
  // The shape the product actually sends. `PolicyAcknowledgmentManager.jsx`
  // passes all four keys on every call, with `userEmails: []` and
  // `filters: {}` for the whole-roster button, and the original destructures
  // `userEmails = []` and branches on its length. Reading `[]` as "nobody"
  // would refuse or no-op every unfiltered distribution the product makes
  // (D58: check the call site before deciding what a request shape means).
  await db.query(`delete from ${SCHEMA}."policy_acknowledgment" where "policy_id" = $1`, [POLICY]);
  const result = await distribute(ADMIN_A,
    { emails: JSON.stringify([]), filters: JSON.stringify({}) });
  assert.equal(result.candidates, 3);
  assert.equal(result.distributed, 3);
  // A list that named somebody and resolved to nobody is still a bad request:
  // blanks are not an absent list.
  await refusal(distribute(ADMIN_A, { emails: JSON.stringify(['  ', '']) }),
    'PENNSYNC_POLICY_USER_EMAILS_INVALID');
  await refusal(distribute(ADMIN_A, { emails: JSON.stringify('everyone') }),
    'PENNSYNC_POLICY_USER_EMAILS_INVALID');
  // An empty list with a real filter takes the filter's branch, so the
  // unported refusal still fires there.
  await refusal(distribute(ADMIN_A, { emails: JSON.stringify([]),
    filters: JSON.stringify({ location: 'North' }) }),
  'PENNSYNC_POLICY_FILTER_UNPORTED:location');
});

test('only an agency administrator may distribute', async () => {
  await refusal(distribute(CLINICIAN_A), 'PENNSYNC_POLICY_DISTRIBUTE_FORBIDDEN');
  assert.deepEqual(await assignedTo(), [], 'and nothing was written on the way to the refusal');
});

test('the platform tier is gone, so no caller reaches another agency', async () => {
  // The original skips its own agency filter when the caller has no
  // `agency_name`, which is exactly the built-in admin — so that caller
  // distributed to every tenant in the deployment. There is no such caller.
  await refusal(distribute(ADMIN_B, { agency: A }), 'PENNSYNC_POLICY_AGENCY_NOT_HELD');
  // And an administrator who holds their own agency cannot name another
  // agency's policy id in it.
  await refusal(distribute(ADMIN_A, { policy: 'policy-b' }), 'PENNSYNC_POLICY_NOT_FOUND');
});

test('an impossible due date is refused by name rather than as a cast failure', async () => {
  // Taken as text for this reason (D38): a `date` parameter would make
  // PostgreSQL reject it at the call boundary, where the HTTP layer cannot
  // classify the error.
  await refusal(distribute(ADMIN_A, { due: '2026-02-31' }), 'PENNSYNC_POLICY_DUE_DATE_INVALID');
  await refusal(distribute(ADMIN_A, { due: 'next tuesday' }), 'PENNSYNC_POLICY_DUE_DATE_INVALID');
  // Absent and empty both mean no due date, as the original's `dueDate || null`.
  for (const due of [null, '   ']) {
    assert.equal((await distribute(ADMIN_A, { due })).success, true);
  }
});

test('the distribution is one transaction: a refusal leaves no half-distributed policy', async () => {
  // `failed` and `failures` are not in the answer because they cannot happen.
  // The original reports them because each create stands alone.
  const result = await distribute(ADMIN_A);
  assert.equal(Object.hasOwn(result, 'failed'), false);
  assert.equal(Object.hasOwn(result, 'failures'), false);
});

test('the trail carries one summary of the distribution, in the agency', async () => {
  await db.query(`delete from ${SCHEMA}."policy_acknowledgment" where "policy_id" = $1`, [POLICY]);
  await db.query(`delete from ${SCHEMA}."activity_audit"`);
  await distribute(ADMIN_A, { commit: true });
  const { rows } = await db.query(
    `select "action","subject_kind","subject_id","detail","agency_id","actor_email"
     from ${SCHEMA}."activity_audit"`);
  assert.equal(rows.length, 1, 'one summary after the loop, not one per person');
  assert.equal(rows[0].action, 'policy_distributed');
  // `other`: the trail's kind list is fixed and names no policy, and the
  // subject id plus the detail carry which policy it was.
  assert.equal(rows[0].subject_kind, 'other');
  assert.equal(rows[0].subject_id, POLICY);
  assert.equal(rows[0].agency_id, A);
  assert.equal(rows[0].actor_email, 'admin-a@example.invalid');
  assert.equal(rows[0].detail.distributed, 3);
  assert.equal(rows[0].detail.policy_version, '3');
});

test('the notification reaches the person it was minted for, read through its own contract',
  async () => {
    // D45's rule, and the reason this test exists at all: D44's fan-out stamped
    // three of the six authority columns `manageMyNotifications` filters on, so
    // every alert it wrote was addressed to nobody — and both contracts' own
    // suites passed throughout. Neither suite alone proves this.
    //
    // It clears both tables first rather than reading whatever the file has
    // accumulated: the rows earlier tests committed are real and correct, and a
    // count over them would be asserting the order this file happens to run in.
    await db.query(`delete from ${SCHEMA}."notification"`);
    await db.query(`delete from ${SCHEMA}."policy_acknowledgment" where "policy_id" = $1`, [POLICY]);
    const sent = await distribute(ADMIN_A, { due: '2026-12-01', commit: true });
    assert.equal(sent.distributed, 3);
    assert.equal(sent.notified, 3);

    const mine = await as(CLINICIAN_A,
      'select "public"."pennsync_contract_notification_list"($1) as result', [A]);
    assert.equal(mine.notifications.length, 1, 'the recipient can see it');
    const [row] = mine.notifications;
    assert.equal(row.title, 'Policy acknowledgment required');
    assert.match(row.message, /Hand Hygiene/);
    assert.match(row.message, /v3/);
    assert.match(row.message, /12\/01\/2026/);
    assert.equal(row.type, 'compliance_alert');
    assert.equal(row.priority, 'high');
    // And it is addressed to ONE person: `notification_read` is agency-WIDE, so
    // this is the reader's own predicate over the envelope the mint stamped.
    // Every column of it has to be right or this is zero (D45).
    const admin = await as(ADMIN_A,
      'select "public"."pennsync_contract_notification_list"($1) as result', [A]);
    assert.equal(admin.notifications.length, 1);
    assert.equal(admin.notifications[0].id === row.id, false, 'each person has their own row');
    const other = await as(ADMIN_B,
      'select "public"."pennsync_contract_notification_list"($1) as result', [B]);
    assert.equal(other.notifications.length, 0, 'and nobody in another agency sees it');
  });

test('an assignment cleared and redistributed does not repeat the message', async () => {
  // The two enforcements the contract catches by name have different
  // lifetimes: the assignment row can be deleted and the notification cannot,
  // so a redistribution assigns afresh and must not hand the person a second
  // copy of a message they may not have read. D51's rule — the index wins —
  // and the difference is reported rather than hidden (D54).
  await db.query(`delete from ${SCHEMA}."policy_acknowledgment" where "policy_id" = $1`, [POLICY]);
  const again = await distribute(ADMIN_A, { due: '2026-12-01', commit: true });
  assert.equal(again.distributed, 3, 'the assignment really is new');
  assert.equal(again.notified, 0, 'and not one of them was told twice');
  const mine = await as(CLINICIAN_A,
    'select "public"."pennsync_contract_notification_list"($1) as result', [A]);
  assert.equal(mine.notifications.length, 1);
  // Sabotage check for the catch itself: a dedupe key this run has NOT used is
  // minted, so the branch is the constraint's and not a swallowed everything.
  await db.query(`delete from ${SCHEMA}."notification"`);
  const fresh = await distribute(ADMIN_A, { due: '2026-12-01' });
  assert.equal(fresh.notified, 0, 'the same version keys the same way');
  await db.query(`update ${SCHEMA}."policy_library" set "version" = '9' where "id" = $1`, [POLICY]);
  try {
    const nine = await distribute(ADMIN_A, { due: '2026-12-01' });
    assert.equal(nine.distributed, 3);
    assert.equal(nine.notified, 3, 'a version nothing has been told about mints every time');
  } finally {
    await db.query(`update ${SCHEMA}."policy_library" set "version" = '3' where "id" = $1`, [POLICY]);
  }
});

test('a unique violation that is NOT the one it names still raises', async () => {
  // D30's warning made behavioural rather than read off the page: both catch
  // blocks compare `constraint_name` and re-raise anything else, and nothing
  // above proves the comparison — swallowing every `unique_violation` passes
  // every other test in this file. So a SECOND unique index is put on each
  // table for the length of the case, violated by the second person in the
  // loop, and the contract has to let it out.
  for (const [table, index, columns, predicate] of [
    ['policy_acknowledgment', 'sabotage_ack_unique', '"source_app_id","policy_id"', ''],
    ['notification', 'sabotage_note_unique', '"source_app_id","title"',
      ` where "title" = 'Policy acknowledgment required'`],
  ]) {
    await db.query(`delete from ${SCHEMA}."policy_acknowledgment" where "policy_id" = $1`, [POLICY]);
    await db.query(`delete from ${SCHEMA}."notification"`);
    await db.query(
      `create unique index "${index}" on ${SCHEMA}."${table}" (${columns})${predicate}`);
    try {
      await refusal(distribute(ADMIN_A), index);
    } finally {
      await db.query(`drop index ${SCHEMA}."${index}"`);
    }
  }
  await db.query(`delete from ${SCHEMA}."policy_acknowledgment" where "policy_id" = $1`, [POLICY]);
  await db.query(`delete from ${SCHEMA}."notification"`);
});
