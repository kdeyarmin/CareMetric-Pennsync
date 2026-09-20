import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { RECORD_MIGRATION_FILE, SCHEMA } from '../../../tools-entity-schema-plan.mjs';
import { BROKER_MIGRATION_FILE } from '../../../tools-record-brokers.mjs';
import { POLICY_SQL_FILES } from '../../../tools-read-purpose-policy.mjs';
import { VISIT_ACTIONS, VISIT_ACTIONS_SERVED, VISIT_ACTION_POLICY }
  from '../../pennsync-api/read-purpose-policy.mjs';
// The browser's own hash, imported rather than reimplemented: the point of
// `note_fnv1a` is that these two agree, and a copy here would agree with
// itself.
import { hashNoteText } from '../../../src/components/smartNote/emrHandoff.js';

/**
 * Documenting a visit (`contract_visit_update`).
 *
 * Four of the original's nine actions, and the shape of the port is the first
 * thing the cases pin: the other five are KNOWN and refused with a reason,
 * which is not the same answer as an action that does not exist. One of them
 * (`set_ai_tags`) is unported because D14 and D22 left it with no performer at
 * all, and that is a decision rather than an omission.
 *
 * Three authorizations, kept apart:
 *
 * - **The action** is extracted data — which inputs it accepts.
 * - **The role** is the contract's, because the original decides it in code,
 *   and it is `clinician` EXACTLY for the three clinical actions. An agency
 *   administrator opens every chart and does not document a visit.
 * - **The chart** is D24, through the `visit` policies, taken together with
 *   the row lock in one `select … for update`.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const UPDATE = 'services/authority-store/supabase/record-migrations/20260920150000_contract_visit_update.sql';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const pid = n => `7aac00000000${String(n).padStart(12, '0')}`;
const vid = n => `9bbd00000000${String(n).padStart(12, '0')}`;
const ADMIN_A = 1; const CLINICIAN_A = 2; const SOCIAL_A = 3;
const CALL = 'select "public"."pennsync_contract_visit_update"($1,$2,$3,$4) as result';
const A = 'agency-a'; const B = 'agency-b';
const MINE = pid(1); const THEIRS = pid(2); const DISCHARGED = pid(3);
const sha = text => createHash('sha256').update(text, 'utf8').digest('hex');
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
    POLICY_SQL_FILES.visit, UPDATE]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  await db.exec(`update pennsync_private.membership set tenant_role = 'social_worker'
    where id = 'membership-3'`);
  for (const [id, status] of [[MINE, 'active'], [THEIRS, 'active'], [DISCHARGED, 'discharged']]) {
    await db.query(`insert into ${SCHEMA}."patient"
      ("source_app_id","id","agency_id","status","is_sample","is_archived","first_name","last_name")
      values ($1,$2,$3,$4,false,false,'Ada','Lovelace')`, [APP, id, A, status]);
  }
  // The clinician's care team is MINE and DISCHARGED, never THEIRS.
  for (const id of [MINE, DISCHARGED]) {
    await db.query(`insert into pennsync_private.chart_assignment
      (app_id,agency_id,patient_id,membership_id,status,changed_by)
      values ($1,$2,$3,'membership-2','active',$4)`, [APP, A, id, uid(1)]);
  }
});
after(async () => db?.close());

/** A fresh visit per case, because an update COMMITS. */
async function seed(extra = {}, patient = MINE) {
  next += 1;
  const id = vid(next);
  const columns = {
    source_app_id: APP, id, agency_id: A, patient_id: patient, status: 'in_progress',
    visit_date: '2026-10-01', visit_type: 'routine_visit', is_sample: false,
    created_by_user_id: uid(2), created_by_user_email_normalized: 'user2@example.invalid',
    created_by: 'user2@example.invalid', emr_handoff_status: 'not_started',
    emr_handoff_history: JSON.stringify([]), updated_date: '2026-09-01 00:00:00+00', ...extra,
  };
  const names = Object.keys(columns);
  await db.query(`insert into ${SCHEMA}."visit" (${names.map(n => `"${n}"`).join(',')})
    values (${names.map((unused, i) => `$${i + 1}`).join(',')})`, names.map(n => columns[n]));
  return id;
}
async function act(n, id, action, fields = {}, agency = A) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
    const { rows } = await db.query(CALL, [agency, id, action, JSON.stringify(fields)]);
    await db.exec('commit');
    return rows[0].result;
  } catch (error) { await db.exec('rollback'); throw error; }
}
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);
const column = async (id, name) => (await db.query(
  `select "${name}" as value from ${SCHEMA}."visit" where "id" = $1`, [id])).rows[0].value;

test('a clinician documents a visit, and the fields reach the columns', async () => {
  const id = await seed();
  const answer = await act(CLINICIAN_A, id, 'save_documentation', {
    nurse_notes: 'Patient stable. BP 120/80.',
    status: 'completed',
    grounding_pending: false,
    vital_signs: { heart_rate: 72, weight: 180.5, pain_level: null },
    compliance_score: 93.5,
    compliance_issues: ['Missing homebound justification'],
    homebound_status_verified: true,
    documentation_source: 'smart_note',
    ai_tags: ['trend:stable', 'chart_flag:homebound'],
  });
  assert.equal(answer.updated, true);
  assert.equal(answer.action, 'save_documentation');
  assert.equal(answer.visit.status, 'completed');
  assert.equal(answer.visit.review_acknowledged, false);
  assert.equal(await column(id, 'nurse_notes'), 'Patient stable. BP 120/80.');
  // A cleared vital is REMOVED rather than stored as null, so clearing one
  // does not block the save.
  assert.deepEqual(await column(id, 'vital_signs'), { heart_rate: 72, weight: 180.5 });
  assert.equal(await column(id, 'compliance_score'), 93.5);
  assert.deepEqual(await column(id, 'ai_tags'), ['trend:stable', 'chart_flag:homebound']);
  assert.equal(await column(id, 'homebound_status_verified'), true);
  // The projection is the original's narrow one and carries none of the
  // clinical text back.
  assert.deepEqual(Object.keys(answer.visit).sort(), ['agency_id', 'emr_handoff_status',
    'id', 'patient_id', 'review_acknowledged', 'status', 'visit_time']);
});

test('the role is the contract\'s, and it is clinician exactly', async () => {
  const id = await seed();
  // The admin opens every chart in the agency under D24 and still may not
  // document a visit: `requireActionPolicy` names one role and it is not this
  // one. That is the whole reason the gate is written rather than inherited.
  for (const action of ['save_documentation', 'advance_handoff', 'set_review_ack']) {
    await refusal(act(ADMIN_A, id, action, action === 'save_documentation'
      ? { nurse_notes: 'x' } : action === 'advance_handoff'
        ? { next_status: 'copied_to_emr' } : { acknowledged: false }),
    'PENNSYNC_VISIT_CLINICIAN_REQUIRED');
  }
  // A social worker is refused for the same reason, and before the row is
  // even read: the role gate runs ahead of the `select`, so the answer does
  // not depend on whether they happen to be on this chart.
  await refusal(act(SOCIAL_A, id, 'save_documentation', { nurse_notes: 'x' }),
    'PENNSYNC_VISIT_CLINICIAN_REQUIRED');
  // `reschedule` has no gate of its own, so the policies decide it — and they
  // let an agency administrator through.
  const scheduled = await seed({ status: 'scheduled' });
  assert.equal((await act(ADMIN_A, scheduled, 'reschedule', { visit_time: '14:30' })).updated, true);
  assert.equal(await column(scheduled, 'visit_time'), '14:30');
});

test('five of the nine actions are known, refused, and say why', async () => {
  const id = await seed();
  assert.equal(VISIT_ACTIONS.length, 9);
  assert.deepEqual([...VISIT_ACTIONS_SERVED].sort(),
    ['advance_handoff', 'reschedule', 'save_documentation', 'set_review_ack']);
  for (const action of VISIT_ACTIONS.filter(name => !VISIT_ACTIONS_SERVED.includes(name))) {
    await refusal(act(CLINICIAN_A, id, action, {}), 'PENNSYNC_VISIT_ACTION_UNPORTED');
    // The reason travels with the refusal rather than living in a comment.
    assert.ok(VISIT_ACTION_POLICY[action].because.length > 40, action);
  }
  // `set_ai_tags` is the one that is unported by DECISION rather than by
  // dependency: D14 and D22 left it with no performer at all.
  assert.match(VISIT_ACTION_POLICY.set_ai_tags.because, /platform tier/);
  // And an action that does not exist is a different answer.
  await refusal(act(CLINICIAN_A, id, 'not_an_action', {}), 'PENNSYNC_VISIT_ACTION_UNKNOWN');
  await refusal(act(CLINICIAN_A, id, 'save_documentation', { next_status: 'copied_to_emr' }),
    'PENNSYNC_VISIT_FIELD_UNSUPPORTED');
});

test('new documentation invalidates an acknowledgement of the old text', async () => {
  const note = 'Reviewed and correct.';
  const id = await seed({ nurse_notes: note });
  const acked = await act(CLINICIAN_A, id, 'set_review_ack',
    { acknowledged: true, expected_note_hash: sha(note), nurse_edited: true });
  assert.equal(acked.visit.review_acknowledged, true);
  const ack = await column(id, 'documentation_review_ack');
  assert.equal(ack.acknowledged, true);
  assert.equal(ack.note_sha256, sha(note));
  assert.equal(ack.note_length, note.length);
  assert.equal(ack.nurse_edited, true);
  assert.equal(ack.ai_assisted, true);
  assert.equal(ack.is_clinical_signature, false, 'never a clinical signature');
  assert.match(ack.statement, /^I reviewed this suggested documentation/);
  assert.match(ack.acknowledged_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  // The browser would otherwise show a review that covers a note nobody read.
  await act(CLINICIAN_A, id, 'save_documentation', { nurse_notes: 'Rewritten.' });
  assert.equal(await column(id, 'documentation_review_ack'), null);
  // A transcription change counts too, because it is what the note is built
  // from.
  const other = await seed({ nurse_notes: note });
  await act(CLINICIAN_A, other, 'set_review_ack',
    { acknowledged: true, expected_note_hash: sha(note) });
  await act(CLINICIAN_A, other, 'save_documentation', { raw_transcription: 'new audio' });
  assert.equal(await column(other, 'documentation_review_ack'), null);
});

test('the stored note hash is the one the browser recomputes', async () => {
  // `isAcknowledgementStale` compares this against `hashNoteText(currentText)`
  // in the browser, so a different answer for one emoji would make every later
  // note look edited. The frontend function is imported rather than copied.
  for (const note of ['Patient stable.', 'café — naïve', 'emoji 🩺 here',
    '𝒜𝒷 mixed 🚑 ünïcödé', 'line one\nline two\ttab', 'x'.repeat(5000)]) {
    const id = await seed({ nurse_notes: note });
    await act(CLINICIAN_A, id, 'set_review_ack',
      { acknowledged: true, expected_note_hash: sha(note) });
    const ack = await column(id, 'documentation_review_ack');
    assert.equal(ack.note_hash, hashNoteText(note), JSON.stringify(note.slice(0, 24)));
    assert.equal(ack.note_sha256, sha(note));
  }
});

test('an acknowledgement covers the text it names and nothing else', async () => {
  const note = 'Reviewed and correct.';
  const id = await seed({ nurse_notes: note });
  await refusal(act(CLINICIAN_A, id, 'set_review_ack',
    { acknowledged: true, expected_note_hash: sha('different text') }),
  'PENNSYNC_VISIT_NOTE_CHANGED');
  await refusal(act(CLINICIAN_A, id, 'set_review_ack',
    { acknowledged: true, expected_note_hash: 'not-a-hash' }), 'PENNSYNC_VISIT_FIELDS_REQUIRED');
  await refusal(act(CLINICIAN_A, id, 'set_review_ack', {}), 'PENNSYNC_VISIT_FIELDS_REQUIRED');
  // A withdrawal carries nothing else: the other two describe a note being
  // acknowledged, and there is none.
  await refusal(act(CLINICIAN_A, id, 'set_review_ack',
    { acknowledged: false, nurse_edited: true }), 'PENNSYNC_VISIT_ACK_FIELDS_UNEXPECTED');
  assert.equal((await act(CLINICIAN_A, id, 'set_review_ack', { acknowledged: false }))
    .visit.review_acknowledged, false);
  // And a visit with no documentation has nothing to acknowledge.
  const blank = await seed({ nurse_notes: '   ' });
  await refusal(act(CLINICIAN_A, blank, 'set_review_ack',
    { acknowledged: true, expected_note_hash: sha('   ') }), 'PENNSYNC_VISIT_NO_DOCUMENTATION');
});

test('the EMR handoff advances one step and records who reported it', async () => {
  const id = await seed();
  const first = await act(CLINICIAN_A, id, 'advance_handoff', { next_status: 'copied_to_emr' });
  assert.equal(first.visit.emr_handoff_status, 'copied_to_emr');
  const history = await column(id, 'emr_handoff_history');
  assert.equal(history.length, 1);
  assert.equal(history[0].status, 'copied_to_emr');
  assert.equal(history[0].self_reported, true, 'self-reported, never an EMR confirmation');
  assert.equal(history[0].note, '');
  assert.match(history[0].reported_by, /@/);
  assert.match(history[0].reported_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  // Exactly one step: a skip would claim a stage nobody reported.
  await refusal(act(CLINICIAN_A, id, 'advance_handoff', { next_status: 'signed_in_emr' }),
    'PENNSYNC_VISIT_HANDOFF_STEP');
  await refusal(act(CLINICIAN_A, id, 'advance_handoff', { next_status: 'copied_to_emr' }),
    'PENNSYNC_VISIT_HANDOFF_STEP');
  await act(CLINICIAN_A, id, 'advance_handoff', { next_status: 'reviewed_in_emr' });
  assert.equal((await act(CLINICIAN_A, id, 'advance_handoff', { next_status: 'signed_in_emr' }))
    .visit.emr_handoff_status, 'signed_in_emr');
  assert.equal((await column(id, 'emr_handoff_history')).length, 3);
  // A history that does not describe the status it belongs to cannot be
  // extended into one that does.
  const broken = await seed({ emr_handoff_status: 'reviewed_in_emr',
    emr_handoff_history: JSON.stringify([{ status: 'copied_to_emr', reported_by: 'a@b.c',
      reported_at: '2026-09-01T00:00:00.000Z', self_reported: true, note: '' }]) });
  await refusal(act(CLINICIAN_A, broken, 'advance_handoff', { next_status: 'signed_in_emr' }),
    'PENNSYNC_VISIT_HANDOFF_HISTORY_INVALID');
  await refusal(act(CLINICIAN_A, id, 'advance_handoff', { next_status: 'nowhere' }),
    'PENNSYNC_VISIT_FIELDS_REQUIRED');
});

test('documentation lifecycle: cancelled is closed, completed does not regress', async () => {
  const cancelled = await seed({ status: 'cancelled' });
  await refusal(act(CLINICIAN_A, cancelled, 'save_documentation', { nurse_notes: 'x' }),
    'PENNSYNC_VISIT_CANCELLED');
  const completed = await seed({ status: 'completed' });
  await refusal(act(CLINICIAN_A, completed, 'save_documentation',
    { status: 'pending_review', grounding_pending: true }), 'PENNSYNC_VISIT_STATUS_REGRESSION');
  // `pending_review` means the grounding pass has not finished, so the two
  // must agree or the visit lands in a state nothing downstream can read.
  const open = await seed();
  await refusal(act(CLINICIAN_A, open, 'save_documentation',
    { status: 'pending_review', grounding_pending: false }),
  'PENNSYNC_VISIT_GROUNDING_INCONSISTENT');
  await refusal(act(CLINICIAN_A, open, 'save_documentation',
    { status: 'completed', grounding_pending: true }), 'PENNSYNC_VISIT_GROUNDING_INCONSISTENT');
  assert.equal((await act(CLINICIAN_A, open, 'save_documentation',
    { status: 'pending_review', grounding_pending: true })).updated, true);
  // Only a scheduled visit is rescheduled.
  await refusal(act(ADMIN_A, open, 'reschedule', { visit_time: '09:00' }),
    'PENNSYNC_VISIT_NOT_SCHEDULED');
});

test('the chart decides, and a discharged one closes every action', async () => {
  const theirs = await seed({}, THEIRS);
  await refusal(act(CLINICIAN_A, theirs, 'save_documentation', { nurse_notes: 'x' }),
    'PENNSYNC_VISIT_NOT_VISIBLE');
  await refusal(act(CLINICIAN_A, vid(9999), 'save_documentation', { nurse_notes: 'x' }),
    'PENNSYNC_VISIT_NOT_VISIBLE');
  await refusal(act(CLINICIAN_A, theirs, 'save_documentation', { nurse_notes: 'x' }, B),
    'PENNSYNC_VISIT_AGENCY_NOT_HELD');
  // The original's bundle requires an ACTIVE patient for every action.
  const discharged = await seed({}, DISCHARGED);
  await refusal(act(CLINICIAN_A, discharged, 'save_documentation', { nurse_notes: 'x' }),
    'PENNSYNC_VISIT_PATIENT_UNAVAILABLE');
  // And a patient_id assertion that does not match is refused, not ignored.
  const mine = await seed();
  await refusal(act(CLINICIAN_A, mine, 'save_documentation',
    { patient_id: THEIRS, nurse_notes: 'x' }), 'PENNSYNC_VISIT_PATIENT_MISMATCH');
  assert.equal((await act(CLINICIAN_A, mine, 'save_documentation',
    { patient_id: MINE, nurse_notes: 'x' })).updated, true);
});

test('a value the original would reject never reaches a column', async () => {
  const id = await seed();
  for (const [fields, code] of [
    [{ status: 'cancelled', grounding_pending: false }, 'PENNSYNC_VISIT_FIELD_INVALID'],
    [{ documentation_source: 'telepathy' }, 'PENNSYNC_VISIT_FIELD_INVALID'],
    [{ compliance_score: 101 }, 'PENNSYNC_VISIT_FIELD_INVALID'],
    [{ compliance_score: 'high' }, 'PENNSYNC_VISIT_FIELD_INVALID'],
    [{ homebound_status_verified: 'yes' }, 'PENNSYNC_VISIT_FIELD_INVALID'],
    [{ vital_signs: { blood_glucose: 90 } }, 'PENNSYNC_VISIT_FIELD_INVALID'],
    [{ vital_signs: { heart_rate: 'fast' } }, 'PENNSYNC_VISIT_FIELD_INVALID'],
    [{ vital_signs: { heart_rate: 2000000 } }, 'PENNSYNC_VISIT_FIELD_INVALID'],
    [{ vital_signs: [] }, 'PENNSYNC_VISIT_FIELD_INVALID'],
    [{ compliance_issues: [' leading space'] }, 'PENNSYNC_VISIT_FIELD_INVALID'],
    [{ compliance_issues: ['same', 'same'] }, 'PENNSYNC_VISIT_FIELD_INVALID'],
    [{ compliance_issues: ['with\u0007bell'] }, 'PENNSYNC_VISIT_FIELD_INVALID'],
    [{ compliance_issues: [''] }, 'PENNSYNC_VISIT_FIELD_INVALID'],
    [{ nurse_notes: 'x'.repeat(250001) }, 'PENNSYNC_VISIT_FIELD_INVALID'],
    [{ homebound_justification: 'x'.repeat(20001) }, 'PENNSYNC_VISIT_FIELD_INVALID'],
    // `save_documentation` writes only tags the system derived; a clinician
    // does not type one.
    [{ ai_tags: ['stable'] }, 'PENNSYNC_VISIT_TAG_NOT_SYSTEM'],
    [{ ai_tags: ['trend:ok', 'invented'] }, 'PENNSYNC_VISIT_TAG_NOT_SYSTEM'],
  ]) await refusal(act(CLINICIAN_A, id, 'save_documentation', fields), code);
  await refusal(act(CLINICIAN_A, id, 'save_documentation', {}), 'PENNSYNC_VISIT_FIELDS_REQUIRED');
  // An assertion alone is not a documentation change.
  await refusal(act(CLINICIAN_A, id, 'save_documentation', { patient_id: MINE }),
    'PENNSYNC_VISIT_FIELDS_REQUIRED');
  await refusal(act(CLINICIAN_A, id, 'reschedule', { visit_time: '25:00' }),
    'PENNSYNC_VISIT_FIELD_INVALID');
  assert.equal(await column(id, 'nurse_notes'), null, 'nothing was written');
});

test('the contract is the only way in, and it cannot be reached by a caller as itself', async () => {
  const sql = readFileSync(resolve(repository, UPDATE), 'utf8');
  const granted = async name => (await db.query(
    'select has_function_privilege($1,$2,$3) as ok', ['authenticated', name, 'execute'])).rows[0].ok;
  assert.equal(await granted('pennsync_records.note_fnv1a(text)'), false);
  assert.equal(await granted('pennsync_records.visit_documentation_value(text,jsonb)'), false);
  assert.equal(await granted('pennsync_records.visit_action_accepts(text,text)'), false);
  assert.equal(await granted('public.pennsync_contract_visit_update(text,text,text,jsonb)'), true);
  // The row is locked before anything is checked, which is what replaces the
  // original's forty-six column compare-and-swap.
  assert.match(sql, /for update;/);
  // And no delete path: the original undoes an acknowledgement it just wrote,
  // and a locked row has nothing to undo.
  assert.equal(/delete\s+from/i.test(sql), false, 'no delete path');
});
