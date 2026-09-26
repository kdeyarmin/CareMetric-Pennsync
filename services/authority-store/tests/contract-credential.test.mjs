import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { SCHEMA } from '../../../tools-entity-schema-plan.mjs';
import { applyRecordMigrations, recordMigrationNames } from './record-migrations.mjs';

/**
 * Submitting a staff credential (`contract_credential_submit`).
 *
 * `reviewPersonnelCredential` was the first whole capability with no performer
 * left — its only gate is `u.role === 'admin'`, the platform tier D14 and D22
 * removed. **D40 answered it**: an `agency_admin`, scoped to their own agency,
 * is the successor, granted deliberately as a widening. So the review half is
 * here too, and the property worth the file is the one the widening created:
 * an `agency_admin` is a member of staff with credentials of their own, so
 * self-approval became possible for the first time — and is refused.
 */

/**
 * The record migrations whose behaviour this suite measures.
 *
 * It does NOT decide what is applied — `applyRecordMigrations` reads the
 * directory — and that separation is the point of the conversion (#316). The
 * hand-kept list this replaces named five files, and a forward migration over
 * any of them would have been applied only if somebody remembered to add it,
 * on the only legal path for changing an applied store (D88).
 *
 * The names are kept so the suite can still SAY what it is about, and asserted
 * to be present in what was applied rather than used to apply anything: a name
 * that stops being a file is then a failure here instead of a silent omission.
 */
const MEASURED = Object.freeze([
  // Carries `time_off_date`, which the credential contracts reuse rather than
  // declaring a second date parser that could drift from it.
  '20260920230000_contract_time_off.sql',
  // Carries `bounded_reason`, which the review reuses.
  '20260920180000_contract_assignment.sql',
  '20260920240000_contract_credential.sql',
  '20260920250000_contract_credential_review.sql',
  '20260920340000_contract_credential_sweep.sql',
]);
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const email = n => ['', 'admin-a', 'clinician-a', 'clinician-empty', 'admin-b'][n]
  + '@example.invalid';
const ADMIN_A = 1; const CLINICIAN_A = 2; const SPARE_A = 3;
const SUBMIT = 'select "public"."pennsync_contract_credential_submit"($1,$2,$3,$4) as result';
const REVIEW = 'select "public"."pennsync_contract_credential_review"($1,$2,$3,$4) as result';
const EXPIRY_SWEEP = 'select "public"."pennsync_contract_credential_expiration_sweep"($1) as result';
const RENEWAL_SWEEP = 'select "public"."pennsync_contract_credential_renewal_sweep"($1) as result';
const A = 'agency-a'; const B = 'agency-b';
const GOOD = Object.freeze({
  item_type: 'license', title: 'RN Licence', issuing_organization: 'PA Board',
  credential_number: 'RN-12345', issued_date: '2024-01-15',
  expiration_date: '2028-01-14', notes: 'renews every four years',
});
let db; let applied;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  applied = await applyRecordMigrations(db);
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
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
const submit = (n, credential = GOOD, { id = null, renews = null, agency = A } = {}) =>
  as(n, SUBMIT, [agency, id, renews, JSON.stringify(credential)], true);
const review = (n, id, action, reason = null, agency = A) =>
  as(n, REVIEW, [agency, id, action, reason], true);
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);
const rowOf = async id => (await db.query(
  `select "user_id","user_name","status","approved_by","title","notes","expiration_date",
     "uploaded_file_url" from ${SCHEMA}."personnel_credential" where "id" = $1`, [id])).rows[0];

test('a member files their own credential, and the server owns the decision fields', async () => {
  const result = await submit(CLINICIAN_A);
  assert.equal(result.success, true);
  assert.equal(result.credential.status, 'pending_approval');
  assert.equal(result.credential.user_id, email(CLINICIAN_A));
  assert.equal(result.credential.title, 'RN Licence');
  assert.equal(result.credential.approved_by, null);
  // Divergence 2: the carried profile has no name column, so the name is the
  // address — the original's own fallback.
  const row = await rowOf(result.credential.id);
  assert.equal(row.user_name, email(CLINICIAN_A));
  assert.equal(row.status, 'pending_approval');
  await refusal(submit(CLINICIAN_A, GOOD, { agency: B }), 'PENNSYNC_CREDENTIAL_AGENCY_NOT_HELD');
});

test('an unknown field is refused, not filtered away', async () => {
  // The original filters `SELF_SERVICE_FIELDS` silently. A caller who misspells
  // `expiration_date` would file a credential with no expiry and never know,
  // so this refuses the key instead.
  await refusal(submit(CLINICIAN_A, { ...GOOD, expiraton_date: '2028-01-14' }),
    'PENNSYNC_CREDENTIAL_FIELD_UNSUPPORTED');
  // And the server-controlled fields are refused by the same rule, which is
  // the point: a staff member with row access could otherwise approve their
  // own licence.
  for (const field of ['status', 'approved_by', 'approved_at', 'rejection_reason']) {
    await refusal(submit(CLINICIAN_A, { ...GOOD, [field]: 'approved' }),
      'PENNSYNC_CREDENTIAL_FIELD_UNSUPPORTED');
  }
});

test('the required three are required and the dates are real', async () => {
  await refusal(submit(CLINICIAN_A, { ...GOOD, title: '' }), 'PENNSYNC_CREDENTIAL_REQUIRED');
  await refusal(submit(CLINICIAN_A, { ...GOOD, item_type: 'badge' }),
    'PENNSYNC_CREDENTIAL_REQUIRED');
  await refusal(submit(CLINICIAN_A, { ...GOOD, expiration_date: '' }),
    'PENNSYNC_CREDENTIAL_REQUIRED');
  await refusal(submit(CLINICIAN_A, { ...GOOD, expiration_date: '2026-02-31' }),
    'PENNSYNC_CREDENTIAL_DATE_INVALID');
  await refusal(submit(CLINICIAN_A, { ...GOOD, issued_date: '2029-01-01' }),
    'PENNSYNC_CREDENTIAL_DATE_ORDER');
  await refusal(submit(CLINICIAN_A, { ...GOOD, notes: 'x'.repeat(4001) }),
    'PENNSYNC_CREDENTIAL_INVALID');
  await refusal(submit(CLINICIAN_A, { ...GOOD, title: 'x'.repeat(2001) }),
    'PENNSYNC_CREDENTIAL_INVALID');
  // An issued date is optional, and omitting it is not a refusal.
  const withoutIssued = Object.fromEntries(
    Object.entries(GOOD).filter(([key]) => key !== 'issued_date'));
  assert.equal((await submit(CLINICIAN_A, withoutIssued)).credential.issued_date, null);
});

test('the file link is bounded the way the original bounds it', async () => {
  // HTTPS, and no user information in the authority. It is stored and never
  // fetched — nothing in the port fetches a locator — so this bounds what can
  // be written rather than what can be reached.
  for (const bad of ['http://example.invalid/a.pdf', 'https://user:pw@example.invalid/a.pdf',
    'ftp://example.invalid/a.pdf', 'javascript:alert(1)', '/relative/a.pdf']) {
    await refusal(submit(CLINICIAN_A, { ...GOOD, uploaded_file_url: bad }),
      'PENNSYNC_CREDENTIAL_FILE_URL_INVALID');
  }
  const ok = await submit(CLINICIAN_A,
    { ...GOOD, uploaded_file_url: 'https://files.example.invalid/rn.pdf',
      uploaded_file_name: 'rn.pdf' });
  assert.equal((await rowOf(ok.credential.id)).uploaded_file_url,
    'https://files.example.invalid/rn.pdf');
  // The locator is stored and NOT projected back, the way the document pair
  // declines to disclose one.
  assert.equal(JSON.stringify(ok.credential).includes('files.example.invalid'), false);
});

test('editing returns a credential to review, and only its owner or an admin may', async () => {
  const mine = (await submit(CLINICIAN_A)).credential;
  // Pretend it had been decided, so the clearing is visible.
  await db.query(`update ${SCHEMA}."personnel_credential"
    set "status" = 'approved', "approved_by" = $2, "approved_at" = clock_timestamp()
    where "id" = $1`, [mine.id, email(ADMIN_A)]);
  // A colleague who is neither the owner nor an administrator cannot touch it.
  await refusal(submit(SPARE_A, { ...GOOD, title: 'Theirs' }, { id: mine.id }),
    'PENNSYNC_CREDENTIAL_FORBIDDEN');
  assert.equal((await rowOf(mine.id)).status, 'approved');

  const edited = await submit(CLINICIAN_A, { ...GOOD, title: 'RN Licence (renewed)' },
    { id: mine.id });
  assert.equal(edited.credential.title, 'RN Licence (renewed)');
  // Back to review, and the previous decision cleared: an edited credential is
  // not the one that was approved.
  assert.equal(edited.credential.status, 'pending_approval');
  assert.equal(edited.credential.approved_by, null);
  assert.equal((await rowOf(mine.id)).approved_by, null);
  // The agency's administrator may correct a colleague's.
  assert.equal((await submit(ADMIN_A, { ...GOOD, title: 'Corrected' }, { id: mine.id }))
    .credential.title, 'Corrected');
  await refusal(submit(CLINICIAN_A, GOOD, { id: 'no-such-credential' }),
    'PENNSYNC_CREDENTIAL_NOT_FOUND');
});

test('a renewal stamps the old credential and leaves its status alone', async () => {
  const old = (await submit(CLINICIAN_A, { ...GOOD, title: 'Expiring' })).credential;
  await db.query(`update ${SCHEMA}."personnel_credential" set "status" = 'approved'
    where "id" = $1`, [old.id]);
  const renewal = await submit(CLINICIAN_A, { ...GOOD, title: 'Renewed' },
    { renews: old.id });
  assert.equal(renewal.credential.status, 'pending_approval');
  const stamped = await rowOf(old.id);
  // The old one is annotated and STILL APPROVED — it stays valid until a
  // reviewer supersedes it, which is what the original is careful about.
  assert.match(stamped.notes, /\[Renewal submitted on \d{4}-\d{2}-\d{2}\]/);
  assert.equal(stamped.status, 'approved');
  // Somebody else's credential cannot be stamped by naming it as a renewal.
  const theirs = (await submit(SPARE_A, { ...GOOD, title: 'Not yours' })).credential;
  const before = (await rowOf(theirs.id)).notes;
  await submit(CLINICIAN_A, GOOD, { renews: theirs.id });
  assert.equal((await rowOf(theirs.id)).notes, before);
});

test('an agency administrator approves, and supersedes the copy it renews', async () => {
  // D40: the agency's own administrator, which the original's platform-admin
  // gate never granted. The submission side still writes no decision field.
  const filed = (await submit(CLINICIAN_A, { ...GOOD, title: 'BLS Card' })).credential;
  await refusal(as(CLINICIAN_A, REVIEW, [A, filed.id, 'approve', null], true),
    'PENNSYNC_CREDENTIAL_FORBIDDEN');
  const approved = await review(ADMIN_A, filed.id, 'approve');
  assert.equal(approved.credential.status, 'approved');
  assert.equal(approved.credential.approved_by, email(ADMIN_A));
  assert.equal(approved.superseded, 0);

  // The renewal of the same credential supersedes the copy it replaces, so a
  // compliance report does not count both.
  const renewal = (await submit(CLINICIAN_A, { ...GOOD, title: 'BLS Card' },
    { renews: filed.id })).credential;
  const second = await review(ADMIN_A, renewal.id, 'approve');
  assert.equal(second.superseded, 1);
  const old = await rowOf(filed.id);
  assert.equal(old.status, 'expired');
  assert.match(old.notes, /\[Superseded by renewal on \d{4}-\d{2}-\d{2}\]/);
  // A credential with a DIFFERENT title is not superseded by it.
  const other = (await submit(CLINICIAN_A, { ...GOOD, title: 'RN Licence' })).credential;
  await review(ADMIN_A, other.id, 'approve');
  assert.equal((await rowOf(other.id)).status, 'approved');
});

test('nobody approves their own credential, which the widening made possible', async () => {
  // Under Base44 the reviewer was a platform admin, who holds no credentials
  // in any agency, so this could not happen. D40 makes the reviewer a member
  // of staff, so it can — and the contract refuses it.
  const own = (await submit(ADMIN_A, { ...GOOD, title: 'Admin RN Licence' })).credential;
  await refusal(review(ADMIN_A, own.id, 'approve'), 'PENNSYNC_CREDENTIAL_SELF');
  await refusal(review(ADMIN_A, own.id, 'reject', 'no'), 'PENNSYNC_CREDENTIAL_SELF');
  assert.equal((await rowOf(own.id)).status, 'pending_approval');
});

test('a rejection needs a reason, and a decision happens once', async () => {
  const filed = (await submit(CLINICIAN_A, { ...GOOD, title: 'Insurance' })).credential;
  await refusal(review(ADMIN_A, filed.id, 'reject', '   '),
    'PENNSYNC_CREDENTIAL_REASON_REQUIRED');
  // And an approval does not carry one.
  await refusal(review(ADMIN_A, filed.id, 'approve', 'why not'),
    'PENNSYNC_CREDENTIAL_REASON_UNEXPECTED');
  await refusal(review(ADMIN_A, filed.id, 'shrug', null),
    'PENNSYNC_CREDENTIAL_ACTION_INVALID');
  const rejected = await review(ADMIN_A, filed.id, 'reject', 'the scan is unreadable');
  assert.equal(rejected.credential.status, 'rejected');
  assert.equal(rejected.credential.rejection_reason, 'the scan is unreadable');
  // Reviewed once is reviewed; a resubmission is how it comes back.
  await refusal(review(ADMIN_A, filed.id, 'approve'), 'PENNSYNC_CREDENTIAL_TRANSITION');
  assert.equal((await submit(CLINICIAN_A, { ...GOOD, title: 'Insurance' },
    { id: filed.id })).credential.status, 'pending_approval');
  // A credential in another agency is not reviewable.
  await refusal(review(ADMIN_A, 'no-such-credential', 'approve'),
    'PENNSYNC_CREDENTIAL_NOT_FOUND');
});

const APP_ID = '6a9881683dc68a0bd54f1ef7';
const expirySweep = (n, agency = A) => as(n, EXPIRY_SWEEP, [agency], true);
const renewalSweep = (n, agency = A) => as(n, RENEWAL_SWEEP, [agency], true);
/**
 * `agency_today()`, never `current_date`.
 *
 * The contract measures a credential's remaining days against the store's own
 * day, which is America/New_York, while `current_date` is the server's — UTC
 * in CI. Between 00:00 and 04:00 UTC the two are different dates, so a
 * credential seeded at `current_date - 1` is `agency_today()` exactly, crosses
 * the 14-day tier and reminds somebody the test expects to hear nothing about.
 * Caught by running the suite at 00:05 UTC; it would otherwise have been a CI
 * flake in a four-hour window nobody had run in.
 */
const seedCredential = async (id, agency, days, overrides = {}) => {
  const row = {
    user_id: email(CLINICIAN_A), title: 'RN Licence', item_type: 'license',
    status: 'approved', reminder_offsets_sent: null,
    renewal_email_offsets_sent: null, ...overrides,
  };
  const keys = Object.keys(row);
  await db.query(
    `insert into ${SCHEMA}."personnel_credential" ("source_app_id","id","agency_id",
      "expiration_date",${keys.map(k => `"${k}"`).join(',')})
     values ($1,$2,$3,(pennsync_records.agency_today() + $4::integer),${keys.map((_, i) => `$${i + 5}`).join(',')})`,
    [APP_ID, id, agency, days, ...keys.map(k => row[k])]);
};
const statusOf = async id => (await db.query(
  `select "status","reminder_offsets_sent" as sent, "renewal_email_offsets_sent" as renewal
   from ${SCHEMA}."personnel_credential" where "id" = $1`, [id])).rows[0];

test('the sweep expires what has run out, whatever its age', async () => {
  // Divergence 1. The original constrains to a ninety-day window BEFORE its
  // thousand-row cap, because "a historical backlog of already-expired
  // credentials ... [would] fill the 1000-row cap and starve the upcoming
  // expirations this job exists to notify about". A SQL update-where has no
  // cap to starve, so the window has nothing left to protect — and keeping it
  // would leave this one permanently un-flipped.
  await db.query(`delete from ${SCHEMA}."personnel_credential"`);
  await seedCredential('cred-ancient', A, -400);
  await seedCredential('cred-recent', A, -3);
  await seedCredential('cred-live', A, 200);
  await seedCredential('cred-elsewhere', B, -5);
  const result = await expirySweep(ADMIN_A);
  assert.equal(result.marked_expired, 2);
  assert.equal((await statusOf('cred-ancient')).status, 'expired');
  assert.equal((await statusOf('cred-recent')).status, 'expired');
  assert.equal((await statusOf('cred-live')).status, 'approved');
  assert.equal((await statusOf('cred-elsewhere')).status, 'approved', 'agency B is untouched');
  // Running it again flips nothing, because nothing is left to flip.
  assert.equal((await expirySweep(ADMIN_A)).marked_expired, 0);
});

test('a tier fires at or below its offset, and is counted rather than claimed', async () => {
  // Divergence 2, and the originals' reason for it: "so a missed cron run
  // (downtime/deploy/DST) doesn't skip a tier permanently".
  await db.query(`delete from ${SCHEMA}."personnel_credential"`);
  await seedCredential('cred-13', A, 13);
  await seedCredential('cred-45', A, 45);
  await seedCredential('cred-200', A, 200);
  const result = await expirySweep(ADMIN_A);
  assert.equal(result.reminders_due, 2, 'the one 200 days out has crossed no tier');
  const by = Object.fromEntries(result.credentials.map(c => [c.id, c.due_offsets]));
  // Thirteen days out has crossed every tier at or above it, not only the 14.
  assert.deepEqual(by['cred-13'], [90, 60, 30, 14]);
  assert.deepEqual(by['cred-45'], [90, 60]);
  assert.equal(result.notifications_sent, 0);
  assert.equal(result.delivery_paused, true);
  assert.equal(result.code, 'OUTBOUND_DELIVERY_RELEASE_PAUSED');
  // The claim is what is NOT written: the tier belongs to the send, and there
  // is none. "do not claim a reminder tier ... that did not run."
  assert.equal((await statusOf('cred-13')).sent, null);
  // An already-claimed tier is not offered again.
  await db.query(`update ${SCHEMA}."personnel_credential"
    set "reminder_offsets_sent" = '[90,60,30]'::jsonb where "id" = 'cred-13'`);
  const second = await expirySweep(ADMIN_A);
  assert.deepEqual(second.credentials.find(c => c.id === 'cred-13').due_offsets, [14]);
  // An expired credential reminds nobody; the status flip covers it.
  await db.query(`delete from ${SCHEMA}."personnel_credential"`);
  await seedCredential('cred-gone', A, -1);
  assert.equal((await expirySweep(ADMIN_A)).reminders_due, 0);
});

test('the two sweeps do not consume each other s tiers', async () => {
  // The bug the renewal original documents: "The three credential-reminder
  // crons previously shared `reminder_offsets_sent` with different tier sets,
  // so whichever fired a shared tier first consumed it for the others."
  await db.query(`delete from ${SCHEMA}."personnel_credential"`);
  await seedCredential('cred-6', A, 6);
  // The renewal sweep has a seventh-day tier the expiration sweep does not.
  assert.deepEqual((await renewalSweep(ADMIN_A)).credentials[0].due_offsets,
    [90, 60, 30, 14, 7]);
  assert.deepEqual((await expirySweep(ADMIN_A)).credentials[0].due_offsets,
    [90, 60, 30, 14]);
  // Claiming every tier on ONE marker leaves the other sweep untouched.
  await db.query(`update ${SCHEMA}."personnel_credential"
    set "reminder_offsets_sent" = '[90,60,30,14]'::jsonb where "id" = 'cred-6'`);
  assert.equal((await expirySweep(ADMIN_A)).reminders_due, 0);
  assert.deepEqual((await renewalSweep(ADMIN_A)).credentials[0].due_offsets,
    [90, 60, 30, 14, 7], 'the renewal tiers are its own');
});

test('only the agency administrator sweeps, and only their own agency', async () => {
  await refusal(expirySweep(CLINICIAN_A), 'PENNSYNC_CREDENTIAL_FORBIDDEN');
  await refusal(renewalSweep(CLINICIAN_A), 'PENNSYNC_CREDENTIAL_FORBIDDEN');
  await refusal(expirySweep(ADMIN_A, B), 'PENNSYNC_CREDENTIAL_FORBIDDEN');
});

test('the migrations this suite measures are ones the directory actually applied', async () => {
  // The conversion moved the apply list from this file to the directory, so
  // the names above no longer make anything happen. That is the improvement
  // and also the new way to be wrong: a file renamed or removed would leave
  // the comments here describing a build nobody performs. Asserting presence
  // in what was APPLIED is what keeps the two attached.
  for (const name of MEASURED) {
    assert.ok(applied.includes(name), `${name} was not applied`);
  }
  // And the direction that matters more: the build is the whole directory, so
  // a forward migration over any of these is picked up by existing rather than
  // by being remembered (D88).
  //
  // Pinned as the EXACT set, which is what #320 does and what a first draft of
  // this file did not. That draft asserted `applied.length > MEASURED.length`
  // under a comment claiming it pinned a relation rather than a count — so the
  // comment described a test that did not exist, and the assertion was
  // satisfied by any build applying six or more files, the omission of a
  // migration this suite does not name among them. An assertion a wrong answer
  // also satisfies is not one, and `recordMigrationNames` sorts, so this pins
  // the apply ORDER (the deployment's directory walk) in the same line.
  assert.deepEqual(applied, await recordMigrationNames(),
    'the build must be the whole record directory, in its apply order');
});

test('every credential capability authorizes, and no helper beside them is callable', async () => {
  const { rows } = await db.query(`
    select p.proname as name, pg_catalog.oidvectortypes(p.proargtypes) as args, n.nspname as schema
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where p.proname like '%credential%' and n.nspname = any(array['pennsync_records','public'])
    order by n.nspname, p.proname`);
  const reachable = [];
  for (const row of rows) {
    const { rows: allowed } = await db.query(
      'select has_function_privilege($1, $2, \'execute\') as allowed',
      ['authenticated', `${row.schema}.${row.name}(${row.args})`]);
    if (allowed[0].allowed) reachable.push(`${row.schema}.${row.name}`);
  }
  // Re-DERIVED against the converted build rather than carried over from the
  // hand-kept one, because the roster conversion found a third roster contract
  // the old build had made invisible and carrying its assertion forward would
  // have preserved exactly that blindness. Here nothing new appeared: the same
  // four capabilities, in both spellings, and no fifth.
  //
  // The `public` wrapper exists so a caller reaches the contract without a
  // Supabase project setting naming another schema; both spellings are the
  // same SECURITY DEFINER doing its own authorization.
  assert.deepEqual(reachable.sort(), [
    'pennsync_records.contract_credential_expiration_sweep',
    'pennsync_records.contract_credential_renewal_sweep',
    'pennsync_records.contract_credential_review',
    'pennsync_records.contract_credential_submit',
    'public.pennsync_contract_credential_expiration_sweep',
    'public.pennsync_contract_credential_renewal_sweep',
    'public.pennsync_contract_credential_review',
    'public.pennsync_contract_credential_submit',
  ]);
  // The exact set is the assertion rather than membership of it, because
  // `includes` is satisfied by a wrong answer as well as the right one: a
  // build that exposed every helper would pass a membership check and fail
  // this. The six helpers beside them do no authorization and are named here
  // so their absence is the claim rather than a side effect.
  //
  // Their absence is asserted through `has_function_privilege` rather than by
  // calling them and matching an error string. A first version did call them,
  // and it was measuring the wrong thing: PostgreSQL resolves and coerces the
  // arguments before the privilege check, so `credential_row`, which takes a
  // composite, raised `malformed record literal` — an error that would arrive
  // whether or not the caller may execute it. Matching "rejects" there would
  // have passed on a helper that was fully reachable.
  const named = rows.map(row => row.name);
  for (const helper of ['credential_due_offsets', 'credential_file_url',
    'credential_notice_message', 'credential_notice_title', 'credential_row',
    'credential_sweep']) {
    assert.ok(named.includes(helper), `${helper} is not in the store any more`);
    assert.ok(!reachable.includes(`${SCHEMA}.${helper}`),
      `${helper} performs no authorization and must not be callable`);
  }
});

test('bounded_reason is reachable, which it should not be — a pin on a known gap', async () => {
  // `20260920180000_contract_assignment.sql` creates two pure helpers after its
  // `set local role`: `bounded_reason` at line 284 and `care_team_row` at 301.
  // Its revoke block names `care_team_row` and the two contracts and NOT
  // `bounded_reason`, and PostgreSQL grants execute to PUBLIC by default, so
  // the omission leaves it callable. The revoked sibling beside it is what
  // makes this an omission rather than a decision.
  //
  // It is DISCIPLINE and not disclosure, measured in both directions. The
  // function is `language sql immutable`, text in and text out, reads no table
  // and calls nothing, so a caller learns nothing they did not send. And all
  // four of its callers — the assignment and membership transitions, the
  // credential review, the clinical phrase lookup — recompute it inside their
  // own definer from the caller's own parameter and use it only to refuse, so
  // nothing anywhere consumes its result where the caller's privilege matters.
  // No policy calls it either.
  //
  // What it breaks is the rule the test above enforces: nothing that does no
  // authorization may be reachable. The fix is a forward `revoke` — the file
  // is merged, so it may never be edited in place (D88) — and it is not taken
  // here because a migration deepens the batch already waiting on an operator
  // for no disclosure control. It should ride the next forward migration over
  // that contract.
  //
  // THIS ASSERTION IS INVERTED ON PURPOSE. It pins the defect so the state is
  // recorded rather than merely described, and so the fix cannot land quietly:
  // whoever writes that revoke will see this fail and must turn it into the
  // refusal the helpers above get. Do not "fix" it by deleting it.
  const { rows } = await db.query(
    'select has_function_privilege($1, $2, \'execute\') as allowed',
    ['authenticated', `${SCHEMA}.bounded_reason(text)`]);
  assert.equal(rows[0].allowed, true,
    'if this fails the revoke has landed — replace this test with the refusal');
});
