import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { RECORD_MIGRATION_FILE } from '../../../tools-entity-schema-plan.mjs';
import { BROKER_MIGRATION_FILE } from '../../../tools-record-brokers.mjs';
import { POLICY_SQL_FILES } from '../../../tools-read-purpose-policy.mjs';

/**
 * Batch E's twelve call sites, and what each contract refuses.
 *
 * The build no longer checks a write route's arguments — an unprovable route is
 * declared and reported unproved rather than failing — so for the three writes
 * here this suite IS the proof, against the real migration rather than a
 * fixture of it. Every case below either drives a refusal by name or reads a
 * projection field by field; none of them asserts that something "works".
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const D = 'services/authority-store/supabase/record-migrations/';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN_A = 1; const CLINICIAN_A = 2; const UNASSIGNED_A = 3; const ADMIN_B = 4;
const A = 'agency-a'; const B = 'agency-b';
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, POLICY_SQL_FILES.patient,
    `${D}20260920060000_contract_patient_read.sql`,
    `${D}20260920580000_contract_screen_records.sql`]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  // Charts of record, which `pennsync_private.patient` is not: the fixtures
  // seed the staging model and D24 authorizes from `chart_assignment`, which
  // they also seed for patient-a1 and clinician-a.
  await db.exec(`
    insert into pennsync_records.patient (source_app_id, id, agency_id, first_name, last_name)
    values ('6a9881683dc68a0bd54f1ef7','patient-a1','agency-a','Ada','Lovelace'),
           ('6a9881683dc68a0bd54f1ef7','patient-a2','agency-a','Grace','Hopper'),
           ('6a9881683dc68a0bd54f1ef7','patient-b1','agency-b','Katherine','Johnson');
    insert into pennsync_records.clinical_event
      (source_app_id, id, patient_id, event_type, event_date, event_title,
       event_description, structured_data, severity, requires_followup, source_text, verified)
    values ('6a9881683dc68a0bd54f1ef7','event-1','patient-a1','fall','2026-09-10','A fall',
            'Found on the floor','{"place":"kitchen"}'::jsonb,'high',true,'Pt found on floor',false),
           ('6a9881683dc68a0bd54f1ef7','event-2','patient-a1','lab_result','2026-09-20','A lab',
            'Potassium high','{"k":5.9}'::jsonb,'medium',false,'K 5.9',true),
           ('6a9881683dc68a0bd54f1ef7','event-3','patient-a2','fall','2026-09-21','Another chart',
            'Not this one','{}'::jsonb,'low',false,'elsewhere',false);
    insert into pennsync_records.ocr_feedback
      (source_app_id, id, agency_id, created_date, correction_type, document_type,
       feedback_notes, applied_to_training, document_url, original_text, corrected_text)
    values ('6a9881683dc68a0bd54f1ef7','ocr-1','agency-a','2026-09-20','minor','fax',
            'a note',false,'https://files.invalid/x.pdf','raw','fixed'),
           ('6a9881683dc68a0bd54f1ef7','ocr-2','agency-a','2026-09-21','major','referral',
            'another',true,'https://files.invalid/y.pdf','raw2','fixed2'),
           ('6a9881683dc68a0bd54f1ef7','ocr-3','agency-b','2026-09-22','minor','fax',
            'other agency',false,'https://files.invalid/z.pdf','raw3','fixed3');
    -- The corrections have owners, and the two in agency-a have DIFFERENT
    -- ones, which is the only seeding under which the entity's own
    -- "user_email = {{user.email}}" rule can be told apart from the table's
    -- agency-wide policy.
    update pennsync_records.ocr_feedback set user_email = 'clinician-a@example.invalid'
      where id = 'ocr-1';
    update pennsync_records.ocr_feedback set user_email = 'admin-a@example.invalid'
      where id in ('ocr-2','ocr-3');
    insert into pennsync_records.ocr_training_session
      (source_app_id, id, agency_id, created_date, status, session_name, feedback_count, ai_insights)
    values ('6a9881683dc68a0bd54f1ef7','run-1','agency-a','2026-09-20','completed','First',5,'model prose'),
           ('6a9881683dc68a0bd54f1ef7','run-2','agency-b','2026-09-21','failed','Theirs',1,'model prose');
    insert into pennsync_records.sent_education_material
      (source_app_id, id, patient_id, material_title, patient_name, sent_by, sent_date,
       delivery_method, personalized_content)
    values ('6a9881683dc68a0bd54f1ef7','sent-1','patient-a1','Falls at home','Ada Lovelace',
            'clinician-a@example.invalid','2026-09-20','printed','the whole body'),
           ('6a9881683dc68a0bd54f1ef7','sent-2','patient-a2','Diet','Grace Hopper',
            'admin-a@example.invalid','2026-09-21','email','other body'),
           -- On a chart clinician-a DOES open, sent by somebody else. Without
           -- it the chart policy and the sender rule refuse the same rows and
           -- a test cannot tell which one answered.
           ('6a9881683dc68a0bd54f1ef7','sent-3','patient-a1','Wound care','Ada Lovelace',
            'admin-a@example.invalid','2026-09-22','email','third body');
    insert into pennsync_records.patient_recommendation
      (source_app_id, id, patient_id, created_date, status, title, description, ai_rationale)
    values ('6a9881683dc68a0bd54f1ef7','rec-1','patient-a1','2026-09-20','completed','T1','D1','why one'),
           ('6a9881683dc68a0bd54f1ef7','rec-2','patient-a1','2026-09-21','pending','T2','D2','why two');
    -- A preference row addressed to one person and written by another: the
    -- entity's CREATE rule is the address alone, its UPDATE rule is the address
    -- AND "created_by", and nothing else in this file can reach that gap.
    insert into pennsync_records.notification_preference
      (source_app_id, id, created_by, user_email, digest_mode)
    values ('6a9881683dc68a0bd54f1ef7','pref-foreign','admin-a@example.invalid',
            'clinician-empty@example.invalid','daily');
    insert into pennsync_records.compliance_rule
      (source_app_id, id, rule_name, rule_code, rule_category, description, severity, is_active)
    values ('6a9881683dc68a0bd54f1ef7','rule-1','Timely filing','CMS-TF-1','medicare_cop',
            'File within 5 days','high',true);
  `);
});
after(async () => db?.close());

/** A read, rolled back: nothing below is allowed to leave a row behind. */
async function as(n, sql, params = []) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
    const { rows } = await db.query(sql, params);
    return rows[0].result;
  } finally { await db.exec('rollback'); }
}
/** A write that COMMITS, for the cases that read the row back afterwards. */
async function write(n, sql, params = []) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
    const { rows } = await db.query(sql, params);
    await db.exec('commit');
    return rows[0].result;
  } catch (error) { await db.exec('rollback'); throw error; }
}
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);

const EVENTS = 'select public.pennsync_contract_clinical_event_list($1,$2,$3) as result';
const OCR = 'select public.pennsync_contract_ocr_feedback_list($1,$2,$3) as result';
const RUNS = 'select public.pennsync_contract_ocr_training_list($1,$2) as result';
const SENT = 'select public.pennsync_contract_sent_education_list($1,$2) as result';
const RECS = 'select public.pennsync_contract_patient_recommendation_list($1,$2,$3) as result';
const RULE = 'select public.pennsync_contract_compliance_rule_lookup($1,$2,$3) as result';
const SEND = 'select public.pennsync_contract_sent_education_record($1,$2,$3) as result';
const PUSH = 'select public.pennsync_contract_patient_recommendation_record($1,$2,$3) as result';
const PREF_GET = 'select public.pennsync_contract_notification_preference_get($1,$2) as result';
const PREF_SAVE = 'select public.pennsync_contract_notification_preference_save($1,$2,$3) as result';

test('the timeline gets its chart, newest first, with the source text the review withholds', async () => {
  const answer = await as(CLINICIAN_A, EVENTS, [A, 'patient-a1', 200]);
  assert.deepEqual(answer.events.map(e => e.id), ['event-2', 'event-1']);
  // The contrast with D64's review, which projects no `source_text` because it
  // hands its rows to a model. This one answers a care-team display.
  assert.equal(answer.events[0].source_text, 'K 5.9');
  assert.equal(answer.events[1].structured_data.place, 'kitchen');
  // And a verified event is present, which the review's `verified = false`
  // filter would have dropped — the reason it could not serve this call.
  assert.equal(answer.events[0].verified, true);
});

test('a chart the caller may not open is refused, and so is an agency they do not hold', async () => {
  await refusal(as(UNASSIGNED_A, EVENTS, [A, 'patient-a1', 200]),
    'PENNSYNC_SCREEN_PATIENT_NOT_VISIBLE');
  await refusal(as(ADMIN_B, EVENTS, [A, 'patient-a1', 200]), 'PENNSYNC_SCREEN_AGENCY_NOT_HELD');
  await refusal(as(ADMIN_A, EVENTS, [A, 'not a chart id!', 200]), 'PENNSYNC_SCREEN_SUBJECT_INVALID');
  // An admin opens every chart in their own agency and none in another's.
  assert.equal((await as(ADMIN_A, EVENTS, [A, 'patient-a2', 200])).events.length, 1);
  await refusal(as(ADMIN_A, EVENTS, [A, 'patient-b1', 200]), 'PENNSYNC_SCREEN_PATIENT_NOT_VISIBLE');
});

test('a caller cannot raise the page ceiling', async () => {
  // D71: a bound a caller can raise is not a bound. Asking for a thousand
  // events gets the ceiling, and asking for zero or a negative gets one row.
  const { rows } = await db.query('select pennsync_records.screen_limit($1,$2) as n', [100000, 200]);
  assert.equal(rows[0].n, 200);
  assert.equal((await db.query('select pennsync_records.screen_limit($1,$2) as n', [0, 200])).rows[0].n, 1);
  assert.equal((await db.query('select pennsync_records.screen_limit($1,$2) as n', [null, 200])).rows[0].n, 200);
});

test('the OCR reads are the agency\'s own, and the predicate is the second call site', async () => {
  assert.deepEqual((await as(ADMIN_A, OCR, [A, null, 100])).entries.map(e => e.id), ['ocr-2', 'ocr-1']);
  assert.deepEqual((await as(ADMIN_A, OCR, [A, false, 500])).entries.map(e => e.id), ['ocr-1']);
  assert.deepEqual((await as(ADMIN_A, OCR, [A, true, 500])).entries.map(e => e.id), ['ocr-2']);
  // Another agency's corrections are not in it, and the document itself never
  // leaves the store.
  const [row] = (await as(ADMIN_A, OCR, [A, null, 100])).entries;
  for (const absent of ['document_url', 'original_text', 'corrected_text', 'original_ocr_text']) {
    assert.equal(row[absent], undefined, `${absent} must not be projected`);
  }
  assert.deepEqual((await as(ADMIN_B, OCR, [B, null, 100])).entries.map(e => e.id), ['ocr-3']);
  assert.deepEqual((await as(ADMIN_A, RUNS, [A, 50])).entries.map(e => e.id), ['run-1']);
  assert.equal((await as(ADMIN_A, RUNS, [A, 50])).entries[0].ai_insights, undefined);
});

test('a correction is its author\'s, and the training panel is the admin\'s alone', async () => {
  // The entity's access block is `user_email = {{user.email}}` OR the platform
  // admin, and `ocr_feedback` here is agency-WIDE -- so this is the assertion
  // that says the contract, and not the policy, is answering. Both rows are in
  // clinician-a's agency and they see exactly the one they wrote.
  assert.deepEqual((await as(CLINICIAN_A, OCR, [A, null, 100])).entries.map(e => e.id), ['ocr-1']);
  assert.deepEqual((await as(CLINICIAN_A, OCR, [A, true, 500])).entries, []);
  // A colleague who wrote none sees none, and that is not the same statement
  // as the agency having none: admin-a above reads two.
  assert.deepEqual((await as(UNASSIGNED_A, OCR, [A, null, 100])).entries, []);

  // `OCRTrainingSession` gates all four operations on the platform tier, whose
  // successor is an `agency_admin` (D40) -- so a clinician is REFUSED rather
  // than answered with an empty list, because an empty list is a claim about
  // the agency and a refusal is a claim about the caller.
  await refusal(as(CLINICIAN_A, RUNS, [A, 50]), 'PENNSYNC_SCREEN_AGENCY_ADMIN_REQUIRED');
  await refusal(as(UNASSIGNED_A, RUNS, [A, 50]), 'PENNSYNC_SCREEN_AGENCY_ADMIN_REQUIRED');
});

test('the education panel is the sender\'s own, on top of the chart policy', async () => {
  // `sent-3` is on patient-a1, a chart clinician-a DOES open, and was sent by
  // somebody else. Without it this test would pass on the chart narrowing
  // alone and prove nothing about the entity's `sent_by` rule.
  assert.deepEqual((await as(CLINICIAN_A, SENT, [A, 50])).entries.map(e => e.id), ['sent-1']);
  // The admin half is D40's, so the agency admin reads all three -- including
  // sent-1, which they did not send.
  assert.deepEqual((await as(ADMIN_A, SENT, [A, 50])).entries.map(e => e.id),
    ['sent-3', 'sent-2', 'sent-1']);
  assert.equal((await as(ADMIN_A, SENT, [A, 50])).entries[0].personalized_content, undefined);
  // And the chart narrowing is still the floor under the sender rule: a
  // colleague who sent nothing reads nothing.
  assert.deepEqual((await as(UNASSIGNED_A, SENT, [A, 50])).entries, []);
});

test('the analyser gets the one field it reads and nothing else', async () => {
  const answer = await as(CLINICIAN_A, RECS, [A, 'patient-a1', 30]);
  assert.deepEqual(answer.entries.map(e => e.status), ['pending', 'completed']);
  // Everything the screen never looks at, and that would otherwise ride into a
  // model's context.
  for (const absent of ['title', 'description', 'ai_rationale', 'patient_id']) {
    assert.equal(answer.entries[0][absent], undefined, `${absent} must not be projected`);
  }
});

test('the rule catalogue is global, and is still an administrator\'s read', async () => {
  assert.deepEqual((await as(ADMIN_A, RULE, [A, 'CMS-TF-1', 2])).entries.map(e => e.rule_code),
    ['CMS-TF-1']);
  // Global means every tenant reads the same catalogue, not that anybody may.
  assert.deepEqual((await as(ADMIN_B, RULE, [B, 'CMS-TF-1', 2])).entries.length, 1);
  await refusal(as(ADMIN_B, RULE, [A, 'CMS-TF-1', 2]), 'PENNSYNC_SCREEN_AGENCY_NOT_HELD');
  await refusal(as(ADMIN_A, RULE, [A, null, 2]), 'PENNSYNC_SCREEN_RULE_CODE_INVALID');
  assert.deepEqual((await as(ADMIN_A, RULE, [A, 'CMS-NOPE', 2])).entries, []);
  // The table's policy is `caller_identified()`, so the store alone would have
  // answered a clinician. The entity's access block is `role === 'admin'` on
  // read, create and update alike, and its one consumer is behind an
  // `adminOnly` route, so D40's successor gates the read.
  await refusal(as(CLINICIAN_A, RULE, [A, 'CMS-TF-1', 2]), 'PENNSYNC_SCREEN_AGENCY_ADMIN_REQUIRED');
});

test('recording a send takes its subject, its sender and its clock from the store', async () => {
  const answer = await write(CLINICIAN_A, SEND, [A, 'patient-a1', JSON.stringify({
    material_id: 'mat-1', material_title: 'Falls', personalized_content: 'body',
    delivery_method: 'printed', notes: 'n',
  })]);
  assert.equal(answer.success, true);
  // Not the caller's copy of the name: the chart's.
  assert.equal(answer.patient_name, 'Ada Lovelace');
  const { rows } = await db.query(
    `select "sent_by","created_by","patient_id","patient_acknowledged","sent_date"
     from pennsync_records.sent_education_material where id = $1`, [answer.id]);
  assert.equal(rows[0].sent_by, 'clinician-a@example.invalid');
  assert.equal(rows[0].created_by, 'clinician-a@example.invalid');
  assert.equal(rows[0].patient_id, 'patient-a1');
  assert.equal(rows[0].patient_acknowledged, null, 'the patient answers this, not the sender');
  assert.ok(rows[0].sent_date, 'the server clock stamps it');
  await db.query('delete from pennsync_records.sent_education_material where id = $1', [answer.id]);
});

test('a send refuses a field the caller does not own, by name rather than by dropping it', async () => {
  for (const extra of [{ patient_name: 'Someone Else' }, { sent_by: 'admin-a@example.invalid' },
    { patient_acknowledged: true }, { patient_id: 'patient-a2' }, { notez: 'typo' }]) {
    await refusal(write(CLINICIAN_A, SEND, [A, 'patient-a1', JSON.stringify({
      material_id: 'm', material_title: 't', ...extra,
    })]), 'PENNSYNC_SCREEN_FIELD_NOT_WRITABLE');
  }
  await refusal(write(UNASSIGNED_A, SEND, [A, 'patient-a1', JSON.stringify({ material_id: 'm' })]),
    'PENNSYNC_SCREEN_PATIENT_NOT_VISIBLE');
  await refusal(write(CLINICIAN_A, SEND, [A, 'patient-a1', 'null']),
    'PENNSYNC_SCREEN_PAYLOAD_INVALID');
});

test('a pushed recommendation keeps the reviewer\'s fields out, and its status stays null', async () => {
  const answer = await write(ADMIN_A, PUSH, [A, 'patient-a1', JSON.stringify({
    source_type: 'oasis_analysis', source_id: 'up-1', recommendation_type: 'compliance',
    title: 'T', description: 'D', priority: 'high', ai_rationale: 'R',
    expected_impact: 'I', implementation_steps: ['one'], suggested_by_user: 'AI Assistant',
    expires_at: '2026-10-25T00:00:00Z',
  })]);
  const { rows } = await db.query(
    `select "status","reviewed_by","patient_id","created_by","implementation_steps"
     from pennsync_records.patient_recommendation where id = $1`, [answer.id]);
  // The recorded defect: the original writes no status, so the analyser's
  // `pending` count is zero for everything this creates. Reproduced on purpose.
  assert.equal(rows[0].status, null);
  assert.equal(rows[0].reviewed_by, null);
  assert.equal(rows[0].patient_id, 'patient-a1');
  assert.equal(rows[0].created_by, 'admin-a@example.invalid');
  assert.deepEqual(rows[0].implementation_steps, ['one']);
  for (const extra of [{ status: 'completed' }, { reviewed_by: 'x' }, { reviewed_at: 'now' },
    { implemented_at: 'now' }, { implementation_notes: 'n' }, { patient_id: 'patient-a2' }]) {
    await refusal(write(ADMIN_A, PUSH, [A, 'patient-a1', JSON.stringify({ title: 'T', ...extra })]),
      'PENNSYNC_SCREEN_FIELD_NOT_WRITABLE');
  }
  await db.query('delete from pennsync_records.patient_recommendation where id = $1', [answer.id]);
});

test('preferences are the caller\'s own row, saved once however many times it is saved', async () => {
  assert.deepEqual(await as(CLINICIAN_A, PREF_GET, [A, null]),
    { success: true, found: false, preference: null });
  const body = {
    email_notifications_enabled: true, in_app_notifications_enabled: true,
    push_notifications_enabled: false, preferences: { info: { email: false } },
    quiet_hours: { enabled: false }, digest_mode: 'daily', sound_enabled: true,
  };
  const first = await write(CLINICIAN_A, PREF_SAVE, [A, null, JSON.stringify(body)]);
  // The screen's second save sends the id it is now holding, which is the
  // update branch and has to be answered rather than dropped.
  const second = await write(CLINICIAN_A, PREF_SAVE, [A, first.id,
    JSON.stringify({ ...body, digest_mode: 'weekly' })]);
  // D78: the screen's own create-or-update branch is what this replaces, and
  // the index is why saving twice is one row rather than two.
  assert.equal(first.id, second.id);
  const answer = await as(CLINICIAN_A, PREF_GET, [A, null]);
  assert.equal(answer.found, true);
  assert.equal(answer.preference.digest_mode, 'weekly');
  assert.equal(answer.preference.user_email, 'clinician-a@example.invalid');
  // Somebody else's preferences are not readable and not writable: the address
  // is the caller's, and the payload may not name one.
  assert.equal((await as(ADMIN_A, PREF_GET, [A, null])).found, false);
  await refusal(write(CLINICIAN_A, PREF_SAVE, [A, null,
    JSON.stringify({ ...body, user_email: 'admin-a@example.invalid' })]),
    'PENNSYNC_SCREEN_FIELD_NOT_WRITABLE');
  await refusal(write(CLINICIAN_A, PREF_SAVE, [A, null, JSON.stringify({ ...body, id: 'x' })]),
    'PENNSYNC_SCREEN_FIELD_NOT_WRITABLE');
  // Somebody else's address on the READ, and somebody else's row id on the
  // SAVE, are refused rather than answered with this caller's own.
  await refusal(as(CLINICIAN_A, PREF_GET, [A, 'admin-a@example.invalid']),
    'PENNSYNC_SCREEN_NOT_YOUR_ROWS');
  await refusal(write(CLINICIAN_A, PREF_SAVE, [A, 'pref-foreign', JSON.stringify(body)]),
    'PENNSYNC_SCREEN_NOT_YOUR_ROWS');
  assert.equal((await as(CLINICIAN_A, PREF_GET, [A, 'clinician-a@example.invalid'])).found, true);
  // Only this caller's rows: `pref-foreign` below is seeded state.
  await db.query('delete from pennsync_records.notification_preference where created_by = $1',
    ['clinician-a@example.invalid']);
});

test('a preference row somebody else wrote is refused, not silently left alone', async () => {
  // The entity's CREATE rule is the address alone and its UPDATE rule is the
  // address AND `created_by`, so a row addressed to clinician-empty but
  // written by admin-a is readable by them and not theirs to change.
  const seen = await as(UNASSIGNED_A, PREF_GET, [A, null]);
  assert.equal(seen.found, true);
  assert.equal(seen.preference.digest_mode, 'daily');
  await refusal(write(UNASSIGNED_A, PREF_SAVE, [A, null, JSON.stringify({ digest_mode: 'weekly' })]),
    'PENNSYNC_SCREEN_PREFERENCE_NOT_OWNED');
  // A `do update` whose WHERE fails changes nothing and returns nothing, so
  // the refusal above is the only thing standing between that and a save the
  // screen would report as successful. Prove the row really did not move.
  const { rows } = await db.query(
    'select digest_mode from pennsync_records.notification_preference where id = $1',
    ['pref-foreign']);
  assert.equal(rows[0].digest_mode, 'daily');
});

test('the helpers are the record owner\'s, and no caller role may ask them', async () => {
  for (const fn of ['screen_agency_held(text)', 'screen_chart(text,text)',
    'screen_agency_admin(text)', 'screen_agency_admin_required(text)',
    'screen_exact_keys(jsonb,text[])']) {
    const { rows } = await db.query(
      `select has_function_privilege('authenticated', 'pennsync_records.${fn}', 'execute') as ok`);
    assert.equal(rows[0].ok, false, `${fn} must not be callable by a caller role`);
  }
});
