import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import {
  AGENCY_A, assertNoDeadBodies, buildStore, callAs, publicWrappers, sweep,
} from './public-wrapper-execution.mjs';

/**
 * Every public wrapper, executed. The module beside this one says why.
 *
 * The two maps below are the population. `ANSWERS` are the wrappers that reach
 * the end of their body under the arguments here; `STOPS` are the ones these
 * arguments do not get past, each pinned to the refusal code that stops them.
 * Their union must equal the public function set exactly, so a wrapper added
 * tomorrow fails this suite rather than being swept past.
 *
 * A STOP is a DEBT, not coverage. The refusal code names what is missing —
 * `PENNSYNC_TASK_ORDER_INVALID` is a missing order, `PENNSYNC_VISIT_ID_INVALID`
 * a missing id — and the assertion is an equality, so paying one down (the
 * call starts answering) fails just as loudly as one changing. That direction
 * matters more than it looks: `contract_task_list` and `contract_care_plan_list`
 * sat at `PENNSYNC_TASK_ORDER_INVALID` and `PENNSYNC_CARE_PLAN_ORDER_INVALID`
 * under a null order, and both are among the seven capabilities that cannot run
 * at all. A sweep is only as honest as its arguments (D129).
 */
const ANSWERS = Object.freeze([
  'pennsync_contract_activity_list',
  'pennsync_contract_adr_deadline_sweep',
  'pennsync_contract_agency_settings_read',
  'pennsync_contract_ai_agreement_status',
  'pennsync_contract_ai_configuration_read',
  'pennsync_contract_alert_list',
  'pennsync_contract_care_plan_list',
  'pennsync_contract_clinical_event_list',
  'pennsync_contract_clinical_library_folder_list',
  'pennsync_contract_clinical_library_template_list',
  'pennsync_contract_clinical_pathway_list',
  'pennsync_contract_compliance_rule_lookup',
  'pennsync_contract_credential_expiration_sweep',
  'pennsync_contract_credential_renewal_sweep',
  'pennsync_contract_dashboard',
  'pennsync_contract_data_quality_audit',
  'pennsync_contract_document_record_list',
  'pennsync_contract_document_template_list',
  'pennsync_contract_education_material_list',
  'pennsync_contract_expiration_notice_sweep',
  'pennsync_contract_face_to_face_list',
  'pennsync_contract_fleet_vehicles',
  'pennsync_contract_invitation_sweep',
  'pennsync_contract_library_document_list',
  'pennsync_contract_medicare_compliance_rule_list',
  'pennsync_contract_medicare_guideline_list',
  'pennsync_contract_note_conversion_list',
  'pennsync_contract_notification_list',
  'pennsync_contract_notification_mark_all',
  'pennsync_contract_notification_preference_get',
  'pennsync_contract_ocr_feedback_list',
  'pennsync_contract_ocr_training_list',
  'pennsync_contract_on_call_shift_list',
  'pennsync_contract_patient_education_list',
  'pennsync_contract_patient_recommendation_list',
  'pennsync_contract_pdf_search_corpus',
  'pennsync_contract_pdf_template_list',
  'pennsync_contract_physician_list',
  'pennsync_contract_referral_assignees',
  'pennsync_contract_referral_list',
  'pennsync_contract_roster_list',
  'pennsync_contract_roster_report',
  'pennsync_contract_sent_education_list',
  'pennsync_contract_task_list',
  'pennsync_contract_tenant_context',
  'pennsync_contract_tenant_memberships',
  'pennsync_contract_time_off_approved',
  'pennsync_contract_validation_rule_list',
  'pennsync_contract_visit_point_config_list',]);

/**
 * The wrappers these arguments do not get past, and where each stops.
 *
 * Four are not argument debt and will not be paid down from here:
 * `pennsync_records_list` and its four siblings answer
 * `PENNSYNC_BROKER_ENTITY_NOT_BROKERED` because the broker family serves three
 * entities and the sweep names none, and the three `pennsync_staging_*` reads
 * answer `PENNSYNC_APP_NOT_ADMITTED` because the staging pair is bound to an
 * app id this store does not admit. They are pinned like the rest so that a
 * change to either refusal is visible.
 */
const STOPS = Object.freeze({
  pennsync_contract_activity_append: 'PENNSYNC_AUDIT_ACTION_INVALID',
  pennsync_contract_agency_settings_save: 'PENNSYNC_SETTINGS_FIELDS_INVALID',
  pennsync_contract_ai_agreement_accept: 'PENNSYNC_AI_AGREEMENT_VERSION_STALE',
  pennsync_contract_ai_configuration_save: 'PENNSYNC_AI_CONFIG_SCOPE_INVALID',
  pennsync_contract_alert_update: 'PENNSYNC_ALERT_ID_INVALID',
  pennsync_contract_assignment_inspect: 'PENNSYNC_ASSIGNMENT_SUBJECT_INVALID',
  pennsync_contract_assignment_transition: 'PENNSYNC_ASSIGNMENT_SUBJECT_INVALID',
  pennsync_contract_care_plan_save: 'PENNSYNC_CARE_PLAN_FIELDS_INVALID',
  pennsync_contract_chart_export_context: 'PENNSYNC_CHART_EXPORT_SUBJECT_INVALID',
  pennsync_contract_clinical_event_review: 'PENNSYNC_CLINICAL_SUBJECT_INVALID',
  pennsync_contract_clinical_extract_context: 'PENNSYNC_EXTRACT_SUBJECT_INVALID',
  pennsync_contract_clinical_extract_record: 'PENNSYNC_EXTRACT_SUBJECT_INVALID',
  pennsync_contract_clinical_library_folder_write: 'PENNSYNC_LIBRARY_FOLDER_ACTION_INVALID',
  pennsync_contract_clinical_library_template_write: 'PENNSYNC_LIBRARY_TEMPLATE_ACTION_INVALID',
  pennsync_contract_clinical_pathway_write: 'PENNSYNC_PATHWAY_ACTION_INVALID',
  pennsync_contract_clinical_phrase_resolve: 'PENNSYNC_PHRASE_REQUIRED',
  pennsync_contract_clinical_phrase_used: 'PENNSYNC_PHRASE_SUBJECT_INVALID',
  pennsync_contract_clinical_task_context: 'PENNSYNC_TASK_CONTEXT_SUBJECT_INVALID',
  pennsync_contract_clinical_trend_context: 'PENNSYNC_CLINICAL_SUBJECT_INVALID',
  pennsync_contract_credential_review: 'PENNSYNC_CREDENTIAL_SUBJECT_INVALID',
  pennsync_contract_credential_submit: 'PENNSYNC_CREDENTIAL_INVALID',
  pennsync_contract_document_get: 'PENNSYNC_DOCUMENT_PURPOSE_INVALID',
  pennsync_contract_document_list: 'PENNSYNC_DOCUMENT_PURPOSE_INVALID',
  pennsync_contract_education_material_write: 'PENNSYNC_EDUCATION_MATERIAL_ACTION_INVALID',
  pennsync_contract_face_to_face_save: 'PENNSYNC_F2F_FIELDS_INVALID',
  pennsync_contract_fleet_entry_add: 'PENNSYNC_FLEET_REQUEST_INVALID',
  pennsync_contract_fleet_entry_review: 'PENNSYNC_FLEET_SUBJECT_INVALID',
  pennsync_contract_fleet_history: 'PENNSYNC_FLEET_SUBJECT_INVALID',
  pennsync_contract_fleet_vehicle_create: 'PENNSYNC_FLEET_REQUEST_INVALID',
  pennsync_contract_fleet_vehicle_update: 'PENNSYNC_FLEET_SUBJECT_INVALID',
  pennsync_contract_follow_up_context: 'PENNSYNC_FOLLOW_UP_SUBJECT_INVALID',
  pennsync_contract_follow_up_record: 'PENNSYNC_FOLLOW_UP_SUBJECT_INVALID',
  pennsync_contract_incident_submit: 'PENNSYNC_INCIDENT_INVALID',
  pennsync_contract_incident_update: 'PENNSYNC_INCIDENT_SUBJECT_INVALID',
  pennsync_contract_invitation_resend: 'PENNSYNC_INVITATION_SUBJECT_INVALID',
  pennsync_contract_membership_inspect: 'PENNSYNC_MEMBERSHIP_SUBJECT_INVALID',
  pennsync_contract_membership_transition: 'PENNSYNC_MEMBERSHIP_SUBJECT_INVALID',
  pennsync_contract_note_append: 'PENNSYNC_NOTE_PATIENT_INVALID',
  pennsync_contract_note_conversion_create: 'PENNSYNC_NOTE_CONVERSION_FIELDS_INVALID',
  pennsync_contract_note_history: 'PENNSYNC_NOTE_PATIENT_INVALID',
  pennsync_contract_notification_create: 'PENNSYNC_NOTIFICATION_INVALID',
  pennsync_contract_notification_preference_save: 'PENNSYNC_SCREEN_PAYLOAD_INVALID',
  pennsync_contract_notification_transition: 'PENNSYNC_NOTIFICATION_ACTION_INVALID',
  pennsync_contract_patient_batch: 'PENNSYNC_PATIENT_PURPOSE_INVALID',
  pennsync_contract_patient_create: 'PENNSYNC_PATIENT_REQUEST_ID_INVALID',
  pennsync_contract_patient_education_write: 'PENNSYNC_PATIENT_EDUCATION_ACTION_INVALID',
  pennsync_contract_patient_get: 'PENNSYNC_PATIENT_PURPOSE_INVALID',
  pennsync_contract_patient_list: 'PENNSYNC_PATIENT_PURPOSE_INVALID',
  pennsync_contract_patient_recommendation_record: 'PENNSYNC_SCREEN_SUBJECT_INVALID',
  pennsync_contract_patient_update: 'PENNSYNC_PATIENT_ID_INVALID',
  pennsync_contract_payroll_profile_save: 'PENNSYNC_CONFIG_INVALID',
  pennsync_contract_pdf_template_delete: 'PENNSYNC_TEMPLATE_ID_INVALID',
  pennsync_contract_pdf_template_save: 'PENNSYNC_TEMPLATE_FIELDS_INVALID',
  pennsync_contract_policy_acknowledge: 'PENNSYNC_POLICY_ACK_SUBJECT_INVALID',
  pennsync_contract_policy_distribute: 'PENNSYNC_POLICY_ID_REQUIRED',
  pennsync_contract_policy_library_list: 'PENNSYNC_CONTRACT_MODE_INVALID',
  pennsync_contract_provider_import: 'PENNSYNC_PROVIDER_IMPORT_INVALID',
  pennsync_contract_referral_archive: 'PENNSYNC_REFERRAL_ID_INVALID',
  pennsync_contract_referral_create: 'PENNSYNC_REFERRAL_REQUEST_ID_INVALID',
  pennsync_contract_referral_get: 'PENNSYNC_REFERRAL_ID_INVALID',
  pennsync_contract_referral_update: 'PENNSYNC_REFERRAL_ID_INVALID',
  pennsync_contract_regulatory_update_store: 'PENNSYNC_REGULATION_INVALID',
  pennsync_contract_report_metrics: 'PENNSYNC_REPORT_RANGE_INVALID',
  pennsync_contract_roster_get: 'PENNSYNC_ROSTER_SUBJECT_INVALID',
  pennsync_contract_sent_education_record: 'PENNSYNC_SCREEN_SUBJECT_INVALID',
  pennsync_contract_state_incident_submit: 'PENNSYNC_STATE_INCIDENT_INVALID',
  pennsync_contract_supply_prediction_generate: 'PENNSYNC_SUPPLY_SUBJECT_INVALID',
  pennsync_contract_task_create: 'PENNSYNC_TASK_FIELDS_INVALID',
  pennsync_contract_time_off_cancel: 'PENNSYNC_TIME_OFF_SUBJECT_INVALID',
  pennsync_contract_time_off_review: 'PENNSYNC_TIME_OFF_SUBJECT_INVALID',
  pennsync_contract_time_off_submit: 'PENNSYNC_TIME_OFF_TYPE_INVALID',
  pennsync_contract_timesheet_review: 'PENNSYNC_TIMESHEET_DECISION_INVALID',
  pennsync_contract_timesheet_submit: 'PENNSYNC_TIMESHEET_INVALID',
  pennsync_contract_validation_rule_write: 'PENNSYNC_VALIDATION_RULE_ACTION_INVALID',
  pennsync_contract_visit_create: 'PENNSYNC_VISIT_PATIENT_INVALID',
  pennsync_contract_visit_get: 'PENNSYNC_VISIT_PURPOSE_INVALID',
  pennsync_contract_visit_list: 'PENNSYNC_VISIT_PURPOSE_INVALID',
  pennsync_contract_visit_points_save: 'PENNSYNC_CONFIG_INVALID',
  pennsync_contract_visit_supply_context: 'PENNSYNC_VISIT_SUPPLY_SUBJECT_INVALID',
  pennsync_contract_visit_supply_record: 'PENNSYNC_VISIT_SUPPLY_SUBJECT_INVALID',
  pennsync_contract_visit_update: 'PENNSYNC_VISIT_ID_INVALID',
  pennsync_records_delete: 'PENNSYNC_BROKER_ENTITY_NOT_BROKERED',
  pennsync_records_get: 'PENNSYNC_BROKER_ENTITY_NOT_BROKERED',
  pennsync_records_insert: 'PENNSYNC_BROKER_ENTITY_NOT_BROKERED',
  pennsync_records_list: 'PENNSYNC_BROKER_ENTITY_NOT_BROKERED',
  pennsync_records_update: 'PENNSYNC_BROKER_ENTITY_NOT_BROKERED',
  pennsync_staging_assignment: 'PENNSYNC_INVALID_ACTION',
  pennsync_staging_context: 'PENNSYNC_APP_NOT_ADMITTED',
  pennsync_staging_memberships: 'PENNSYNC_APP_NOT_ADMITTED',
  pennsync_staging_patient: 'PENNSYNC_APP_NOT_ADMITTED',
  pennsync_staging_patient_context: 'PENNSYNC_APP_NOT_ADMITTED',
  pennsync_staging_patients: 'PENNSYNC_APP_NOT_ADMITTED',
  pennsync_staging_referral_patient: 'PENNSYNC_APP_NOT_ADMITTED',
  pennsync_staging_referral_patients: 'PENNSYNC_APP_NOT_ADMITTED',
  pennsync_staging_revoke_membership: 'PENNSYNC_APP_NOT_ADMITTED',
  pennsync_staging_s3_confirm: 'PENNSYNC_APP_NOT_ADMITTED',
  pennsync_staging_s3_create: 'PENNSYNC_APP_NOT_ADMITTED',
  pennsync_staging_s3_list: 'PENNSYNC_APP_NOT_ADMITTED',
  pennsync_staging_s3_read: 'PENNSYNC_APP_NOT_ADMITTED',
  pennsync_staging_s4_create: 'PENNSYNC_APP_NOT_ADMITTED',
  pennsync_staging_s4_read: 'PENNSYNC_APP_NOT_ADMITTED',
  pennsync_staging_visit_documentation: 'PENNSYNC_APP_NOT_ADMITTED',
  pennsync_staging_visits_schedule: 'PENNSYNC_APP_NOT_ADMITTED',});

/**
 * Bound wherever the parameter appears. `p_limit` is the reason this suite
 * exists: it is null in every body `service-rpc-signatures` captures, and
 * `operational_limit` returns 50 before its bad line when it is.
 */
const DEFAULTS = Object.freeze({ p_agency: AGENCY_A, p_limit: 25 });

/**
 * The values that get one wrapper past its own validation, derived from the
 * migration that declares them rather than guessed.
 */
const DRIVEN = Object.freeze({
  pennsync_contract_task_list: { p_order: 'created_date' },
  pennsync_contract_care_plan_list: { p_order: 'created_date' },
  pennsync_contract_physician_list: { p_order: 'recent' },
  pennsync_contract_ai_configuration_read: { p_scope: 'agency' },
  pennsync_contract_compliance_rule_lookup: { p_rule_code: 'F2F-1' },
  pennsync_contract_clinical_event_list: { p_patient_id: 'patient-a1' },
  pennsync_contract_patient_recommendation_list: { p_patient_id: 'patient-a1' },
  pennsync_contract_patient_education_list: { p_patient_id: 'patient-a1' },
});

const APP = '6a9881683dc68a0bd54f1ef7';
let db;
let results;

/** The chart of record the fixtures' synthetic rows do not create. */
async function seed(database) {
  await database.query(`insert into pennsync_records."agency"
    ("source_app_id","id","agency_name","status") values ($1,$2,'Keystone Home Health','active')`,
  [APP, AGENCY_A]);
  await database.query(`insert into pennsync_records."patient"
    ("source_app_id","id","agency_id","first_name") values ($1,'patient-a1',$2,'Ann')`,
  [APP, AGENCY_A]);
}

before(async () => {
  db = new PGlite();
  await buildStore(db);
  await seed(db);
  results = await sweep(db, { defaults: DEFAULTS, perName: DRIVEN });
});
after(async () => db?.close());

test('the population is the public function set, with nothing declared twice or left out', async () => {
  const exposed = (await publicWrappers(db)).map(wrapper => wrapper.name).sort();
  const declared = [...ANSWERS, ...Object.keys(STOPS)].sort();
  assert.deepEqual(declared, exposed, 'a public wrapper is undeclared, or a declaration has rotted');
  assert.equal(new Set(declared).size, declared.length, 'a wrapper is in both maps');
  assert.equal(results.length, exposed.length, 'the sweep did not call every wrapper');
});

test('no public wrapper raises an error the contracts do not raise themselves', () => {
  assertNoDeadBodies(assert, results);
});

test('every wrapper declared as answering answers, and the set has not shrunk', () => {
  assert.deepEqual(results.filter(r => r.outcome === 'answered').map(r => r.name).sort(),
    [...ANSWERS].sort(), 'the set of wrappers that reach the end of their body changed');
});

test('every stop is still stopped, at the code it is pinned to', () => {
  const reached = new Map(results.map(r => [r.name, r]));
  const wrong = [];
  for (const [name, code] of Object.entries(STOPS)) {
    const result = reached.get(name);
    const actual = result.outcome === 'refused' ? result.message.split(':')[0] : `<${result.outcome}>`;
    if (actual !== code) wrong.push(`${name}: pinned ${code}, got ${actual}`);
  }
  assert.deepEqual(wrong, [], 'a stop changed. If it now answers, move it to ANSWERS');
});

test('a wrapper whose body cannot run is REPORTED, proved by planting one', async () => {
  const planted = new PGlite();
  try {
    await buildStore(planted);
    await seed(planted);
    // `pg_catalog.least` is the real shape: LEAST is an SQL construct and
    // cannot be schema-qualified, so this creates cleanly and dies on the call.
    await planted.exec(`create function "public"."pennsync_contract_planted_dead"(p_agency text)
      returns integer language plpgsql stable security definer set search_path = '' as $dead$
      begin return pg_catalog.least(1, 2); end $dead$;
      grant execute on function "public"."pennsync_contract_planted_dead"(text) to authenticated;`);
    const swept = await sweep(planted, { defaults: DEFAULTS, perName: DRIVEN });
    // The PRODUCTION assertion, raised against the planted build (D120): a
    // control that recomputed the predicate would stay green if the real one
    // were weakened, which is the thing the control exists to rule out.
    assert.throws(() => assertNoDeadBodies(assert, swept), /pennsync_contract_planted_dead/,
      'the sweep did not report a wrapper that cannot run');
    // An equality rather than a membership, for the reason D113 settled: that
    // the plant is reported does not say the report is the plant. What the
    // plant adds to the real tree's findings must be the plant and nothing
    // else, and nothing may drop out of them either.
    const names = swept.filter(r => r.outcome === 'failed').map(r => r.name).sort();
    assert.deepEqual(names,
      [...results.filter(r => r.outcome === 'failed').map(r => r.name),
        'pennsync_contract_planted_dead'].sort(),
      'planting one dead body changed the findings by something other than that body');
  } finally {
    await planted.close();
  }
});

test('a caller with no membership reaches no body, so the sweep measures an AUTHORIZED run', async () => {
  // Identity 4 is an `agency_admin` in agency B. If the sweep's identity did
  // not hold agency A, almost every wrapper would refuse at its tenant check
  // and answer nothing, and this suite would be green over a store it never
  // entered — the vacuous case D115 names, arriving through the caller rather
  // than through the population.
  const [wrapper] = (await publicWrappers(db)).filter(w => w.name === 'pennsync_contract_alert_list');
  const held = await callAs(db, 1, wrapper, { ...DEFAULTS });
  const notHeld = await callAs(db, 4, wrapper, { ...DEFAULTS });
  assert.equal(held.outcome, 'answered');
  assert.equal(notHeld.outcome, 'refused');
  assert.match(notHeld.message, /AGENCY_NOT_HELD/);
});
