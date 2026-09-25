import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { RECORD_MIGRATION_FILE, readSchemas } from '../../../tools-entity-schema-plan.mjs';
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
// A caller who holds BOTH agencies, seeded here because the shared fixtures
// give every identity exactly one membership -- under which the policies
// refuse a cross-agency row on their own and a test of the contract's own
// binding passes with that binding deleted.
const DUAL = 5;
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
    -- One row per bound capability in the OTHER agency, so each binding can be
    -- neutralised on its own and the failure names the entity.
    insert into pennsync_records.clinical_event
      (source_app_id, id, patient_id, event_type, event_date, event_title, event_description)
    values ('6a9881683dc68a0bd54f1ef7','event-b1','patient-b1','fall','2026-09-22',
            'Their chart','not ours');
    insert into pennsync_records.patient_recommendation
      (source_app_id, id, patient_id, created_date, status, title, description)
    values ('6a9881683dc68a0bd54f1ef7','rec-b1','patient-b1','2026-09-22','pending','TB','DB');
    insert into pennsync_records.sent_education_material
      (source_app_id, id, patient_id, material_title, patient_name, sent_by, sent_date,
       delivery_method, personalized_content)
    values ('6a9881683dc68a0bd54f1ef7','sent-b1','patient-b1','Theirs','Katherine Johnson',
            'dual@example.invalid','2026-09-22','email','their body');
    insert into auth.users(id,email,email_confirmed_at)
      values ('10000000-0000-4000-8000-000000000005','dual@example.invalid',clock_timestamp());
    insert into auth.sessions(id,user_id,not_after)
      values ('20000000-0000-4000-8000-000000000005',
              '10000000-0000-4000-8000-000000000005',clock_timestamp()+interval '1 hour');
    insert into pennsync_private.identity_map
      (app_id,auth_user_id,base44_user_id,expected_email,source_evidence_sha256,verified_at)
      values ('6a9881683dc68a0bd54f1ef7','10000000-0000-4000-8000-000000000005',
              '6aac00000000000000000005','dual@example.invalid',repeat('a',64),clock_timestamp());
    insert into pennsync_private.membership
      (app_id,id,agency_id,auth_user_id,base44_user_id,tenant_role,status)
    values ('6a9881683dc68a0bd54f1ef7','membership-5a','agency-a',
            '10000000-0000-4000-8000-000000000005','6aac00000000000000000005',
            'agency_admin','active'),
           ('6a9881683dc68a0bd54f1ef7','membership-5b','agency-b',
            '10000000-0000-4000-8000-000000000005','6aac00000000000000000005',
            'agency_admin','active');
    insert into pennsync_records.compliance_rule
      (source_app_id, id, rule_name, rule_code, rule_category, description, severity, is_active)
    values ('6a9881683dc68a0bd54f1ef7','rule-1','Timely filing','CMS-TF-1','medicare_cop',
            'File within 5 days','high',true);
    -- A row on a chart that was never carried into this store: the entity kept
    -- its patient id and no patient row answers to it. D61's failure mode,
    -- and the case a chart guard is accused of hiding from everybody. Seeded
    -- so the accusation can be measured against the POLICY rather than argued.
    insert into pennsync_records.clinical_event
      (source_app_id, id, patient_id, event_type, event_date, event_title, event_description)
    values ('6a9881683dc68a0bd54f1ef7','event-gone','patient-gone','fall','2026-09-23',
            'An uncarried chart','no patient row answers to this id');
    insert into pennsync_records.patient_recommendation
      (source_app_id, id, patient_id, created_date, status, title, description)
    values ('6a9881683dc68a0bd54f1ef7','rec-gone','patient-gone','2026-09-23','pending','TG','DG');
    insert into pennsync_records.sent_education_material
      (source_app_id, id, patient_id, material_title, patient_name, sent_by, sent_date,
       delivery_method, personalized_content)
    values ('6a9881683dc68a0bd54f1ef7','sent-gone','patient-gone','Gone','Nobody',
            'admin-a@example.invalid','2026-09-23','email','orphan body');
  `);
  // A TEST DOUBLE, and the only way to ask what the POLICIES grant. The caller
  // helpers refuse unless `current_setting('role')` is `authenticated`
  // (`pennsync_private.actor`), and `authenticated` is granted nothing on a
  // record table -- deliberately, because an RLS policy runs with the querying
  // role's privileges. So a bare read answers `permission denied` for a reason
  // that has nothing to do with the question. This reproduces a contract's own
  // execution context and asks for NOTHING else: definer, owned by the record
  // owner, which holds no BYPASSRLS while every record table is FORCE RLS.
  await db.exec(`
    grant create on schema public to pennsync_records_owner;
    set role pennsync_records_owner;
    create function public.zz_policy_visible(p_entity text, p_patient text) returns integer
      language plpgsql stable security definer set search_path = '' as $zz$
      declare v_n integer;
      begin
        if p_entity = 'clinical_event' then
          select count(*) into v_n from "pennsync_records"."clinical_event"
            where "patient_id" = p_patient;
        elsif p_entity = 'patient_recommendation' then
          select count(*) into v_n from "pennsync_records"."patient_recommendation"
            where "patient_id" = p_patient;
        elsif p_entity = 'sent_education_material' then
          select count(*) into v_n from "pennsync_records"."sent_education_material"
            where "patient_id" = p_patient;
        else raise exception 'no such entity %', p_entity;
        end if;
        return v_n;
      end $zz$;
    reset role;
    grant execute on function public.zz_policy_visible(text,text) to authenticated;
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
  // The entity's declared default, stamped here because the store emits none.
  // Still not the sender's to set: it is absent from the writable field list.
  assert.equal(rows[0].patient_acknowledged, false);
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

test('a pushed recommendation keeps the reviewer\'s fields out and gets its defaults', async () => {
  const answer = await write(ADMIN_A, PUSH, [A, 'patient-a1', JSON.stringify({
    source_type: 'oasis_analysis', source_id: 'up-1', recommendation_type: 'compliance',
    title: 'T', description: 'D', priority: 'high', ai_rationale: 'R',
    expected_impact: 'I', implementation_steps: ['one'], suggested_by_user: 'AI Assistant',
    expires_at: '2026-10-25T00:00:00Z',
  })]);
  const { rows } = await db.query(
    `select "status","reviewed_by","patient_id","created_by","implementation_steps"
     from pennsync_records.patient_recommendation where id = $1`, [answer.id]);
  // Not null: the entity declares `default: "pending"` and the generated store
  // emits no defaults, so a null here would be this store's defect rather than
  // the product's -- and the analyser counts `status === 'pending'`.
  assert.equal(rows[0].status, 'pending');
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

test('a caller holding two agencies gets only the agency they named', async () => {
  // THE FIXTURE, NOT THE ASSERTION, IS WHAT THIS PROVES. With one membership
  // each -- which is what the shared fixtures give every identity -- the
  // policies refuse the other agency's rows on their own, and every case below
  // passes with the contract's binding DELETED. `DUAL` holds both agencies as
  // an administrator, so the policies admit both and only each contract's own
  // binding stands between a request naming agency A and agency B's rows.
  //
  // Each capability is checked on its own, so a failure names the entity: the
  // two chart reads and the two writes bind through `screen_chart`, the OCR
  // pair through their own `agency_id` term, and the education panel through a
  // join it has to write out because it takes no subject.
  const held = await db.query(
    "select count(*)::int as n from pennsync_private.membership " +
    "where auth_user_id = '10000000-0000-4000-8000-000000000005' and status = 'active'");
  assert.equal(held.rows[0].n, 2, 'every case here is vacuous unless this caller holds both');

  // The timeline answers under `events` and the rest under `entries`; both are
  // read rather than assumed, so a renamed key fails here rather than turning
  // every case below into a vacuous "saw nothing".
  const ids = answer => {
    const list = answer.events ?? answer.entries;
    assert.ok(Array.isArray(list), `no list in ${JSON.stringify(answer)}`);
    return list.map(entry => entry.id);
  };
  const bound = [
    // [what it is, the call, its agency-A arguments, its agency-B arguments,
    //  the row that is only in agency B]
    ['clinical events', EVENTS, [A, 'patient-b1', 50], [B, 'patient-b1', 50], 'event-b1'],
    ['recommendations', RECS, [A, 'patient-b1', 50], [B, 'patient-b1', 50], 'rec-b1'],
    ['OCR corrections', OCR, [A, null, 50], [B, null, 50], 'ocr-3'],
    ['OCR training runs', RUNS, [A, 50], [B, 50], 'run-2'],
    ['the education panel', SENT, [A, 50], [B, 50], 'sent-b1'],
  ];
  for (const [what, call, inA, inB, only] of bound) {
    // Naming agency B, this caller really does reach the row -- so a refusal or
    // an absence under agency A is the binding and not a chart they could never
    // open. A case whose positive half does not hold proves nothing.
    assert.ok(ids(await as(DUAL, call, inB)).includes(only),
      `${what}: the caller cannot reach ${only} even when they name its agency`);
    if (call === EVENTS || call === RECS) {
      await refusal(as(DUAL, call, inA), 'PENNSYNC_SCREEN_PATIENT_NOT_VISIBLE');
    } else {
      assert.ok(!ids(await as(DUAL, call, inA)).includes(only),
        `${what}: a request naming agency A answered with agency B's ${only}`);
    }
  }

  // The two writes, whose binding is the same `screen_chart` the chart reads
  // use and, for the send, a second lookup of the subject's own name.
  const reached = await write(DUAL, SEND, [B, 'patient-b1', JSON.stringify({
    material_id: 'm', personalized_content: 'c' })]);
  assert.equal(reached.success, true, 'the caller can write this chart when they name its agency');
  await db.query('delete from pennsync_records.sent_education_material where id = $1',
    [reached.id]);
  await refusal(write(DUAL, SEND, [A, 'patient-b1', JSON.stringify({
    material_id: 'm', personalized_content: 'c' })]), 'PENNSYNC_SCREEN_PATIENT_NOT_VISIBLE');
  await refusal(write(DUAL, PUSH, [A, 'patient-b1', JSON.stringify({
    source_type: 's', recommendation_type: 'r', title: 'T', description: 'D' })]),
    'PENNSYNC_SCREEN_PATIENT_NOT_VISIBLE');

  // AND THE COUNTER-CASE, because restating tenancy where there is none is the
  // same defect from the other side: `compliance_rule` is D83's global
  // reference table with one read policy and no tenant column, so this caller
  // SHOULD see the same catalogue whichever agency they name.
  const catalogue = ids(await as(DUAL, RULE, [A, 'CMS-TF-1', 50]));
  assert.ok(catalogue.length > 0, 'two empty lists are equal and prove nothing');
  assert.deepEqual(catalogue, ids(await as(DUAL, RULE, [B, 'CMS-TF-1', 50])));
});

test('a caller holding ONE agency is refused the other agency\'s chart, and the refusal is the contract\'s', async () => {
  // THE OTHER HALF, and the one that distinguishes a guard that works from one
  // that protects only the person already safe. A negative existence check --
  // "refuse if the chart is provably elsewhere" -- fails OPEN here: the
  // subquery runs inside a SECURITY DEFINER under forced RLS with the caller's
  // own claims and the record owner holds no BYPASSRLS, so the foreign chart
  // that would prove the row foreign is invisible to exactly the caller who
  // needs protecting, and the guard hides the row for a dual-agency caller
  // while leaving it visible to a single-agency one.
  //
  // `screen_chart` is the opposite shape: a POSITIVE requirement that the
  // patient row be visible AND carry the named agency. An invisible row makes
  // it null, and null RAISES. That is a claim about a failure mode, so it is
  // measured here rather than reasoned about.
  const single = await db.query(
    "select count(*)::int as n from pennsync_private.membership " +
    "where auth_user_id = $1 and status = 'active'",
    ['10000000-0000-4000-8000-000000000001']);
  assert.equal(single.rows[0].n, 1, 'this case needs a caller who holds exactly one agency');
  // And the chart really is in the other agency, which is what makes it the
  // crossed case rather than a missing row.
  const chart = await db.query(
    "select agency_id from pennsync_records.patient where id = 'patient-b1'");
  assert.equal(chart.rows[0].agency_id, B);

  for (const [what, call, args] of [
    ['the timeline', EVENTS, [A, 'patient-b1', 50]],
    ['the recommendations read', RECS, [A, 'patient-b1', 50]],
  ]) {
    await refusal(as(ADMIN_A, call, args), 'PENNSYNC_SCREEN_PATIENT_NOT_VISIBLE');
    assert.ok(what);
  }
  await refusal(write(ADMIN_A, SEND, [A, 'patient-b1', JSON.stringify({
    material_id: 'm', personalized_content: 'c' })]), 'PENNSYNC_SCREEN_PATIENT_NOT_VISIBLE');
  await refusal(write(ADMIN_A, PUSH, [A, 'patient-b1', JSON.stringify({
    source_type: 's', recommendation_type: 'r', title: 'T', description: 'D' })]),
    'PENNSYNC_SCREEN_PATIENT_NOT_VISIBLE');

  // Naming the agency the chart IS in does not rescue it either: this caller
  // does not hold agency B, so the refusal moves one step earlier rather than
  // disappearing. Both refusals matter -- a contract that answered the second
  // with the first's code would be reporting a chart problem for a tenancy one.
  await refusal(as(ADMIN_A, EVENTS, [B, 'patient-b1', 50]), 'PENNSYNC_SCREEN_AGENCY_NOT_HELD');

  // AND THE FAIL-CLOSED CLAIM ON ITS OWN, with the agency term SATISFIED so it
  // cannot be what answers. `UNASSIGNED_A` holds agency A and `patient-a1` is
  // in agency A, so `p."agency_id" = p_agency` is true -- and the row is still
  // invisible, because D24 narrows a chart to its care team and this clinician
  // holds no assignment. An invisible row leaves `v_id` null and null RAISES,
  // which is the whole difference from a negative existence check.
  await refusal(as(UNASSIGNED_A, EVENTS, [A, 'patient-a1', 50]),
    'PENNSYNC_SCREEN_PATIENT_NOT_VISIBLE');
  await refusal(write(UNASSIGNED_A, PUSH, [A, 'patient-a1', JSON.stringify({
    source_type: 's', recommendation_type: 'r', title: 'T', description: 'D' })]),
    'PENNSYNC_SCREEN_PATIENT_NOT_VISIBLE');

  // Nothing was written by the two refused writes.
  assert.equal((await db.query(
    "select count(*)::int as n from pennsync_records.sent_education_material " +
    "where patient_id = 'patient-b1' and sent_by = 'admin-a@example.invalid'")).rows[0].n, 0);
  assert.equal((await db.query(
    "select count(*)::int as n from pennsync_records.patient_recommendation " +
    "where patient_id = 'patient-b1' and created_by = 'admin-a@example.invalid'")).rows[0].n, 0);
});

test('an entity default the generated store does not emit is stamped by the contract', async () => {
  // The store's own header says columns are nullable so a legacy row can
  // migrate. It says nothing about defaults, and emits none -- so a create
  // path that did not stamp them would write null where Base44 wrote a value.
  // The expected values are the ENTITY's, read here rather than typed.
  const schemas = new Map(readSchemas(repository));
  const declared = (entity, field) => {
    const property = (schemas.get(entity).properties ?? {})[field];
    assert.ok(property && 'default' in property,
      `${entity}.${field} no longer declares a default; this case is stale`);
    return property.default;
  };

  const sent = await write(CLINICIAN_A, SEND, [A, 'patient-a1', JSON.stringify({
    material_id: 'mat-d', personalized_content: 'body' })]);
  const push = await write(ADMIN_A, PUSH, [A, 'patient-a1', JSON.stringify({
    source_type: 'oasis_analysis', recommendation_type: 'compliance',
    title: 'T', description: 'D' })]);
  const sentRow = (await db.query(
    'select "patient_acknowledged" from pennsync_records.sent_education_material where id = $1',
    [sent.id])).rows[0];
  const pushRow = (await db.query(
    'select "status","priority" from pennsync_records.patient_recommendation where id = $1',
    [push.id])).rows[0];
  assert.equal(sentRow.patient_acknowledged,
    declared('SentEducationMaterial', 'patient_acknowledged'));
  assert.equal(pushRow.status, declared('PatientRecommendation', 'status'));
  assert.equal(pushRow.priority, declared('PatientRecommendation', 'priority'));
  await db.query('delete from pennsync_records.sent_education_material where id = $1', [sent.id]);
  await db.query('delete from pennsync_records.patient_recommendation where id = $1', [push.id]);

  // A value the caller DID send is theirs, so the default fills a gap rather
  // than overwriting an answer.
  const chosen = await write(ADMIN_A, PUSH, [A, 'patient-a1', JSON.stringify({
    source_type: 'oasis_analysis', recommendation_type: 'compliance',
    title: 'T', description: 'D', priority: 'high' })]);
  assert.equal((await db.query(
    'select "priority" from pennsync_records.patient_recommendation where id = $1',
    [chosen.id])).rows[0].priority, 'high');
  await db.query('delete from pennsync_records.patient_recommendation where id = $1', [chosen.id]);

  // And the preference save, whose five defaults are all the caller's fields.
  await write(CLINICIAN_A, PREF_SAVE, [A, null, JSON.stringify({})]);
  const pref = await as(CLINICIAN_A, PREF_GET, [A, null]);
  for (const field of ['email_notifications_enabled', 'in_app_notifications_enabled',
    'push_notifications_enabled', 'digest_mode', 'sound_enabled']) {
    assert.equal(pref.preference[field], declared('NotificationPreference', field), field);
  }
  await db.query(
    "delete from pennsync_records.notification_preference where user_email = $1",
    ['clinician-a@example.invalid']);
});

test('a caller\'s bad value is a named refusal, not a record-store outage', async () => {
  // Enum values DO become CHECK constraints, and an uncaught one reaches the
  // HTTP boundary undeclared as a 503 CONTRACT_REFUSED -- a typo reported as an
  // outage. Each of these raises inside the insert rather than before it.
  await refusal(write(CLINICIAN_A, SEND, [A, 'patient-a1', JSON.stringify({
    material_id: 'm', personalized_content: 'c', delivery_method: 'carrier pigeon' })]),
    'PENNSYNC_SCREEN_FIELD_VALUE_INVALID');
  await refusal(write(ADMIN_A, PUSH, [A, 'patient-a1', JSON.stringify({
    source_type: 'oasis_analysis', recommendation_type: 'compliance', title: 'T',
    description: 'D', priority: 'VERY HIGH' })]), 'PENNSYNC_SCREEN_FIELD_VALUE_INVALID');
  await refusal(write(ADMIN_A, PUSH, [A, 'patient-a1', JSON.stringify({
    source_type: 'oasis_analysis', recommendation_type: 'compliance', title: 'T',
    description: 'D', expires_at: 'the day after tomorrow' })]),
    'PENNSYNC_SCREEN_FIELD_VALUE_INVALID');
  await refusal(write(CLINICIAN_A, PREF_SAVE, [A, null, JSON.stringify({
    digest_mode: 'whenever' })]), 'PENNSYNC_SCREEN_FIELD_VALUE_INVALID');
  // And the refused write left nothing behind.
  assert.equal((await db.query(
    "select count(*)::int as n from pennsync_records.notification_preference " +
    "where user_email = 'clinician-a@example.invalid'")).rows[0].n, 0);
});

test('a recommendation cannot be attributed to a colleague', async () => {
  // `suggested_by_user` names a person, and the only call site sends the
  // literal `AI Assistant`. An address that is not the caller's own is a
  // provenance claim nobody reading the row could check.
  await refusal(write(ADMIN_A, PUSH, [A, 'patient-a1', JSON.stringify({
    source_type: 'oasis_analysis', recommendation_type: 'compliance', title: 'T',
    description: 'D', suggested_by_user: 'clinician-a@example.invalid' })]),
    'PENNSYNC_SCREEN_FIELD_VALUE_INVALID');
  for (const value of ['AI Assistant', 'admin-a@example.invalid']) {
    const answer = await write(ADMIN_A, PUSH, [A, 'patient-a1', JSON.stringify({
      source_type: 'oasis_analysis', recommendation_type: 'compliance', title: 'T',
      description: 'D', suggested_by_user: value })]);
    assert.equal((await db.query(
      'select "suggested_by_user" from pennsync_records.patient_recommendation where id = $1',
      [answer.id])).rows[0].suggested_by_user, value);
    await db.query('delete from pennsync_records.patient_recommendation where id = $1',
      [answer.id]);
  }
});

test('a required field the caller supplies is refused when it is absent', async () => {
  // The generated record store leaves every column NULLABLE, so a missing
  // required field does not fail the insert -- it writes a junk row and answers
  // `success: true`. Base44 enforced these at the platform, so the refusal is
  // what keeps the port from being WIDER than the original.
  //
  // The list is read out of each entity's own `required` array rather than
  // typed here, so a field added upstream fails this suite instead of becoming
  // silently optional.
  const schemas = new Map(readSchemas(repository));
  const cases = [
    ['SentEducationMaterial', SEND, 'sent_education_material',
      { material_id: 'mat-x', material_title: 'T', personalized_content: 'body' }],
    ['PatientRecommendation', PUSH, 'patient_recommendation',
      { source_type: 'oasis_analysis', recommendation_type: 'compliance',
        title: 'T', description: 'D' }],
  ];
  for (const [entity, call, table, payload] of cases) {
    // A FIELD CAN BE REQUIRED AND DECLARE A DEFAULT, which makes the ORDER of
    // the two checks load-bearing: refuse-then-default would reject an omission
    // the entity itself fills, which is narrower than the original. Batch C
    // carries that case (`template_type`); neither entity written here does,
    // so the ordering is not exercised and asserting it would be theatre. What
    // is asserted is that the case does not exist, so the day it arrives this
    // fails rather than the contract quietly refusing a legitimate omission.
    // Two of batch E's seven entities DO have it -- `ComplianceRule.severity`
    // and `OCRTrainingSession.status` -- and neither is written by any contract
    // in this file, which is why it does not bite here.
    const properties = schemas.get(entity).properties ?? {};
    const defaulted = (schemas.get(entity).required ?? [])
      .filter(field => properties[field]?.default !== undefined);
    assert.deepEqual(defaulted, [],
      `${entity} now has a required field that declares a default (${defaulted.join(', ')}); `
      + 'the contract must stamp the default BEFORE screen_required_keys, or it refuses '
      + 'an omission the entity would have filled');
    // `patient_id` is required by both and is the contract's own parameter,
    // already answered by `screen_chart`, so it is covered structurally.
    const required = (schemas.get(entity).required ?? []).filter(f => f !== 'patient_id');
    assert.ok(required.length > 0, `${entity} declares no required field to check`);
    for (const field of required) {
      assert.ok(field in payload,
        `${entity} requires ${field}; this case does not send it, so nothing proves it`);
      const without = { ...payload };
      delete without[field];
      await refusal(write(CLINICIAN_A, call, [A, 'patient-a1', JSON.stringify(without)]),
        'PENNSYNC_SCREEN_FIELD_REQUIRED');
      await refusal(write(CLINICIAN_A, call,
        [A, 'patient-a1', JSON.stringify({ ...payload, [field]: null })]),
        'PENNSYNC_SCREEN_FIELD_REQUIRED');
    }
    // The same payload complete is accepted, so the refusals above are the
    // missing field rather than anything else about the request.
    const answer = await write(CLINICIAN_A, call, [A, 'patient-a1', JSON.stringify(payload)]);
    assert.equal(answer.success, true, `${entity} refuses a complete payload`);
    await db.query(`delete from pennsync_records.${table} where id = $1`, [answer.id]);
  }
  // And the place it is deliberately NOT stricter: JSON Schema's `required` is
  // satisfied by an empty string, so refusing one here would be a narrowing
  // invented in the contract rather than the original's behaviour.
  const blank = await write(CLINICIAN_A, SEND, [A, 'patient-a1', JSON.stringify({
    material_id: 'mat-x', personalized_content: '' })]);
  assert.equal(blank.success, true, 'an empty string is present, which is what required means');
  await db.query('delete from pennsync_records.sent_education_material where id = $1', [blank.id]);
});

test('the helpers are the record owner\'s, and no caller role may ask them', async () => {
  for (const fn of ['screen_agency_held(text)', 'screen_chart(text,text)',
    'screen_agency_admin(text)', 'screen_agency_admin_required(text)',
    'screen_exact_keys(jsonb,text[])', 'screen_required_keys(jsonb,text[])']) {
    const { rows } = await db.query(
      `select has_function_privilege('authenticated', 'pennsync_records.${fn}', 'execute') as ok`);
    assert.equal(rows[0].ok, false, `${fn} must not be callable by a caller role`);
  }
});

/**
 * What the POLICIES grant this caller, past the contract entirely -- asked in
 * the context a contract body runs in, through the definer seeded above.
 */
const visible = (n, entity, patient) =>
  as(n, 'select public.zz_policy_visible($1,$2) as result', [entity, patient]);

test('the chart guard subtracts no row the table policies would have granted', async () => {
  // THE QUESTION A REFUSAL CANNOT ANSWER ON ITS OWN. Every case above asserts
  // that `screen_chart` refuses; none of them asks whether the row it refused
  // was one the caller was ENTITLED to. A guard that hides rows the access
  // block granted is a narrowing, and a narrowing fails blank rather than
  // loud -- so it is measured here against the policies themselves, per table,
  // rather than reasoned about from the refusal.
  //
  // These three tables carry NO `agency_id`: their tenancy IS the chart, and
  // the generated policy is `exists (select 1 from patient where id =
  // <row>.patient_id and agency_id in caller_agencies() and
  // (caller_opens_every_chart or id in caller_assigned_patients))`. That is
  // `screen_chart`'s own predicate, asked of the same caller under the same
  // forced RLS. So the guard can only ever re-ask what the policy already
  // decided -- except for the one term the policy CANNOT ask, because a policy
  // does not know which agency the request named.
  const TABLES = ['clinical_event', 'patient_recommendation', 'sent_education_material'];
  // The three cases the guard refuses, and what the policy says about each.
  for (const [who, subject, why] of [
    [UNASSIGNED_A, 'patient-a1', 'own agency, a chart D24 does not open for them'],
    [ADMIN_A, 'patient-b1', 'another agency\'s chart'],
    [ADMIN_A, 'patient-gone', 'a chart never carried into this store'],
    [CLINICIAN_A, 'patient-gone', 'the same, for a caller who opens charts by assignment'],
  ]) {
    for (const table of TABLES) {
      assert.equal(await visible(who, table, subject), 0,
        `${table}: the policy grants this caller rows on ${subject} (${why}), ` +
        'so the contract\'s refusal is hiding a row rather than naming one');
    }
  }
  // AND THE COUNTER-CASE, without which every line above passes on a query
  // that returns nothing for a reason of its own. The rows exist and are
  // visible to somebody.
  for (const table of TABLES) {
    assert.ok(await visible(ADMIN_A, table, 'patient-a1') > 0, `${table}: nothing seeded`);
    assert.ok(await visible(ADMIN_B, table, 'patient-b1') > 0, `${table}: nothing seeded in B`);
    // The uncarried row IS in the table and invisible to everyone above, which
    // is the policies' answer and not the contract's. Counted past RLS.
    assert.ok((await db.query(
      `select count(*)::int as n from pennsync_records.${table} where patient_id = 'patient-gone'`
    )).rows[0].n > 0, `${table}: no orphan seeded`);
  }
  // THE ONE CASE WHERE THE GUARD REALLY SUBTRACTS, and the reason it exists:
  // a caller holding BOTH agencies is granted agency B's rows by the policy,
  // because the policy asks `in caller_agencies()` and cannot know that this
  // request named agency A. The agency term is the only thing that refuses it.
  for (const table of TABLES) {
    assert.ok(await visible(DUAL, table, 'patient-b1') > 0,
      `${table}: the crossed-request leak is not reproduced, so the term below proves nothing`);
  }
  await refusal(as(DUAL, EVENTS, [A, 'patient-b1', 50]), 'PENNSYNC_SCREEN_PATIENT_NOT_VISIBLE');
  await refusal(as(DUAL, RECS, [A, 'patient-b1', 50]), 'PENNSYNC_SCREEN_PATIENT_NOT_VISIBLE');
});
