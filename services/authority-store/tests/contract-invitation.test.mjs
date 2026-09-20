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
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN_A = 1; const CLINICIAN_A = 2;
const RESEND = 'select "public"."pennsync_contract_invitation_resend"($1,$2) as result';
const A = 'agency-a'; const B = 'agency-b';
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, AUDIT, INVITATION]) {
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
  `select "status","resend_count","expires_at","last_sent_at"
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

test('a resend revives an expired invitation and counts itself', async () => {
  const before = await rowOf('inv-expired');
  assert.equal(before.status, 'expired');
  const result = await resend(ADMIN_A, 'inv-expired');
  assert.equal(result.success, true);
  assert.equal(result.invitation.status, 'pending');
  assert.equal(result.invitation.resend_count, 3, 'the original increments from 2');
  const after = await rowOf('inv-expired');
  assert.equal(after.status, 'pending');
  assert.equal(Number(after.resend_count), 3);
  assert.ok(after.last_sent_at, 'the moment is stamped');
  // Seven days, which is the original's window.
  const days = (new Date(after.expires_at) - new Date(after.last_sent_at)) / 86400000;
  assert.ok(Math.abs(days - 7) < 0.01, `expected seven days, saw ${days}`);
  // A null count starts at one rather than becoming NaN.
  assert.equal((await resend(ADMIN_A, 'inv-pending')).invitation.resend_count, 1);
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
