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
 * Referral intake: the largest capability in the migration, as one contract.
 *
 * Three things here are worth more than the coverage.
 *
 * D24 NARROWS THIS CAPABILITY AND THE NARROWING IS NOT THE CONTRACT'S.
 * `office_staff` is an intake role in the original and opens no chart under
 * D24, and `referral` carries the chart rule because it has a `patient_id`.
 * So the role whose job this is sees a referral until it names a patient. That
 * is asserted rather than described, because it is the kind of consequence a
 * reader will want to see fire.
 *
 * THE CONDITIONAL VERSIONED WRITE IS NOT OPTIMISTIC CONCURRENCY. The original
 * writes `where version = <what I just read>`, and the caller sends no version
 * — so the predicate protects the handler from itself. An update here sends no
 * version and succeeds, which is the assertion that the deletion was safe.
 *
 * `list_assignees` IS THE ROSTER. D48's `agency_roster` already returns the
 * membership id and version the published client validates, which
 * `agency_colleague` does not — so the port is a filter, not a query.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const MIGRATIONS = 'services/authority-store/supabase/record-migrations/';
// `caller_membership` (D34) and `agency_roster` (D48) are facilities this
// contract reads, and each lives in the migration that first needed it.
const NOTE_HISTORY = `${MIGRATIONS}20260920170000_contract_note_history.sql`;
const MINT = `${MIGRATIONS}20260920285000_notification_mint.sql`;
const REFERRAL = `${MIGRATIONS}20260920460000_contract_referral.sql`;
const ORIGINAL = 'base44/functions/manageAuthorizedReferral/entry.ts';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const email = n => ['', 'admin-a', 'clinician-a', 'clinician-empty', 'admin-b'][n]
  + '@example.invalid';
const ADMIN_A = 1; const CLINICIAN_A = 2; const OFFICE_A = 3; const ADMIN_B = 4;
const LIST = 'select "public"."pennsync_contract_referral_list"($1,$2,$3,$4,$5) as result';
const GET = 'select "public"."pennsync_contract_referral_get"($1,$2) as result';
const ASSIGNEES = 'select "public"."pennsync_contract_referral_assignees"($1) as result';
const CREATE = 'select "public"."pennsync_contract_referral_create"($1,$2,$3) as result';
const UPDATE = 'select "public"."pennsync_contract_referral_update"($1,$2,$3) as result';
const ARCHIVE = 'select "public"."pennsync_contract_referral_archive"($1,$2) as result';
const A = 'agency-a'; const B = 'agency-b';
let db; let sequence = 0;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE,
    NOTE_HISTORY, MINT, REFERRAL]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  // Agency-a gets an `office_staff` member: an INTAKE role that opens no
  // chart. The whole of divergence 5 lives on this one row.
  await db.exec(`update pennsync_private.membership set tenant_role = 'office_staff'
    where id = 'membership-3'`);
  for (const [id, agency, first, last] of [
    ['patient-a1', A, 'Ada', 'Lovelace'], ['patient-a2', A, 'Grace', 'Hopper'],
    ['patient-b1', B, 'Katherine', 'Johnson'],
  ]) {
    await db.query(`insert into ${SCHEMA}."patient"("source_app_id","id","agency_id",
      "first_name","last_name","status","is_sample","is_archived")
      values ($1,$2,$3,$4,$5,'active',false,false)`, [APP, id, agency, first, last]);
  }
});
after(async () => db?.close());

async function as(n, sql, params = []) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
    const { rows } = await db.query(sql, params);
    await db.exec('commit');
    return rows[0].result;
  } catch (error) { await db.exec('rollback'); throw error; }
}
// `??` would turn an explicit null limit back into the default, which is the
// one case the contract has its own refusal for.
const list = (n, options = {}) => as(n, LIST, [options.agency ?? A,
  Object.hasOwn(options, 'limit') ? options.limit : 200,
  options.patient_id ?? null, options.status ?? null, options.assigned_to ?? null]);
const get = (n, id, agency = A) => as(n, GET, [agency, id]);
const assignees = (n, agency = A) => as(n, ASSIGNEES, [agency]);
const create = (n, referral, options = {}) => as(n, CREATE, [options.agency ?? A,
  options.request ?? `req-${++sequence}`, JSON.stringify(referral)]);
const update = (n, id, changes, agency = A) =>
  as(n, UPDATE, [agency, id, JSON.stringify(changes)]);
const archive = (n, id, agency = A) => as(n, ARCHIVE, [agency, id]);
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
});
const column = async (id, name) => (await db.query(
  `select "${name}" as value from ${SCHEMA}."referral" where "id" = $1`, [id])).rows[0]?.value;
const seed = async (n = ADMIN_A, referral = { patient_name: 'Ada Lovelace', status: 'new' }) =>
  (await create(n, referral)).referral;

test('the role gate is the intake set, which is not D24 and not the assignee set', async () => {
  // `agency_admin` and `office_staff` work the queue.
  assert.equal((await list(ADMIN_A)).scope.tenant_role, 'agency_admin');
  assert.equal((await list(OFFICE_A)).scope.tenant_role, 'office_staff');
  // A clinician may be GIVEN a referral and may not work the queue. Delete
  // this gate and the policies would admit them to the whole intake list.
  await refusal(list(CLINICIAN_A), 'PENNSYNC_REFERRAL_FORBIDDEN');
  await refusal(assignees(CLINICIAN_A), 'PENNSYNC_REFERRAL_FORBIDDEN');
  await refusal(create(CLINICIAN_A, { patient_name: 'x' }), 'PENNSYNC_REFERRAL_FORBIDDEN');
  // An agency the caller holds nothing in is a different refusal, and neither
  // one says whether the agency exists.
  await refusal(list(ADMIN_A, { agency: B }), 'PENNSYNC_REFERRAL_AGENCY_NOT_HELD');
  await refusal(list(ADMIN_A, { agency: 'agency-nowhere' }), 'PENNSYNC_REFERRAL_AGENCY_NOT_HELD');
});

test('the scope is this store\'s membership, in the shape the client validates', async () => {
  const { scope } = await list(ADMIN_A);
  assert.deepEqual(Object.keys(scope).sort(),
    ['agency_id', 'membership_id', 'membership_version', 'tenant_role']);
  assert.equal(scope.agency_id, A);
  assert.equal(scope.membership_id, 'membership-1');
  assert.equal(Number.isSafeInteger(scope.membership_version), true);
  assert.ok(scope.membership_version >= 1);
});

test('DIVERGENCE 5: office_staff works the queue until a referral names a patient', async () => {
  // An unlinked referral is intake's own, and office_staff creates and reads it.
  const unlinked = (await create(OFFICE_A, { patient_name: 'Walk-in', status: 'new' })).referral;
  assert.equal((await get(OFFICE_A, unlinked.id)).referral.id, unlinked.id);
  // The moment it names a chart, D24 applies: `office_staff` opens none.
  await refusal(create(OFFICE_A, { patient_name: 'Ada', patient_id: 'patient-a1' }),
    'PENNSYNC_REFERRAL_PATIENT_UNAVAILABLE');
  const linked = (await create(ADMIN_A, { patient_name: 'Ada', patient_id: 'patient-a1' })).referral;
  assert.equal(linked.patient_id, 'patient-a1');
  // Absent and not-visible answer the same way.
  await refusal(get(OFFICE_A, linked.id), 'PENNSYNC_REFERRAL_NOT_FOUND');
  const ids = (await list(OFFICE_A)).referrals.map(row => row.id);
  assert.equal(ids.includes(unlinked.id), true);
  assert.equal(ids.includes(linked.id), false, 'the linked referral is in a chart it cannot open');
  // An agency_admin opens every chart and is unaffected.
  assert.equal((await list(ADMIN_A)).referrals.some(row => row.id === linked.id), true);
  // And office_staff cannot move a referral it CAN see into a chart it cannot.
  await refusal(update(OFFICE_A, unlinked.id, { patient_id: 'patient-a1' }),
    'PENNSYNC_REFERRAL_PATIENT_UNAVAILABLE');
});

test('an update sends no version and succeeds, which is why the 409 machinery went', async () => {
  const row = await seed();
  assert.equal(row.version, 1);
  const first = await update(ADMIN_A, row.id, { diagnosis: 'CHF' });
  assert.equal(first.referral.version, 2);
  assert.equal(first.referral.diagnosis, 'CHF');
  // Twice, with no expectation carried between them: the original's
  // `where version = <what I just read>` was built from its own read, so
  // nothing a caller relies on has been deleted.
  const second = await update(ADMIN_A, row.id, { priority: 'urgent' });
  assert.equal(second.referral.version, 3);
  assert.equal(second.referral.diagnosis, 'CHF', 'the first change stands');
  assert.equal(second.referral.priority, 'urgent');
});

test('list_assignees is the roster filtered to three roles, and has no name to give', async () => {
  const { assignees: rows } = await assignees(ADMIN_A);
  assert.deepEqual(rows.map(row => row.email),
    [email(ADMIN_A), email(CLINICIAN_A)].sort());
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), ['email', 'full_name', 'membership_id',
      'membership_version', 'tenant_role', 'user_id']);
    // The carried `user` table has no name column (D38, D46). Null is a shape
    // the published client already accepts.
    assert.equal(row.full_name, null);
    assert.match(row.membership_id, /^membership-\d$/);
    assert.ok(row.membership_version >= 1);
  }
  assert.deepEqual(rows.map(row => row.tenant_role), ['agency_admin', 'clinician']);
  // `office_staff` works the queue and may not be given a referral. The two
  // sets are different on purpose in the original and are different here.
  assert.equal(rows.some(row => row.email === email(OFFICE_A)), false);
  // Another agency's roster is not disclosed by this capability at all.
  await refusal(assignees(ADMIN_B, A), 'PENNSYNC_REFERRAL_AGENCY_NOT_HELD');
});

test('an assignment stamps seven columns, and clearing it clears all seven', async () => {
  const row = await seed();
  const assigned = (await update(ADMIN_A, row.id,
    { assigned_to: `  ${email(CLINICIAN_A).toUpperCase()}  ` })).referral;
  // The VERIFIED address, not the one the caller typed.
  assert.equal(assigned.assigned_to, email(CLINICIAN_A));
  assert.equal(assigned.assigned_to_user_id, `6aac00000000${uid(CLINICIAN_A).slice(-12)}`);
  // THIS store's membership, as D34 settled — not Base44's AgencyMembership id.
  assert.equal(assigned.assigned_to_membership_id, 'membership-2');
  assert.ok(assigned.assigned_to_membership_version >= 1);
  assert.match(assigned.assigned_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(assigned.assigned_by_user_id, `6aac00000000${uid(ADMIN_A).slice(-12)}`);
  assert.equal(assigned.assigned_by_user_email_normalized, email(ADMIN_A));
  // Clearing it removes the provenance too: a row keeping `assigned_to_user_id`
  // after `assigned_to` went says a person holds a referral naming nobody.
  const cleared = (await update(ADMIN_A, row.id, { assigned_to: null })).referral;
  for (const field of ['assigned_to', 'assigned_to_user_id', 'assigned_to_membership_id',
    'assigned_to_membership_version', 'assigned_at', 'assigned_by_user_id',
    'assigned_by_user_email_normalized']) {
    assert.equal(Object.hasOwn(cleared, field), false, `${field} is gone`);
    assert.equal(await column(row.id, field), null, `${field} is null in the row`);
  }
  // Only an assignee role may be given one, and only a colleague.
  await refusal(update(ADMIN_A, row.id, { assigned_to: email(OFFICE_A) }),
    'PENNSYNC_REFERRAL_ASSIGNEE_UNAVAILABLE');
  await refusal(update(ADMIN_A, row.id, { assigned_to: email(ADMIN_B) }),
    'PENNSYNC_REFERRAL_ASSIGNEE_UNAVAILABLE');
  await refusal(update(ADMIN_A, row.id, { assigned_to: 'not-an-address' }),
    'PENNSYNC_REFERRAL_ASSIGNEE_INVALID');
});

test('a caller may filter the queue to their own referrals and not to somebody else\'s', async () => {
  const mine = await seed();
  await update(ADMIN_A, mine.id, { assigned_to: email(ADMIN_A) });
  const theirs = await seed();
  await update(ADMIN_A, theirs.id, { assigned_to: email(CLINICIAN_A) });
  const filtered = (await list(ADMIN_A, { assigned_to: email(ADMIN_A) })).referrals;
  assert.equal(filtered.some(row => row.id === mine.id), true);
  assert.equal(filtered.some(row => row.id === theirs.id), false);
  await refusal(list(ADMIN_A, { assigned_to: email(CLINICIAN_A) }),
    'PENNSYNC_REFERRAL_ASSIGNMENT_FILTER_FORBIDDEN');
  await refusal(list(ADMIN_A, { assigned_to: 'nonsense' }),
    'PENNSYNC_REFERRAL_ASSIGNMENT_FILTER_FORBIDDEN');
});

test('the follow-up capability fields are a caller\'s to lose and not to set', async () => {
  const row = await seed();
  // Sent by a caller: stripped, never stored.
  const created = (await update(ADMIN_A, row.id, {
    follow_up_requests: {
      generated_at: '2026-06-01T12:00:00.000Z', requests: ['labs'],
      portal_link_active: true, fax_back: 'fax-1', stale_notification_key: 'k',
    },
  })).referral;
  assert.deepEqual(created.follow_up_requests,
    { generated_at: '2026-06-01T12:00:00.000Z', requests: ['labs'] });
  // Written by the capability that owns them.
  await db.query(`update ${SCHEMA}."referral" set "follow_up_requests" =
    "follow_up_requests" || $2::jsonb where "id" = $1`, [row.id, JSON.stringify({
    portal_link_active: true, portal_token_id: 'tok-1', fax_back: 'fax-9',
    stale_notification_claimed_by: 'worker-1',
  })]);
  // A client edit that names the SAME instant in a different spelling must not
  // reset a claim: the worker's dedupe key is the instant, not its text.
  const preserved = (await update(ADMIN_A, row.id, {
    follow_up_requests: { generated_at: '2026-06-01T08:00:00-04:00', requests: ['labs', 'vitals'] },
  })).referral.follow_up_requests;
  assert.deepEqual(preserved.requests, ['labs', 'vitals']);
  assert.equal(preserved.portal_token_id, 'tok-1');
  assert.equal(preserved.fax_back, 'fax-9');
  assert.equal(preserved.stale_notification_claimed_by, 'worker-1');
  // A different instant is a different follow-up round, so nothing carries.
  const fresh = (await update(ADMIN_A, row.id, {
    follow_up_requests: { generated_at: '2026-07-01T12:00:00.000Z', requests: ['imaging'] },
  })).referral.follow_up_requests;
  assert.deepEqual(fresh, { generated_at: '2026-07-01T12:00:00.000Z', requests: ['imaging'] });
  // And an object that is ONLY capability fields asked to change nothing a
  // caller owns, which is a refusal rather than an empty write.
  await refusal(update(ADMIN_A, row.id, { follow_up_requests: { fax_back: 'x' } }),
    'PENNSYNC_REFERRAL_FOLLOW_UP_EMPTY');
  await refusal(update(ADMIN_A, row.id, { follow_up_requests: 'not an object' }),
    'PENNSYNC_REFERRAL_FOLLOW_UP_INVALID');
});

test('the rejection and completion stamps are the contract\'s, never the caller\'s', async () => {
  const row = await seed();
  const declined = (await update(ADMIN_A, row.id, { status: 'declined' })).referral;
  assert.equal(declined.rejected_by, email(ADMIN_A));
  assert.match(declined.rejection_date, /^\d{4}-\d{2}-\d{2}T/);
  const completed = (await update(ADMIN_A, row.id, { status: 'soc_completed' })).referral;
  assert.equal(completed.soc_completed_by, email(ADMIN_A));
  // A caller cannot name any of the three: they are not client fields, so a
  // caller who sends one is refused rather than ignored.
  for (const field of ['rejected_by', 'rejection_date', 'soc_completed_by',
    'agency_id', 'version', 'created_by_user_id', 'archived_at',
    'assigned_to_membership_id', 'referral_creation_key']) {
    await refusal(update(ADMIN_A, row.id, { [field]: 'x' }), 'PENNSYNC_REFERRAL_FIELD_UNKNOWN');
  }
});

test('the three enum checks, including the one the table does not carry', async () => {
  const row = await seed();
  await refusal(update(ADMIN_A, row.id, { status: 'invented' }), 'PENNSYNC_REFERRAL_STATUS_INVALID');
  await refusal(update(ADMIN_A, row.id, { priority: 'asap' }), 'PENNSYNC_REFERRAL_PRIORITY_INVALID');
  // `document_type` has no CHECK constraint on the table, so the contract is
  // the only thing that refuses one.
  await refusal(update(ADMIN_A, row.id, { document_type: 'papyrus' }),
    'PENNSYNC_REFERRAL_DOCUMENT_TYPE_INVALID');
  assert.equal((await update(ADMIN_A, row.id, { document_type: 'fax' })).referral.document_type,
    'fax');
  // An explicit null status or priority is refused and an explicit null
  // document_type is not — the original's asymmetry, kept rather than tidied.
  await refusal(update(ADMIN_A, row.id, { status: null }), 'PENNSYNC_REFERRAL_STATUS_INVALID');
  await refusal(update(ADMIN_A, row.id, { priority: null }), 'PENNSYNC_REFERRAL_PRIORITY_INVALID');
  const cleared = await update(ADMIN_A, row.id, { document_type: null });
  assert.equal(Object.hasOwn(cleared.referral, 'document_type'), false);
  await refusal(update(ADMIN_A, row.id, {}), 'PENNSYNC_REFERRAL_FIELDS_EMPTY');
  await refusal(update(ADMIN_A, row.id, { patient_id: '$ne' }),
    'PENNSYNC_REFERRAL_PATIENT_ID_INVALID');
});

test('a get with no usable identifier is refused before any row is looked for', async () => {
  // D76 leans on this. `extractReferralDataForSmartNote` validates no
  // identifier of its own — `exactObject` refuses an unknown key and does not
  // require a known one — so a caller who sends `{}` reaches the contract with
  // a null id, and this is what answers. Nothing proved it until the handler
  // depended on it.
  const row = await seed();
  for (const id of [null, '', ' leading-space', 'trailing-space ', '$ne', 'a'.repeat(201),
    'control\u0007char']) {
    await refusal(get(ADMIN_A, id), 'PENNSYNC_REFERRAL_ID_INVALID');
  }
  // A well-formed id that names nothing is a different refusal, and that
  // difference is the point: it is the one a caller could use to probe.
  await refusal(get(ADMIN_A, 'referral-that-does-not-exist'), 'PENNSYNC_REFERRAL_NOT_FOUND');
  assert.equal((await get(ADMIN_A, row.id)).referral.id, row.id);
  // The role gate runs FIRST, so a caller who may not work the queue learns
  // nothing about whether the id was even shaped right.
  await refusal(get(CLINICIAN_A, null), 'PENNSYNC_REFERRAL_FORBIDDEN');
});

test('one request id makes one referral, and a different payload under it is refused', async () => {
  const payload = { patient_name: 'Grace Hopper', diagnosis: 'COPD', priority: 'high' };
  const first = await create(ADMIN_A, payload, { request: 'req-fixed' });
  assert.equal(first.created, true);
  const replay = await create(ADMIN_A, payload, { request: 'req-fixed' });
  assert.equal(replay.created, false);
  assert.equal(replay.referral.id, first.referral.id);
  await refusal(create(ADMIN_A, { ...payload, diagnosis: 'CHF' }, { request: 'req-fixed' }),
    'PENNSYNC_REFERRAL_REQUEST_CONFLICT');
  // A referral that has since MOVED cannot be replayed either: the answer
  // would be a row the caller's payload no longer describes.
  await update(ADMIN_A, first.referral.id, { status: 'processing' });
  await refusal(create(ADMIN_A, payload, { request: 'req-fixed' }),
    'PENNSYNC_REFERRAL_REQUEST_CONFLICT');
  // The key carries the caller, so one person's request id cannot collide with
  // another's.
  const other = await create(OFFICE_A, payload, { request: 'req-fixed' });
  assert.equal(other.created, true);
  assert.notEqual(other.referral.id, first.referral.id);
  await refusal(create(ADMIN_A, payload, { request: ' leading-space' }),
    'PENNSYNC_REFERRAL_REQUEST_ID_INVALID');
});

test('the index the retry answer depends on is caught by the name it actually has', async () => {
  // D30's rule: the contract catches `unique_violation` for ONE index by name
  // and re-raises anything else, so a rename in the generator would turn a
  // correct retry answer into a raw database error. Both names are read.
  const contract = readFileSync(resolve(repository, REFERRAL), 'utf8');
  const store = readFileSync(resolve(repository, RECORD_MIGRATION_FILE), 'utf8');
  assert.match(contract, /v_constraint is distinct from 'referral_referral_creation_key_unique'/);
  assert.match(store, /create unique index "referral_referral_creation_key_unique"/);
});

test('removal archives, and an archived referral is gone from every read', async () => {
  const row = await seed();
  const removed = await archive(ADMIN_A, row.id);
  assert.deepEqual(Object.keys(removed).sort(), ['archived', 'referral_id', 'scope']);
  assert.equal(removed.archived, true);
  assert.equal(removed.referral_id, row.id);
  // A removed referral is a declined one, which is what the intake reports count.
  assert.equal(await column(row.id, 'status'), 'declined');
  assert.equal(await column(row.id, 'rejected_by'), email(ADMIN_A));
  assert.equal(await column(row.id, 'archived_by_user_email_normalized'), email(ADMIN_A));
  assert.equal(await column(row.id, 'archive_reason'), 'Removed from Referral Intake');
  assert.notEqual(await column(row.id, 'archived_at'), null);
  assert.equal(Number(await column(row.id, 'version')), 2);
  // The row is still there and is in no read.
  await refusal(get(ADMIN_A, row.id), 'PENNSYNC_REFERRAL_NOT_FOUND');
  assert.equal((await list(ADMIN_A)).referrals.some(entry => entry.id === row.id), false);
  await refusal(archive(ADMIN_A, row.id), 'PENNSYNC_REFERRAL_NOT_FOUND');
  await refusal(update(ADMIN_A, row.id, { diagnosis: 'x' }), 'PENNSYNC_REFERRAL_NOT_FOUND');
});

test('another tenant\'s referral is not found rather than refused', async () => {
  const mine = await seed();
  await refusal(get(ADMIN_B, mine.id, B), 'PENNSYNC_REFERRAL_NOT_FOUND');
  await refusal(update(ADMIN_B, mine.id, { diagnosis: 'x' }, B), 'PENNSYNC_REFERRAL_NOT_FOUND');
  await refusal(archive(ADMIN_B, mine.id, B), 'PENNSYNC_REFERRAL_NOT_FOUND');
  assert.equal((await list(ADMIN_B, { agency: B })).referrals.some(row => row.id === mine.id),
    false);
});

test('the answer is the response field set, with a top-level null left off', async () => {
  const CLIENT = new Set(['patient_name', 'patient_id', 'patient_dob', 'diagnosis',
    'referral_source', 'referral_date', 'estimated_start_date', 'document_type',
    'priority', 'status', 'soc_date', 'first_visit_date', 'document_url',
    'processed_document_url', 'page_range', 'detection_confidence', 'manually_confirmed',
    'requires_manual_review', 'assigned_to', 'match_confidence', 'match_factors',
    'match_suggestions', 'match_analysis', 'analysis_results', 'missing_information',
    'discrepancies', 'ai_generated_tasks', 'extracted_data', 'diagnosis_coding',
    'follow_up_requests', 'follow_up_notes']);
  const RESPONSE = new Set(['id', 'agency_id', 'version', 'created_date', 'updated_date',
    ...CLIENT, 'rejection_date', 'rejected_by', 'soc_completed_by', 'assigned_to_user_id',
    'assigned_to_membership_id', 'assigned_to_membership_version', 'assigned_at',
    'assigned_by_user_id', 'assigned_by_user_email_normalized']);
  // Read from the original rather than retyped, so a field added there fails
  // here instead of quietly not being served — and read out of the CONTRACT
  // the same way, so the two lists are compared rather than each being
  // compared to a third copy in this file.
  const source = readFileSync(resolve(repository, ORIGINAL), 'utf8');
  const sql = readFileSync(resolve(repository, REFERRAL), 'utf8');
  const names = text => [...text.matchAll(/'([a-z_]+)'/g)].map(match => match[1]).sort();
  const declared = name => {
    const start = source.indexOf(`const ${name}`);
    const open = source.indexOf('[', start);
    return names(source.slice(open, source.indexOf(']', open)));
  };
  const emitted = name => {
    const start = sql.indexOf(`referral_${name}(p_field text)`);
    const open = sql.indexOf('select p_field in (', start);
    return names(sql.slice(open, sql.indexOf(')\n$', open)));
  };
  assert.deepEqual(declared('CLIENT_REFERRAL_FIELDS'), [...CLIENT].sort());
  assert.deepEqual(emitted('client_field'), [...CLIENT].sort());
  // The fourteen keys a capability owns inside `follow_up_requests`. A key
  // added there and not here would become one a client could forge.
  assert.equal(declared('FOLLOW_UP_CAPABILITY_FIELDS').length, 14);
  assert.deepEqual(emitted('follow_up_reserved'), declared('FOLLOW_UP_CAPABILITY_FIELDS'));

  const row = await seed(ADMIN_A, { patient_name: 'Ada', extracted_data: { dob: null } });
  for (const field of Object.keys(row)) {
    assert.equal(RESPONSE.has(field), true, `${field} is a response field`);
    assert.notEqual(row[field], null, `${field} is absent rather than null`);
  }
  // Provenance the contract stamps is stored and NOT disclosed.
  assert.equal(await column(row.id, 'created_by_user_email_normalized'), email(ADMIN_A));
  for (const field of ['created_by', 'created_by_user_id', 'created_by_user_email_normalized',
    'client_request_id', 'referral_creation_key', 'archived_at', 'archive_reason']) {
    assert.equal(Object.hasOwn(row, field), false, `${field} is not projected`);
  }
  // A null INSIDE a caller's own payload is theirs and is left alone:
  // `jsonb_strip_nulls` is recursive and would have edited it.
  assert.deepEqual(row.extracted_data, { dob: null });
});

test('a list is newest first, bounded, and never reaches another agency', async () => {
  const bounded = await list(ADMIN_A, { limit: 2 });
  assert.equal(bounded.referrals.length <= 2, true);
  await refusal(list(ADMIN_A, { limit: 0 }), 'PENNSYNC_REFERRAL_LIMIT_INVALID');
  await refusal(list(ADMIN_A, { limit: 5001 }), 'PENNSYNC_REFERRAL_LIMIT_INVALID');
  await refusal(list(ADMIN_A, { limit: null }), 'PENNSYNC_REFERRAL_LIMIT_INVALID');
  const all = (await list(ADMIN_A)).referrals;
  for (const row of all) assert.equal(row.agency_id, A);
  const dates = all.map(row => Date.parse(row.created_date));
  assert.deepEqual(dates, [...dates].sort((left, right) => right - left));
  // The status filter is the original's, and an invented one is refused rather
  // than answering an empty page.
  const created = await seed(ADMIN_A, { patient_name: 'Filter me', status: 'awaiting_info' });
  const filtered = (await list(ADMIN_A, { status: 'awaiting_info' })).referrals;
  assert.equal(filtered.every(row => row.status === 'awaiting_info'), true);
  assert.equal(filtered.some(row => row.id === created.id), true);
  await refusal(list(ADMIN_A, { status: 'invented' }), 'PENNSYNC_REFERRAL_STATUS_INVALID');
});
