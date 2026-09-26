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
 * The data-quality audit (`contract_data_quality_audit`).
 *
 * The property worth the file: **the original's agency scope was derived and
 * this one is not.** It fetched every patient, user, visit and credential in
 * the deployment and rebuilt "which are mine" from `agency_name` strings,
 * `created_by` addresses and `assigned_nurses` arrays — and its own comment
 * records that the first version of that filter leaked one tenant's patient
 * names into every other tenant's report. The test seeds exactly that shape:
 * a patient in agency B created by agency A's admin and carrying agency A's
 * clinician in `assigned_nurses`. The original's filter would have counted it
 * as agency A's. The policy does not.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const QUALITY = 'services/authority-store/supabase/record-migrations/'
  + '20260920260000_contract_data_quality.sql';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const b44 = n => `6aac00000000${String(n).padStart(12, '0')}`;
const email = n => ['', 'admin-a', 'clinician-a', 'clinician-empty', 'admin-b'][n]
  + '@example.invalid';
const ADMIN_A = 1; const CLINICIAN_A = 2; const ADMIN_B = 4;
const AUDIT = 'select "public"."pennsync_contract_data_quality_audit"($1) as result';
const A = 'agency-a'; const B = 'agency-b';
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, QUALITY]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));

  const patient = (id, agency, complete, extra = {}) => db.query(
    `insert into ${SCHEMA}."patient"
      ("source_app_id","id","agency_id","status","is_sample","is_archived",
       "first_name","last_name","emergency_contact_name","emergency_contact_phone",
       "physician_name","phone","date_of_birth","created_by","assigned_nurses")
     values ($1,$2,$3,'active',false,false,'Ada','Lovelace',$4,$5,$6,$7,$8,$9,$10)`,
    [APP, id, agency,
      complete ? 'Kin' : null, complete ? '555-0100' : null,
      complete ? 'Dr Who' : null, complete ? '555-0101' : '',
      complete ? '1950-01-01' : null,
      extra.created_by ?? email(ADMIN_A),
      JSON.stringify(extra.assigned_nurses ?? [])]);
  await patient('p-complete', A, true);
  await patient('p-thin', A, false);
  // The cross-agency trap. Agency B's patient, created by agency A's admin and
  // naming agency A's clinician in `assigned_nurses` — which is exactly what
  // the original's filter matched on.
  await patient('p-elsewhere', B, false,
    { created_by: email(ADMIN_A), assigned_nurses: [email(CLINICIAN_A)] });

  const visit = (id, agency, patientId, complete) => db.query(
    `insert into ${SCHEMA}."visit"
      ("source_app_id","id","agency_id","patient_id","status","visit_date",
       "nurse_notes","homebound_justification","vital_signs")
     values ($1,$2,$3,$4,'completed','2026-09-01',$5,$6,$7)`,
    [APP, id, agency, patientId,
      complete ? 'n'.repeat(120) : 'too short',
      complete ? 'bed bound' : '',
      // An empty object is TRUTHY in JavaScript, which is the bug the
      // original's own comment records; it must count as missing.
      complete ? JSON.stringify({ bp: '120/80' }) : JSON.stringify({})]);
  await visit('v-complete', A, 'p-complete', true);
  await visit('v-thin', A, 'p-thin', false);
  await visit('v-elsewhere', B, 'p-elsewhere', false);

  // Carried profiles. The clinician's is complete; the admin's is not.
  await db.query(`insert into ${SCHEMA}."user"
    ("source_app_id","id","phone","care_scope","credential_type")
    values ($1,$2,'555-0200','skilled_nursing','RN')`, [APP, b44(CLINICIAN_A)]);
  // The admin's two gaps are NAMED as nulls rather than left out of the insert.
  // `credential_type` carries a schema default of 'RN', so omitting the column
  // would store that value and the completeness rule below would be asserting
  // against a field that is present -- passing or failing for a reason with
  // nothing to do with the rule. D107: arrange the precondition, do not rely on
  // it holding.
  await db.query(`insert into ${SCHEMA}."user"
    ("source_app_id","id","phone","care_scope","credential_type")
    values ($1,$2,'555-0201',null,null)`, [APP, b44(ADMIN_A)]);
  // One credential, for the clinician only.
  await db.query(`insert into ${SCHEMA}."personnel_credential"
    ("source_app_id","id","agency_id","user_id","title","status")
    values ($1,'cred-1',$2,$3,'RN Licence','approved')`, [APP, A, email(CLINICIAN_A)]);
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
const audit = (n, agency = A) => as(n, AUDIT, [agency]);
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);

test('only the agency administrator may audit, and only their own agency', async () => {
  // D40's gate: the original admits the built-in admin and nobody else.
  await refusal(audit(CLINICIAN_A), 'PENNSYNC_QUALITY_FORBIDDEN');
  await refusal(audit(ADMIN_A, B), 'PENNSYNC_QUALITY_FORBIDDEN');
  assert.ok((await audit(ADMIN_A)).summary);
  assert.ok((await audit(ADMIN_B, B)).summary);
});

test('the cross-agency leak the original s own comment records cannot happen', async () => {
  const result = await audit(ADMIN_A);
  const ids = result.patient_issues.map(row => row.id);
  // `p-elsewhere` is agency B's, created by agency A's admin and naming agency
  // A's clinician in `assigned_nurses`. The original matched a patient on
  // exactly those two things, so it would have counted this one.
  assert.equal(ids.includes('p-elsewhere'), false);
  assert.deepEqual(ids, ['p-thin']);
  assert.equal(result.summary.total_patients, 2);
  // And agency B sees its own and not agency A's.
  const other = await audit(ADMIN_B, B);
  assert.deepEqual(other.patient_issues.map(row => row.id), ['p-elsewhere']);
  assert.equal(other.summary.total_patients, 1);
  assert.equal(other.visit_issues.every(row => row.id === 'v-elsewhere'), true);
});

test('the completeness rules are the original s, empty object included', async () => {
  const result = await audit(ADMIN_A);
  const [thin] = result.patient_issues;
  assert.deepEqual(thin.missing_fields.sort(), ['date_of_birth', 'emergency_contact_name',
    'emergency_contact_phone', 'phone', 'physician_name'].sort());
  assert.equal(thin.completeness_score, 0);
  assert.equal(thin.critical, true);
  assert.equal(thin.name, 'Ada Lovelace');

  const visit = result.visit_issues.find(row => row.id === 'v-thin');
  // `nurse_notes` is missing below a hundred characters rather than when
  // empty, and `vital_signs: {}` counts as missing although it is truthy in
  // JavaScript — the original's own note.
  assert.deepEqual(visit.missing_fields.sort(),
    ['homebound_justification', 'nurse_notes', 'vital_signs']);
  assert.equal(visit.critical, true, 'a missing homebound justification is critical');
  assert.equal(result.visit_issues.some(row => row.id === 'v-complete'), false);
});

test('the audited people are the roster, and the address is the verified one', async () => {
  const result = await audit(ADMIN_A);
  // Three active members of agency A. The admin's profile is missing two of
  // three fields; the spare clinician has no carried profile at all, so all
  // three are missing.
  assert.equal(result.summary.total_users, 3);
  const admin = result.user_issues.find(row => row.email === email(ADMIN_A));
  assert.deepEqual(admin.missing_fields.sort(), ['care_scope', 'credential_type']);
  assert.equal(admin.critical, true);
  // The clinician's profile is complete, so they are not an issue.
  assert.equal(result.user_issues.some(row => row.email === email(CLINICIAN_A)), false);
  // The address comes from the authority store; the carried table has no
  // email column at all.
  assert.ok(result.user_issues.every(row => row.email.endsWith('@example.invalid')));
  // Credential coverage: only the clinician has one.
  assert.equal(result.summary.users_without_credentials, 2);
  assert.equal(result.credential_coverage.some(row => row.email === email(CLINICIAN_A)), false);
});

test('an empty population reports zero rather than NaN', async () => {
  // The original added its `pct` guard because a tenant with no completed
  // visits emitted the string "NaN" into the dashboard.
  await db.exec(`delete from ${SCHEMA}."visit" where "agency_id" = '${B}'`);
  await db.exec(`delete from ${SCHEMA}."patient" where "agency_id" = '${B}'`);
  const result = await audit(ADMIN_B, B);
  assert.equal(result.summary.total_visits, 0);
  assert.equal(result.summary.visit_completeness, '0.0');
  assert.equal(result.summary.total_patients, 0);
  assert.equal(result.summary.patient_completeness, '0.0');
  assert.deepEqual(result.patient_issues, []);
  assert.equal(String(result.summary.patient_completeness).includes('NaN'), false);
  // A complete population reports a hundred.
  assert.equal((await audit(ADMIN_A)).summary.patient_completeness, '50.0');
});
