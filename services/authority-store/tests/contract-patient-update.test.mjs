import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { RECORD_MIGRATION_FILE, SCHEMA } from '../../../tools-entity-schema-plan.mjs';
import { BROKER_MIGRATION_FILE } from '../../../tools-record-brokers.mjs';
import { POLICY_SQL_FILES } from '../../../tools-read-purpose-policy.mjs';
import { PATIENT_ACTION_POLICY, PATIENT_ACTIONS } from '../../pennsync-api/read-purpose-policy.mjs';

/**
 * Mutating a patient (`contract_patient_update`).
 *
 * Three authorizations decide every case here and they are deliberately
 * tested apart, because each one alone reads like the whole answer:
 *
 * - **Which action** is the extracted policy. A tenant role is admitted for
 *   `edit_insurance` and not for `set_primary_diagnosis`, and the two have
 *   nothing to do with each other.
 * - **Which chart** is RLS, with D24's narrowing on top of tenancy. The
 *   contract asks nothing about the care team; it reads the row, and a row it
 *   cannot read is a row it cannot write.
 * - **Which version** is `expected_updated_date`, carried into the `where`
 *   clause so that a concurrent change loses instead of being overwritten.
 *
 * The lifecycle rules are a fourth thing again and they are the original's:
 * a discharge is terminal, a clinical edit needs a clinically active chart,
 * and the COMBINED result of a batch is validated rather than each action
 * against the row as it was.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const READ = 'services/authority-store/supabase/record-migrations/20260920060000_contract_patient_read.sql';
const UPDATE = 'services/authority-store/supabase/record-migrations/20260920130000_contract_patient_update.sql';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const pid = n => `7aac00000000${String(n).padStart(12, '0')}`;
const ADMIN_A = 1; const CLINICIAN_A = 2; const OFFICE_A = 3; const ADMIN_B = 4;
const UPDATE_SQL = 'select "public"."pennsync_contract_patient_update"($1,$2,$3,$4) as result';
const GET = 'select "public"."pennsync_contract_patient_get"($1,$2,$3) as result';
const A = 'agency-a'; const B = 'agency-b';
const SEEDED = '2026-09-01 00:00:00+00';
let db;
let next = 0;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE,
    POLICY_SQL_FILES.patient, READ, UPDATE]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  // Agency-a gets an `office_staff` member. D24 gives that role no chart at
  // all, which is the whole of divergence 2 and is asserted below.
  await db.exec(`update pennsync_private.membership set tenant_role = 'office_staff'
    where id = 'membership-3'`);
});
after(async () => db?.close());

/**
 * A fresh chart for one case, assigned to the clinician unless told otherwise.
 *
 * Every case gets its own, because an update COMMITS: sharing one row would
 * make the cases depend on the order they ran in.
 */
async function seed(extra = {}, { assign = true, agency = A } = {}) {
  next += 1;
  const id = pid(next);
  const columns = {
    source_app_id: APP, id, agency_id: agency, status: 'active',
    is_sample: false, is_archived: false, first_name: 'Ada', last_name: 'Lovelace',
    care_type: 'home_health', updated_date: SEEDED, ...extra,
  };
  const names = Object.keys(columns);
  await db.query(`insert into ${SCHEMA}."patient" (${names.map(n => `"${n}"`).join(',')})
    values (${names.map((unused, i) => `$${i + 1}`).join(',')})`, names.map(n => columns[n]));
  if (assign) {
    await db.query(`insert into pennsync_private.chart_assignment
      (app_id,agency_id,patient_id,membership_id,status,changed_by)
      values ($1,$2,$3,'membership-2','active',$4)`, [APP, agency, id, uid(1)]);
  }
  return id;
}

/** An update COMMITS, because what it wrote is what the next read looks for. */
async function update(n, id, expected, actions, agency = A) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
    const { rows } = await db.query(UPDATE_SQL, [agency, id, expected, JSON.stringify(actions)]);
    await db.exec('commit');
    return rows[0].result;
  } catch (error) { await db.exec('rollback'); throw error; }
}
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
const column = async (id, name) => (await db.query(
  `select "${name}" as value from ${SCHEMA}."patient" where "id" = $1`, [id])).rows[0].value;
/** The same column as the database renders it, for the date and timestamp ones. */
const rendered = async (id, name) => (await db.query(
  `select "${name}"::text as value from ${SCHEMA}."patient" where "id" = $1`, [id])).rows[0].value;
const act = (action, changes) => [{ action, changes }];

test('an admitted action moves its field and reports what moved', async () => {
  const id = await seed();
  const answer = await update(CLINICIAN_A, id, SEEDED,
    act('edit_demographics', { first_name: 'Grace', phone: '555-0199' }));
  assert.equal(answer.updated, true);
  assert.equal(answer.action, 'edit_demographics', 'one action names itself');
  assert.deepEqual(answer.actions, ['edit_demographics']);
  assert.deepEqual(answer.changed_fields, ['first_name', 'phone']);
  assert.equal(answer.patient.first_name, 'Grace');
  assert.equal(await column(id, 'first_name'), 'Grace');
  assert.equal(await column(id, 'phone'), '555-0199');
  // The projection is the original's narrow one: a mutation answers the
  // lifecycle it moved, not the provenance a create stamps.
  assert.deepEqual(Object.keys(answer.patient).sort(), ['agency_id', 'care_type', 'first_name',
    'id', 'is_archived', 'last_name', 'middle_name', 'status', 'updated_date']);
});

test('every field an action declares actually reaches the column', async () => {
  // The closed loop against the extracted policy. The contract builds its set
  // list from the keys that moved rather than from a column list of its own,
  // so a field added to an action in the original cannot validate and then
  // silently not be written — which is the one failure a hand-kept list has.
  const value = {
    date_of_birth: '1990-01-02', admission_date: '1990-01-03',
    email: 'a@example.invalid', physician_email: 'b@example.invalid',
    caregiver_email: 'c@example.invalid', care_type: 'hospice',
    admission_source: 'hospital', medical_record_number: 'MRN-LOOP',
    secondary_diagnoses: ['one'], past_medical_history: ['two'], goals_of_care: ['three'],
  };
  // `change_status` is exercised by the lifecycle cases: its three fields are
  // only writable through a transition, which is a rule rather than a column.
  for (const action of PATIENT_ACTIONS.filter(name => name !== 'change_status')) {
    const id = await seed();
    const fields = PATIENT_ACTION_POLICY[action].fields;
    const changes = Object.fromEntries(fields.map(field => [field, value[field] ?? `v-${field}`]));
    // The admin, because `medical_record_number` is admitted only for a caller
    // who opens every chart — divergence 4, asserted on its own below.
    const answer = await update(ADMIN_A, id, SEEDED, act(action, changes));
    assert.deepEqual(answer.changed_fields, [...fields].sort(), `${action} moved every field`);
    for (const field of fields) {
      const stored = await column(id, field);
      const seen = stored instanceof Date ? stored.toISOString().slice(0, 10) : stored;
      assert.deepEqual(Array.isArray(changes[field]) ? seen : String(seen),
        Array.isArray(changes[field]) ? changes[field] : String(changes[field]),
        `${action}.${field} reached the column`);
    }
  }
});

test('an action a role is not admitted for is refused before the chart is read', async () => {
  const id = await seed();
  // The policy admits `office_staff` for demographics and insurance and for
  // nothing else. Refused on the action, not on the chart.
  await refusal(update(OFFICE_A, id, SEEDED, act('set_primary_diagnosis',
    { primary_diagnosis: 'x' })), 'PENNSYNC_PATIENT_ACTION_FORBIDDEN');
  await refusal(update(OFFICE_A, id, SEEDED, act('edit_clinical_profile',
    { allergies: 'x' })), 'PENNSYNC_PATIENT_ACTION_FORBIDDEN');
  // DIVERGENCE 2, and this is what it looks like: the action gate admits
  // `office_staff` for demographics exactly as the original does, and D24
  // gives the role no chart, so the read is what refuses.
  await refusal(update(OFFICE_A, id, SEEDED, act('edit_demographics',
    { first_name: 'Grace' })), 'PENNSYNC_PATIENT_NOT_VISIBLE');
  assert.equal(await column(id, 'first_name'), 'Ada', 'nothing moved');
});

test('a chart the caller cannot open is the same answer as one that does not exist', async () => {
  const mine = await seed();
  const theirs = await seed({}, { assign: false });
  const elsewhere = await seed({ agency_id: B }, { assign: false, agency: B });
  await refusal(update(CLINICIAN_A, theirs, SEEDED, act('edit_demographics', { first_name: 'X' })),
    'PENNSYNC_PATIENT_NOT_VISIBLE');
  await refusal(update(CLINICIAN_A, pid(9999), SEEDED, act('edit_demographics', { first_name: 'X' })),
    'PENNSYNC_PATIENT_NOT_VISIBLE');
  // The agency is asked of the authority store, never of the request.
  await refusal(update(ADMIN_B, mine, SEEDED, act('edit_demographics', { first_name: 'X' })),
    'PENNSYNC_PATIENT_AGENCY_NOT_HELD');
  await refusal(update(ADMIN_A, elsewhere, SEEDED, act('edit_demographics', { first_name: 'X' }), B),
    'PENNSYNC_PATIENT_AGENCY_NOT_HELD');
  // An admin opens every chart in their own agency, including the one the
  // clinician was refused.
  assert.equal((await update(ADMIN_A, theirs, SEEDED,
    act('edit_demographics', { first_name: 'Grace' }))).updated, true);
});

test('a field belongs to the action that declares it and to no other', async () => {
  const id = await seed();
  // `payor` is `edit_insurance`'s. Sending it under demographics is not a
  // near miss; it is a different authorization.
  await refusal(update(ADMIN_A, id, SEEDED, act('edit_demographics', { payor: 'Medicare' })),
    'PENNSYNC_PATIENT_FIELD_UNSUPPORTED');
  // And a column no action declares at all — these are the ones the original
  // names as never caller-controlled.
  for (const field of ['agency_id', 'created_by_user_id', 'is_archived', 'assigned_nurses',
    'patient_creation_key', 'merged_into_id', 'updated_date']) {
    assert.ok(!PATIENT_ACTIONS.some(name => PATIENT_ACTION_POLICY[name].fields.includes(field)),
      `${field} is not an action field`);
    await refusal(update(ADMIN_A, id, SEEDED, act('edit_demographics', { [field]: 'x' })),
      'PENNSYNC_PATIENT_FIELD_UNSUPPORTED');
  }
  await refusal(update(ADMIN_A, id, SEEDED, act('not_an_action', { first_name: 'X' })),
    'PENNSYNC_PATIENT_ACTION_UNKNOWN');
});

test('a batch of actions is one write, in the policy\'s order whatever order it arrived in', async () => {
  const id = await seed();
  const answer = await update(CLINICIAN_A, id, SEEDED, [
    { action: 'set_primary_diagnosis', changes: { primary_diagnosis: 'CHF' } },
    { action: 'edit_demographics', changes: { last_name: 'Byron' } },
  ]);
  assert.equal(answer.action, 'batch');
  // `ACTION_CANONICAL_ORDER`: demographics is declared first, so it is
  // reported first although it was sent second.
  assert.deepEqual(answer.actions, ['edit_demographics', 'set_primary_diagnosis']);
  assert.deepEqual(answer.changed_fields, ['last_name', 'primary_diagnosis']);
  assert.equal(await column(id, 'last_name'), 'Byron');
  assert.equal(await column(id, 'primary_diagnosis'), 'CHF');
  // One write, so one `updated_date` for both.
  await refusal(update(CLINICIAN_A, id, SEEDED, act('edit_demographics', { last_name: 'X' })),
    'PENNSYNC_PATIENT_STALE');
  // The same action twice is refused rather than merged.
  const other = await seed();
  await refusal(update(CLINICIAN_A, other, SEEDED, [
    { action: 'edit_demographics', changes: { first_name: 'A' } },
    { action: 'edit_demographics', changes: { last_name: 'B' } },
  ]), 'PENNSYNC_PATIENT_ACTION_UNKNOWN');
});

test('a stale expectation loses, and the row it was about does not move', async () => {
  const id = await seed();
  const first = await update(CLINICIAN_A, id, SEEDED, act('edit_demographics', { first_name: 'Grace' }));
  await refusal(update(CLINICIAN_A, id, SEEDED, act('edit_demographics', { first_name: 'Joan' })),
    'PENNSYNC_PATIENT_STALE');
  assert.equal(await column(id, 'first_name'), 'Grace', 'the second caller did not overwrite');
  // The version the first write returned is the one that works next.
  assert.equal((await update(CLINICIAN_A, id, first.patient.updated_date,
    act('edit_demographics', { first_name: 'Joan' }))).updated, true);
  await refusal(update(CLINICIAN_A, id, null, act('edit_demographics', { first_name: 'X' })),
    'PENNSYNC_PATIENT_EXPECTED_REQUIRED');
});

test('sending a value the chart already has is not a write', async () => {
  const id = await seed({ first_name: 'Ada' });
  const answer = await update(CLINICIAN_A, id, SEEDED, act('edit_demographics', { first_name: ' Ada ' }));
  assert.equal(answer.updated, false);
  assert.deepEqual(answer.changed_fields, []);
  // Trimmed first, so the comparison is against the value that WOULD be
  // stored rather than against what arrived.
  assert.match(await rendered(id, 'updated_date'), /^2026-09-01/, 'updated_date did not advance');
  assert.equal((await update(CLINICIAN_A, id, SEEDED,
    act('edit_demographics', { first_name: 'Grace' }))).updated, true,
    'the expectation is still the seeded one, because nothing was written');
});

test('the lifecycle rules are the original\'s, and the transitions are finite', async () => {
  const active = await seed();
  // active -> hospitalized -> active -> discharged.
  const up = await update(CLINICIAN_A, active, SEEDED, act('change_status', { status: 'hospitalized' }));
  assert.equal(up.patient.status, 'hospitalized');
  const back = await update(CLINICIAN_A, active, up.patient.updated_date,
    act('change_status', { status: 'active' }));
  // A discharge needs both discharge fields; neither alone is a discharge.
  await refusal(update(CLINICIAN_A, active, back.patient.updated_date,
    act('change_status', { status: 'discharged' })), 'PENNSYNC_PATIENT_DISCHARGE_FIELDS_REQUIRED');
  const out = await update(CLINICIAN_A, active, back.patient.updated_date, act('change_status', {
    status: 'discharged', discharge_date: '2026-06-01', discharge_disposition: 'home',
  }));
  assert.equal(out.patient.status, 'discharged');
  // And a discharge is terminal: nothing transitions out of it.
  await refusal(update(CLINICIAN_A, active, out.patient.updated_date,
    act('change_status', { status: 'active' })), 'PENNSYNC_PATIENT_STATUS_TRANSITION');
  // Discharge fields without a discharge are refused rather than stored.
  const other = await seed();
  await refusal(update(CLINICIAN_A, other, SEEDED, act('change_status',
    { status: 'hospitalized', discharge_date: '2026-06-01' })),
  'PENNSYNC_PATIENT_DISCHARGE_FIELDS_UNEXPECTED');
  await refusal(update(CLINICIAN_A, other, SEEDED, act('change_status',
    { discharge_disposition: 'home' })), 'PENNSYNC_PATIENT_STATUS_REQUIRED');
});

test('a discharged chart takes no clinical edit and no episode edit', async () => {
  const id = await seed({
    status: 'discharged', admission_date: '2026-01-01',
    discharge_date: '2026-06-01', discharge_disposition: 'home',
  });
  await refusal(update(CLINICIAN_A, id, SEEDED, act('set_primary_diagnosis',
    { primary_diagnosis: 'CHF' })), 'PENNSYNC_PATIENT_NOT_CLINICALLY_ACTIVE');
  await refusal(update(CLINICIAN_A, id, SEEDED, act('edit_clinical_profile',
    { allergies: 'none' })), 'PENNSYNC_PATIENT_NOT_CLINICALLY_ACTIVE');
  await refusal(update(CLINICIAN_A, id, SEEDED, act('edit_care_episode',
    { admission_source: 'home' })), 'PENNSYNC_PATIENT_EPISODE_DISCHARGED');
  // Demographics are not clinical, and a discharged chart still has an
  // address worth correcting.
  assert.equal((await update(CLINICIAN_A, id, SEEDED,
    act('edit_demographics', { address: '2 Example Street' }))).updated, true);
  // Hospitalized is clinically active; discharged is not.
  const held = await seed({ status: 'hospitalized' });
  const noted = await update(CLINICIAN_A, held, SEEDED,
    act('set_primary_diagnosis', { primary_diagnosis: 'CHF' }));
  assert.equal(noted.updated, true);
  // And care_type moves only while the chart is active, because home health
  // and hospice are different episodes rather than a label.
  await refusal(update(CLINICIAN_A, held, noted.patient.updated_date,
    act('edit_care_episode', { care_type: 'hospice' })), 'PENNSYNC_PATIENT_CARE_TYPE_LOCKED');
});

test('the combined result of a batch is validated, not each action against the old row', async () => {
  // Each half is valid alone: the chart may be discharged, and the admission
  // date may be corrected. Together they put the discharge before the
  // admission, which the original catches only by checking the merged row.
  const id = await seed({ admission_date: '2026-01-01' });
  await refusal(update(CLINICIAN_A, id, SEEDED, [
    { action: 'edit_care_episode', changes: { admission_date: '2026-07-01' } },
    {
      action: 'change_status',
      changes: { status: 'discharged', discharge_date: '2026-06-01', discharge_disposition: 'home' },
    },
  ]), 'PENNSYNC_PATIENT_DISCHARGE_BEFORE_ADMISSION');
  assert.equal(await column(id, 'status'), 'active', 'neither half was written');
  assert.equal(await rendered(id, 'admission_date'), '2026-01-01');
});

test('a value is canonicalised the way the original canonicalises it', async () => {
  const id = await seed();
  const answer = await update(ADMIN_A, id, SEEDED, act('edit_demographics', {
    email: '  ADA@Example.INVALID ', medical_record_number: ' MRN-9 ', date_of_birth: '1990-01-02',
  }));
  assert.equal(await column(id, 'email'), 'ada@example.invalid', 'trimmed and lowercased');
  assert.equal(await column(id, 'medical_record_number'), 'MRN-9');
  // An empty string CLEARS a date, which on a `date` column means null —
  // and an absent key would have left it alone, so the two are not the same.
  await update(ADMIN_A, id, answer.patient.updated_date,
    act('edit_demographics', { date_of_birth: '' }));
  assert.equal(await column(id, 'date_of_birth'), null);
  for (const [changes, code] of [
    [{ email: 'not an address' }, 'PENNSYNC_PATIENT_FIELD_INVALID'],
    [{ date_of_birth: '2021-02-30' }, 'PENNSYNC_PATIENT_FIELD_INVALID'],
    [{ date_of_birth: '01/02/1990' }, 'PENNSYNC_PATIENT_FIELD_INVALID'],
    [{ first_name: '   ' }, 'PENNSYNC_PATIENT_FIELD_INVALID'],
    [{ first_name: 'x'.repeat(1001) }, 'PENNSYNC_PATIENT_FIELD_INVALID'],
    [{ address: 'x'.repeat(20001) }, 'PENNSYNC_PATIENT_FIELD_TOO_LARGE'],
    [{ first_name: ['Ada'] }, 'PENNSYNC_PATIENT_FIELD_INVALID'],
  ]) await refusal(update(ADMIN_A, id, SEEDED, act('edit_demographics', changes)), code);
  // A list field is a list of strings, not whatever JSON arrived.
  await refusal(update(ADMIN_A, id, SEEDED,
    act('edit_clinical_profile', { goals_of_care: { a: 1 } })), 'PENNSYNC_PATIENT_FIELD_INVALID');
  await refusal(update(ADMIN_A, id, SEEDED,
    act('edit_clinical_profile', { goals_of_care: [1] })), 'PENNSYNC_PATIENT_FIELD_INVALID');
  await refusal(update(ADMIN_A, id, SEEDED, act('edit_care_episode',
    { admission_source: 'somewhere' })), 'PENNSYNC_PATIENT_FIELD_INVALID');
  // `merged` and `archived` are lifecycle states no workflow may set, even
  // though the column's own check accepts them.
  await refusal(update(ADMIN_A, id, SEEDED, act('change_status', { status: 'archived' })),
    'PENNSYNC_PATIENT_FIELD_INVALID');
});

test('a medical record number moves only where the collision check sees every chart', async () => {
  // DIVERGENCE 4. The check is agency-wide or it is not a check, and this
  // contract sees only the charts its caller opens.
  const held = await seed({ medical_record_number: 'MRN-TAKEN' }, { assign: false });
  const mine = await seed();
  await refusal(update(CLINICIAN_A, mine, SEEDED,
    act('edit_demographics', { medical_record_number: 'MRN-NEW' })),
  'PENNSYNC_PATIENT_MRN_SCOPE');
  // The admin opens every chart, so for them the check IS agency-wide — and
  // it sees the chart the clinician could not.
  await refusal(update(ADMIN_A, mine, SEEDED,
    act('edit_demographics', { medical_record_number: 'MRN-TAKEN' })),
  'PENNSYNC_PATIENT_MRN_TAKEN');
  assert.equal((await update(ADMIN_A, mine, SEEDED,
    act('edit_demographics', { medical_record_number: 'MRN-FREE' }))).updated, true);
  // Another agency's number is not a collision.
  await db.query(`update ${SCHEMA}."patient" set "agency_id" = $1 where "id" = $2`, [B, held]);
  const free = await seed();
  assert.equal((await update(ADMIN_A, free, SEEDED,
    act('edit_demographics', { medical_record_number: 'MRN-TAKEN' }))).updated, true);
});

test('a sample, archived or merged chart is not mutable through this contract', async () => {
  for (const [extra, label] of [
    [{ is_sample: true }, 'sample'], [{ is_archived: true }, 'archived'],
    [{ status: 'merged' }, 'merged'],
  ]) {
    const id = await seed(extra);
    await refusal(update(ADMIN_A, id, SEEDED, act('edit_demographics', { first_name: 'X' })),
      'PENNSYNC_PATIENT_UNAVAILABLE');
    assert.equal(await column(id, 'first_name'), 'Ada', `${label} did not move`);
  }
});

test('a malformed request never reaches the table', async () => {
  const id = await seed();
  for (const [actions, code] of [
    [[], 'PENNSYNC_PATIENT_ACTIONS_INVALID'],
    [{ action: 'edit_demographics', changes: {} }, 'PENNSYNC_PATIENT_ACTIONS_INVALID'],
    [[{ action: 'edit_demographics' }], 'PENNSYNC_PATIENT_ACTION_SHAPE'],
    [[{ action: 'edit_demographics', changes: {}, extra: 1 }], 'PENNSYNC_PATIENT_ACTION_SHAPE'],
    [['edit_demographics'], 'PENNSYNC_PATIENT_ACTION_SHAPE'],
    [[{ action: 'edit_demographics', changes: {} }], 'PENNSYNC_PATIENT_CHANGES_INVALID'],
    [[{ action: 'edit_demographics', changes: [] }], 'PENNSYNC_PATIENT_CHANGES_INVALID'],
  ]) await refusal(update(ADMIN_A, id, SEEDED, actions), code);
  await refusal(update(ADMIN_A, '', SEEDED, act('edit_demographics', { first_name: 'X' })),
    'PENNSYNC_PATIENT_ID_INVALID');
  assert.equal(await column(id, 'first_name'), 'Ada', 'nothing was written');
});

test('the contract is the only way in, and it cannot be reached by a caller as itself', async () => {
  // The same shape every contract has: the record functions are the owner's,
  // the public wrapper is an invoker, and `authenticated` may call exactly one
  // of them.
  const sql = readFileSync(resolve(repository, UPDATE), 'utf8');
  assert.match(sql, /grant execute on function\s+"pennsync_records"\.contract_patient_update/);
  assert.match(sql, /revoke all on function\s+"pennsync_records"\.patient_change_value/);
  const granted = async name => (await db.query(
    'select has_function_privilege($1,$2,$3) as ok',
    ['authenticated', name, 'execute'])).rows[0].ok;
  assert.equal(await granted('pennsync_records.patient_change_value(text,jsonb)'), false);
  assert.equal(await granted('pennsync_records.patient_updated(pennsync_records.patient)'), false);
  assert.equal(await granted('pennsync_records.patient_action_writes(text,text)'), false,
    'a caller cannot ask the policy anything either');
  assert.equal(await granted('public.pennsync_contract_patient_update(text,text,timestamptz,jsonb)'),
    true);
});

test('a mutated chart reads back through the read contract that serves it', async () => {
  // The two contracts are separate authorizations and this is the one case
  // that crosses them: what a caller wrote is what the next read shows.
  const id = await seed();
  await update(CLINICIAN_A, id, SEEDED, act('edit_demographics', { first_name: 'Grace' }));
  assert.equal((await as(CLINICIAN_A, GET, [A, 'display', id]))[0].result?.first_name, 'Grace');
});
