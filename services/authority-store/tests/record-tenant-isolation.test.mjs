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
 * Access runs as `authenticated`, because that is the role the caller gate
 * requires: `pennsync_private.actor()` refuses a session whose connection role
 * is anything else, and these policies now go through it rather than through a
 * weaker copy. A superuser or BYPASSRLS role bypasses row level security
 * outright, so testing as one would prove nothing — the last test here
 * demonstrates exactly that, which is why brokers must hold neither attribute.
 *
 * The grants below are the test's own, so that each predicate can be exercised
 * directly. They are NOT how a deployment works: the record store's migration
 * grants no caller role anything and puts the tables under an owner that RLS
 * binds, which `record-store-migration.test.mjs` applies and proves the same
 * predicates deny under. What is settled here is the predicate each table
 * carries; what is settled there is that a real caller is held to it.
 *
 * What this file covers and what it does not: the PREDICATE each table carries
 * is settled here, and the transport that reaches it is settled in
 * `record-brokers.test.mjs`, which applies the real broker migration and holds
 * the family D17 settled. This comment used to say that family was still an
 * open decision, which stopped being true when it was built — and a test
 * describing the security boundary as undecided misstates it.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// Fixture identities: 1 to 3 are in agency-a, 4 is in agency-b. 1 and 4 are
// `agency_admin`; 2 and 3 are clinicians, and only 2 is assigned to a patient.
const AGENCY_A = 1; const AGENCY_B = 4;
const ASSIGNED = 2; const UNASSIGNED = 3;
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
    grant usage on schema ${SCHEMA} to authenticated;
    grant select, insert, update, delete on all tables in schema ${SCHEMA} to authenticated;
    grant execute on function ${SCHEMA}.caller_identity(), ${SCHEMA}.caller_identified(),
      ${SCHEMA}.caller_agencies(), ${SCHEMA}.caller_user_id(), ${SCHEMA}.caller_roster_ids(),
      ${SCHEMA}.caller_tenant_role(text), ${SCHEMA}.caller_opens_every_chart(text),
      ${SCHEMA}.caller_assigned_patients(text),
      ${SCHEMA}.caller_email(), ${SCHEMA}.deployment_app() to authenticated;`);
});
after(async () => db?.close());

/** Run as the broker, speaking as one of the fixture identities. */
async function as(n, sql, params = []) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
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
  // `supply_usage_log`, and not `adr_audit_case`, which used to be the example
  // here: D61 gave that one a key of its own, because its `patient_id` was
  // OPTIONAL and a case filed before a chart existed was in no tenant at all.
  // A reference is still a tenancy where the schema REQUIRES the column, which
  // it does for a usage log's patient.
  await seed(`insert into ${SCHEMA}.patient("source_app_id","id","agency_id") values
      ('${APP}','patient-a','agency-a'), ('${APP}','patient-b','agency-b');
    insert into ${SCHEMA}.supply_usage_log("source_app_id","id","patient_id") values
      ('${APP}','log-a','patient-a'), ('${APP}','log-b','patient-b');`);

  // supply_usage_log carries no key of its own; it reaches one through patient.
  assert.deepEqual(ids(await as(AGENCY_A, `select "id" from ${SCHEMA}.supply_usage_log`)), ['log-a']);
  assert.deepEqual(ids(await as(AGENCY_B, `select "id" from ${SCHEMA}.supply_usage_log`)), ['log-b']);
  // Attaching a log to the other agency's patient is refused, so the join
  // cannot be used to launder a row into a tenant the caller is not in.
  await refused(AGENCY_A, `insert into ${SCHEMA}.supply_usage_log("source_app_id","id","patient_id")
    values ('${APP}','log-c','patient-b')`);
});

test('a self-keyed row is the account own, not the agency', async () => {
  const email = n => `select "expected_email" from pennsync_private.identity_map where "auth_user_id" = '${uid(n)}'`;
  const { rows: [{ expected_email: first }] } = await db.query(email(1));
  const { rows: [{ expected_email: third }] } = await db.query(email(3));
  await seed(`insert into ${SCHEMA}.notification_preference("source_app_id","id","user_email") values
    ('${APP}','pref-1','${first}'), ('${APP}','pref-3','${third}');`);

  // 1 and 3 are both in agency-a, so an agency predicate would show each both
  // rows. A self predicate shows each only its own.
  assert.deepEqual(ids(await as(1, `select "id" from ${SCHEMA}.notification_preference`)), ['pref-1']);
  assert.deepEqual(ids(await as(3, `select "id" from ${SCHEMA}.notification_preference`)), ['pref-3']);
  await refused(1, `insert into ${SCHEMA}.notification_preference("source_app_id","id","user_email")
    values ('${APP}','pref-x','${third}')`);
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
    await db.exec('set local role authenticated');
    assert.deepEqual((await db.query(mine)).rows, [], 'a revoked membership reaches no row');
  } finally { await db.exec('rollback'); }
});

test('the roster shows colleagues and nobody else, and the row own agency label decides nothing', async () => {
  // D23. `user.agency_id`, `agency_name` and `account_type` are self-editable
  // profile labels — the entity schema says so in each field's own description
  // — so the predicate does not read them. It asks the authority store who the
  // caller shares an agency with.
  //
  // The rows below are seeded with LYING labels on purpose: the agency-b
  // person claims agency-a, and the agency-a people claim agency-b. If the
  // policy consulted the column, every assertion here would come out exactly
  // backwards.
  const rosterId = n => `6aac00000000${'0'.repeat(11)}${n}`;
  await seed(`insert into ${SCHEMA}."user"("source_app_id","id","agency_id","agency_name","account_type") values
    ('${APP}','${rosterId(1)}','agency-b','Claimed B','platform_admin'),
    ('${APP}','${rosterId(2)}','agency-b','Claimed B','platform_admin'),
    ('${APP}','${rosterId(3)}','agency-b','Claimed B','platform_admin'),
    ('${APP}','${rosterId(4)}','agency-a','Claimed A','platform_admin');`);

  // 1, 2 and 3 are in agency-a; 4 is in agency-b.
  assert.deepEqual(ids(await as(AGENCY_A, `select "id" from ${SCHEMA}."user"`)),
    [rosterId(1), rosterId(2), rosterId(3)].sort());
  assert.deepEqual(ids(await as(AGENCY_B, `select "id" from ${SCHEMA}."user"`)), [rosterId(4)]);
  // Naming the row directly does not reach it either.
  assert.deepEqual(await as(AGENCY_B, `select "id" from ${SCHEMA}."user" where "id" = $1`, [rosterId(1)]), []);

  // Writable in exactly one direction, and the three refusals do not look
  // alike, which is why all three are here. D23 left the profile-write path
  // open and D82 settled it at the caller's OWN row: `rosterId(1)` is
  // AGENCY_A's row, so AGENCY_A may correct its telephone number and nobody
  // else may — not AGENCY_B, who is on the same roster and can SEE the row,
  // which is the assertion that says sharing an agency is not owning it.
  //
  // An insert has nothing to permit it and is DENIED. An update or a delete is
  // FILTERED to the rows a policy admits: the cross-user update finds none and
  // succeeds against nothing, and the delete has no policy at all so it finds
  // none for anybody, the owner included. A test asserting only a raised error
  // would miss both, and "no rows changed" is the answer that matters.
  await refused(AGENCY_A, `insert into ${SCHEMA}."user"("source_app_id","id") values ('${APP}','6aac0000000000000000000f')`);
  assert.deepEqual(await as(AGENCY_A,
    `update ${SCHEMA}."user" set "phone" = '555' where "id" = $1 returning "id"`, [rosterId(1)]),
  [{ id: rosterId(1) }], 'a person may correct their own profile');
  assert.deepEqual(await as(AGENCY_B,
    `update ${SCHEMA}."user" set "phone" = '999' where "id" = $1 returning "id"`, [rosterId(1)]), [],
  'and nobody else may, however well they can see it');
  for (const who of [AGENCY_A, AGENCY_B]) {
    assert.deepEqual(await as(who,
      `delete from ${SCHEMA}."user" where "id" = $1 returning "id"`, [rosterId(1)]), []);
  }
  // The column half is a trigger rather than a policy, because a policy cannot
  // see `old`. `record-store-migration.test.mjs` exercises it through a real
  // broker; what belongs here is that the two mechanisms compose — the row the
  // policy admits is still refused a column the guard does not.
  await assert.rejects(() => as(AGENCY_A,
    `update ${SCHEMA}."user" set "account_type" = 'super_admin' where "id" = '${rosterId(1)}'`),
  error => error.message.includes('PENNSYNC_PROFILE_FIELD_NOT_SELF_WRITABLE: account_type'),
  'the guard raises by name rather than filtering, so the caller is told which column');
  // And the row is as it was, because every statement above ran in its own
  // rolled-back transaction — which is this file's design, so that one
  // capability's writes cannot set up the next one's reads. That the permitted
  // update returned its row is the proof it was permitted;
  // `record-store-migration.test.mjs` is where a write is left standing and
  // read back.
  assert.deepEqual(await as(AGENCY_A,
    `select "phone", "account_type" from ${SCHEMA}."user" where "id" = $1`, [rosterId(1)]),
  [{ phone: null, account_type: 'platform_admin' }]);

  // A caller whose membership is revoked is on nobody's roster — including
  // their own, because a person with no active membership is not a colleague.
  await db.exec('begin');
  try {
    await db.query(`update pennsync_private.membership set status = 'revoked',
      revoked_at = clock_timestamp(), revoked_by = $1 where id = 'membership-1'`, [uid(1)]);
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(1), session_id: sid(1), role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
    assert.deepEqual(await db.query(`select "id" from ${SCHEMA}."user"`).then(r => r.rows), []);
  } finally { await db.exec('rollback'); }

  await db.exec(`delete from ${SCHEMA}."user"`);
});

test('belonging to the agency is not the same as being a chart the caller may open', async () => {
  // D24. Until this, every member of an agency could read every patient in it.
  // `patient-a1` is assigned to identity 2's membership in the fixtures;
  // `patient-a2` is assigned to nobody.
  // From a known table, not from whatever an earlier case left behind: these
  // assert an exact set, and a stray row makes them fail for the wrong reason.
  await seed(`delete from ${SCHEMA}."document"; delete from ${SCHEMA}."patient";
    insert into ${SCHEMA}."patient"("source_app_id","id","agency_id") values
    ('${APP}','patient-a1','agency-a'), ('${APP}','patient-a2','agency-a');`);
  try {
    const charts = who => as(who, `select "id" from ${SCHEMA}."patient"`).then(ids);
    // An administrator opens every chart in their agency.
    assert.deepEqual(await charts(AGENCY_A), ['patient-a1', 'patient-a2']);
    // A clinician opens the one they are assigned to, and naming the other
    // does not reach it.
    assert.deepEqual(await charts(ASSIGNED), ['patient-a1']);
    assert.deepEqual(await as(ASSIGNED, `select "id" from ${SCHEMA}."patient" where "id" = 'patient-a2'`), []);
    // A clinician of the same agency with no assignment opens none. This is
    // the case that separates "narrowed" from "narrowed to the agency".
    assert.deepEqual(await charts(UNASSIGNED), []);
    // The other agency sees neither, as before.
    assert.deepEqual(await charts(AGENCY_B), []);
  } finally { await db.exec(`delete from ${SCHEMA}."patient"`); }
});

test('the narrowing travels with a borrowed predicate, not only with its own', async () => {
  // The defect this catches is the one a first version shipped: a reference
  // predicate inlines the target's TENANT check, so `document` reached
  // `patient` and asked only whether the patient was in the caller's agency.
  // Fifty-four tables looked narrowed and were not — every document, alert,
  // medication and note of a patient the caller was never assigned to.
  await seed(`delete from ${SCHEMA}."document_tenant_binding"; delete from ${SCHEMA}."document";
    delete from ${SCHEMA}."visit"; delete from ${SCHEMA}."patient";
    insert into ${SCHEMA}."patient"("source_app_id","id","agency_id") values
    ('${APP}','patient-a1','agency-a'), ('${APP}','patient-a2','agency-a');
    insert into ${SCHEMA}."document"("source_app_id","id","patient_id") values
    ('${APP}','doc-mine','patient-a1'), ('${APP}','doc-theirs','patient-a2');
    insert into ${SCHEMA}."document_tenant_binding"
      ("source_app_id","id","document_id","agency_id","patient_id") values
    ('${APP}','bind-mine','doc-mine','agency-a','patient-a1'),
    ('${APP}','bind-theirs','doc-theirs','agency-a','patient-a2');
    insert into ${SCHEMA}."visit"("source_app_id","id","agency_id","patient_id") values
    ('${APP}','visit-mine','agency-a','patient-a1'), ('${APP}','visit-theirs','agency-a','patient-a2');`);
  try {
    // `document` borrows its tenancy from the table that BINDS it (D27);
    // `visit` carries its own `agency_id` and its own `patient_id`. Both must
    // narrow, by different routes, and a test using only one of them would
    // prove half of it.
    assert.deepEqual(await as(AGENCY_A, `select "id" from ${SCHEMA}."document"`).then(ids),
      ['doc-mine', 'doc-theirs']);
    assert.deepEqual(await as(ASSIGNED, `select "id" from ${SCHEMA}."document"`).then(ids), ['doc-mine']);
    assert.deepEqual(await as(UNASSIGNED, `select "id" from ${SCHEMA}."document"`).then(ids), []);

    assert.deepEqual(await as(ASSIGNED, `select "id" from ${SCHEMA}."visit"`).then(ids), ['visit-mine']);
    assert.deepEqual(await as(AGENCY_A, `select "id" from ${SCHEMA}."visit"`).then(ids),
      ['visit-mine', 'visit-theirs']);

    // Writing into a chart you cannot open is the same disclosure in the other
    // direction, so the narrowing is on the write too.
    await refused(ASSIGNED, `insert into ${SCHEMA}."document"("source_app_id","id","patient_id")
      values ('${APP}','doc-intruded','patient-a2')`);
    assert.deepEqual(await as(ASSIGNED,
      `update ${SCHEMA}."visit" set "id" = "id" where "id" = 'visit-theirs' returning "id"`), []);
    // A document with no binding is in no tenant, so nobody may insert one —
    // not even into a chart they hold. D27's direction makes the ordering
    // explicit: the binding says which agency a document is in, so it has to
    // exist before the document does.
    await refused(ASSIGNED, `insert into ${SCHEMA}."document"("source_app_id","id","patient_id")
      values ('${APP}','doc-unbound','patient-a1')`);
    // With the binding in place first, into their own chart they still can.
    await db.exec(`insert into ${SCHEMA}."document_tenant_binding"
      ("source_app_id","id","document_id","agency_id","patient_id")
      values ('${APP}','bind-added','doc-added','agency-a','patient-a1')`);
    assert.deepEqual(await as(ASSIGNED, `insert into ${SCHEMA}."document"("source_app_id","id","patient_id")
      values ('${APP}','doc-added','patient-a1') returning "id"`), [{ id: 'doc-added' }]);
  } finally { await db.exec(`delete from ${SCHEMA}."document_tenant_binding";
    delete from ${SCHEMA}."document"; delete from ${SCHEMA}."visit"; delete from ${SCHEMA}."patient";`); }
});

test('a row naming no chart stays with its agency, because it is not one yet', async () => {
  // A referral taken before a patient exists is intake data, not anybody's
  // chart. Hiding it from every clinician would break intake to protect a
  // chart that is not there — so a null subject is agency-scoped on purpose,
  // and this is the assertion that says so out loud rather than leaving it to
  // be read out of a generated predicate.
  await seed(`delete from ${SCHEMA}."referral"; delete from ${SCHEMA}."patient";
    insert into ${SCHEMA}."patient"("source_app_id","id","agency_id") values
    ('${APP}','patient-a2','agency-a');
    insert into ${SCHEMA}."referral"("source_app_id","id","agency_id","patient_id") values
    ('${APP}','ref-intake','agency-a',null), ('${APP}','ref-linked','agency-a','patient-a2');`);
  try {
    assert.deepEqual(await as(UNASSIGNED, `select "id" from ${SCHEMA}."referral"`).then(ids), ['ref-intake'],
      'the unlinked referral is visible, the one naming a chart is not');
    assert.deepEqual(await as(AGENCY_A, `select "id" from ${SCHEMA}."referral"`).then(ids),
      ['ref-intake', 'ref-linked']);
    // The other agency sees neither, so "null subject" widens within one
    // agency and never across two.
    assert.deepEqual(await as(AGENCY_B, `select "id" from ${SCHEMA}."referral"`).then(ids), []);
  } finally { await db.exec(`delete from ${SCHEMA}."referral"; delete from ${SCHEMA}."patient";`); }
});

test('a revoked assignment closes the chart, and every table that hangs off it', async () => {
  await seed(`delete from ${SCHEMA}."document_tenant_binding"; delete from ${SCHEMA}."document";
    delete from ${SCHEMA}."patient";
    insert into ${SCHEMA}."patient"("source_app_id","id","agency_id") values
    ('${APP}','patient-a1','agency-a');
    insert into ${SCHEMA}."document"("source_app_id","id","patient_id") values ('${APP}','doc-1','patient-a1');
    insert into ${SCHEMA}."document_tenant_binding"
      ("source_app_id","id","document_id","agency_id","patient_id")
      values ('${APP}','bind-1','doc-1','agency-a','patient-a1');`);
  try {
    assert.deepEqual(await as(ASSIGNED, `select "id" from ${SCHEMA}."document"`).then(ids), ['doc-1']);
    await db.exec('begin');
    try {
      // A COHERENT revocation, which is more than `status`: D33's lifecycle
      // check refuses a row claiming to be both a grant and revoked, so a test
      // reaching around the contract reaches the state the contract produces.
      await db.query(`update pennsync_private.chart_assignment
        set status = 'revoked', last_action = 'revoke', last_reason = 'test withdrawal',
          revoked_at = clock_timestamp(), version = version + 1
        where patient_id = 'patient-a1' and membership_id = 'membership-2'`);
      await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
        sub: uid(ASSIGNED), session_id: sid(ASSIGNED), role: 'authenticated',
        exp: Math.floor(Date.now() / 1000) + 3600,
      })]);
      await db.exec('set local role authenticated');
      assert.deepEqual((await db.query(`select "id" from ${SCHEMA}."patient"`)).rows, []);
      assert.deepEqual((await db.query(`select "id" from ${SCHEMA}."document"`)).rows, [],
        'the chart closing must close what hangs off it too');
    } finally { await db.exec('rollback'); }
  } finally { await db.exec(`delete from ${SCHEMA}."document_tenant_binding";
    delete from ${SCHEMA}."document"; delete from ${SCHEMA}."patient";`); }
});

test('a document bound to an agency and no patient belongs to that agency', async () => {
  // D27's case, and the reason `document` stopped borrowing from `patient`. A
  // referral document exists before an intake becomes a patient: its binding
  // names an agency and no chart. Reading it through `document.patient_id`
  // made it belong to nobody, so an agency administrator could not see it
  // either — which is not a narrowing anybody chose.
  await seed(`delete from ${SCHEMA}."document_tenant_binding"; delete from ${SCHEMA}."document";
    delete from ${SCHEMA}."patient";
    insert into ${SCHEMA}."document"("source_app_id","id") values ('${APP}','doc-intake');
    insert into ${SCHEMA}."document_tenant_binding"
      ("source_app_id","id","document_id","agency_id","patient_id")
      values ('${APP}','bind-intake','doc-intake','agency-a',null);`);
  try {
    for (const caller of [AGENCY_A, ASSIGNED, UNASSIGNED]) {
      assert.deepEqual(await as(caller, `select "id" from ${SCHEMA}."document"`).then(ids),
        ['doc-intake'], 'intake data stays agency-scoped, as it does for a referral');
    }
    assert.deepEqual(await as(AGENCY_B, `select "id" from ${SCHEMA}."document"`).then(ids), [],
      'and the other agency still sees none of it');
    // A document with no binding at all is in no tenant and belongs to nobody,
    // which is the same answer both authorized-read originals give: every
    // document they serve is joined to a binding.
    await db.exec(`insert into ${SCHEMA}."document"("source_app_id","id") values ('${APP}','doc-orphan')`);
    for (const caller of [AGENCY_A, AGENCY_B, ASSIGNED]) {
      assert.ok(!(await as(caller, `select "id" from ${SCHEMA}."document"`).then(ids)).includes('doc-orphan'));
    }
  } finally { await db.exec(`delete from ${SCHEMA}."document_tenant_binding";
    delete from ${SCHEMA}."document"; delete from ${SCHEMA}."patient";`); }
});

test('creating a chart is not narrowed to a chart that does not exist yet', async () => {
  // D24 narrows a chart to its care team, and on every table but one that
  // applies to the write as much as the read: filing a note against a
  // stranger's record is the same disclosure in the other direction.
  //
  // `patient` is the exception, and it is not a judgement call. Its subject IS
  // its identity, so the row being inserted is the chart, and
  // `caller_assigned_patients` can never contain an id that does not exist
  // yet. Applied there the predicate narrows nothing — it makes creating a
  // patient impossible for anybody who does not already open every chart in
  // the agency, which measured exactly that way: the admin could and the
  // clinician could not, while the Base44 original admits `agency_admin`,
  // `manager` AND `clinician` to `PATIENT_CREATE_ROLES`.
  await seed(`delete from ${SCHEMA}."document_tenant_binding"; delete from ${SCHEMA}."document";
    delete from ${SCHEMA}."visit"; delete from ${SCHEMA}."patient";
    insert into ${SCHEMA}."patient"("source_app_id","id","agency_id") values
    ('${APP}','patient-a1','agency-a'), ('${APP}','patient-a2','agency-a');`);
  try {
    // Every role that holds the agency may create a chart in it. The clinician
    // is assigned to patient-a1 only; the third caller is assigned to nothing.
    for (const [caller, id] of [[AGENCY_A, 'made-by-admin'], [ASSIGNED, 'made-by-clinician'],
      [UNASSIGNED, 'made-by-unassigned']]) {
      assert.deepEqual(await as(caller, `insert into ${SCHEMA}."patient"
        ("source_app_id","id","agency_id") values ('${APP}','${id}','agency-a')`), [],
      `${id} must be creatable`);
    }
    // Tenancy still applies: the new row must name an agency the caller holds.
    await refused(ASSIGNED, `insert into ${SCHEMA}."patient"("source_app_id","id","agency_id")
      values ('${APP}','made-elsewhere','agency-b')`);

    // The exemption is the INSERT alone, and `returning` is where that becomes
    // visible: it is a read of the row the statement just wrote, so the read
    // policy decides it. A caller who opens every chart gets the row back; one
    // who does not is refused — and PostgreSQL reports that as a WITH CHECK
    // violation, which reads like the insert was rejected and was not. The
    // insert above, without `returning`, succeeds for the same caller.
    //
    // So a clinician can create a patient and cannot then open it. That gap is
    // real: the Base44 original records a `patient_creator` care-team
    // assignment as part of creating, and the equivalent here is a write to
    // `pennsync_private`, a schema the record owner deliberately cannot touch.
    // It needs a decision about how one capability writes to both stores, not
    // a wider predicate. Pinned here so the day it is closed, this fails.
    assert.deepEqual(await as(AGENCY_A, `insert into ${SCHEMA}."patient"
      ("source_app_id","id","agency_id") values ('${APP}','returned','agency-a') returning "id"`),
    [{ id: 'returned' }], 'an agency_admin reads back what they created');
    await refused(ASSIGNED, `insert into ${SCHEMA}."patient"("source_app_id","id","agency_id")
      values ('${APP}','not-returned','agency-a') returning "id"`);

    // Reading, updating and deleting a chart are all still narrowed.
    assert.deepEqual(await as(ASSIGNED, `select "id" from ${SCHEMA}."patient"`).then(ids),
      ['patient-a1'], 'creating a chart does not open it');
    assert.deepEqual(await as(ASSIGNED,
      `update ${SCHEMA}."patient" set "id" = "id" where "id" = 'patient-a2' returning "id"`), []);
    // And every other table keeps the narrowing on the write, because there
    // the subject names a chart that already exists.
    await db.exec(`insert into ${SCHEMA}."document_tenant_binding"
      ("source_app_id","id","document_id","agency_id","patient_id")
      values ('${APP}','bind-x','doc-x','agency-a','patient-a2')`);
    await refused(ASSIGNED, `insert into ${SCHEMA}."document"("source_app_id","id","patient_id")
      values ('${APP}','doc-x','patient-a2')`);
    await refused(ASSIGNED, `insert into ${SCHEMA}."visit"("source_app_id","id","agency_id","patient_id")
      values ('${APP}','visit-x','agency-a','patient-a2')`);
  } finally { await db.exec(`delete from ${SCHEMA}."document_tenant_binding";
    delete from ${SCHEMA}."document"; delete from ${SCHEMA}."visit"; delete from ${SCHEMA}."patient";`); }
});

test('a row its own schema calls append-only cannot be rewritten by anybody', async () => {
  // Four entity descriptions say the ROW is immutable or append-only, and the
  // store carries that by having NO update and NO delete policy — the same
  // absence the activity trail and the roster rely on. Demonstrated rather
  // than described, because a permissive-looking policy that evaluates false
  // is one edit away from being true and this is not that.
  await seed(`insert into ${SCHEMA}.patient("source_app_id","id","agency_id") values
    ('${APP}','patient-note-a','agency-a') on conflict do nothing;
    insert into ${SCHEMA}.visit("source_app_id","id","agency_id","patient_id") values
    ('${APP}','visit-note-a','agency-a','patient-note-a') on conflict do nothing;
    insert into ${SCHEMA}.patient_note_history_entry
      ("source_app_id","id","agency_id","patient_id","visit_id","note")
      values ('${APP}','note-a','agency-a','patient-note-a','visit-note-a','First revision');`);
  await seed(`insert into pennsync_private.chart_assignment
    (app_id,agency_id,patient_id,membership_id,status,changed_by)
    values ('${APP}','agency-a','patient-note-a','membership-1',
      'active','${uid(AGENCY_A)}') on conflict do nothing;`);

  // The caller reads it and appends beside it, which is what an append-only
  // log is for.
  assert.deepEqual(ids(await as(AGENCY_A,
    `select "id" from ${SCHEMA}.patient_note_history_entry`)), ['note-a']);
  assert.deepEqual(await as(AGENCY_A,
    `insert into ${SCHEMA}.patient_note_history_entry
      ("source_app_id","id","agency_id","patient_id","visit_id","note")
      values ('${APP}','note-b','agency-a','patient-note-a','visit-note-a','Second revision')
      returning "id"`), [{ id: 'note-b' }]);
  // And cannot rewrite or remove one. The shape of the refusal is worth being
  // exact about: an operation with NO policy matches no rows rather than
  // raising, so the statement succeeds and changes nothing. The row is equally
  // unchangeable either way, and the caller is not told it exists — which is
  // the better of the two answers.
  assert.deepEqual(await as(AGENCY_A,
    `update ${SCHEMA}.patient_note_history_entry set "note" = 'rewritten'
     where "id" = 'note-a' returning "id"`), []);
  assert.deepEqual(await as(AGENCY_A,
    `delete from ${SCHEMA}.patient_note_history_entry where "id" = 'note-a' returning "id"`), []);
  assert.deepEqual((await db.query(
    `select "note" from ${SCHEMA}.patient_note_history_entry where "id" = 'note-a'`)).rows,
  [{ note: 'First revision' }]);
  // The other half — that the role which OWNS the table is bound too, which is
  // the load-bearing one because every contract runs as it — needs the owner
  // role to exist. This file applies the DDL without the migration's role
  // wrapper, so `record-contract-postgres.test.mjs` proves it on a real
  // PostgreSQL where the role is there.
  // A mutable clinical table beside it still updates, so this is the schema's
  // claim taking effect rather than something global.
  assert.deepEqual(await as(AGENCY_A,
    `update ${SCHEMA}.visit set "visit_time" = '09:00' where "id" = 'visit-note-a' returning "id"`),
  [{ id: 'visit-note-a' }]);
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
    await db.exec('set local role authenticated');
    const { rows } = await db.query(`select "id" from ${SCHEMA}.supply_item`);
    assert.deepEqual(rows, [], 'no JWT means no membership, so no row');
  } finally { await db.exec('rollback'); }
});
