import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { SCHEMA, renderDdl } from '../../../tools-entity-schema-plan.mjs';

/**
 * The record store's policies have to DENY, and a policy that admits
 * everything passes every test that only checks what a caller can see. So
 * every case below reads the same table twice from two agencies and asserts
 * what each one cannot reach, then tries the write that must be refused.
 *
 * Access runs as `record_broker`, a non-superuser standing in for the
 * SECURITY DEFINER brokers the plan calls for: a superuser bypasses row level
 * security outright, so testing as one proves nothing. Production grants that
 * role nothing — the brokers are the tables' owner and reach them that way —
 * so the grants here are the test supplying what ownership would.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// Fixture identities: 1 to 3 are in agency-a, 4 is in agency-b.
const AGENCY_A = 1; const AGENCY_B = 4;
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const migrationDir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(migrationDir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, migrationDir), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  await db.exec(renderDdl(repository).sql);
  await db.exec(`
    create role record_broker nologin;
    grant usage on schema ${SCHEMA} to record_broker;
    grant select, insert, update, delete on all tables in schema ${SCHEMA} to record_broker;
    grant execute on function ${SCHEMA}.caller_agencies(), ${SCHEMA}.caller_user_id(),
      ${SCHEMA}.caller_email(), ${SCHEMA}.deployment_app() to record_broker;`);
});
after(async () => db?.close());

/** Run as the broker, speaking as one of the fixture identities. */
async function as(n, sql, params = []) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role record_broker');
    const { rows } = await db.query(sql, params);
    return rows;
  } finally { await db.exec('rollback'); }
}
async function refused(n, sql, params = []) {
  await assert.rejects(() => as(n, sql, params), error => /row-level security|permission denied/i.test(error.message),
    `${sql} should have been refused`);
}
/** Seed as the owner, which is the only way rows exist before a broker runs. */
const seed = sql => db.exec(sql);
const ids = rows => rows.map(row => row.id).sort();

test('an agency-keyed table shows each agency only its own rows, and refuses to write into the other', async () => {
  await seed(`insert into ${SCHEMA}.supply_item("source_app_id","id","agency_id","name") values
    ('${APP}','supply-a','agency-a','Gauze A'), ('${APP}','supply-b','agency-b','Gauze B');`);

  assert.deepEqual(ids(await as(AGENCY_A, `select "id" from ${SCHEMA}.supply_item`)), ['supply-a']);
  assert.deepEqual(ids(await as(AGENCY_B, `select "id" from ${SCHEMA}.supply_item`)), ['supply-b']);

  // The row the other agency cannot see, it also cannot reach by naming it.
  assert.deepEqual(await as(AGENCY_A, `select "id" from ${SCHEMA}.supply_item where "id" = 'supply-b'`), []);
  // An update it cannot see is silently no rows rather than an error, which is
  // the point: the predicate removes the row rather than reporting it exists.
  assert.deepEqual(await as(AGENCY_A,
    `update ${SCHEMA}.supply_item set "name" = 'taken' where "id" = 'supply-b' returning "id"`), []);
  // Writing a row stamped for the other agency is refused outright.
  await refused(AGENCY_A, `insert into ${SCHEMA}.supply_item("source_app_id","id","agency_id","name")
    values ('${APP}','supply-c','agency-b','Planted')`);
});

test('a row reached only through another entity inherits that entity tenancy', async () => {
  await seed(`insert into ${SCHEMA}.patient("source_app_id","id","agency_id") values
      ('${APP}','patient-a','agency-a'), ('${APP}','patient-b','agency-b');
    insert into ${SCHEMA}.adr_audit_case("source_app_id","id","patient_id") values
      ('${APP}','case-a','patient-a'), ('${APP}','case-b','patient-b');`);

  // adr_audit_case carries no key of its own; it reaches one through patient.
  assert.deepEqual(ids(await as(AGENCY_A, `select "id" from ${SCHEMA}.adr_audit_case`)), ['case-a']);
  assert.deepEqual(ids(await as(AGENCY_B, `select "id" from ${SCHEMA}.adr_audit_case`)), ['case-b']);
  // Attaching a case to the other agency's patient is refused, so the join
  // cannot be used to launder a row into a tenant the caller is not in.
  await refused(AGENCY_A, `insert into ${SCHEMA}.adr_audit_case("source_app_id","id","patient_id")
    values ('${APP}','case-c','patient-b')`);
});

test('a self-keyed row is the account own, not the agency', async () => {
  const email = n => `select "expected_email" from pennsync_private.identity_map where "auth_user_id" = '${uid(n)}'`;
  const { rows: [{ expected_email: first }] } = await db.query(email(1));
  const { rows: [{ expected_email: third }] } = await db.query(email(3));
  await seed(`insert into ${SCHEMA}.ai_configuration("source_app_id","id","user_email") values
    ('${APP}','config-1','${first}'), ('${APP}','config-3','${third}');`);

  // 1 and 3 are both in agency-a, so an agency predicate would show each both
  // rows. A self predicate shows each only its own.
  assert.deepEqual(ids(await as(1, `select "id" from ${SCHEMA}.ai_configuration`)), ['config-1']);
  assert.deepEqual(ids(await as(3, `select "id" from ${SCHEMA}.ai_configuration`)), ['config-3']);
  await refused(1, `insert into ${SCHEMA}.ai_configuration("source_app_id","id","user_email")
    values ('${APP}','config-x','${third}')`);
});

test('a shared table shows platform rows to everyone and agency rows to their owner', async () => {
  await seed(`insert into ${SCHEMA}.document_template
      ("source_app_id","id","agency_id","name","is_system_template") values
      ('${APP}','tpl-system','agency-a','Platform SOC',true),
      ('${APP}','tpl-a','agency-a','Agency A note',false),
      ('${APP}','tpl-b','agency-b','Agency B note',false);`);

  assert.deepEqual(ids(await as(AGENCY_A, `select "id" from ${SCHEMA}.document_template`)), ['tpl-a', 'tpl-system']);
  // agency-b sees the platform row although it is stamped to agency-a, and
  // still cannot see agency-a's own template.
  assert.deepEqual(ids(await as(AGENCY_B, `select "id" from ${SCHEMA}.document_template`)), ['tpl-b', 'tpl-system']);
  // The flag is read-only: it admits a row to everyone's reads and never to
  // anyone's writes, so an agency cannot publish to every other agency.
  assert.deepEqual(await as(AGENCY_B,
    `update ${SCHEMA}.document_template set "name" = 'taken' where "id" = 'tpl-system' returning "id"`), []);
  await refused(AGENCY_B, `insert into ${SCHEMA}.document_template
    ("source_app_id","id","agency_id","name","is_system_template")
    values ('${APP}','tpl-planted','agency-a','Planted',true)`);
});

test('a global table is readable by every agency and writable by none', async () => {
  await seed(`insert into ${SCHEMA}.medicare_guideline("source_app_id","id","title") values
    ('${APP}','guide-1','Coverage of home health services');`);

  for (const who of [AGENCY_A, AGENCY_B]) {
    assert.deepEqual(ids(await as(who, `select "id" from ${SCHEMA}.medicare_guideline`)), ['guide-1']);
  }
  // Forced RLS with no write policy is what refuses these; there is nothing to
  // permit the write, so it is denied rather than filtered.
  await refused(AGENCY_A, `insert into ${SCHEMA}.medicare_guideline("source_app_id","id","title")
    values ('${APP}','guide-2','Invented')`);
  assert.deepEqual(await as(AGENCY_A,
    `update ${SCHEMA}.medicare_guideline set "title" = 'taken' where "id" = 'guide-1' returning "id"`), []);
  assert.deepEqual(await as(AGENCY_A,
    `delete from ${SCHEMA}.medicare_guideline where "id" = 'guide-1' returning "id"`), []);
});

test('revoking a membership takes the rows away, and half a revocation cannot exist', async () => {
  await seed(`insert into ${SCHEMA}.supply_item("source_app_id","id","agency_id","name") values
    ('${APP}','rev-1','agency-a','Gauze');`);
  const mine = `select "id" from ${SCHEMA}.supply_item where "id" = 'rev-1'`;
  assert.deepEqual(ids(await as(AGENCY_A, mine)), ['rev-1']);

  // The store refuses the state the thirteen copied validateMembershipRows
  // variants argued about: revoked_at set while status still says active.
  // So the disagreement was over a row the database will not hold.
  await assert.rejects(
    () => db.query(`update pennsync_private.membership set "revoked_at" = clock_timestamp()
      where "auth_user_id" = '${uid(AGENCY_A)}'`),
    error => error.code === '23514',
    'a half-revoked membership must violate membership_check');

  // A whole revocation, which is the only kind there is, takes the rows.
  await db.exec('begin');
  try {
    await db.exec(`update pennsync_private.membership
      set "status" = 'revoked', "revoked_at" = clock_timestamp(), "revoked_by" = '${uid(AGENCY_A)}'
      where "auth_user_id" = '${uid(AGENCY_A)}'`);
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(AGENCY_A), session_id: sid(AGENCY_A), role: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role record_broker');
    assert.deepEqual((await db.query(mine)).rows, [], 'a revoked membership reaches no row');
  } finally { await db.exec('rollback'); }
});

test('a row belonging to the other source app is not this deployment to show', async () => {
  // `source_app_id` is plain text here and the primary key is composite
  // precisely because ids COLLIDE across the two source apps. So a row of the
  // other app can carry the very same agency id the caller is a member of.
  // Without the deployment-app predicate that row reads as the caller's own.
  const OTHER_APP = '694ec16e72e01b60d22f7cbf';
  await seed(`insert into ${SCHEMA}.supply_item("source_app_id","id","agency_id","name") values
    ('${APP}','cross-mine','agency-a','Mine'),
    ('${OTHER_APP}','cross-theirs','agency-a','Other app, same agency id');`);

  assert.deepEqual(ids(await as(AGENCY_A, `select "id" from ${SCHEMA}.supply_item where "id" like 'cross-%'`)),
    ['cross-mine']);
  assert.deepEqual(await as(AGENCY_A,
    `update ${SCHEMA}.supply_item set "name" = 'taken' where "id" = 'cross-theirs' returning "id"`), []);
  await refused(AGENCY_A, `insert into ${SCHEMA}.supply_item("source_app_id","id","agency_id","name")
    values ('${OTHER_APP}','cross-planted','agency-a','Planted')`);
});

test('a shared table refuses to let an agency publish its own row to everyone', async () => {
  await seed(`insert into ${SCHEMA}.document_template
    ("source_app_id","id","agency_id","name","is_system_template") values
    ('${APP}','own-tpl','agency-a','Agency A note',false);`);

  // The tenant predicate alone would allow this: the row IS the caller's. What
  // must refuse it is the flag, because setting it is what makes the row
  // readable by every other agency.
  await refused(AGENCY_A, `insert into ${SCHEMA}.document_template
    ("source_app_id","id","agency_id","name","is_system_template")
    values ('${APP}','self-published','agency-a','Promoted',true)`);
  await refused(AGENCY_A,
    `update ${SCHEMA}.document_template set "is_system_template" = true where "id" = 'own-tpl'`);
  // Writing its own row without the flag stays perfectly allowed.
  assert.deepEqual(ids(await as(AGENCY_A,
    `update ${SCHEMA}.document_template set "name" = 'Renamed' where "id" = 'own-tpl' returning "id"`)),
  ['own-tpl']);
});

test('a BYPASSRLS role is not bound by any of this, which is why brokers must not have it', async () => {
  await seed(`insert into ${SCHEMA}.supply_item("source_app_id","id","agency_id","name") values
    ('${APP}','bypass-a','agency-a','A'), ('${APP}','bypass-b','agency-b','B');`);
  await db.exec(`create role record_owner nologin bypassrls;
    grant usage on schema ${SCHEMA} to record_owner;
    grant select on all tables in schema ${SCHEMA} to record_owner;`);

  // The authority migration REQUIRES a SUPERUSER or BYPASSRLS owner
  // (PENNSYNC_BYPASSRLS_MIGRATION_OWNER_REQUIRED), and such a role bypasses row
  // level security even where it is forced. So `force row level security` does
  // not bind a broker that runs as the migration owner, and the policies above
  // are only worth anything to a role without the attribute. Demonstrated here
  // rather than described, so the requirement cannot be quietly forgotten.
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(AGENCY_A), session_id: sid(AGENCY_A), role: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role record_owner');
    const { rows } = await db.query(`select "id" from ${SCHEMA}.supply_item where "id" like 'bypass-%'`);
    assert.deepEqual(rows.map(row => row.id).sort(), ['bypass-a', 'bypass-b'],
      'a BYPASSRLS role sees both agencies, which is the boundary brokers must stay outside of');
  } finally { await db.exec('rollback'); }

  // The same read as a role without the attribute is filtered, which is the
  // contrast that makes the requirement concrete.
  assert.deepEqual(ids(await as(AGENCY_A, `select "id" from ${SCHEMA}.supply_item where "id" like 'bypass-%'`)),
    ['bypass-a']);
});

test('a caller with no session reaches nothing at all', async () => {
  await seed(`insert into ${SCHEMA}.supply_item("source_app_id","id","agency_id","name") values
    ('${APP}','supply-anon','agency-a','Gauze');`);
  await db.exec('begin');
  try {
    await db.exec('set local role record_broker');
    const { rows } = await db.query(`select "id" from ${SCHEMA}.supply_item`);
    assert.deepEqual(rows, [], 'no JWT means no membership, so no row');
  } finally { await db.exec('rollback'); }
});
