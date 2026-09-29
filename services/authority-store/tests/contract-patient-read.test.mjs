import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { RECORD_MIGRATION_FILE, SCHEMA } from '../../../tools-entity-schema-plan.mjs';
import { BROKER_MIGRATION_FILE } from '../../../tools-record-brokers.mjs';
import { POLICY_SQL_FILES } from '../../../tools-read-purpose-policy.mjs';
import { applyRecordMigrations, recordMigrationNames } from './record-migrations.mjs';
import {
  PATIENT_EXACT_PURPOSE_POLICY, PATIENT_LIST_PURPOSE_POLICY,
} from '../../pennsync-api/read-purpose-policy.mjs';

/**
 * The authorized patient read (`contract_patient_list` / `contract_patient_get`).
 *
 * Two authorizations apply to every answer here and the tests are arranged
 * around keeping them apart, because either one alone looks sufficient and is
 * not:
 *
 * - **Which rows** is RLS. Tenancy from `caller_agencies()`, and D24's chart
 *   narrowing on top of it — an `agency_admin` opens every chart in their
 *   agency, a `clinician` opens the ones they are assigned to.
 * - **Which fields, and who may ask at all** is the purpose. A clinician
 *   assigned to a chart may open it; that does not make them entitled to pull
 *   the agency's contact details under the `contact` purpose, or anybody's
 *   date of birth under `identity_match`.
 *
 * So the fixture deliberately gives the clinician one assignment and the admin
 * none — the admin sees more rows anyway — and every projection assertion
 * names the field that must NOT be there rather than only the ones that must.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const CONTRACT = 'services/authority-store/supabase/record-migrations/20260920060000_contract_patient_read.sql';
/**
 * The files whose BEHAVIOUR this suite measures. They no longer decide what is
 * applied — the store is the whole record directory now, so a forward migration
 * over this contract is in the build the moment it is committed (D88) — and the
 * `before` block asserts each was applied, which is all this list does.
 *
 * **Measured, so the assertion is credited with exactly what it does, and it
 * does two different things.** Omitting a measured FILE from the build cannot
 * reach it: the build dies earlier, in `20260920080000_contract_visit_read.sql`,
 * whose own precondition raises `PENNSYNC_RECORD_STORE_REQUIRED` when
 * `patient_purpose_gate` is absent, and the purpose policy is refused the same
 * way. For that failure the directory already fails closed, loudly, and this
 * loop is only the backstop for a directory that stops doing so.
 *
 * But a measured NAME the directory does not hold reaches it directly, and
 * that is live today rather than a backstop: the names below are derived, so
 * a rename the tool follows and the directory does not — or the reverse —
 * lands here and nowhere else. Sabotaged once to be sure rather than reasoned
 * about: pointing `CONTRACT` at a file that does not exist fails all thirteen
 * tests on `must be applied`. An earlier draft of this paragraph said neither
 * name could reach the assertion, which was true while the names were typed
 * literals beside the files they named and stopped being true the moment they
 * were derived from them.
 *
 * **A red here after somebody else's migration merges is a possible and correct
 * outcome, and the first reading is that this suite SAW something** (D149).
 * Before the swap a forward over `contract_patient_read` or the purpose policy
 * was silently absent from this build; now it is present, so a change in what
 * these tests observe is a change in what the deployed store does. Diagnose the
 * arriving migration before suspecting the conversion.
 *
 * Its corollary decides how to land such a change: a forward that flips a state
 * this file PINS, and the flip of that pin here, go in the SAME change. Split
 * across two, `main` is red in between for a reason nobody introduced.
 *
 * The names are taken from the same exports the four-file build used to read
 * the files through -- `POLICY_SQL_FILES.patient`, `CONTRACT`,
 * `RECORD_MIGRATION_FILE`, `BROKER_MIGRATION_FILE` -- rather than retyped as
 * literals beside them. A retyped basename is a second representation of a
 * path the tool already owns, and it goes stale in the one direction nothing
 * measures: the file is renamed, the tool follows it, and the loop below
 * quietly asserts the presence of a name no directory has any more.
 */
const MEASURED = Object.freeze([
  basename(POLICY_SQL_FILES.patient),
  basename(CONTRACT),
]);
/**
 * The exact four files this suite used to build from, kept for ONE purpose: the
 * control in the last test rebuilds that store so the two can be compared. It
 * is not a list anything is applied from any more, and adding a file to it
 * would widen the control rather than the store.
 */
const FORMERLY_APPLIED = Object.freeze([
  basename(RECORD_MIGRATION_FILE),
  basename(BROKER_MIGRATION_FILE),
  ...MEASURED,
]);
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** Patient ids are Base44-shaped, because the cursor and the batch require it. */
const pid = n => `7aac00000000${String(n).padStart(12, '0')}`;
const ADMIN_A = 1; const CLINICIAN_A = 2; const ADMIN_B = 4;
const LIST = 'select "public"."pennsync_contract_patient_list"($1,$2,$3,$4,$5) as result';
const BATCH = 'select "public"."pennsync_contract_patient_batch"($1,$2,$3) as result';
const GET = 'select "public"."pennsync_contract_patient_get"($1,$2,$3) as result';
const A = 'agency-a'; const B = 'agency-b';
let db;
/** The record migrations this suite's store was built from; the last test reads it. */
let applied;

/**
 * Eight in agency-a the clinician is assigned to, one they are not, one
 * sample, one archived, one merged, and one in agency-b. Every one of them
 * carries a date of birth and an address, so a purpose that must not disclose
 * them has something to fail on.
 */
const patient = (n, extra = {}) => ({
  id: pid(n), agency_id: A, status: 'active', is_sample: false, is_archived: false, ...extra,
});
const PATIENTS = [
  ...Array.from({ length: 8 }, (unused, index) => patient(index + 1)),
  patient(9),                                     // in the agency, no assignment
  patient(10, { is_sample: true }),
  patient(11, { is_archived: true }),
  patient(12, { status: 'merged' }),
  patient(13, { status: 'discharged' }),
  patient(14, { agency_id: B }),
];
/** The clinician's care team: 1..8 and 13, never 9. */
const ASSIGNED = [1, 2, 3, 4, 5, 6, 7, 8, 13];

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  // The whole record directory, in apply order, rather than the four files this
  // suite used to name. The broker family is still what grants `authenticated`
  // USAGE on the schema, and a contract reached through it still grants nothing
  // of its own; that is now true because the directory contains it rather than
  // because this file remembered to list it.
  applied = await applyRecordMigrations(db);
  for (const name of MEASURED) {
    assert.ok(applied.includes(name),
      `${name} must be applied: this suite measures its behaviour`);
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  for (const row of PATIENTS) {
    await db.query(`insert into ${SCHEMA}."patient"
      ("source_app_id","id","agency_id","status","is_sample","is_archived",
       "first_name","last_name","date_of_birth","address","phone","email",
       "medical_record_number","care_type","primary_diagnosis","updated_date")
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`, [
      APP, row.id, row.agency_id, row.status, row.is_sample, row.is_archived,
      `First${row.id.slice(-2)}`, `Last${row.id.slice(-2)}`, '1950-01-01',
      '1 Example Street', '555-0100', `p${row.id.slice(-2)}@example.invalid`,
      `MRN-${row.id.slice(-2)}`, 'home_health', 'Diagnosis', '2026-09-01T00:00:00Z',
    ]);
  }
  for (const n of ASSIGNED) {
    await db.query(`insert into pennsync_private.chart_assignment
      (app_id,agency_id,patient_id,membership_id,status,changed_by)
      values ($1,$2,$3,'membership-2','active',$4)`, [APP, A, pid(n), uid(1)]);
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
    return rows;
  } finally { await db.exec('rollback'); }
}
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);
const listAs = async (n, { agency = A, purpose = 'roster', status = null, pageSize = 25, after = null } = {}) =>
  (await as(n, LIST, [agency, purpose, status, pageSize, after]))[0].result;
const batchAs = async (n, ids, { agency = A, purpose = 'roster' } = {}) =>
  (await as(n, BATCH, [agency, purpose, ids]))[0].result;
const getAs = async (n, id, { agency = A, purpose = 'display' } = {}) =>
  (await as(n, GET, [agency, purpose, id]))[0].result;

test('the purpose decides the fields, and the ones it leaves out are absent', async () => {
  const [entry] = (await listAs(ADMIN_A, { purpose: 'roster' })).patients;
  assert.deepEqual(Object.keys(entry).sort(), [...PATIENT_LIST_PURPOSE_POLICY.roster.fields].sort(),
    'the roster projection is exactly what the original declares');
  // Named rather than left to the deepEqual above, because these two are the
  // reason a roster purpose exists separately at all.
  assert.ok(!Object.hasOwn(entry, 'date_of_birth'), 'a roster must not disclose a date of birth');
  assert.ok(!Object.hasOwn(entry, 'address'));

  const [contact] = (await listAs(ADMIN_A, { purpose: 'contact' })).patients;
  assert.deepEqual(Object.keys(contact).sort(), [...PATIENT_LIST_PURPOSE_POLICY.contact.fields].sort());
  assert.equal(contact.phone, '555-0100');
  assert.ok(!Object.hasOwn(contact, 'date_of_birth'), 'contact details are not identity');

  const [identity] = (await listAs(ADMIN_A, { purpose: 'identity_match' })).patients;
  assert.deepEqual(Object.keys(identity).sort(), [...PATIENT_LIST_PURPOSE_POLICY.identity_match.fields].sort());
  assert.equal(identity.date_of_birth, '1950-01-01');
  // Matching an identity needs the identifiers and nothing about the care:
  // no email to write to, no status, no diagnosis.
  for (const field of ['email', 'status', 'primary_diagnosis', 'care_type']) {
    assert.ok(!Object.hasOwn(identity, field), `identity_match must not disclose ${field}`);
  }
});

test('the purpose decides who may ask, on top of the chart they may open', async () => {
  // The clinician is assigned to patient 1 and may open it under a purpose
  // their role is admitted to.
  assert.ok((await listAs(CLINICIAN_A, { purpose: 'roster' })).patients.length > 0);
  // And is refused the two purposes the original reserves for an agency_admin
  // or manager, on the same charts they can otherwise open.
  for (const purpose of ['identity_match', 'data_quality']) {
    await refusal(listAs(CLINICIAN_A, { purpose }), 'PENNSYNC_PATIENT_FORBIDDEN');
    await refusal(batchAs(CLINICIAN_A, [pid(1)], { purpose }), 'PENNSYNC_PATIENT_FORBIDDEN');
    assert.ok((await listAs(ADMIN_A, { purpose })).patients.length > 0, `${purpose} is an admin purpose`);
  }
  // A purpose nobody declared is refused before anything is read, and refused
  // the same way for a caller who could have read something.
  await refusal(listAs(ADMIN_A, { purpose: 'export' }), 'PENNSYNC_PATIENT_PURPOSE_INVALID');
});

test('the agency is asked of the authority store, and a stranger is refused rather than emptied', async () => {
  const mine = await listAs(ADMIN_A, { pageSize: 50 });
  assert.ok(!mine.patients.some(row => row.id === pid(14)), 'agency-b is not in agency-a');
  assert.deepEqual((await listAs(ADMIN_B, { agency: B, pageSize: 50 })).patients.map(row => row.id), [pid(14)]);
  // A refusal, not an empty list: an empty list would confirm the agency
  // exists and say it has nobody in it.
  await refusal(listAs(ADMIN_B, { agency: A }), 'PENNSYNC_PATIENT_AGENCY_NOT_HELD');
  await refusal(batchAs(ADMIN_B, [pid(1)], { agency: A }), 'PENNSYNC_PATIENT_AGENCY_NOT_HELD');
  // And the batch cannot reach across either, even naming an id that exists.
  assert.deepEqual((await batchAs(ADMIN_A, [pid(14)])).patients, []);
});

test('D24 narrows the agency to the care team, and the contract does not widen it', async () => {
  const admin = (await listAs(ADMIN_A, { pageSize: 50 })).patients.map(row => row.id);
  const clinician = (await listAs(CLINICIAN_A, { pageSize: 50 })).patients.map(row => row.id);
  // 9 is in the agency and on nobody's care team. The admin opens every chart;
  // the clinician opens the nine they are assigned to, of which 13 is
  // discharged and still theirs.
  assert.ok(admin.includes(pid(9)), 'an agency_admin opens every chart');
  assert.ok(!clinician.includes(pid(9)), 'a clinician opens only their own');
  assert.deepEqual(clinician, ASSIGNED.map(pid).sort());
  // The batch answers by the same authority, and an unreachable chart is
  // skipped rather than refused: refusing would confirm the id names a real
  // patient somewhere.
  assert.deepEqual((await batchAs(CLINICIAN_A, [pid(9), pid(1)])).patients.map(row => row.id), [pid(1)]);
});

test('sample, archived and merged rows are never a roster', async () => {
  const listed = (await listAs(ADMIN_A, { pageSize: 50 })).patients.map(row => row.id);
  for (const n of [10, 11, 12]) {
    assert.ok(!listed.includes(pid(n)), `${pid(n)} must not be listed`);
    assert.deepEqual((await batchAs(ADMIN_A, [pid(n)])).patients, [], `${pid(n)} must not be fetched`);
  }
  // A merged duplicate in the agency does not make the rest unreadable, which
  // is the one place this answers better than the original rather than the
  // same: it rejects the whole page on a row like this.
  assert.equal(listed.length, 10);
  // The status filter is the visible set and nothing else.
  assert.deepEqual((await listAs(ADMIN_A, { status: 'discharged', pageSize: 50 })).patients
    .map(row => row.id), [pid(13)]);
  for (const status of ['merged', 'archived', 'deleted']) {
    await refusal(listAs(ADMIN_A, { status }), 'PENNSYNC_PATIENT_STATUS_INVALID');
  }
});

test('the page is bounded by the purpose, and an over-large page is refused rather than clamped', async () => {
  // `contact` bounds a page at 25 and `roster` at 50. A clamp would answer a
  // different question than the one asked and not say so.
  assert.equal(PATIENT_LIST_PURPOSE_POLICY.contact.page_size, 25);
  await refusal(listAs(ADMIN_A, { purpose: 'contact', pageSize: 26 }), 'PENNSYNC_PATIENT_PAGE_SIZE_INVALID');
  assert.ok((await listAs(ADMIN_A, { purpose: 'contact', pageSize: 25 })).patients.length > 0);
  assert.ok((await listAs(ADMIN_A, { purpose: 'roster', pageSize: 50 })).patients.length > 0);
  for (const pageSize of [0, -1, null]) {
    await refusal(listAs(ADMIN_A, { pageSize }), 'PENNSYNC_PATIENT_PAGE_SIZE_INVALID');
  }
});

test('the walk tiles the agency without repeating or dropping anybody', async () => {
  const seen = [];
  let after = null;
  for (let page = 0; page < 10; page += 1) {
    const result = await listAs(ADMIN_A, { pageSize: 3, after });
    seen.push(...result.patients.map(row => row.id));
    after = result.next;
    if (after === null) break;
  }
  assert.equal(after, null, 'the walk ends');
  assert.deepEqual(seen, [...new Set(seen)], 'nobody is repeated');
  assert.deepEqual(seen, (await listAs(ADMIN_A, { pageSize: 50 })).patients.map(row => row.id),
    'and the walk is the whole agency');
  // A full last page does not invent another: `next` is set from having looked
  // one row further, not from the page being full.
  const exact = await listAs(ADMIN_A, { pageSize: 10 });
  assert.equal(exact.patients.length, 10);
  assert.equal(exact.next, null, 'a page that exactly finishes the agency has no continuation');
});

test('a continuation that no longer names a visible row is refused, not quietly restarted', async () => {
  await refusal(listAs(ADMIN_A, { after: 'not-an-id' }), 'PENNSYNC_PATIENT_CURSOR_INVALID');
  // Well-formed and nobody's: the case in practice is a chart revoked or
  // discharged between two pages. Answering from the start would repeat every
  // patient already seen; answering nothing would report an agency of ten as
  // an agency of three.
  await refusal(listAs(ADMIN_A, { after: pid(99) }), 'PENNSYNC_PATIENT_CURSOR_UNKNOWN');
  // Visible to the admin, invisible to the clinician: the refusal follows the
  // caller, not the row.
  assert.ok((await listAs(ADMIN_A, { after: pid(9), pageSize: 3 })).patients.length > 0);
  await refusal(listAs(CLINICIAN_A, { after: pid(9) }), 'PENNSYNC_PATIENT_CURSOR_UNKNOWN');
  // And it follows the filter: 13 is discharged, so it cannot continue an
  // active-only walk even though the same caller can see it unfiltered.
  assert.ok((await listAs(ADMIN_A, { after: pid(13), pageSize: 3 })).patients !== undefined);
  await refusal(listAs(ADMIN_A, { after: pid(13), status: 'active' }), 'PENNSYNC_PATIENT_CURSOR_UNKNOWN');
});

test('the id batch answers in the order asked, and refuses a batch nobody could mean', async () => {
  const asked = [pid(5), pid(1), pid(3)];
  assert.deepEqual((await batchAs(ADMIN_A, asked)).patients.map(row => row.id), asked,
    'a caller lining answers up against their own list gets them in that order');
  for (const ids of [[], null, Array.from({ length: 26 }, (unused, index) => pid(index + 1))]) {
    await refusal(batchAs(ADMIN_A, ids), 'PENNSYNC_PATIENT_SUBJECT_INVALID');
  }
  // A duplicate id is a request whose answer has no shape: one row or two?
  await refusal(batchAs(ADMIN_A, [pid(1), pid(1)]), 'PENNSYNC_PATIENT_SUBJECT_INVALID');
  await refusal(batchAs(ADMIN_A, [pid(1), 'nope']), 'PENNSYNC_PATIENT_SUBJECT_INVALID');
  await refusal(batchAs(ADMIN_A, [pid(1), null]), 'PENNSYNC_PATIENT_SUBJECT_INVALID');
});

test('no caller role may reach the policy or the gate; the contracts are the way in', async () => {
  const { rows } = await db.query(`select p.proname, r.rolname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join unnest(array['anon','authenticated','service_role','public']) as r(rolname)
    where n.nspname = $1 and p.proname in
      ('patient_list_purpose_row','patient_list_purpose_admits','patient_list_purpose_page_size',
       'patient_list_purpose_known','patient_exact_purpose_row','patient_exact_purpose_admits',
       'patient_exact_purpose_known','patient_purpose_gate','patient_listable_status')
      and has_function_privilege(r.rolname, p.oid, 'execute')`, [SCHEMA]);
  assert.deepEqual(rows, [], 'the policy and the gate answer to the contract alone');
  // And the two contracts are reachable, or the capability would be unusable
  // for a reason no test would otherwise name.
  for (const name of ['pennsync_contract_patient_list', 'pennsync_contract_patient_batch',
    'pennsync_contract_patient_get']) {
    const { rows: granted } = await db.query(
      `select has_function_privilege('authenticated', p.oid, 'execute') as ok
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = $1`, [name]);
    assert.deepEqual(granted.map(row => row.ok), [true], name);
  }
});

test('one chart is opened under its own vocabulary, never the list one', async () => {
  // `display` and `smart_note_context` belong to `getAuthorizedPatient`;
  // `roster` and `contact` belong to the list. Neither contract answers for
  // the other's purposes, so a caller cannot reach a single-chart projection
  // by naming it on a list — or pull an agency-wide field list one row at a
  // time by naming a list purpose here.
  const display = await getAs(CLINICIAN_A, pid(1), { purpose: 'display' });
  assert.deepEqual(Object.keys(display).sort(),
    [...PATIENT_EXACT_PURPOSE_POLICY.display.fields].sort());
  await refusal(getAs(ADMIN_A, pid(1), { purpose: 'roster' }), 'PENNSYNC_PATIENT_PURPOSE_INVALID');
  await refusal(listAs(ADMIN_A, { purpose: 'display' }), 'PENNSYNC_PATIENT_PURPOSE_INVALID');
  await refusal(batchAs(ADMIN_A, [pid(1)], { purpose: 'display' }), 'PENNSYNC_PATIENT_PURPOSE_INVALID');

  // The clinical purposes carry real chart content, and are the ones a
  // social worker or spiritual care worker is not admitted to.
  const note = await getAs(CLINICIAN_A, pid(1), { purpose: 'smart_note_context' });
  assert.deepEqual(Object.keys(note).sort(),
    [...PATIENT_EXACT_PURPOSE_POLICY.smart_note_context.fields].sort());
  assert.ok(Object.hasOwn(note, 'current_medications') && Object.hasOwn(note, 'allergies'));
  assert.ok(!PATIENT_EXACT_PURPOSE_POLICY.smart_note_context.roles.includes('social_worker'),
    'the original reserves the clinical context, and the port must too');
});

test('a chart that is not there and one that is not yours answer identically', async () => {
  // Null either way, because a refusal that distinguished them would confirm
  // that an id names a real patient in an agency the caller cannot see.
  assert.equal(await getAs(ADMIN_A, pid(99)), null, 'no such patient');
  assert.equal(await getAs(CLINICIAN_A, pid(9)), null, 'in the agency, not on their care team');
  assert.equal(await getAs(ADMIN_A, pid(14)), null, 'another agency');
  for (const n of [10, 11, 12]) {
    assert.equal(await getAs(ADMIN_A, pid(n)), null, `${pid(n)} is sample, archived or merged`);
  }
  assert.notEqual(await getAs(ADMIN_A, pid(9)), null, 'an agency_admin opens every chart');
  // A malformed id is a refusal rather than a null: nothing about a patient
  // is being disclosed by saying an id is not an id.
  await refusal(getAs(ADMIN_A, 'not-an-id'), 'PENNSYNC_PATIENT_SUBJECT_INVALID');
  await refusal(getAs(ADMIN_A, null), 'PENNSYNC_PATIENT_SUBJECT_INVALID');
  // And the agency is still asked of the authority store first.
  await refusal(getAs(ADMIN_B, pid(1)), 'PENNSYNC_PATIENT_AGENCY_NOT_HELD');
});

test('the swap widened the store and left this contract reachable unchanged', async () => {
  // D127's question, asked about THIS contract rather than answered from the
  // file list: does building from the whole record directory change what the
  // capability exposes?
  //
  // Measured before the swap, per file rather than as a group. Nothing later in
  // the directory redefines any of the eight functions these two files declare
  // -- `20260920080000_contract_visit_read.sql` names `patient_purpose_gate`,
  // and only inside a `to_regprocedure(...) is null` precondition. The one later
  // statement that touches anything this contract reads is
  // `20260920590000_column_defaults.sql`, which sets defaults on four `patient`
  // columns; every fixture row above supplies all four explicitly, so no insert
  // here reaches a default. That is the STRONG case, and the strong case is the
  // one that needs a control, because "nothing moved" and "the instrument cannot
  // see movement" read identically.
  assert.deepEqual(applied, await recordMigrationNames(),
    'the store under test is every file in the record directory, in apply order');
  assert.deepEqual(FORMERLY_APPLIED.filter(name => !applied.includes(name)), [],
    'every file the four-file build applied is still applied');

  // The population is derived from what the measured files DECLARE, never from
  // a name pattern. A pattern has to be tuned wide enough to catch everything
  // and narrow enough to exclude the neighbours, and it can be wrong in either
  // direction while staying green -- on `activity-audit`, `%activity_%` matches
  // exactly the right four in today's directory, so the wrong instrument was
  // green there. Declarations remove the question instead of answering it.
  const DECLARATION = /create\s+(?:or\s+replace\s+)?function\s+"?([a-z_][a-z0-9_]*)"?\s*\.\s*"?([a-z_][a-z0-9_]*)"?\s*\(/gi;
  const declared = [...new Set(MEASURED.flatMap(name => [...readFileSync(
    resolve(repository, 'services/authority-store/supabase/record-migrations', name), 'utf8')
    .matchAll(DECLARATION)].map(([, schema, fn]) => `${schema}.${fn}`)))].sort();
  assert.ok(declared.includes('pennsync_records.contract_patient_list')
    && declared.includes('public.pennsync_contract_patient_list'),
    'the parser reads both declaration spellings the measured files use: '
    + '"schema".name and "schema"."name"');

  /** Every declared function that a build actually holds, with its signature. */
  const surface = async client => (await client.query(
    `select n.nspname as schema, p.proname as name,
            pg_get_function_identity_arguments(p.oid) as args
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname || '.' || p.proname = any($1)
      order by 1, 2, 3`, [declared])).rows;
  const derived = await surface(db);
  // Names only, de-duplicated, because a function may legitimately be
  // overloaded and this line is about PRESENCE alone: every declared name is
  // reachable in the derived store, so an empty or partial answer cannot be
  // mistaken for agreement below. Whether the signatures are right is the
  // control's question, not this one's.
  assert.deepEqual([...new Set(derived.map(row => `${row.schema}.${row.name}`))].sort(),
    declared, 'every function the measured files declare is present in the derived store');

  // The four-file build this suite used to carry, rebuilt as the control.
  const control = new PGlite();
  try {
    await control.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
    const dir = new URL('../supabase/migrations/', import.meta.url);
    for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
      await control.exec(await readFile(new URL(name, dir), 'utf8'));
    }
    await applyRecordMigrations(control, {
      omit: applied.filter(name => !FORMERLY_APPLIED.includes(name)),
    });

    // The comparison is vacuous unless the two builds really are different
    // stores, so that is checked rather than assumed: a control equal to the
    // store under test would agree with it about everything.
    const allFunctions = async client => (await client.query(
      `select n.nspname || '.' || p.proname as name
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('pennsync_records', 'pennsync_private', 'public')
        order by 1`)).rows.map(row => row.name);
    const derivedFunctions = await allFunctions(db);
    const controlFunctions = await allFunctions(control);
    const held = new Set(derivedFunctions);
    assert.deepEqual(controlFunctions.filter(name => !held.has(name)), [],
      'widening the store adds functions and removes none');
    assert.notDeepEqual(controlFunctions, derivedFunctions,
      'the control must be a different store from the one under test, or the '
      + 'surface comparison below compares a build with itself');

    assert.deepEqual(derived, await surface(control),
      'widening the store changes nothing about what this contract exposes: '
      + 'same functions, same identity arguments');

    // Known-positive, in the same test and on the control's own connection, so
    // there is no planted file and nothing to restore. An overload is the
    // smallest difference the comparison is supposed to catch: same name, and a
    // signature the deployed store does not have.
    await control.exec('create function "pennsync_records".contract_patient_get'
      + '(p_probe text) returns void language sql as $probe$ select $probe$;');
    assert.notDeepEqual(derived, await surface(control),
      'adding one overload to the control makes the comparison above report a '
      + 'difference, so its agreement was not the comparison failing to look');
  } finally {
    await control.close();
  }
});
