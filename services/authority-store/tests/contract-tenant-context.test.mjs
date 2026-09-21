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
 * Which agency the caller is acting in (`contract_tenant_context`) and which
 * they could choose (`contract_tenant_memberships`).
 *
 * Two properties are worth the file. The first is that a **revoked membership
 * is not a choice** — the selector is where a person picks the tenant every
 * later capability then authorizes against, so a stale row here is a stale row
 * everywhere. The second is the last test: the originals re-derive a
 * membership's integrity on every read, and that is only necessary for an
 * entity any writer could corrupt. Here the same properties are constraints,
 * so the test asserts the CONSTRAINTS rather than trusting the migration's
 * header — delete one and this fails instead of the gap quietly re-opening.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const TENANT = 'services/authority-store/supabase/record-migrations/'
  + '20260920190000_contract_tenant_context.sql';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN_A = 1; const CLINICIAN_A = 2; const SPARE_A = 3; const ADMIN_B = 4;
const LIST = 'select "public"."pennsync_contract_tenant_memberships"() as result';
const CONTEXT = 'select "public"."pennsync_contract_tenant_context"($1,$2,$3) as result';
const A = 'agency-a'; const B = 'agency-b';
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, TENANT]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  // The carried rows the originals project from. The authority store's own
  // `agency.name` is constrained `like 'Synthetic %'`, so it is deliberately
  // NOT what a caller is shown.
  for (const [id, name] of [[A, 'Keystone Home Health'], [B, 'Allegheny Care Partners']]) {
    await db.query(`insert into ${SCHEMA}."agency"
      ("source_app_id","id","agency_name","status") values ($1,$2,$3,'active')`,
    [APP, id, name]);
  }
});
after(async () => db?.close());

async function as(n, sql, params = []) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
    const { rows } = await db.query(sql, params);
    await db.exec('rollback');
    return rows[0].result;
  } catch (error) { await db.exec('rollback'); throw error; }
}
const list = n => as(n, LIST);
const context = (n, agency = null, id = null, version = null) => as(n, CONTEXT, [agency, id, version]);
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);
const revoke = id => db.exec(`update pennsync_private.membership set status = 'revoked',
  revoked_at = clock_timestamp(), revoked_by = '${uid(1)}' where id = '${id}'`);
const restore = id => db.exec(`update pennsync_private.membership set status = 'active',
  revoked_at = null, revoked_by = null where id = '${id}'`);

test('the selector answers the caller own memberships, with the carried agency name', async () => {
  const result = await list(ADMIN_A);
  assert.equal(result.subject.user_email, 'admin-a@example.invalid');
  assert.equal(result.memberships.length, 1);
  const [only] = result.memberships;
  assert.equal(only.agency_id, A);
  assert.equal(only.tenant_role, 'agency_admin');
  assert.equal(only.membership_status, 'active');
  assert.equal(only.membership_version, 1);
  // The generated column, which the original recomputes as `agency:user` and
  // then refuses the row if the stored value disagrees.
  assert.equal(only.membership_key, `${A}:6aac00000000000000000001`);
  // The CARRIED name, not the authority store's synthetic label.
  assert.deepEqual(only.agency, { id: A, name: 'Keystone Home Health', status: 'active' });
  // And it is the caller's own list: agency B's admin sees only agency B.
  const other = await list(ADMIN_B);
  assert.deepEqual(other.memberships.map(row => row.agency_id), [B]);
  assert.equal(other.subject.user_email, 'admin-b@example.invalid');
});

test('a revoked membership is not a choice, and leaves the caller with none', async () => {
  // The property the whole selector exists for. Every later capability
  // authorizes against the agency chosen here, so a revoked row that stayed
  // selectable would be a revocation that changed nothing.
  await revoke('membership-3');
  try {
    assert.deepEqual((await list(SPARE_A)).memberships, []);
    // And the context refuses rather than inventing one. The originals answer
    // a caller with no membership as a `platform_owner`; D14 and D22 removed
    // that tier, so this is a refusal.
    await refusal(context(SPARE_A), 'PENNSYNC_TENANT_NO_MEMBERSHIP');
    await refusal(context(SPARE_A, A), 'PENNSYNC_TENANT_NO_MEMBERSHIP');
  } finally { await restore('membership-3'); }
  assert.equal((await list(SPARE_A)).memberships.length, 1);
});

test('one membership selects itself and carries the whole context', async () => {
  const { tenant_context: ctx } = await context(CLINICIAN_A);
  assert.equal(ctx.agency_id, A);
  assert.equal(ctx.tenant_role, 'clinician');
  assert.equal(ctx.membership_status, 'active');
  assert.equal(ctx.user_email, 'clinician-a@example.invalid');
  assert.equal(ctx.agency.name, 'Keystone Home Health');
  // No platform-owner field at all: one that is always false invites a client
  // to test it.
  assert.equal('is_platform_owner' in ctx, false);
  // Naming the agency they do hold is the same answer.
  assert.deepEqual((await context(CLINICIAN_A, A)).tenant_context, ctx);
});

test('two memberships make the caller choose, and only their own are offered', async () => {
  await db.exec(`insert into pennsync_private.membership
    (app_id,id,agency_id,auth_user_id,base44_user_id,tenant_role,status)
    values ('${APP}','membership-1b','${B}','${uid(1)}','6aac00000000000000000001',
      'manager','active')`);
  try {
    const result = await list(ADMIN_A);
    // Agency order, as both originals sort.
    assert.deepEqual(result.memberships.map(row => row.agency_id), [A, B]);
    assert.deepEqual(result.memberships.map(row => row.tenant_role),
      ['agency_admin', 'manager']);
    // Guessing would put them in an agency they never named.
    await refusal(context(ADMIN_A), 'PENNSYNC_TENANT_AGENCY_REQUIRED');
    assert.equal((await context(ADMIN_A, B)).tenant_context.tenant_role, 'manager');
    assert.equal((await context(ADMIN_A, A)).tenant_context.tenant_role, 'agency_admin');
  } finally {
    await db.exec("delete from pennsync_private.membership where id = 'membership-1b'");
  }
  // An agency that exists, that the caller simply is not in.
  await refusal(context(ADMIN_A, B), 'PENNSYNC_TENANT_AGENCY_NOT_HELD');
  await refusal(context(ADMIN_B, A), 'PENNSYNC_TENANT_AGENCY_NOT_HELD');
  // And one that does not exist at all is the same answer, so the endpoint is
  // not an existence oracle for agency ids.
  await refusal(context(ADMIN_A, 'agency-nowhere'), 'PENNSYNC_TENANT_AGENCY_NOT_HELD');
});

test('the optimistic binding refuses a context the caller did not see', async () => {
  const { tenant_context: ctx } = await context(CLINICIAN_A, A);
  // The selector's own answer binds cleanly.
  assert.equal(
    (await context(CLINICIAN_A, A, ctx.membership_id, ctx.membership_version)).tenant_context.agency_id, A);
  // A version that moved under them does not.
  await refusal(context(CLINICIAN_A, A, ctx.membership_id, ctx.membership_version + 1),
    'PENNSYNC_TENANT_MEMBERSHIP_CHANGED');
  await refusal(context(CLINICIAN_A, A, 'membership-other', ctx.membership_version),
    'PENNSYNC_TENANT_MEMBERSHIP_CHANGED');
  // Half a binding is a client bug, not an absent one.
  await refusal(context(CLINICIAN_A, A, ctx.membership_id, null),
    'PENNSYNC_TENANT_BINDING_INCOMPLETE');
  await refusal(context(CLINICIAN_A, A, null, 1), 'PENNSYNC_TENANT_BINDING_INCOMPLETE');
  await refusal(context(CLINICIAN_A, A, 'has spaces', 1), 'PENNSYNC_TENANT_SUBJECT_INVALID');
  await refusal(context(CLINICIAN_A, A, ctx.membership_id, 0), 'PENNSYNC_TENANT_VERSION_INVALID');
  await refusal(context(CLINICIAN_A, 'has spaces'), 'PENNSYNC_TENANT_SUBJECT_INVALID');
});

test('an agency has to be enabled in BOTH stores to be entered', async () => {
  // The authority store owns whether the tenant is enabled; the originals
  // could only see the carried row, so requiring both refuses more.
  await db.exec(`update pennsync_private.agency set status = 'suspended' where id = '${A}'`);
  try {
    await refusal(context(CLINICIAN_A, A), 'PENNSYNC_TENANT_AGENCY_UNAVAILABLE');
    await refusal(list(CLINICIAN_A), 'PENNSYNC_TENANT_AGENCY_UNAVAILABLE');
  } finally {
    await db.exec(`update pennsync_private.agency set status = 'active' where id = '${A}'`);
  }
  // And the carried row's own status, which is what the originals gate on.
  await db.query(`update ${SCHEMA}."agency" set "status" = 'cancelled'
    where "source_app_id" = $1 and "id" = $2`, [APP, A]);
  try {
    await refusal(context(CLINICIAN_A, A), 'PENNSYNC_TENANT_AGENCY_UNAVAILABLE');
  } finally {
    await db.query(`update ${SCHEMA}."agency" set "status" = 'active'
      where "source_app_id" = $1 and "id" = $2`, [APP, A]);
  }
  // A membership whose carried agency was never imported is not a context
  // either — the originals answer 403 "Agency is unavailable" for a missing
  // row, and a name the caller cannot be shown is not a tenant they can enter.
  await db.query(`update ${SCHEMA}."agency" set "agency_name" = null
    where "source_app_id" = $1 and "id" = $2`, [APP, A]);
  try {
    await refusal(context(CLINICIAN_A, A), 'PENNSYNC_TENANT_AGENCY_UNAVAILABLE');
  } finally {
    await db.query(`update ${SCHEMA}."agency" set "agency_name" = 'Keystone Home Health'
      where "source_app_id" = $1 and "id" = $2`, [APP, A]);
  }
  assert.equal((await context(CLINICIAN_A, A)).tenant_context.agency_id, A);
});

test('what the originals re-derive per read, this store cannot hold wrong', async () => {
  // The forty-line `validateMemberships` both originals run over every row is
  // a compensation for an entity any service-role writer could corrupt. These
  // are the same properties as constraints. Asserting them here is what makes
  // deleting the validation honest rather than merely shorter.
  const constraints = (await db.query(`select pg_get_constraintdef(c.oid) as def
    from pg_constraint c where c.conrelid = 'pennsync_private.membership'::regclass
      and c.contype = 'c'`)).rows.map(row => row.def).join('\n');
  // A known tenant role, and a known status.
  assert.match(constraints, /tenant_role = ANY|tenant_role IN/i);
  for (const role of ['agency_admin', 'manager', 'clinician', 'office_staff',
    'social_worker', 'spiritual_care']) {
    assert.ok(constraints.includes(role), `${role} is a known tenant role`);
  }
  // A revocation carries its timestamp and its actor, and nothing else does.
  assert.match(constraints, /revoked_at IS NULL/);
  assert.match(constraints, /revoked_at IS NOT NULL/);
  // `membership_key` is generated, not written — so it cannot disagree with
  // the row the way the original checks for.
  const key = (await db.query(`select a.attgenerated, pg_get_expr(d.adbin, d.adrelid) as expr
    from pg_attribute a join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'pennsync_private.membership'::regclass
      and a.attname = 'membership_key'`)).rows[0];
  assert.equal(key.attgenerated, 's', 'membership_key is stored-generated');
  assert.match(key.expr, /agency_id/);
  assert.match(key.expr, /base44_user_id/);
  // And a version of at least one, which the original tests with
  // `Number.isSafeInteger(row.version) && row.version >= 1`.
  const version = (await db.query(`select pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    join pg_type t on t.oid = c.contypid
    where t.typname = 'revision'`)).rows.map(row => row.def).join('\n');
  assert.match(version, /VALUE >= 1|VALUE > 0/);
  // The constraints are real, not merely declared: the bad rows are refused.
  await assert.rejects(db.exec(`insert into pennsync_private.membership
    (app_id,id,agency_id,auth_user_id,base44_user_id,tenant_role,status)
    values ('${APP}','membership-bad','${A}','${uid(2)}','6aac00000000000000000002',
      'wizard','active')`), /tenant_role/);
  await assert.rejects(db.exec(`insert into pennsync_private.membership
    (app_id,id,agency_id,auth_user_id,base44_user_id,tenant_role,status,revoked_at)
    values ('${APP}','membership-bad','${A}','${uid(2)}','6aac00000000000000000002',
      'clinician','active',clock_timestamp())`), /membership_check|check constraint/i);
});
