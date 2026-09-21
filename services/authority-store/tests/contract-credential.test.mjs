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
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const TIME_OFF = 'services/authority-store/supabase/record-migrations/'
  + '20260920230000_contract_time_off.sql';
const CREDENTIAL = 'services/authority-store/supabase/record-migrations/'
  + '20260920240000_contract_credential.sql';
const REVIEW_SQL = 'services/authority-store/supabase/record-migrations/'
  + '20260920250000_contract_credential_review.sql';
const ASSIGNMENT = 'services/authority-store/supabase/record-migrations/'
  + '20260920180000_contract_assignment.sql';
const SWEEP_SQL = 'services/authority-store/supabase/record-migrations/'
  + '20260920340000_contract_credential_sweep.sql';
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
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  // The time-off migration carries `time_off_date`, which this one reuses
  // rather than declaring a second date parser that could drift from it.
  // The assignment migration carries `bounded_reason`, which the review reuses.
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, ASSIGNMENT,
    TIME_OFF, CREDENTIAL, REVIEW_SQL, SWEEP_SQL]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
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
