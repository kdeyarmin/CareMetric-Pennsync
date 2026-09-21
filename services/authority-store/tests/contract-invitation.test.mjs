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
 * Resending a staff invitation (`contract_invitation_resend`).
 *
 * One contract for TWO Base44 capabilities: `resendInvitation` and
 * `resendInvitationV2` are byte-identical apart from a trailing comment naming
 * the second the production replacement, and the first test says so by reading
 * both files rather than by asserting it — if they ever diverge, this fails
 * and the port has to decide which one it is serving.
 *
 * The second property is the honest gap: the original's send is
 * `base44.users.inviteUser`, the platform's own invitation service, and there
 * is no platform here. The record half is ported, the audit entry says
 * `delivery_paused`, and a test reads the trail to check that a resend does not
 * record itself as though a message went out.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const AUDIT = 'services/authority-store/supabase/record-migrations/'
  + '20260920010000_activity_audit.sql';
const INVITATION = 'services/authority-store/supabase/record-migrations/'
  + '20260920270000_contract_invitation.sql';
const SWEEP = 'services/authority-store/supabase/record-migrations/'
  + '20260920330000_contract_invitation_sweep.sql';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN_A = 1; const CLINICIAN_A = 2;
const RESEND = 'select "public"."pennsync_contract_invitation_resend"($1,$2) as result';
const SWEEP_CALL = 'select "public"."pennsync_contract_invitation_sweep"($1) as result';
const A = 'agency-a'; const B = 'agency-b';
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, AUDIT, INVITATION, SWEEP]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  const rows = [
    ['inv-expired', A, 'new-nurse@example.invalid', 'expired', 2],
    ['inv-pending', A, 'pending@example.invalid', 'pending', null],
    ['inv-accepted', A, 'joined@example.invalid', 'accepted', 0],
    ['inv-cancelled', A, 'withdrawn@example.invalid', 'cancelled', 1],
    ['inv-elsewhere', B, 'other-agency@example.invalid', 'expired', 0],
  ];
  for (const [id, agency, email, status, count] of rows) {
    await db.query(`insert into ${SCHEMA}."user_invitation"
      ("source_app_id","id","agency_id","email","full_name","status","resend_count",
       "expires_at","invited_by","agency_name")
      values ($1,$2,$3,$4,'New Nurse',$5,$6,'2026-01-01 00:00:00+00',
        'admin-a@example.invalid','Agency A')`,
    [APP, id, agency, email, status, count]);
  }
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
const resend = (n, id, agency = A) => as(n, RESEND, [agency, id], true);
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);
const rowOf = async id => (await db.query(
  `select "status","resend_count","expires_at","last_sent_at","updated_date"
   from ${SCHEMA}."user_invitation" where "id" = $1`, [id])).rows[0];

test('the two originals really are one capability', async () => {
  // Read rather than asserted: if they ever diverge, this fails and the port
  // has to decide which of the two it is serving.
  const one = readFileSync(resolve(repository, 'base44/functions/resendInvitation/entry.ts'), 'utf8');
  const two = readFileSync(resolve(repository, 'base44/functions/resendInvitationV2/entry.ts'), 'utf8');
  const marker = '// Production replacement endpoint: resendInvitationV2 (registered 2026-09-09)';
  assert.equal(two.includes(marker), true, 'V2 names itself the replacement');
  assert.equal(one.trimEnd(), two.replace(marker, '').trimEnd(),
    'the two originals are the same file apart from that marker');
});

test('only the agency administrator may resend, and only their own agency', async () => {
  await refusal(resend(CLINICIAN_A, 'inv-expired'), 'PENNSYNC_INVITATION_FORBIDDEN');
  await refusal(resend(ADMIN_A, 'inv-expired', B), 'PENNSYNC_INVITATION_FORBIDDEN');
  // Agency B's invitation is simply not in agency A. The original resolves
  // this from the invitation's own `agency_name` string and then from the
  // INVITER's profile — both self-editable, and both a second answer to what
  // the policy already decides. The fixture's `agency_name` says "Agency A"
  // for every row, including agency B's, precisely so that a port reading it
  // would get this wrong.
  await refusal(resend(ADMIN_A, 'inv-elsewhere'), 'PENNSYNC_INVITATION_NOT_FOUND');
  assert.equal((await rowOf('inv-elsewhere')).status, 'expired');
  await refusal(resend(ADMIN_A, 'has spaces'), 'PENNSYNC_INVITATION_SUBJECT_INVALID');
});

test('a resend reopens an expired invitation and records no send, because none happened', async () => {
  /*
   * This test was called "and counts itself" and asserted `resend_count` rose
   * to 3 with `last_sent_at` stamped — pinning as correct a row that claimed a
   * delivery nothing performed. D42 ported this capability knowing the send
   * has NO successor and put `delivery_paused: true` on the audit entry for
   * that reason; D73's standard is that the RECORD must not read as though it
   * happened either, and that half was missed.
   */
  const before = await rowOf('inv-expired');
  assert.equal(before.status, 'expired');
  const result = await resend(ADMIN_A, 'inv-expired');
  assert.equal(result.success, true);
  // The window really does reopen — that is the part a resend means which does
  // not claim a delivery, and it is what lets an operator send the link by
  // hand without fighting a stale row.
  assert.equal(result.invitation.status, 'pending');
  const after = await rowOf('inv-expired');
  assert.equal(after.status, 'pending');
  const days = (new Date(after.expires_at) - new Date(after.updated_date)) / 86400000;
  assert.ok(Math.abs(days - 7) < 0.01, `expected seven days, saw ${days}`);

  // And the two delivery-success fields do NOT move.
  assert.equal(Number(after.resend_count), Number(before.resend_count),
    'resend_count must not count a send that did not happen');
  assert.equal(after.last_sent_at?.toISOString?.() ?? after.last_sent_at,
    before.last_sent_at?.toISOString?.() ?? before.last_sent_at,
    'last_sent_at must not be stamped when nothing was sent');
  assert.equal(result.invitation.resend_count, Number(before.resend_count));

  // The caller is TOLD, at the top level rather than only in the trail — the
  // SPA cannot read the trail, which is why it said "resent successfully!".
  assert.equal(result.delivery_paused, true);

  // An invitation that never had a count stays without one rather than
  // becoming 1 by being asked about.
  const pending = await resend(ADMIN_A, 'inv-pending');
  assert.equal(pending.delivery_paused, true);
  assert.equal(pending.invitation.resend_count, 0);
});

test('an accepted or cancelled invitation is not resent', async () => {
  // Each has its own answer in the original: one has already done its job,
  // the other was withdrawn on purpose.
  await refusal(resend(ADMIN_A, 'inv-accepted'), 'PENNSYNC_INVITATION_ACCEPTED');
  await refusal(resend(ADMIN_A, 'inv-cancelled'), 'PENNSYNC_INVITATION_CANCELLED');
  assert.equal((await rowOf('inv-accepted')).status, 'accepted');
  assert.equal((await rowOf('inv-cancelled')).status, 'cancelled');
});

test('the trail records the resend, and does not claim a message went out', async () => {
  const result = await resend(ADMIN_A, 'inv-expired');
  assert.ok(result.audit_event_id);
  const event = (await db.query(
    `select "action","subject_kind","subject_id","detail","actor_user_id"
     from ${SCHEMA}."activity_audit" where "id" = $1`, [result.audit_event_id])).rows[0];
  assert.ok(event, 'the entry the answer names is really there');
  assert.equal(event.action, 'invitation_resent');
  assert.equal(event.subject_id, 'inv-expired');
  assert.equal(event.detail.invited_email, 'new-nurse@example.invalid');
  // The honest part: the original's send is the Base44 platform's own
  // invitation service, and there is none here. The trail says so rather than
  // reading as though a message went out.
  assert.equal(event.detail.delivery_paused, true);
  // And the entry is in the SAME transaction as the update (D37): the
  // original writes a UserActivity row inside a try/catch, so a resend could
  // happen with nothing recording it.
  const source = readFileSync(resolve(repository, INVITATION), 'utf8');
  // Scoped to the contract's own body: every contract's owner preamble has an
  // `exception when` of its own, so checking the whole file would only ever
  // find that one.
  const body = source.slice(source.indexOf('create function "pennsync_records".contract_invitation_resend'),
    source.indexOf('reset role;'));
  assert.equal(/exception\s+when/.test(body), false,
    'the trail write is not swallowed the way the original swallows it');
  assert.equal(body.includes('contract_activity_append'), true);
});

const sweep = (n, agency = A) => as(n, SWEEP_CALL, [agency], true);

test('the sweep expires what has run out, in this agency only', async () => {
  // Divergence 1, and the sixth original whose own comments document a
  // derived-scope bug: it scopes its digest by comparing the invitation's
  // `agency_name` STRING to each admin's, and records what that cost —
  // "Unscoped fan-out emailed invitee names/emails to every tenant's admins."
  // Every fixture row says "Agency A", agency B's included, precisely so a
  // port reading it would get this wrong.
  await db.query(`update ${SCHEMA}."user_invitation" set "status" = 'pending',
    "expires_at" = '2020-01-01 00:00:00+00' where "id" in ('inv-expired','inv-elsewhere')`);
  await db.query(`update ${SCHEMA}."user_invitation" set "status" = 'pending',
    "expires_at" = null where "id" = 'inv-pending'`);
  const result = await sweep(ADMIN_A);
  assert.equal(result.success, true);
  // Both of agency A's: the one that ran out, and the one with no expiry at
  // all — the original's fail-closed rule for an expiry it cannot read.
  assert.equal(result.expired, 2);
  assert.deepEqual(result.expired_invitations.map(i => i.id).sort(),
    ['inv-expired', 'inv-pending']);
  assert.equal((await rowOf('inv-expired')).status, 'expired');
  assert.equal((await rowOf('inv-pending')).status, 'expired');
  // Agency B's is untouched although its `agency_name` says Agency A.
  assert.equal((await rowOf('inv-elsewhere')).status, 'pending');
  // Neither terminal state is swept.
  assert.equal((await rowOf('inv-accepted')).status, 'accepted');
  assert.equal((await rowOf('inv-cancelled')).status, 'cancelled');
});

test('an expiring invitation is counted and NOT claimed', async () => {
  // The original's own rule for a paused send: "Preserve expiration
  // maintenance while the environment-wide delivery gate is closed, but do not
  // claim an email tier that was never sent." The digest is Core.SendEmail,
  // which nothing here brokers, so this port is that branch.
  await db.query(`update ${SCHEMA}."user_invitation"
    set "status" = 'pending', "expires_at" = clock_timestamp() + interval '6 hours',
        "expiring_soon_notified_at" = null where "id" = 'inv-expired'`);
  await db.query(`update ${SCHEMA}."user_invitation"
    set "status" = 'pending', "expires_at" = clock_timestamp() + interval '9 days'
    where "id" = 'inv-pending'`);
  const result = await sweep(ADMIN_A);
  assert.equal(result.expired, 0, 'nothing has run out yet');
  assert.equal(result.expiring_soon, 1, 'only the one inside twenty-four hours');
  assert.equal(result.notifications_sent, 0);
  assert.equal(result.delivery_paused, true);
  assert.equal(result.code, 'OUTBOUND_DELIVERY_RELEASE_PAUSED');
  // The claim stamp is the thing NOT written, so the next run can still send.
  assert.equal((await rowOf('inv-expired')).last_sent_at !== undefined, true);
  assert.equal((await db.query(
    `select "expiring_soon_notified_at" as at from ${SCHEMA}."user_invitation"
     where "id" = 'inv-expired'`)).rows[0].at, null);
  // An invitation already claimed is not counted again.
  await db.query(`update ${SCHEMA}."user_invitation"
    set "expiring_soon_notified_at" = clock_timestamp() where "id" = 'inv-expired'`);
  assert.equal((await sweep(ADMIN_A)).expiring_soon, 0);
});

test('only the agency administrator sweeps, and only their own agency', async () => {
  await refusal(sweep(CLINICIAN_A), 'PENNSYNC_INVITATION_FORBIDDEN');
  await refusal(sweep(ADMIN_A, B), 'PENNSYNC_INVITATION_FORBIDDEN');
});
