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
 * The membership lifecycle (`contract_membership_inspect` /
 * `contract_membership_transition`) — the second PARTIAL port.
 *
 * Three properties are worth the file. **`provision` has no performer**: the
 * original reserves it to the protected platform owner D14 and D22 removed, so
 * the port refuses it BY NAME rather than as an unknown action, and a test says
 * so. **An administrator is not a performer for another administrator**, which
 * is the original's rule and the reason a port that quietly dropped the
 * platform tier would have widened rather than narrowed. And **a suspension
 * actually closes the tenant** — asserted through `caller_agencies` and the
 * D34 selector, the way a caller would notice it, rather than through the row.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const MEMBERSHIP = 'services/authority-store/supabase/record-migrations/'
  + '20260920200000_contract_membership.sql';
const ASSIGNMENT = 'services/authority-store/supabase/record-migrations/'
  + '20260920180000_contract_assignment.sql';
const TENANT = 'services/authority-store/supabase/record-migrations/'
  + '20260920190000_contract_tenant_context.sql';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const b44 = n => `6aac00000000${String(n).padStart(12, '0')}`;
const ADMIN_A = 1; const CLINICIAN_A = 2; const SPARE_A = 3; const ADMIN_B = 4;
const INSPECT = 'select "public"."pennsync_contract_membership_inspect"($1,$2) as result';
const MOVE = 'select "public"."pennsync_contract_membership_transition"($1,$2,$3,$4,$5,$6) as result';
const SELECTOR = 'select "public"."pennsync_contract_tenant_memberships"() as result';
const A = 'agency-a'; const B = 'agency-b';
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, ASSIGNMENT, TENANT, MEMBERSHIP]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  for (const [id, name] of [[A, 'Keystone Home Health'], [B, 'Allegheny Care Partners']]) {
    await db.query(`insert into ${SCHEMA}."agency"
      ("source_app_id","id","agency_name","status") values ($1,$2,$3,'active')`,
    [APP, id, name]);
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
const inspect = (n, target, agency = A) => as(n, INSPECT, [agency, target]);
const move = (n, target, action, {
  agency = A, role = null, reason = 'restructuring the team', version = 1,
} = {}) => as(n, MOVE, [agency, target, action, role, reason, version], true);
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);
const membershipOf = async id => (await db.query(
  'select status, version, tenant_role from pennsync_private.membership where id = $1',
  [id])).rows[0];

test('provision is refused by name, because D14 and D22 removed its only performer', async () => {
  // Not "unknown action": a caller asking for `provision` is asking for
  // something real in the original, and the honest answer says so. The
  // original's own guard reserves it to the protected platform owner.
  await refusal(move(ADMIN_A, b44(SPARE_A), 'provision'),
    'PENNSYNC_MEMBERSHIP_ACTION_UNPORTED');
  await refusal(move(ADMIN_A, b44(SPARE_A), 'invent'), 'PENNSYNC_MEMBERSHIP_ACTION_INVALID');
});

test('only an active agency administrator of that agency may act', async () => {
  // A clinician cannot, and neither can a manager — D24 lets a manager open
  // every chart, and the original still does not let them manage memberships.
  await refusal(inspect(CLINICIAN_A, b44(SPARE_A)), 'PENNSYNC_MEMBERSHIP_FORBIDDEN');
  await db.exec("update pennsync_private.membership set tenant_role = 'manager' where id = 'membership-2'");
  await refusal(inspect(CLINICIAN_A, b44(SPARE_A)), 'PENNSYNC_MEMBERSHIP_FORBIDDEN');
  await db.exec("update pennsync_private.membership set tenant_role = 'clinician' where id = 'membership-2'");
  // Agency B's administrator has no standing in agency A.
  await refusal(inspect(ADMIN_B, b44(SPARE_A), A), 'PENNSYNC_MEMBERSHIP_FORBIDDEN');
  // And an administrator cannot act on themselves: one who could suspend
  // themselves could un-suspend themselves, and one who could revoke
  // themselves could strand the agency.
  await refusal(inspect(ADMIN_A, b44(ADMIN_A)), 'PENNSYNC_MEMBERSHIP_SELF');
  await refusal(move(ADMIN_A, b44(ADMIN_A), 'suspend'), 'PENNSYNC_MEMBERSHIP_SELF');
});

test('an administrator is never a subject, because only the platform tier could be', async () => {
  // The original reserves an `agency_admin` target to the protected platform
  // owner. Dropping that tier without keeping this rule would have WIDENED the
  // capability — one administrator could unmake another.
  // Agency B's administrator, given a second administrator membership in
  // agency A. It has to be a different person: `membership` is unique on
  // (app, agency, auth_user), and the identity has to be one `identity_map`
  // already knows, because the membership keys to it.
  await db.exec(`insert into pennsync_private.membership
    (app_id,id,agency_id,auth_user_id,base44_user_id,tenant_role,status)
    values ('${APP}','membership-4a','${A}','${uid(4)}','${b44(ADMIN_B)}',
      'agency_admin','active')`);
  try {
    await refusal(inspect(ADMIN_A, b44(ADMIN_B)), 'PENNSYNC_MEMBERSHIP_PRIVILEGED');
    await refusal(move(ADMIN_A, b44(ADMIN_B), 'suspend'), 'PENNSYNC_MEMBERSHIP_PRIVILEGED');
  } finally {
    await db.exec("delete from pennsync_private.membership where id = 'membership-4a'");
  }
  // And the role being GIVEN cannot be the administrator one either: the
  // contract's role list is the original's SUBORDINATE_ROLES.
  await refusal(move(ADMIN_A, b44(SPARE_A), 'change_role', { role: 'agency_admin' }),
    'PENNSYNC_MEMBERSHIP_ROLE_INVALID');
});

test('the arguments each action accepts are the ones the original accepts', async () => {
  await refusal(inspect(ADMIN_A, 'has spaces'), 'PENNSYNC_MEMBERSHIP_SUBJECT_INVALID');
  // A role is required for a role change and refused for anything else, the
  // way the original accepts `expected_version` only for a versioned action.
  await refusal(move(ADMIN_A, b44(SPARE_A), 'change_role'), 'PENNSYNC_MEMBERSHIP_ROLE_INVALID');
  await refusal(move(ADMIN_A, b44(SPARE_A), 'suspend', { role: 'clinician' }),
    'PENNSYNC_MEMBERSHIP_ROLE_UNEXPECTED');
  await refusal(move(ADMIN_A, b44(SPARE_A), 'suspend', { reason: '   ' }),
    'PENNSYNC_MEMBERSHIP_REASON_REQUIRED');
  // The reason is the same `bounded_reason` D33 ported from this same original
  // family — a Unicode space separator is empty after a JavaScript trim.
  await refusal(move(ADMIN_A, b44(SPARE_A), 'suspend', { reason: ' ' }),
    'PENNSYNC_MEMBERSHIP_REASON_REQUIRED');
  await refusal(move(ADMIN_A, b44(SPARE_A), 'suspend', { version: null }),
    'PENNSYNC_MEMBERSHIP_VERSION_REQUIRED');
  await refusal(move(ADMIN_A, b44(SPARE_A), 'suspend', { version: 99 }),
    'PENNSYNC_MEMBERSHIP_STALE');
  await refusal(inspect(ADMIN_A, b44(4)), 'PENNSYNC_MEMBERSHIP_NOT_FOUND');
});

test('a suspension closes the tenant, and reactivation opens it again', async () => {
  const before = await inspect(ADMIN_A, b44(SPARE_A));
  assert.equal(before.membership.membership_status, 'active');
  assert.equal(before.membership.tenant_role, 'clinician');
  // The spare clinician can see their own agency through D34's selector.
  assert.deepEqual((await as(SPARE_A, SELECTOR)).memberships.map(row => row.agency_id), [A]);

  const suspended = await move(ADMIN_A, b44(SPARE_A), 'suspend', { reason: 'on leave' });
  assert.equal(suspended.membership.membership_status, 'suspended');
  assert.equal(suspended.membership.membership_version, 2);
  assert.ok(suspended.membership.suspended_at);
  // **The closure**, seen the way a caller sees it rather than in the row:
  // every reader in this store filters `status = 'active'`, so the tenant is
  // simply gone.
  assert.deepEqual((await as(SPARE_A, SELECTOR)).memberships, []);

  // Suspending again is the state it is already in, so it is answered rather
  // than refused — the original returns the current row unchanged.
  const again = await move(ADMIN_A, b44(SPARE_A), 'suspend', { version: 2 });
  assert.equal(again.membership.membership_version, 2);
  // Activating from suspended is the one enabling transition this port serves.
  const active = await move(ADMIN_A, b44(SPARE_A), 'activate', { version: 2, reason: 'back' });
  assert.equal(active.membership.membership_status, 'active');
  assert.equal(active.membership.membership_version, 3);
  assert.deepEqual((await as(SPARE_A, SELECTOR)).memberships.map(row => row.agency_id), [A]);
  // And activating an already-active membership is answered, not refused.
  assert.equal((await move(ADMIN_A, b44(SPARE_A), 'activate', { version: 3 }))
    .membership.membership_version, 3);
});

test('a role change moves the role and nothing else, and is refused after revocation', async () => {
  const changed = await move(ADMIN_A, b44(SPARE_A), 'change_role',
    { role: 'social_worker', version: 3, reason: 'moving to the social work team' });
  assert.equal(changed.membership.tenant_role, 'social_worker');
  assert.equal(changed.membership.membership_status, 'active');
  assert.equal(changed.membership.membership_version, 4);
  assert.equal(changed.membership.last_action, 'change_role');
  // The same role is not a change.
  await refusal(move(ADMIN_A, b44(SPARE_A), 'change_role', { role: 'social_worker', version: 4 }),
    'PENNSYNC_MEMBERSHIP_ROLE_UNCHANGED');

  const revoked = await move(ADMIN_A, b44(SPARE_A), 'revoke',
    { version: 4, reason: 'left the agency' });
  assert.equal(revoked.membership.membership_status, 'revoked');
  assert.ok(revoked.membership.revoked_at);
  assert.deepEqual((await as(SPARE_A, SELECTOR)).memberships, []);
  // Terminal for a role change and for an activation; a second revocation is
  // the state it is in and is answered.
  await refusal(move(ADMIN_A, b44(SPARE_A), 'change_role', { role: 'clinician', version: 5 }),
    'PENNSYNC_MEMBERSHIP_REVOKED');
  await refusal(move(ADMIN_A, b44(SPARE_A), 'activate', { version: 5 }),
    'PENNSYNC_MEMBERSHIP_TRANSITION');
  assert.equal((await move(ADMIN_A, b44(SPARE_A), 'revoke', { version: 5 }))
    .membership.membership_status, 'revoked');
  // Restore for any test that follows.
  await db.exec(`update pennsync_private.membership set status = 'active',
    tenant_role = 'clinician', revoked_at = null, revoked_by = null,
    suspended_at = null, last_action = 'activate' where id = 'membership-3'`);
});

test('taking access away works where granting it would not', async () => {
  // A suspended agency refuses EVERY action here, where the original refuses
  // only the enabling ones — divergence 6, and it is `caller_tenant_role`'s
  // doing rather than a choice: it admits a membership only while its agency
  // is `active` or `trial`, so the administrator has no standing to lose.
  // A narrowing, and a harmless one: a suspended agency already denies every
  // capability through `caller_agencies()`.
  await db.exec(`update pennsync_private.agency set status = 'suspended' where id = '${A}'`);
  try {
    await refusal(move(ADMIN_A, b44(SPARE_A), 'change_role', { role: 'manager' }),
      'PENNSYNC_MEMBERSHIP_FORBIDDEN');
    await refusal(move(ADMIN_A, b44(SPARE_A), 'suspend'), 'PENNSYNC_MEMBERSHIP_FORBIDDEN');
    await refusal(inspect(ADMIN_A, b44(SPARE_A)), 'PENNSYNC_MEMBERSHIP_FORBIDDEN');
  } finally {
    await db.exec(`update pennsync_private.agency set status = 'active' where id = '${A}'`);
  }
  // Withdrawal works again the moment the agency does, and it is the enabling
  // direction that the deactivation check below still guards. The version is
  // READ rather than assumed: the tests above committed transitions, and a
  // hard-coded one would make this assert its own bookkeeping.
  const live = Number((await membershipOf('membership-3')).version);
  assert.equal((await move(ADMIN_A, b44(SPARE_A), 'suspend', { version: live }))
    .membership.membership_status, 'suspended');
  // A disabled identity cannot be activated back in either. This reads
  // `identity_map.enabled` rather than the carried `User.is_active` — see
  // divergence 5 in the migration header: the carried row is invisible under
  // `user_read` once the colleague is suspended, so the original's check would
  // have failed closed exactly when it mattered.
  // Reactivation works while the identity is enabled...
  const suspendedAt = Number((await membershipOf('membership-3')).version);
  assert.equal((await move(ADMIN_A, b44(SPARE_A), 'activate', { version: suspendedAt }))
    .membership.membership_status, 'active');

  // ...and not once it is revoked. This is done LAST and never undone,
  // because `identity_map`'s own trigger makes revocation ONE-WAY: it refuses
  // any update that sets `enabled` back to true or clears `revoked_at`. That
  // is the strongest argument for divergence 5 — a flag the store will not let
  // anyone un-set is authority in a way a carried `is_active` column is not.
  await db.exec(`update pennsync_private.identity_map set enabled = false,
    revoked_at = clock_timestamp(), version = version + 1
    where base44_user_id = '${b44(SPARE_A)}'`);
  const active = Number((await membershipOf('membership-3')).version);
  await refusal(move(ADMIN_A, b44(SPARE_A), 'change_role',
    { role: 'manager', version: active }), 'PENNSYNC_MEMBERSHIP_TARGET_DEACTIVATED');
  // Taking access away still works, which is the half that must never block.
  assert.equal((await move(ADMIN_A, b44(SPARE_A), 'revoke',
    { version: active, reason: 'identity revoked' })).membership.membership_status, 'revoked');
});
