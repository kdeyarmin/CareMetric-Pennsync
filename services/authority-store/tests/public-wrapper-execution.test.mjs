import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import {
  AGENCY_A, assertNoDeadBodies, buildStore, callAs, functionBodies, helperReach,
  publicWrappers, sweep,
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
 *
 * SO IF YOU ARE SHIPPING A FORWARD MIGRATION, READ THIS. These maps pin a
 * STATE of the store, not a property of it, and a forward that makes a pinned
 * wrapper answer — or that changes the code one refuses with — contradicts the
 * map the moment it merges. The map moves in the SAME change as the migration,
 * or `main` is red between the two merges and the red belongs to whoever split
 * them. That a red here is a POSSIBLE and correct outcome of somebody else's
 * migration is the point of the equality: the first reading of a failure is
 * "this suite saw the change", not "this suite is broken". The failure names
 * the wrapper and both codes, so the edit is one line.
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
  'pennsync_contract_note_conversion_create',
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
 * Two GROUPS here are not argument debt and will not be paid down from this
 * fixture. All five `pennsync_records_*` wrappers answer
 * `PENNSYNC_BROKER_ENTITY_NOT_BROKERED`, because the broker family serves
 * three entities and the sweep names none. The `pennsync_staging_*` wrappers
 * answer `PENNSYNC_APP_NOT_ADMITTED` or an action refusal, because the staging
 * pair is bound to an app id this store does not admit. They are pinned like
 * the rest so that a change to either refusal is visible.
 *
 * No count is given for either group deliberately, and the reason is D129's:
 * an earlier draft of this comment said "four", which was the number of them
 * among the THIRTY-SEVEN limit-taking wrappers — one broker read and three
 * staging reads — set down beside a map that pins every wrapper in the store.
 * Two populations, one sentence, the smaller count. The names are in the map
 * below; count them there, against the population you actually mean.
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
  // Driven rather than pinned because a reading of the FILES attributed a
  // call to `operational_limit` to this body — the file's trailing
  // `grant`/`revoke` block names every signature in it, so splitting by
  // `create function` hands that block to whatever function it follows. The
  // body has no such call, and this is the only way to say so with the
  // instrument rather than with a second reading: it is a WRITE, and a write
  // left pinned would have been the one path nobody could speak for.
  pennsync_contract_note_conversion_create: {
    p_fields: JSON.stringify({ patient_id: 'patient-a1', visit_type: 'routine' }),
  },
});


/**
 * The `pennsync_records` helpers STATICALLY REACHABLE from a wrapper on the
 * ANSWERS side. An UPPER BOUND on what this sweep runs, never a coverage
 * figure — read the next paragraph before quoting it.
 *
 * It is a syntactic transitive closure over the function bodies, so it counts
 * a helper an answering wrapper could call, not one it did. An answered
 * wrapper skips a call on an empty result or an untaken branch:
 * `contract_notification_list` answers here and the fixtures seed no
 * notification, so its loop never reaches `notification_sound`, which this set
 * nevertheless contains. Closing that gap means runtime instrumentation and
 * seeded rows for every branch worth measuring, and this suite does neither.
 * Naming it `EXECUTED` was the defect D129 describes arriving in a variable
 * name: the number was right for the predicate it computed and wrong for the
 * one its name claimed.
 *
 * What it is still good for is the direction of travel. A PINNED wrapper stops
 * at its refusal, so nothing below that line can run, and the helpers are
 * exactly where a shared defect lives — `operational_limit` is one, and a pin
 * over any of the seven it killed would have hidden all of them. 122 of the
 * 344 helpers reachable from a public wrapper are reachable from an ANSWERING
 * one, so at most a little over a third of them run, and paying down a pin is
 * what moves that ceiling. The set is pinned rather than the count, for the
 * reason D113 settled: a count holds while one name leaves and another
 * arrives.
 */
const REACHED_HELPERS = Object.freeze([
  'adr_reminder_message',
  'adr_reminder_title',
  'agency_today',
  'ai_agreement_acknowledgments',
  'ai_agreement_version',
  'alert_row',
  'caller_assigned_patients',
  'caller_email',
  'caller_identity',
  'caller_opens_every_chart',
  'caller_roster',
  'caller_tenant_role',
  'caller_user_id',
  'care_plan_projected',
  'chart_not_elsewhere',
  'contract_activity_list',
  'contract_adr_deadline_sweep',
  'contract_agency_settings_read',
  'contract_ai_agreement_status',
  'contract_ai_configuration_read',
  'contract_alert_list',
  'contract_care_plan_list',
  'contract_clinical_event_list',
  'contract_clinical_library_folder_list',
  'contract_clinical_library_template_list',
  'contract_clinical_pathway_list',
  'contract_compliance_rule_lookup',
  'contract_credential_expiration_sweep',
  'contract_credential_renewal_sweep',
  'contract_dashboard',
  'contract_data_quality_audit',
  'contract_document_record_list',
  'contract_document_template_list',
  'contract_education_material_list',
  'contract_expiration_notice_sweep',
  'contract_face_to_face_list',
  'contract_fleet_vehicles',
  'contract_invitation_sweep',
  'contract_library_document_list',
  'contract_medicare_compliance_rule_list',
  'contract_medicare_guideline_list',
  'contract_note_conversion_create',
  'contract_note_conversion_list',
  'contract_notification_list',
  'contract_notification_mark_all',
  'contract_notification_preference_get',
  'contract_ocr_feedback_list',
  'contract_ocr_training_list',
  'contract_on_call_shift_list',
  'contract_patient_education_list',
  'contract_patient_recommendation_list',
  'contract_pdf_search_corpus',
  'contract_pdf_template_list',
  'contract_physician_list',
  'contract_referral_assignees',
  'contract_referral_list',
  'contract_roster_list',
  'contract_roster_report',
  'contract_sent_education_list',
  'contract_task_list',
  'contract_tenant_context',
  'contract_tenant_memberships',
  'contract_time_off_approved',
  'contract_validation_rule_list',
  'contract_visit_point_config_list',
  'credential_due_offsets',
  'credential_notice_message',
  'credential_notice_title',
  'credential_sweep',
  'dashboard_care_plan',
  'dashboard_incident',
  'dashboard_patient',
  'dashboard_visit',
  'deployment_app',
  'document_record_projected',
  'f2f_projected',
  'fleet_vehicle_row',
  'jsonb_head',
  'library_answer',
  'library_owner_visible',
  'library_page_size',
  'library_row_id',
  'note_conversion_projected',
  'note_conversion_reserved',
  'note_conversion_writable',
  'notification_action_url',
  'notification_in_app_off',
  'notification_in_app_off_safe',
  'notification_mint',
  'notification_row',
  'notification_sound',
  'notification_text',
  'operational_chart',
  'operational_check_fields',
  'operational_limit',
  'operational_locator',
  'operational_new_id',
  'pdf_search_document_type',
  'pdf_search_row',
  'quality_json_missing',
  'quality_pct',
  'quality_score',
  'reference_read_limit',
  'reference_read_role',
  'referral_authority',
  'referral_canonical_email',
  'referral_exact_identifier',
  'referral_row',
  'referral_scope',
  'roster_entry',
  'screen_agency_admin',
  'screen_agency_admin_required',
  'screen_agency_held',
  'screen_chart',
  'screen_limit',
  'settings_projected',
  'settings_reserved',
  'task_projected',
  'template_projected',
  'tenant_agency',
  'tenant_membership_row',
  'time_off_row',
]);

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

test('the helpers an answering wrapper can reach are exactly what is pinned', async () => {
  const answered = new Set(results.filter(r => r.outcome === 'answered').map(r => r.name));
  const reach = helperReach(await functionBodies(db));
  const reached = new Set();
  const reachable = new Set();
  for (const [wrapper, helpers] of reach) {
    for (const helper of helpers) {
      reachable.add(helper);
      if (answered.has(wrapper)) reached.add(helper);
    }
  }
  assert.ok(reachable.size > reached.size,
    'every helper in the store is reachable from an answering wrapper, which '
    + 'would make the blind spot empty and this assertion vacuous; re-read it '
    + 'rather than deleting it');
  assert.deepEqual([...reached].sort(), [...REACHED_HELPERS].sort(),
    'the helpers an answering wrapper can reach changed');
  // D96's pattern: a number a check cannot assert usefully is READ and PRINTED,
  // so the debt is visible in the job log rather than promised in a comment.
  // It says REACHABLE rather than executed, because that is what it measures.
  console.log(`# helpers reachable from an answering wrapper: ${reached.size} `
    + `of ${reachable.size} (an upper bound on what runs, not coverage)`);
});

test('a dead helper behind a PINNED wrapper is what this gate cannot see, and it says so', async () => {
  // The honest statement of the limit, planted rather than argued, and there
  // are TWO reasons a helper goes unmeasured rather than one. A helper reached
  // only from a pinned wrapper can be broken and the sweep stays green,
  // because the refusal is above the call. And a helper an ANSWERING wrapper
  // reaches can be broken too, when the call sits on a path these fixtures do
  // not take: `contract_task_list` answers, reaches `task_projected`, and
  // never calls it, because the task table is empty and the projection runs
  // per row. This case is invisible for both reasons at once, so it asserts
  // both — an assertion that named only the pin would keep passing after the
  // pin was paid down, for the other reason, and read as though it still
  // measured the first. The test below it is the positive control: a dead
  // helper on a path the fixtures DO take is reported, which is what makes
  // this silence a blind spot rather than a plant that never worked.
  const planted = new PGlite();
  try {
    await buildStore(planted);
    await seed(planted);
    // `contract_task_create` is pinned at PENNSYNC_TASK_FIELDS_INVALID, so it
    // never reaches `task_projected` and a dead one there is invisible here.
    await planted.exec(`create or replace function "pennsync_records".task_projected(
        p_row "pennsync_records"."task") returns jsonb
      language plpgsql stable set search_path = '' as $dead$
      begin return pg_catalog.to_jsonb(pg_catalog.least(1, 2)); end $dead$;`);
    const swept = await sweep(planted, { defaults: DEFAULTS, perName: DRIVEN });
    const reported = swept.filter(r => r.outcome === 'failed').map(r => r.name);
    assert.equal(reported.includes('pennsync_contract_task_create'), false,
      'if this is now reported, the pin was paid down and this case needs another');
    assert.equal(swept.find(r => r.name === 'pennsync_contract_task_create').outcome,
      'refused', 'the pinned wrapper refuses before it reaches the dead helper');
    // The second reason, asserted so the case cannot go quiet on one of them.
    assert.equal(reported.includes('pennsync_contract_task_list'), false,
      'if this is now reported, the fixtures seed a task and the empty-result '
      + 'half of the blind spot has closed; this case needs another');
    assert.equal(swept.find(r => r.name === 'pennsync_contract_task_list').outcome,
      'answered', 'the list wrapper answers over no rows, so the projection never runs');
  } finally {
    await planted.close();
  }
});

test('a dead helper an answering wrapper really calls IS reported', async () => {
  // The control for the case above. Its silence only means something if the
  // same plant, on a path these fixtures take, is loud — otherwise a broken
  // plant and a blind spot are the same green. `operational_limit` is the
  // helper the seven capabilities died on, and re-introducing the schema
  // qualification that killed them is the real defect rather than a synthetic
  // one: `least` is a parser construct, so `pg_catalog.least(...)` does not
  // resolve at call time and every wrapper that pages through it dies.
  const planted = new PGlite();
  try {
    await buildStore(planted);
    await seed(planted);
    await planted.exec(`create or replace function "pennsync_records".operational_limit(
        p_limit integer, p_prefix text) returns integer
      language plpgsql immutable set search_path = '' as $dead$
      begin
        if p_limit is null then return 50; end if;
        if p_limit < 1 then
          raise exception using errcode='22023', message=p_prefix || '_LIMIT_INVALID';
        end if;
        return pg_catalog.least(p_limit, 5000);
      end $dead$;`);
    const swept = await sweep(planted, { defaults: DEFAULTS, perName: DRIVEN });
    const reported = swept.filter(r => r.outcome === 'failed').map(r => r.name);
    assert.ok(reported.length > 0,
      'a dead helper on a taken path was not reported at all, so the plant does '
      + 'not bite and the blind-spot case above proves nothing');
    for (const name of reported) {
      assert.ok(ANSWERS.includes(name),
        `${name} is reported dead but is not on the ANSWERS side, so this plant `
        + 'broke something other than the path it names');
    }
    console.log(`# control: a dead operational_limit is reported by ${reported.length} `
      + 'answering wrappers');
  } finally {
    await planted.close();
  }
});
