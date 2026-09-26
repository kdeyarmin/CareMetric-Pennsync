// The service's path to a reviewed per-capability contract.
//
// Separate from `records.mjs` on purpose, because the two are different kinds
// of thing and keeping one allowlist for both would blur exactly the line D16
// drew. `records.mjs` reaches the generic family: five operations over the 31
// entities whose schemas cleared D2's ceiling. A contract is the opposite — one
// endpoint, one reviewed authorization, and a capability the generic family is
// specifically not allowed to serve. `listPolicyLibrary` returns `doc_url`, a
// locator into our own storage, which is why `PolicyLibrary` is kept out of the
// family in the first place.
//
// Everything else is the same discipline as `records.mjs` and
// `integrations.mjs`: the bearer stays in this closure, the RPC name is fixed
// per capability and chosen by nothing a caller sends, and the store's words do
// not come back.
//
// The contract itself decides who may see what. This module carries no
// authorization logic at all, and that is deliberate: a copy here would be a
// second answer to keep in agreement with the database's.
import { ID, MAX_UPSTREAM_BYTES, fail, isObject, readJson } from './contracts.mjs';
import { validAuthorityKey, validAuthorityTarget } from './authority.mjs';

/**
 * Referral intake's refusal vocabulary, shared by its six entries because they
 * are one capability: the original answers every action from one `catch`, so a
 * code one action can raise is a code the endpoint can raise. That is the
 * opposite of the usual rule — each contract declares its own so a code one
 * cannot raise never crosses back from another — and it holds here only
 * because the six ARE one contract, split by statement rather than by
 * authorization.
 */
const REFERRAL_CODES = Object.freeze([
  'PENNSYNC_REFERRAL_AGENCY_NOT_HELD',
  'PENNSYNC_REFERRAL_FORBIDDEN',
  'PENNSYNC_REFERRAL_NOT_FOUND',
  'PENNSYNC_REFERRAL_ID_INVALID',
  'PENNSYNC_REFERRAL_LIMIT_INVALID',
  'PENNSYNC_REFERRAL_REQUEST_ID_INVALID',
  'PENNSYNC_REFERRAL_REQUEST_CONFLICT',
  'PENNSYNC_REFERRAL_FIELDS_INVALID',
  'PENNSYNC_REFERRAL_FIELDS_EMPTY',
  'PENNSYNC_REFERRAL_FIELD_UNKNOWN',
  'PENNSYNC_REFERRAL_FIELD_INVALID',
  'PENNSYNC_REFERRAL_FOLLOW_UP_INVALID',
  'PENNSYNC_REFERRAL_FOLLOW_UP_EMPTY',
  'PENNSYNC_REFERRAL_PATIENT_ID_INVALID',
  'PENNSYNC_REFERRAL_PATIENT_UNAVAILABLE',
  'PENNSYNC_REFERRAL_STATUS_INVALID',
  'PENNSYNC_REFERRAL_PRIORITY_INVALID',
  'PENNSYNC_REFERRAL_DOCUMENT_TYPE_INVALID',
  'PENNSYNC_REFERRAL_ASSIGNEE_INVALID',
  'PENNSYNC_REFERRAL_ASSIGNEE_UNAVAILABLE',
  'PENNSYNC_REFERRAL_ASSIGNMENT_FILTER_FORBIDDEN',
]);

/**
 * The reference reads' one shared refusal.
 *
 * Every contract in that group opens with `reference_read_role`, which raises
 * this and nothing else, so a code one of them can raise every one of them can
 * raise. That is the exception the house rule allows: the seven are one
 * authorization asked seven times, not seven authorizations sharing a list.
 */
const REFERENCE_READ_CODES = Object.freeze(['PENNSYNC_CONTRACT_AGENCY_NOT_HELD']);

/**
 * Batch E's shared refusal vocabulary.
 *
 * Unlike `REFERRAL_CODES`, which is one capability's whole vocabulary shared by
 * its six statements, these are the codes the four SHARED HELPERS raise —
 * every contract in that file calls `screen_agency_held`, six of them call
 * `screen_chart`, two gate on `screen_agency_admin_required` and three filter
 * a payload through `screen_exact_keys`. Each entry composes the ones its own
 * body can actually reach and adds whatever is its own.
 */
const SCREEN_COMMON = Object.freeze(['PENNSYNC_SCREEN_AGENCY_NOT_HELD']);
const SCREEN_ADMIN_CODES = Object.freeze([
  ...SCREEN_COMMON, 'PENNSYNC_SCREEN_AGENCY_ADMIN_REQUIRED']);
const SCREEN_CHART_CODES = Object.freeze([
  ...SCREEN_COMMON, 'PENNSYNC_SCREEN_SUBJECT_INVALID', 'PENNSYNC_SCREEN_PATIENT_NOT_VISIBLE']);
const SCREEN_WRITE_CODES = Object.freeze([
  ...SCREEN_CHART_CODES, 'PENNSYNC_SCREEN_PAYLOAD_INVALID', 'PENNSYNC_SCREEN_FIELD_NOT_WRITABLE',
  // An unknown key and a missing required one are two different refusals: the
  // first is a field the caller may not write, the second a field the entity
  // says it must. Collapsing them would tell a screen "not writable" about a
  // column it owns.
  'PENNSYNC_SCREEN_FIELD_REQUIRED',
  // A value the column's own CHECK constraint refuses, or a cast that fails.
  // Undeclared it reaches the boundary as a 503 CONTRACT_REFUSED, which reads
  // as a record-store outage rather than a caller's typo.
  'PENNSYNC_SCREEN_FIELD_VALUE_INVALID']);

/**
 * One entry per ported capability. `params` is the exact argument set the
 * capability accepts — anything else is refused rather than dropped — and
 * `body` maps it to the contract's parameters, which are never caller-chosen.
 */
export const RECORD_CONTRACTS = Object.freeze({
  listPolicyLibrary: Object.freeze({
    rpc: 'pennsync_contract_policy_library_list',
    params: Object.freeze(['mode']),
    // The original defaults an ABSENT mode to 'active' and refuses an explicit
    // null, so `undefined` is the only thing that defaults here either.
    body: (agencyId, args) => ({ p_agency: agencyId, p_mode: args.mode === undefined ? 'active' : args.mode }),
    codes: Object.freeze([
      'PENNSYNC_CONTRACT_MODE_INVALID',
      'PENNSYNC_CONTRACT_AGENCY_NOT_HELD',
      'PENNSYNC_CONTRACT_FORBIDDEN',
    ]),
  }),
  // D23's roster. Not a ported Base44 name: the original read the `User`
  // entity directly from each of 35 capabilities, and what replaces that is
  // one reviewed contract rather than 35 copies of a query. It is an endpoint
  // in its own right — a staff directory is something a caller asks for — and
  // the thing those 35 handlers will call while serving.
  listAgencyRoster: Object.freeze({
    rpc: 'pennsync_contract_roster_list',
    params: Object.freeze(['limit', 'after']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_limit: args.limit === undefined ? null : args.limit,
      p_after: args.after === undefined ? null : args.after,
    }),
    codes: Object.freeze([
      'PENNSYNC_ROSTER_AGENCY_NOT_HELD',
      'PENNSYNC_ROSTER_CURSOR_INVALID',
      'PENNSYNC_ROSTER_CURSOR_UNKNOWN',
    ]),
  }),
  // The authorized patient read. Three contracts for two Base44 capabilities,
  // because `listAuthorizedPatients` is one endpoint with two modes and the
  // two are different queries: a keyset page, and a bounded batch of ids. The
  // RPC is still fixed per entry and chosen by nothing a caller sends — the
  // handler picks the entry from the mode, and the mode is one of two words.
  //
  // `getAuthorizedPatient` carries its OWN purposes. A list is asked for
  // `contact` or `roster`; one chart is opened for `smart_note_context`. The
  // database keeps the two vocabularies apart, so a purpose from one is
  // `PENNSYNC_PATIENT_PURPOSE_INVALID` in the other rather than a projection
  // nobody meant to allow.
  listAuthorizedPatientsPage: Object.freeze({
    rpc: 'pennsync_contract_patient_list',
    params: Object.freeze(['purpose', 'status', 'page_size', 'after']),
    // Absent is the original's default; an explicit null is not, and reaches
    // the contract as null so the contract refuses it. The same rule the
    // policy library's `mode` follows.
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_purpose: args.purpose ?? null,
      p_status: args.status === undefined ? null : args.status,
      p_page_size: args.page_size === undefined ? 25 : args.page_size,
      p_after: args.after === undefined ? null : args.after,
    }),
    codes: Object.freeze([
      'PENNSYNC_PATIENT_AGENCY_NOT_HELD',
      'PENNSYNC_PATIENT_PURPOSE_INVALID',
      'PENNSYNC_PATIENT_FORBIDDEN',
      'PENNSYNC_PATIENT_STATUS_INVALID',
      'PENNSYNC_PATIENT_PAGE_SIZE_INVALID',
      'PENNSYNC_PATIENT_CURSOR_INVALID',
      'PENNSYNC_PATIENT_CURSOR_UNKNOWN',
    ]),
  }),
  listAuthorizedPatientsBatch: Object.freeze({
    rpc: 'pennsync_contract_patient_batch',
    params: Object.freeze(['purpose', 'patient_ids']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_purpose: args.purpose ?? null,
      p_patient_ids: args.patient_ids ?? null,
    }),
    codes: Object.freeze([
      'PENNSYNC_PATIENT_AGENCY_NOT_HELD',
      'PENNSYNC_PATIENT_PURPOSE_INVALID',
      'PENNSYNC_PATIENT_FORBIDDEN',
      'PENNSYNC_PATIENT_SUBJECT_INVALID',
    ]),
  }),
  getAuthorizedPatient: Object.freeze({
    rpc: 'pennsync_contract_patient_get',
    params: Object.freeze(['purpose', 'patient_id']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_purpose: args.purpose ?? null,
      p_patient_id: args.patient_id ?? null,
    }),
    // Null is an answer here, not an outage: a chart that is not there and a
    // chart that is not this caller's are made indistinguishable on purpose.
    nullable: true,
    codes: Object.freeze([
      'PENNSYNC_PATIENT_AGENCY_NOT_HELD',
      'PENNSYNC_PATIENT_PURPOSE_INVALID',
      'PENNSYNC_PATIENT_FORBIDDEN',
      'PENNSYNC_PATIENT_SUBJECT_INVALID',
    ]),
  }),
  // The authorized visit read. One mode on the list, not two: the original has
  // no id batch here, and inventing one would be a capability nobody asked for.
  //
  // `schedule`, `documentation` and `compliance_review` are purposes on BOTH
  // capabilities and mean different projections — one visit under
  // `compliance_review` discloses fourteen fields, a row of a list eight. The
  // database keeps them apart; nothing here has to know which is which.
  listAuthorizedVisits: Object.freeze({
    rpc: 'pennsync_contract_visit_list',
    params: Object.freeze(['purpose', 'patient_id', 'status', 'page_size', 'after']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_purpose: args.purpose ?? null,
      p_patient_id: args.patient_id === undefined ? null : args.patient_id,
      p_status: args.status === undefined ? null : args.status,
      p_page_size: args.page_size === undefined ? 25 : args.page_size,
      p_after: args.after === undefined ? null : args.after,
    }),
    codes: Object.freeze([
      'PENNSYNC_VISIT_AGENCY_NOT_HELD',
      'PENNSYNC_VISIT_PURPOSE_INVALID',
      'PENNSYNC_VISIT_FORBIDDEN',
      'PENNSYNC_VISIT_STATUS_INVALID',
      'PENNSYNC_VISIT_SUBJECT_INVALID',
      'PENNSYNC_VISIT_PAGE_SIZE_INVALID',
      'PENNSYNC_VISIT_CURSOR_INVALID',
      'PENNSYNC_VISIT_CURSOR_UNKNOWN',
    ]),
  }),
  getAuthorizedVisit: Object.freeze({
    rpc: 'pennsync_contract_visit_get',
    params: Object.freeze(['purpose', 'visit_id']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_purpose: args.purpose ?? null,
      p_visit_id: args.visit_id ?? null,
    }),
    nullable: true,
    codes: Object.freeze([
      'PENNSYNC_VISIT_AGENCY_NOT_HELD',
      'PENNSYNC_VISIT_PURPOSE_INVALID',
      'PENNSYNC_VISIT_FORBIDDEN',
      'PENNSYNC_VISIT_SUBJECT_INVALID',
    ]),
  }),
  // The authorized document read. Its tenancy is the binding, not the row
  // (D27), and its purposes disclose no file locator at all — not even
  // `download` — which is why it ports before the file layer rather than
  // after it.
  listAuthorizedDocuments: Object.freeze({
    rpc: 'pennsync_contract_document_list',
    params: Object.freeze(['purpose', 'patient_id', 'binding_purpose', 'page_size', 'after']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_purpose: args.purpose ?? null,
      p_patient_id: args.patient_id === undefined ? null : args.patient_id,
      p_binding_purpose: args.binding_purpose === undefined ? null : args.binding_purpose,
      // Ten is the original's `MAX_PAGE_SIZE` and its default, which are the
      // same number here because it declares one bound for both purposes.
      p_page_size: args.page_size === undefined ? 10 : args.page_size,
      p_after: args.after === undefined ? null : args.after,
    }),
    codes: Object.freeze([
      'PENNSYNC_DOCUMENT_AGENCY_NOT_HELD',
      'PENNSYNC_DOCUMENT_PURPOSE_INVALID',
      'PENNSYNC_DOCUMENT_FORBIDDEN',
      'PENNSYNC_DOCUMENT_SUBJECT_REQUIRED',
      'PENNSYNC_DOCUMENT_SUBJECT_INVALID',
      'PENNSYNC_DOCUMENT_BINDING_INVALID',
      'PENNSYNC_DOCUMENT_PAGE_SIZE_INVALID',
      'PENNSYNC_DOCUMENT_CURSOR_INVALID',
      'PENNSYNC_DOCUMENT_CURSOR_UNKNOWN',
    ]),
  }),
  getAuthorizedDocument: Object.freeze({
    rpc: 'pennsync_contract_document_get',
    params: Object.freeze(['purpose', 'document_id']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_purpose: args.purpose ?? null,
      p_document_id: args.document_id ?? null,
    }),
    nullable: true,
    codes: Object.freeze([
      'PENNSYNC_DOCUMENT_AGENCY_NOT_HELD',
      'PENNSYNC_DOCUMENT_PURPOSE_INVALID',
      'PENNSYNC_DOCUMENT_FORBIDDEN',
      'PENNSYNC_DOCUMENT_SUBJECT_INVALID',
    ]),
  }),
  // The first ported capability that WRITES a clinical row (D28). It claims
  // the chart and inserts it in one transaction, so a clinician can open what
  // they created — which is the gap the six reads could not have shown.
  //
  // `client_request_id` is the original's idempotency key and is required: a
  // retry answers the same chart rather than making a second one. This module
  // carries none of that; the contract does.
  createAuthorizedPatient: Object.freeze({
    rpc: 'pennsync_contract_patient_create',
    params: Object.freeze(['client_request_id', 'patient']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_client_request_id: args.client_request_id ?? null,
      p_patient: args.patient === undefined ? null : args.patient,
    }),
    codes: Object.freeze([
      'PENNSYNC_PATIENT_AGENCY_NOT_HELD',
      'PENNSYNC_PATIENT_FORBIDDEN',
      'PENNSYNC_PATIENT_REQUEST_ID_INVALID',
      'PENNSYNC_PATIENT_PAYLOAD_INVALID',
      'PENNSYNC_PATIENT_FIELD_RESERVED',
      'PENNSYNC_PATIENT_FIELD_UNKNOWN',
      'PENNSYNC_PATIENT_NAME_REQUIRED',
      'PENNSYNC_PATIENT_FIELD_INVALID',
      'PENNSYNC_PATIENT_REQUEST_CONFLICT',
    ]),
  }),
  // The authorized patient mutation. A caller names workflow actions rather
  // than sending a patch, and the actions — which fields each may touch, and
  // which tenant roles may perform it — are the contract's, extracted in SQL
  // from the original's own fenced declaration. Nothing about them is
  // repeated here, for the reason this module carries no authorization at all.
  updateAuthorizedPatient: Object.freeze({
    rpc: 'pennsync_contract_patient_update',
    params: Object.freeze(['patient_id', 'expected_updated_date', 'actions']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_patient_id: args.patient_id ?? null,
      p_expected_updated_date: args.expected_updated_date ?? null,
      p_actions: args.actions === undefined ? null : args.actions,
    }),
    codes: Object.freeze([
      'PENNSYNC_PATIENT_AGENCY_NOT_HELD',
      'PENNSYNC_PATIENT_ID_INVALID',
      'PENNSYNC_PATIENT_EXPECTED_REQUIRED',
      'PENNSYNC_PATIENT_ACTIONS_INVALID',
      'PENNSYNC_PATIENT_ACTION_SHAPE',
      'PENNSYNC_PATIENT_ACTION_UNKNOWN',
      'PENNSYNC_PATIENT_ACTION_FORBIDDEN',
      'PENNSYNC_PATIENT_CHANGES_INVALID',
      'PENNSYNC_PATIENT_FIELD_UNSUPPORTED',
      'PENNSYNC_PATIENT_FIELD_REPEATED',
      'PENNSYNC_PATIENT_FIELD_INVALID',
      'PENNSYNC_PATIENT_FIELD_TOO_LARGE',
      'PENNSYNC_PATIENT_STATUS_REQUIRED',
      'PENNSYNC_PATIENT_NOT_VISIBLE',
      'PENNSYNC_PATIENT_UNAVAILABLE',
      'PENNSYNC_PATIENT_STALE',
      'PENNSYNC_PATIENT_NOT_CLINICALLY_ACTIVE',
      'PENNSYNC_PATIENT_EPISODE_DISCHARGED',
      'PENNSYNC_PATIENT_CARE_TYPE_LOCKED',
      'PENNSYNC_PATIENT_STATUS_TRANSITION',
      'PENNSYNC_PATIENT_DISCHARGE_FIELDS_REQUIRED',
      'PENNSYNC_PATIENT_DISCHARGE_FIELDS_UNEXPECTED',
      'PENNSYNC_PATIENT_DISCHARGE_BEFORE_ADMISSION',
      'PENNSYNC_PATIENT_MRN_SCOPE',
      'PENNSYNC_PATIENT_MRN_TAKEN',
    ]),
  }),
  // Scheduling a visit. `patient_id` is a parameter rather than a payload
  // field because it is what the authorization is about; the five fields a
  // client may supply are the contract's, extracted in SQL from the original's
  // own `CLIENT_VISIT_FIELDS`. `client_request_id` is optional here, unlike
  // the patient create's: the original accepts a visit without one and simply
  // does not dedupe it.
  createAuthorizedVisit: Object.freeze({
    rpc: 'pennsync_contract_visit_create',
    params: Object.freeze(['patient_id', 'client_request_id', 'visit']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_patient_id: args.patient_id ?? null,
      p_client_request_id: args.client_request_id === undefined ? null : args.client_request_id,
      p_visit: args.visit === undefined ? null : args.visit,
    }),
    codes: Object.freeze([
      'PENNSYNC_VISIT_AGENCY_NOT_HELD',
      'PENNSYNC_VISIT_FORBIDDEN',
      'PENNSYNC_VISIT_PATIENT_INVALID',
      'PENNSYNC_VISIT_REQUEST_ID_INVALID',
      'PENNSYNC_VISIT_PAYLOAD_INVALID',
      'PENNSYNC_VISIT_FIELD_RESERVED',
      'PENNSYNC_VISIT_FIELD_UNKNOWN',
      'PENNSYNC_VISIT_FIELD_INVALID',
      'PENNSYNC_VISIT_DATE_INVALID',
      'PENNSYNC_VISIT_TYPE_INVALID',
      'PENNSYNC_VISIT_PATIENT_NOT_VISIBLE',
      'PENNSYNC_VISIT_PATIENT_UNAVAILABLE',
      'PENNSYNC_VISIT_REQUEST_AMBIGUOUS',
      'PENNSYNC_VISIT_REQUEST_CONFLICT',
      'PENNSYNC_VISIT_IDENTITY_EXHAUSTED',
    ]),
  }),
  // Documenting a visit. Four of the original's nine actions; the other five
  // are known to the contract and refused with the reason the generator
  // carries, so "not ported" and "no such action" stay different answers.
  //
  // The original's body is flat — `{visit_id, action, ...fields}` — and this
  // takes the fields as their own object, the way the ported create
  // capabilities take their payloads. A fixed parameter allowlist is what lets
  // an unreviewed argument be refused rather than forwarded, and an action's
  // own field names cannot be in it.
  updateAuthorizedVisit: Object.freeze({
    rpc: 'pennsync_contract_visit_update',
    params: Object.freeze(['visit_id', 'action', 'fields']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_visit_id: args.visit_id ?? null,
      p_action: args.action ?? null,
      p_fields: args.fields === undefined ? null : args.fields,
    }),
    codes: Object.freeze([
      'PENNSYNC_VISIT_AGENCY_NOT_HELD',
      'PENNSYNC_VISIT_ID_INVALID',
      'PENNSYNC_VISIT_ACTION_UNKNOWN',
      'PENNSYNC_VISIT_ACTION_UNPORTED',
      'PENNSYNC_VISIT_CLINICIAN_REQUIRED',
      'PENNSYNC_VISIT_PAYLOAD_INVALID',
      'PENNSYNC_VISIT_FIELD_UNSUPPORTED',
      'PENNSYNC_VISIT_FIELD_INVALID',
      'PENNSYNC_VISIT_FIELDS_REQUIRED',
      'PENNSYNC_VISIT_TAG_NOT_SYSTEM',
      'PENNSYNC_VISIT_NOT_VISIBLE',
      'PENNSYNC_VISIT_UNAVAILABLE',
      'PENNSYNC_VISIT_PATIENT_UNAVAILABLE',
      'PENNSYNC_VISIT_PATIENT_MISMATCH',
      'PENNSYNC_VISIT_CANCELLED',
      'PENNSYNC_VISIT_STATUS_REGRESSION',
      'PENNSYNC_VISIT_GROUNDING_INCONSISTENT',
      'PENNSYNC_VISIT_NOT_SCHEDULED',
      'PENNSYNC_VISIT_HANDOFF_HISTORY_INVALID',
      'PENNSYNC_VISIT_HANDOFF_STEP',
      'PENNSYNC_VISIT_HANDOFF_FULL',
      'PENNSYNC_VISIT_NO_DOCUMENTATION',
      'PENNSYNC_VISIT_NOTE_CHANGED',
      'PENNSYNC_VISIT_ACK_FIELDS_UNEXPECTED',
    ]),
  }),
  // Patient alerts. Both originals authorize on `patientBelongsToCaller` —
  // the patient's `created_by` or an address in `Patient.assigned_nurses` —
  // which is the representation D21 and D24 threw out, because an address
  // stays on the chart after the assignment naming it was suspended. The
  // contract authorizes through D24's policies instead and carries no copy of
  // either rule.
  getScopedPatientAlerts: Object.freeze({
    rpc: 'pennsync_contract_alert_list',
    params: Object.freeze(['patient_id', 'status', 'severity', 'limit']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_patient_id: args.patient_id === undefined ? null : args.patient_id,
      p_status: args.status === undefined ? null : args.status,
      p_severity: args.severity === undefined ? null : args.severity,
      p_limit: args.limit === undefined ? null : args.limit,
    }),
    codes: Object.freeze([
      'PENNSYNC_ALERT_AGENCY_NOT_HELD',
      'PENNSYNC_ALERT_PATIENT_INVALID',
      'PENNSYNC_ALERT_STATUS_INVALID',
      'PENNSYNC_ALERT_SEVERITY_INVALID',
    ]),
  }),
  updateScopedPatientAlert: Object.freeze({
    rpc: 'pennsync_contract_alert_update',
    params: Object.freeze(['alert_id', 'action', 'resolution_notes']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_alert_id: args.alert_id ?? null,
      p_action: args.action ?? null,
      p_resolution_notes: args.resolution_notes === undefined ? null : args.resolution_notes,
    }),
    codes: Object.freeze([
      'PENNSYNC_ALERT_AGENCY_NOT_HELD',
      'PENNSYNC_ALERT_ID_INVALID',
      'PENNSYNC_ALERT_ACTION_INVALID',
      'PENNSYNC_ALERT_NOTES_UNEXPECTED',
      'PENNSYNC_ALERT_NOTES_INVALID',
      'PENNSYNC_ALERT_NOT_VISIBLE',
    ]),
  }),
  // The clinical note history. Append-only by D32: the store gives the table
  // no update and no delete policy, so a correction writes a NEW event and
  // the read shows only the latest revision of each note.
  getAuthorizedPatientNoteHistory: Object.freeze({
    rpc: 'pennsync_contract_note_history',
    params: Object.freeze(['patient_id', 'event_limit', 'offset']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_patient_id: args.patient_id ?? null,
      p_event_limit: args.event_limit === undefined ? null : args.event_limit,
      p_offset: args.offset === undefined ? null : args.offset,
    }),
    codes: Object.freeze([
      'PENNSYNC_NOTE_AGENCY_NOT_HELD',
      'PENNSYNC_NOTE_FORBIDDEN',
      'PENNSYNC_NOTE_PATIENT_INVALID',
      'PENNSYNC_NOTE_LIMIT_INVALID',
      'PENNSYNC_NOTE_OFFSET_INVALID',
      'PENNSYNC_NOTE_EVENT_AMBIGUOUS',
      'PENNSYNC_NOTE_INTEGRITY',
    ]),
  }),
  appendPatientNoteHistory: Object.freeze({
    rpc: 'pennsync_contract_note_append',
    params: Object.freeze(['patient_id', 'mode', 'entry', 'clinical_notes']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_patient_id: args.patient_id ?? null,
      p_mode: args.mode ?? null,
      p_entry: args.entry === undefined ? null : args.entry,
      p_clinical_notes: args.clinical_notes === undefined ? null : args.clinical_notes,
    }),
    codes: Object.freeze([
      'PENNSYNC_NOTE_AGENCY_NOT_HELD',
      'PENNSYNC_NOTE_FORBIDDEN',
      'PENNSYNC_NOTE_PATIENT_INVALID',
      'PENNSYNC_NOTE_MODE_INVALID',
      'PENNSYNC_NOTE_ENTRY_INVALID',
      'PENNSYNC_NOTE_FIELD_UNSUPPORTED',
      'PENNSYNC_NOTE_VISIT_INVALID',
      'PENNSYNC_NOTE_ENTRY_ID_INVALID',
      'PENNSYNC_NOTE_TEXT_INVALID',
      'PENNSYNC_NOTE_CLINICAL_MISMATCH',
      'PENNSYNC_NOTE_SCORE_INVALID',
      'PENNSYNC_NOTE_PATIENT_NOT_VISIBLE',
      'PENNSYNC_NOTE_PATIENT_UNAVAILABLE',
      'PENNSYNC_NOTE_VISIT_NOT_VISIBLE',
      'PENNSYNC_NOTE_VISIT_UNAVAILABLE',
      'PENNSYNC_NOTE_VISIT_INCOMPLETE',
      'PENNSYNC_NOTE_VISIT_METADATA_MISMATCH',
      'PENNSYNC_NOTE_CONTENT_MISMATCH',
      'PENNSYNC_NOTE_EVENT_CONFLICT',
      'PENNSYNC_NOTE_IDENTITY_EXHAUSTED',
    ]),
  }),
  // The care-team assignment lifecycle. The one capability in the port queue
  // whose original is PAUSED AT SOURCE, re-enabled because the owned store
  // meets the three conditions its pause names — a create-if-absent unique
  // constraint, one transaction spanning membership, agency, chart and
  // assignment, and an authenticated concurrency matrix proved rather than
  // asserted. `inspect` was always live; the four mutations were not.
  inspectPatientCareTeamAssignment: Object.freeze({
    rpc: 'pennsync_contract_assignment_inspect',
    params: Object.freeze(['patient_id', 'target_user_id']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_patient_id: args.patient_id ?? null,
      p_target_user_id: args.target_user_id ?? null,
    }),
    codes: Object.freeze([
      'PENNSYNC_ASSIGNMENT_AGENCY_NOT_HELD',
      'PENNSYNC_ASSIGNMENT_FORBIDDEN',
      'PENNSYNC_ASSIGNMENT_SUBJECT_INVALID',
      'PENNSYNC_ASSIGNMENT_TARGET_NOT_A_COLLEAGUE',
      'PENNSYNC_ASSIGNMENT_PATIENT_NOT_VISIBLE',
    ]),
  }),
  transitionPatientCareTeamAssignment: Object.freeze({
    rpc: 'pennsync_contract_assignment_transition',
    params: Object.freeze([
      'patient_id', 'target_user_id', 'action', 'client_request_id', 'reason', 'expected_version',
    ]),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_patient_id: args.patient_id ?? null,
      p_target_user_id: args.target_user_id ?? null,
      p_action: args.action ?? null,
      p_client_request_id: args.client_request_id ?? null,
      p_reason: args.reason === undefined ? null : args.reason,
      p_expected_version: args.expected_version === undefined ? null : args.expected_version,
    }),
    codes: Object.freeze([
      'PENNSYNC_ASSIGNMENT_AGENCY_NOT_HELD',
      'PENNSYNC_ASSIGNMENT_FORBIDDEN',
      'PENNSYNC_ASSIGNMENT_SUBJECT_INVALID',
      'PENNSYNC_ASSIGNMENT_ACTION_INVALID',
      'PENNSYNC_ASSIGNMENT_REQUEST_ID_INVALID',
      'PENNSYNC_ASSIGNMENT_REASON_REQUIRED',
      'PENNSYNC_ASSIGNMENT_VERSION_REQUIRED',
      'PENNSYNC_ASSIGNMENT_VERSION_UNEXPECTED',
      'PENNSYNC_ASSIGNMENT_TARGET_NOT_A_COLLEAGUE',
      'PENNSYNC_ASSIGNMENT_PATIENT_NOT_VISIBLE',
      'PENNSYNC_ASSIGNMENT_EXISTS',
      'PENNSYNC_ASSIGNMENT_NOT_FOUND',
      'PENNSYNC_ASSIGNMENT_STALE',
      'PENNSYNC_ASSIGNMENT_REVOKED',
      'PENNSYNC_ASSIGNMENT_TRANSITION',
      'PENNSYNC_ASSIGNMENT_REQUEST_CONFLICT',
    ]),
  }),
  // Filing a staff credential. Its sibling `reviewPersonnelCredential` is NOT
  // here and has no contract at all: its only gate is `u.role === 'admin'`,
  // the platform tier D14 and D22 removed, so the whole capability has no
  // performer left. Who may approve a credential is a product decision.
  submitPersonnelCredential: Object.freeze({
    rpc: 'pennsync_contract_credential_submit',
    params: Object.freeze(['credential_id', 'renews_credential_id', 'credential']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_credential_id: args.credential_id === undefined ? null : args.credential_id,
      p_renews_id: args.renews_credential_id === undefined ? null : args.renews_credential_id,
      p_credential: args.credential === undefined ? null : args.credential,
    }),
    codes: Object.freeze([
      'PENNSYNC_CREDENTIAL_AGENCY_NOT_HELD',
      'PENNSYNC_CREDENTIAL_INVALID',
      'PENNSYNC_CREDENTIAL_FIELD_UNSUPPORTED',
      'PENNSYNC_CREDENTIAL_REQUIRED',
      'PENNSYNC_CREDENTIAL_DATE_INVALID',
      'PENNSYNC_CREDENTIAL_DATE_ORDER',
      'PENNSYNC_CREDENTIAL_FILE_URL_INVALID',
      'PENNSYNC_CREDENTIAL_SUBJECT_INVALID',
      'PENNSYNC_CREDENTIAL_NOT_FOUND',
      'PENNSYNC_CREDENTIAL_FORBIDDEN',
    ]),
  }),
  // Two agency configuration rows, both under D40. Each original is a
  // single-row-per-scope upsert whose scope it rebuilt in JavaScript, and each
  // carries a bug in its own comments from having got that wrong (D43).
  saveVisitPointConfig: Object.freeze({
    rpc: 'pennsync_contract_visit_points_save',
    params: Object.freeze(['config']),
    body: (agencyId, args) => ({
      p_agency: agencyId, p_config: args.config === undefined ? null : args.config,
    }),
    codes: Object.freeze([
      'PENNSYNC_CONFIG_FORBIDDEN',
      'PENNSYNC_CONFIG_INVALID',
      'PENNSYNC_CONFIG_EMPTY',
      'PENNSYNC_CONFIG_FIELD_UNSUPPORTED',
      // D78: the contract retries once onto a concurrent winner's row, so this
      // is only reachable if that row was gone again by the time it looked.
      // Undeclared it would be opaque, which is the one answer a caller of a
      // save cannot act on.
      'PENNSYNC_CONFIG_CONFLICT',
    ]),
  }),
  savePayrollProfile: Object.freeze({
    rpc: 'pennsync_contract_payroll_profile_save',
    params: Object.freeze(['employee_email', 'profile']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_employee_email: args.employee_email ?? null,
      p_profile: args.profile === undefined ? null : args.profile,
    }),
    codes: Object.freeze([
      'PENNSYNC_CONFIG_FORBIDDEN',
      'PENNSYNC_CONFIG_INVALID',
      'PENNSYNC_CONFIG_FIELD_UNSUPPORTED',
      'PENNSYNC_CONFIG_EMPLOYEE_REQUIRED',
      'PENNSYNC_CONFIG_EMPLOYEE_UNKNOWN',
    ]),
  }),
  // Vehicle maintenance. Six of `manageVehicleMaintenance`'s eight actions;
  // the other two need no SQL, because `context` is D34's tenant memberships
  // and `staff` is D22's roster. The rule D34 established generalises: check
  // which store already models what the original reads.
  //
  // The original's `createOnce` reservation protocol — a hashed claim appended
  // to an array on a parent row — becomes a `for update` on that same parent,
  // which is what it was emulating. And a review INSERTS an immutable row
  // (D32) rather than rewriting the entry's array, which is what the original
  // says it is doing too.
  listFleetVehicles: Object.freeze({
    rpc: 'pennsync_contract_fleet_vehicles',
    params: Object.freeze(['offset', 'include_retired']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_offset: args.offset === undefined ? null : args.offset,
      p_include_retired: args.include_retired === undefined ? null : args.include_retired,
    }),
    codes: Object.freeze([
      'PENNSYNC_FLEET_AGENCY_NOT_HELD',
      'PENNSYNC_FLEET_OFFSET_INVALID',
    ]),
  }),
  getFleetVehicleHistory: Object.freeze({
    rpc: 'pennsync_contract_fleet_history',
    params: Object.freeze(['vehicle_id', 'cursor']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_vehicle_id: args.vehicle_id ?? null,
      p_cursor: args.cursor === undefined ? null : args.cursor,
    }),
    codes: Object.freeze([
      'PENNSYNC_FLEET_AGENCY_NOT_HELD',
      'PENNSYNC_FLEET_SUBJECT_INVALID',
      'PENNSYNC_FLEET_VEHICLE_NOT_FOUND',
      'PENNSYNC_FLEET_VEHICLE_NOT_YOURS',
      'PENNSYNC_FLEET_CURSOR_INVALID',
      'PENNSYNC_FLEET_FIELD_INVALID',
    ]),
  }),
  createFleetVehicle: Object.freeze({
    rpc: 'pennsync_contract_fleet_vehicle_create',
    params: Object.freeze(['request_id', 'vehicle']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_request_id: args.request_id ?? null,
      p_vehicle: args.vehicle === undefined ? null : args.vehicle,
    }),
    codes: Object.freeze([
      'PENNSYNC_FLEET_AGENCY_NOT_HELD',
      'PENNSYNC_FLEET_FORBIDDEN',
      'PENNSYNC_FLEET_REQUEST_INVALID',
      'PENNSYNC_FLEET_VEHICLE_INVALID',
      'PENNSYNC_FLEET_FIELD_UNSUPPORTED',
      'PENNSYNC_FLEET_FIELD_INVALID',
      'PENNSYNC_FLEET_VIN_INVALID',
      'PENNSYNC_FLEET_SUBJECT_INVALID',
      'PENNSYNC_FLEET_ASSIGNEE_UNKNOWN',
    ]),
  }),
  updateFleetVehicle: Object.freeze({
    rpc: 'pennsync_contract_fleet_vehicle_update',
    params: Object.freeze(['vehicle_id', 'expected_version', 'vehicle']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_vehicle_id: args.vehicle_id ?? null,
      p_expected_version: args.expected_version === undefined ? null : args.expected_version,
      p_vehicle: args.vehicle === undefined ? null : args.vehicle,
    }),
    codes: Object.freeze([
      'PENNSYNC_FLEET_AGENCY_NOT_HELD',
      'PENNSYNC_FLEET_FORBIDDEN',
      'PENNSYNC_FLEET_SUBJECT_INVALID',
      'PENNSYNC_FLEET_VEHICLE_NOT_FOUND',
      'PENNSYNC_FLEET_VEHICLE_STALE',
      'PENNSYNC_FLEET_VEHICLE_INVALID',
      'PENNSYNC_FLEET_FIELD_UNSUPPORTED',
      'PENNSYNC_FLEET_FIELD_INVALID',
      'PENNSYNC_FLEET_VIN_INVALID',
      'PENNSYNC_FLEET_ASSIGNEE_UNKNOWN',
    ]),
  }),
  addFleetServiceEntry: Object.freeze({
    rpc: 'pennsync_contract_fleet_entry_add',
    params: Object.freeze(['vehicle_id', 'request_id', 'entry']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_vehicle_id: args.vehicle_id ?? null,
      p_request_id: args.request_id ?? null,
      p_entry: args.entry === undefined ? null : args.entry,
    }),
    codes: Object.freeze([
      'PENNSYNC_FLEET_AGENCY_NOT_HELD',
      'PENNSYNC_FLEET_REQUEST_INVALID',
      'PENNSYNC_FLEET_SUBJECT_INVALID',
      'PENNSYNC_FLEET_VEHICLE_NOT_FOUND',
      'PENNSYNC_FLEET_VEHICLE_NOT_YOURS',
      'PENNSYNC_FLEET_VEHICLE_RETIRED',
      'PENNSYNC_FLEET_ENTRY_INVALID',
      'PENNSYNC_FLEET_FIELD_UNSUPPORTED',
      'PENNSYNC_FLEET_FIELD_INVALID',
      'PENNSYNC_FLEET_SERVICE_DATE_FUTURE',
      'PENNSYNC_FLEET_NEXT_DATE_BEFORE',
      'PENNSYNC_FLEET_NEXT_ODOMETER_BEFORE',
    ]),
  }),
  reviewFleetServiceEntry: Object.freeze({
    rpc: 'pennsync_contract_fleet_entry_review',
    params: Object.freeze(['vehicle_id', 'entry_id', 'request_id',
      'expected_review_count', 'status', 'note']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_vehicle_id: args.vehicle_id ?? null,
      p_entry_id: args.entry_id ?? null,
      p_request_id: args.request_id === undefined ? null : args.request_id,
      p_expected_review_count: args.expected_review_count === undefined
        ? null : args.expected_review_count,
      p_status: args.status ?? null,
      p_note: args.note === undefined ? null : args.note,
    }),
    codes: Object.freeze([
      'PENNSYNC_FLEET_AGENCY_NOT_HELD',
      'PENNSYNC_FLEET_FORBIDDEN',
      'PENNSYNC_FLEET_SUBJECT_INVALID',
      'PENNSYNC_FLEET_VEHICLE_NOT_FOUND',
      'PENNSYNC_FLEET_VEHICLE_NOT_YOURS',
      'PENNSYNC_FLEET_ENTRY_NOT_FOUND',
      'PENNSYNC_FLEET_REVIEW_STATUS_INVALID',
      'PENNSYNC_FLEET_REVIEW_COUNT_INVALID',
      'PENNSYNC_FLEET_REVIEW_STALE',
      'PENNSYNC_FLEET_REVIEW_HISTORY_FULL',
      'PENNSYNC_FLEET_REQUEST_INVALID',
      'PENNSYNC_FLEET_FIELD_INVALID',
    ]),
  }),
  // Creating a notification for somebody else: the writer half of D45.
  //
  // It mints through `notification_mint`, the facility that owns the authority
  // envelope and is the only thing in the store that inserts a notification
  // row — `contract_incident_submit`'s fan-out inlined it until D48, and got
  // three of its six columns.
  //
  // The email half is `Core.SendEmail`, which nothing here brokers, so the
  // answer says `delivery_paused`. Everything that gated the EMAIL goes with
  // it: quiet hours, digest mode and the email preference are not evaluated,
  // because there is nothing for them to gate. The IN-APP preference moves to
  // the reader, because `notification_preference_read` is
  // `user_email = caller_email()` and the sender cannot ask.
  createNotification: Object.freeze({
    rpc: 'pennsync_contract_notification_create',
    params: Object.freeze(['notification']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_notification: args.notification === undefined ? null : args.notification,
    }),
    codes: Object.freeze([
      'PENNSYNC_NOTIFICATION_AGENCY_NOT_HELD',
      'PENNSYNC_NOTIFICATION_INVALID',
      'PENNSYNC_NOTIFICATION_FIELD_UNSUPPORTED',
      'PENNSYNC_NOTIFICATION_REQUIRED',
      'PENNSYNC_NOTIFICATION_ACTION_URL_INVALID',
      'PENNSYNC_NOTIFICATION_SUBJECT_INVALID',
      'PENNSYNC_NOTIFICATION_RECIPIENT_UNKNOWN',
      'PENNSYNC_NOTIFICATION_TYPE_FORBIDDEN',
      'PENNSYNC_NOTIFICATION_RECIPIENT_FORBIDDEN',
      'PENNSYNC_NOTIFICATION_PATIENT_FORBIDDEN',
    ]),
  }),
  // A person's own notifications, and the second capability where tenancy is
  // not ownership (D36) — this time the policy says so plainly, because
  // `notification_read` and `notification_update` are agency-WIDE. Every
  // ownership rule here is the contract's.
  //
  // One Base44 capability, three contracts, because its three actions are
  // three different statements: a page, one row under an optimistic version,
  // and one set-based update. The handler keeps the original's single
  // `action` envelope.
  listMyNotifications: Object.freeze({
    rpc: 'pennsync_contract_notification_list',
    params: Object.freeze([]),
    body: agencyId => ({ p_agency: agencyId }),
    codes: Object.freeze([
      'PENNSYNC_NOTIFICATION_AGENCY_NOT_HELD',
      'PENNSYNC_NOTIFICATION_INTEGRITY',
    ]),
  }),
  transitionMyNotification: Object.freeze({
    rpc: 'pennsync_contract_notification_transition',
    params: Object.freeze(['notification_id', 'expected_version', 'action']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_notification_id: args.notification_id ?? null,
      p_expected_version: args.expected_version === undefined ? null : args.expected_version,
      p_action: args.action ?? null,
    }),
    codes: Object.freeze([
      'PENNSYNC_NOTIFICATION_AGENCY_NOT_HELD',
      'PENNSYNC_NOTIFICATION_ACTION_INVALID',
      'PENNSYNC_NOTIFICATION_SUBJECT_INVALID',
      'PENNSYNC_NOTIFICATION_VERSION_INVALID',
      'PENNSYNC_NOTIFICATION_NOT_FOUND',
      'PENNSYNC_NOTIFICATION_INTEGRITY',
      'PENNSYNC_NOTIFICATION_STALE',
    ]),
  }),
  markAllMyNotificationsRead: Object.freeze({
    rpc: 'pennsync_contract_notification_mark_all',
    params: Object.freeze([]),
    body: agencyId => ({ p_agency: agencyId }),
    codes: Object.freeze(['PENNSYNC_NOTIFICATION_AGENCY_NOT_HELD']),
  }),
  // Reporting an incident, and moving one through its review.
  //
  // The reviewer-only field set (`severity`, `state_reportable`, `ai_tags`) is
  // the original's own security control: they are the inputs to the resolve
  // gate, so a reporter who could write them could soften their own incident
  // and close it with no corrective action. D40 is what makes the contract's
  // self-review refusal necessary — the original's reviewer was the platform
  // owner, who never reported an agency's incidents, so the split held by
  // itself.
  //
  // The urgent-alert fan-out is ported rather than paused, because its
  // recipients are records rather than a message: the agency's active
  // `agency_admin` memberships, which is what the original's 5000-row `User`
  // scan over `account_type` and `agency_name` was approximating.
  submitIncidentReport: Object.freeze({
    rpc: 'pennsync_contract_incident_submit',
    params: Object.freeze(['incident']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_incident: args.incident === undefined ? null : args.incident,
    }),
    codes: Object.freeze([
      'PENNSYNC_INCIDENT_AGENCY_NOT_HELD',
      'PENNSYNC_INCIDENT_INVALID',
      'PENNSYNC_INCIDENT_REQUIRED',
      'PENNSYNC_INCIDENT_SEVERITY_INVALID',
      'PENNSYNC_INCIDENT_PATIENT_NOT_VISIBLE',
    ]),
  }),
  updateIncident: Object.freeze({
    rpc: 'pennsync_contract_incident_update',
    params: Object.freeze(['incident_id', 'action', 'patch', 'to_status',
      'corrective_action_plan', 'resolution_notes', 'patient_id']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_incident_id: args.incident_id ?? null,
      p_action: args.action ?? null,
      p_patch: args.patch === undefined ? null : args.patch,
      p_to_status: args.to_status === undefined ? null : args.to_status,
      p_corrective_action_plan: args.corrective_action_plan === undefined
        ? null : args.corrective_action_plan,
      p_resolution_notes: args.resolution_notes === undefined
        ? null : args.resolution_notes,
      p_patient_id: args.patient_id === undefined ? null : args.patient_id,
    }),
    codes: Object.freeze([
      'PENNSYNC_INCIDENT_AGENCY_NOT_HELD',
      'PENNSYNC_INCIDENT_SUBJECT_INVALID',
      'PENNSYNC_INCIDENT_ACTION_INVALID',
      'PENNSYNC_INCIDENT_NOT_FOUND',
      'PENNSYNC_INCIDENT_FORBIDDEN',
      'PENNSYNC_INCIDENT_SELF_REVIEW',
      'PENNSYNC_INCIDENT_PATCH_EMPTY',
      'PENNSYNC_INCIDENT_FIELD_NOT_CARRIED',
      'PENNSYNC_INCIDENT_FIELD_UNSUPPORTED',
      'PENNSYNC_INCIDENT_FIELD_PRIVILEGED',
      'PENNSYNC_INCIDENT_SEVERITY_INVALID',
      'PENNSYNC_INCIDENT_PATIENT_NOT_VISIBLE',
      'PENNSYNC_INCIDENT_STATUS_REQUIRED',
      'PENNSYNC_INCIDENT_STATUS_UNCHANGED',
      'PENNSYNC_INCIDENT_TRANSITION',
      'PENNSYNC_INCIDENT_CORRECTIVE_ACTION_REQUIRED',
    ]),
  }),
  // Sweeping an agency's pending invitations, fourth under D40.
  //
  // Its two gates were the built-in admin and a shared secret in a header.
  // Only the first has a successor; the second is how a SCHEDULER calls it,
  // and nothing in this store is cross-tenant, so who runs this on a schedule
  // is an open decision. This is the per-agency half that decision will call.
  //
  // The digest is `Core.SendEmail`, which nothing brokers, so the answer is
  // the original's OWN paused branch: expiry maintenance happens, the
  // expiring-soon tier is counted and not claimed, and it says so.
  checkExpiredInvitations: Object.freeze({
    rpc: 'pennsync_contract_invitation_sweep',
    params: Object.freeze([]),
    body: agencyId => ({ p_agency: agencyId }),
    codes: Object.freeze(['PENNSYNC_INVITATION_FORBIDDEN']),
  }),
  // Resending a staff invitation, third under D40. ONE contract for TWO Base44
  // capabilities: `resendInvitation` and `resendInvitationV2` are
  // byte-identical apart from a comment naming the second the production
  // replacement, so both handler names reach this. The invitation EMAIL is not
  // ported — the original calls the Base44 platform's own invitation service,
  // and there is no platform here.
  resendInvitation: Object.freeze({
    rpc: 'pennsync_contract_invitation_resend',
    params: Object.freeze(['invitation_id']),
    body: (agencyId, args) => ({
      p_agency: agencyId, p_invitation_id: args.invitation_id ?? null,
    }),
    codes: Object.freeze([
      'PENNSYNC_INVITATION_FORBIDDEN',
      'PENNSYNC_INVITATION_SUBJECT_INVALID',
      'PENNSYNC_INVITATION_NOT_FOUND',
      'PENNSYNC_INVITATION_ACCEPTED',
      'PENNSYNC_INVITATION_CANCELLED',
    ]),
  }),
  // The data-quality audit, second under D40. Its whole agency-scoping block
  // disappears: the original rebuilt "which of these are mine" from
  // `agency_name` strings, `created_by` addresses and `assigned_nurses`
  // arrays, and the policies answer it here.
  auditDataQuality: Object.freeze({
    rpc: 'pennsync_contract_data_quality_audit',
    params: Object.freeze([]),
    body: agencyId => ({ p_agency: agencyId }),
    codes: Object.freeze(['PENNSYNC_QUALITY_FORBIDDEN']),
  }),
  // D40: an `agency_admin` scoped to their own agency is the successor to
  // Base44's built-in `role === 'admin'`. A WIDENING, granted by the owner,
  // and the self-approval check the contract adds is what that widening makes
  // necessary — the original's reviewer held no credentials in any agency.
  reviewPersonnelCredential: Object.freeze({
    rpc: 'pennsync_contract_credential_review',
    params: Object.freeze(['credential_id', 'action', 'rejection_reason']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_credential_id: args.credential_id ?? null,
      p_action: args.action ?? null,
      p_rejection_reason: args.rejection_reason === undefined ? null : args.rejection_reason,
    }),
    codes: Object.freeze([
      'PENNSYNC_CREDENTIAL_FORBIDDEN',
      'PENNSYNC_CREDENTIAL_SUBJECT_INVALID',
      'PENNSYNC_CREDENTIAL_ACTION_INVALID',
      'PENNSYNC_CREDENTIAL_REASON_REQUIRED',
      'PENNSYNC_CREDENTIAL_REASON_UNEXPECTED',
      'PENNSYNC_CREDENTIAL_NOT_FOUND',
      'PENNSYNC_CREDENTIAL_SELF',
      'PENNSYNC_CREDENTIAL_TRANSITION',
    ]),
  }),
  // The record half of the CMS regulation sync. Every enumerated field the
  // MODEL supplies is checked against the column's own constraint before
  // anything is stored, and the answer reports how many were adjusted — the
  // original writes them straight through, so an unlisted category raises a
  // check violation and the row is lost inside a catch that only logs.
  syncCMSRegulations: Object.freeze({
    rpc: 'pennsync_contract_regulatory_update_store',
    params: Object.freeze(['regulations']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_regulations: args.regulations === undefined ? null : args.regulations,
    }),
    codes: Object.freeze([
      'PENNSYNC_REGULATION_FORBIDDEN',
      'PENNSYNC_REGULATION_INVALID',
      'PENNSYNC_REGULATION_TOO_MANY',
    ]),
  }),
  // ADR response deadline reminders: the first D49 sweep with nothing paused,
  // because its reminder is a row rather than an email.
  //
  // It is also the evidence for `notification_mint`. The original creates its
  // reminder with none of the six authority columns `manageMyNotifications`
  // filters on, so in Base44 today an ADR deadline reminder is shown to
  // nobody. Minting through the facility makes that impossible to repeat.
  checkAdrDeadlines: Object.freeze({
    rpc: 'pennsync_contract_adr_deadline_sweep',
    params: Object.freeze([]),
    body: agencyId => ({ p_agency: agencyId }),
    codes: Object.freeze(['PENNSYNC_ADR_FORBIDDEN']),
  }),
  // The credential sweeps, fifth and sixth under D40 and both scheduler
  // capabilities under D49: their human gate is the built-in admin, and their
  // machine gate is a shared secret over every tenant, which has no successor
  // because nothing in this store is cross-tenant.
  //
  // They are two contracts rather than one because the renewal original says
  // in its own comment why they must be: the three credential-reminder crons
  // once shared `reminder_offsets_sent` with different tier sets, so whichever
  // fired a shared tier first consumed it for the others. Three marker
  // columns, one each.
  //
  // The send is `Core.SendEmail`, which nothing brokers, so each answer is the
  // original's OWN paused branch: expiry is maintained, the due tiers are
  // counted and not claimed, and it says so.
  sendPersonnelExpirationNotifications: Object.freeze({
    rpc: 'pennsync_contract_credential_expiration_sweep',
    params: Object.freeze([]),
    body: agencyId => ({ p_agency: agencyId }),
    codes: Object.freeze(['PENNSYNC_CREDENTIAL_FORBIDDEN']),
  }),
  sendCredentialRenewalReminders: Object.freeze({
    rpc: 'pennsync_contract_credential_renewal_sweep',
    params: Object.freeze([]),
    body: agencyId => ({ p_agency: agencyId }),
    codes: Object.freeze(['PENNSYNC_CREDENTIAL_FORBIDDEN']),
  }),
  // The THIRD of those three crons, and the one the renewal original quotes by
  // name. Its column is `expiration_note_offsets_sent` and it is a separate
  // contract rather than a third caller of `credential_sweep`, because that
  // body counts the due tiers and deliberately does not claim them: its two
  // capabilities' send is paused, and a claim without a send loses the
  // reminder permanently. This one's reminder is a row, so it claims.
  //
  // Partial on a second axis too: the module's training half reads
  // `TrainingAssignment`, which is `hub`, and D84's `uncarried_legs` entry
  // settles that leg by name. The answer says so rather than reporting a zero
  // that reads like "no training expired".
  sendExpirationNotifications: Object.freeze({
    rpc: 'pennsync_contract_expiration_notice_sweep',
    params: Object.freeze([]),
    body: agencyId => ({ p_agency: agencyId }),
    codes: Object.freeze(['PENNSYNC_EXPIRATION_FORBIDDEN']),
  }),
  // The timesheet pair: a submission and the decision on it, one domain as the
  // time-off four are.
  //
  // Almost nothing the caller sends decides what they are paid. The service
  // line and points eligibility are the payroll profile's, the points are the
  // agency's configured per-type values times the visit counts, the paid time
  // off carries in from approved requests, and the phone reimbursement is the
  // profile's — each server-authoritative in the original and here.
  //
  // `timesheet_read` and `timesheet_update` are agency-WIDE, so "my timesheet"
  // and "one I may review" are the contract's rules (D45). The employee and
  // approver notifications mint through the facility (D48); their EMAIL halves
  // are `Core.SendEmail`, which nothing brokers.
  submitTimesheet: Object.freeze({
    rpc: 'pennsync_contract_timesheet_submit',
    params: Object.freeze(['timesheet_id', 'timesheet']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_timesheet_id: args.timesheet_id === undefined ? null : args.timesheet_id,
      p_sheet: args.timesheet === undefined ? null : args.timesheet,
    }),
    codes: Object.freeze([
      'PENNSYNC_TIMESHEET_AGENCY_NOT_HELD',
      'PENNSYNC_TIMESHEET_INVALID',
      'PENNSYNC_TIMESHEET_FIELD_UNSUPPORTED',
      'PENNSYNC_TIMESHEET_STATUS_INVALID',
      'PENNSYNC_TIMESHEET_PERIOD_INVALID',
      'PENNSYNC_TIMESHEET_PERIOD_UNALIGNED',
      'PENNSYNC_TIMESHEET_SERVICE_TYPE_INVALID',
      'PENNSYNC_TIMESHEET_NUMBER_INVALID',
      'PENNSYNC_TIMESHEET_DAILY_INVALID',
      'PENNSYNC_TIMESHEET_DAILY_DUPLICATE',
      'PENNSYNC_TIMESHEET_APPROVER_SELF',
      'PENNSYNC_TIMESHEET_APPROVER_UNKNOWN',
      'PENNSYNC_TIMESHEET_APPROVER_INVALID',
      'PENNSYNC_TIMESHEET_PERIOD_EXISTS',
      'PENNSYNC_TIMESHEET_PERIOD_APPROVED',
      'PENNSYNC_TIMESHEET_SUBJECT_INVALID',
      'PENNSYNC_TIMESHEET_NOT_FOUND',
      'PENNSYNC_TIMESHEET_FORBIDDEN',
      'PENNSYNC_TIMESHEET_APPROVED_LOCKED',
    ]),
  }),
  reviewTimesheet: Object.freeze({
    rpc: 'pennsync_contract_timesheet_review',
    params: Object.freeze(['timesheet_id', 'decision', 'note']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_timesheet_id: args.timesheet_id ?? null,
      p_decision: args.decision ?? null,
      p_note: args.note === undefined ? null : args.note,
    }),
    codes: Object.freeze([
      'PENNSYNC_TIMESHEET_AGENCY_NOT_HELD',
      'PENNSYNC_TIMESHEET_DECISION_INVALID',
      'PENNSYNC_TIMESHEET_SUBJECT_INVALID',
      'PENNSYNC_TIMESHEET_NOT_FOUND',
      'PENNSYNC_TIMESHEET_REVIEW_FORBIDDEN',
      'PENNSYNC_TIMESHEET_REVIEW_SELF',
      'PENNSYNC_TIMESHEET_NOT_AWAITING_REVIEW',
    ]),
  }),
  // The time-off domain. All four originals decide who may act by reading the
  // carried `User` row — `is_approved`, `is_manager`, `role`, `account_type`
  // and string comparisons of `agency_name` — and D23 says that row decides
  // nothing. Membership answers all of it here, so the list capability's
  // "collect the agency's users and filter by address" step is gone rather
  // than reimplemented.
  submitTimeOffRequest: Object.freeze({
    rpc: 'pennsync_contract_time_off_submit',
    params: Object.freeze(['request_type', 'start_date', 'end_date', 'half_day',
      'reason', 'coverage', 'manager_email']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_request_type: args.request_type ?? null,
      p_start: args.start_date ?? null,
      p_end: args.end_date ?? null,
      p_half_day: args.half_day === undefined ? null : args.half_day,
      p_reason: args.reason === undefined ? null : args.reason,
      p_coverage: args.coverage === undefined ? null : args.coverage,
      p_manager_email: args.manager_email === undefined ? null : args.manager_email,
    }),
    codes: Object.freeze([
      'PENNSYNC_TIME_OFF_AGENCY_NOT_HELD',
      'PENNSYNC_TIME_OFF_TYPE_INVALID',
      'PENNSYNC_TIME_OFF_DATE_INVALID',
      'PENNSYNC_TIME_OFF_RANGE_INVALID',
      'PENNSYNC_TIME_OFF_APPROVER_SELF',
      'PENNSYNC_TIME_OFF_APPROVER_UNKNOWN',
      'PENNSYNC_TIME_OFF_APPROVER_INVALID',
    ]),
  }),
  cancelTimeOffRequest: Object.freeze({
    rpc: 'pennsync_contract_time_off_cancel',
    params: Object.freeze(['request_id']),
    body: (agencyId, args) => ({ p_agency: agencyId, p_request_id: args.request_id ?? null }),
    codes: Object.freeze([
      'PENNSYNC_TIME_OFF_AGENCY_NOT_HELD',
      'PENNSYNC_TIME_OFF_SUBJECT_INVALID',
      'PENNSYNC_TIME_OFF_NOT_FOUND',
      'PENNSYNC_TIME_OFF_FORBIDDEN',
      'PENNSYNC_TIME_OFF_TRANSITION',
    ]),
  }),
  reviewTimeOffRequest: Object.freeze({
    rpc: 'pennsync_contract_time_off_review',
    params: Object.freeze(['request_id', 'decision', 'note']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_request_id: args.request_id ?? null,
      p_decision: args.decision ?? null,
      p_note: args.note === undefined ? null : args.note,
    }),
    codes: Object.freeze([
      'PENNSYNC_TIME_OFF_AGENCY_NOT_HELD',
      'PENNSYNC_TIME_OFF_SUBJECT_INVALID',
      'PENNSYNC_TIME_OFF_DECISION_INVALID',
      'PENNSYNC_TIME_OFF_NOT_FOUND',
      'PENNSYNC_TIME_OFF_FORBIDDEN',
      'PENNSYNC_TIME_OFF_SELF',
      'PENNSYNC_TIME_OFF_TRANSITION',
    ]),
  }),
  getApprovedTimeOff: Object.freeze({
    rpc: 'pennsync_contract_time_off_approved',
    params: Object.freeze([]),
    body: agencyId => ({ p_agency: agencyId }),
    codes: Object.freeze(['PENNSYNC_TIME_OFF_AGENCY_NOT_HELD']),
  }),
  // The AI content agreement, and the first contract to write D25's activity
  // trail. It calls `contract_activity_append` in SQL rather than going
  // through `audit.mjs`, because the attestation carries the audit entry's id
  // and two round trips cannot be one transaction.
  getAiContentAgreementStatus: Object.freeze({
    rpc: 'pennsync_contract_ai_agreement_status',
    params: Object.freeze([]),
    body: agencyId => ({ p_agency: agencyId }),
    codes: Object.freeze(['PENNSYNC_AI_AGREEMENT_AGENCY_NOT_HELD']),
  }),
  acceptAiContentAgreement: Object.freeze({
    rpc: 'pennsync_contract_ai_agreement_accept',
    params: Object.freeze(['agreement_version']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_agreement_version: args.agreement_version === undefined ? null : args.agreement_version,
    }),
    codes: Object.freeze([
      'PENNSYNC_AI_AGREEMENT_AGENCY_NOT_HELD',
      'PENNSYNC_AI_AGREEMENT_VERSION_STALE',
    ]),
  }),
  // Signing a policy acknowledgment: the THIRD partial port. `list` is refused
  // by name because its gate is `u.role === 'admin'`, the Base44 built-in
  // admin — the platform tier D14 and D22 removed, exactly as D31 found for
  // `set_ai_tags`.
  acknowledgePolicy: Object.freeze({
    rpc: 'pennsync_contract_policy_acknowledge',
    params: Object.freeze(['acknowledgment_id', 'signed_name']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_acknowledgment_id: args.acknowledgment_id ?? null,
      p_signed_name: args.signed_name ?? null,
    }),
    codes: Object.freeze([
      'PENNSYNC_POLICY_ACK_AGENCY_NOT_HELD',
      'PENNSYNC_POLICY_ACK_SUBJECT_INVALID',
      'PENNSYNC_POLICY_ACK_NAME_REQUIRED',
      'PENNSYNC_POLICY_ACK_NOT_FOUND',
      'PENNSYNC_POLICY_ACK_FORBIDDEN',
    ]),
  }),
  // Distributing a policy version, and the SEVENTH partial port. The four
  // cohort filters have no carried column, so each is refused by its own name
  // rather than silently dropped — a dropped narrowing distributes to MORE
  // people than were asked for. They are enumerated rather than matched by
  // prefix because `declaredRefusal` compares exactly, and a code that only
  // nearly matches degrades to a 503 that tells the caller nothing.
  distributePolicyAcknowledgment: Object.freeze({
    rpc: 'pennsync_contract_policy_distribute',
    params: Object.freeze(['policyId', 'dueDate', 'userEmails', 'filters']),
    // camelCase, because the SPA sends these names and is shared between both
    // backends (D58). `userEmails: []` and `filters: {}` are what the
    // whole-roster button sends, and the contract reads both as absent.
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_policy_id: args.policyId ?? null,
      p_due_date: args.dueDate ?? null,
      p_user_emails: args.userEmails ?? null,
      p_filters: args.filters ?? null,
    }),
    codes: Object.freeze([
      'PENNSYNC_POLICY_AGENCY_NOT_HELD',
      'PENNSYNC_POLICY_CALLER_UNKNOWN',
      'PENNSYNC_POLICY_DISTRIBUTE_FORBIDDEN',
      'PENNSYNC_POLICY_ID_REQUIRED',
      'PENNSYNC_POLICY_NOT_FOUND',
      'PENNSYNC_POLICY_DUE_DATE_INVALID',
      'PENNSYNC_POLICY_USER_EMAILS_INVALID',
      'PENNSYNC_POLICY_FILTERS_INVALID',
      'PENNSYNC_POLICY_FILTER_UNPORTED:role',
      'PENNSYNC_POLICY_FILTER_UNPORTED:department',
      'PENNSYNC_POLICY_FILTER_UNPORTED:business_line',
      'PENNSYNC_POLICY_FILTER_UNPORTED:location',
    ]),
  }),
  // The membership lifecycle, and the second PARTIAL port. Five of the
  // original's six actions: `provision` is refused by name because its own
  // guard reserves it to the protected platform owner D14 and D22 removed, so
  // it has no performer left — the same shape as D31's `set_ai_tags`.
  inspectAgencyMembership: Object.freeze({
    rpc: 'pennsync_contract_membership_inspect',
    params: Object.freeze(['target_user_id']),
    body: (agencyId, args) => ({
      p_agency: agencyId, p_target_user_id: args.target_user_id ?? null,
    }),
    codes: Object.freeze([
      'PENNSYNC_MEMBERSHIP_FORBIDDEN',
      'PENNSYNC_MEMBERSHIP_SELF',
      'PENNSYNC_MEMBERSHIP_SUBJECT_INVALID',
      'PENNSYNC_MEMBERSHIP_NOT_FOUND',
      'PENNSYNC_MEMBERSHIP_PRIVILEGED',
    ]),
  }),
  transitionAgencyMembership: Object.freeze({
    rpc: 'pennsync_contract_membership_transition',
    params: Object.freeze(['target_user_id', 'action', 'tenant_role', 'reason', 'expected_version']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_target_user_id: args.target_user_id ?? null,
      p_action: args.action ?? null,
      p_tenant_role: args.tenant_role === undefined ? null : args.tenant_role,
      p_reason: args.reason === undefined ? null : args.reason,
      p_expected_version: args.expected_version === undefined ? null : args.expected_version,
    }),
    codes: Object.freeze([
      'PENNSYNC_MEMBERSHIP_FORBIDDEN',
      'PENNSYNC_MEMBERSHIP_SELF',
      'PENNSYNC_MEMBERSHIP_SUBJECT_INVALID',
      'PENNSYNC_MEMBERSHIP_ACTION_UNPORTED',
      'PENNSYNC_MEMBERSHIP_ACTION_INVALID',
      'PENNSYNC_MEMBERSHIP_ROLE_INVALID',
      'PENNSYNC_MEMBERSHIP_ROLE_UNEXPECTED',
      'PENNSYNC_MEMBERSHIP_ROLE_UNCHANGED',
      'PENNSYNC_MEMBERSHIP_REASON_REQUIRED',
      'PENNSYNC_MEMBERSHIP_VERSION_REQUIRED',
      'PENNSYNC_MEMBERSHIP_VERSION_EXHAUSTED',
      'PENNSYNC_MEMBERSHIP_NOT_FOUND',
      'PENNSYNC_MEMBERSHIP_PRIVILEGED',
      'PENNSYNC_MEMBERSHIP_AGENCY_UNAVAILABLE',
      'PENNSYNC_MEMBERSHIP_TARGET_DEACTIVATED',
      'PENNSYNC_MEMBERSHIP_STALE',
      'PENNSYNC_MEMBERSHIP_REVOKED',
      'PENNSYNC_MEMBERSHIP_TRANSITION',
    ]),
  }),
  // Which agency the caller is acting in, and which they could choose. The
  // first pair whose originals read nothing the record store owns: both read
  // `AgencyMembership` and `Agency`, and the authority store already carries
  // the membership model natively. Most of both originals is machinery for
  // not having a transaction — three double-reads and a snapshot comparison
  // each — which one statement in one transaction replaces outright.
  listMyTenantMemberships: Object.freeze({
    rpc: 'pennsync_contract_tenant_memberships',
    params: Object.freeze([]),
    body: () => ({}),
    codes: Object.freeze([
      'PENNSYNC_TENANT_NOT_IDENTIFIED',
      'PENNSYNC_TENANT_MEMBERSHIPS_EXCEEDED',
      'PENNSYNC_TENANT_AGENCY_UNAVAILABLE',
    ]),
  }),
  getMyTenantContext: Object.freeze({
    rpc: 'pennsync_contract_tenant_context',
    params: Object.freeze(['expected_membership_id', 'expected_membership_version']),
    // The acting agency comes from the envelope like every other contract's,
    // NOT from a parameter of its own. The original takes an optional
    // `agency_id` because a Base44 caller has no envelope; here every request
    // already names the agency it acts in, and a second way to name it is a
    // second thing that can disagree with the first.
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_expected_membership_id: args.expected_membership_id === undefined
        ? null : args.expected_membership_id,
      p_expected_membership_version: args.expected_membership_version === undefined
        ? null : args.expected_membership_version,
    }),
    codes: Object.freeze([
      'PENNSYNC_TENANT_NOT_IDENTIFIED',
      'PENNSYNC_TENANT_SUBJECT_INVALID',
      'PENNSYNC_TENANT_VERSION_INVALID',
      'PENNSYNC_TENANT_BINDING_INCOMPLETE',
      'PENNSYNC_TENANT_NO_MEMBERSHIP',
      'PENNSYNC_TENANT_MEMBERSHIPS_EXCEEDED',
      // Unreachable through this service, which always names the agency, and
      // declared anyway: the contract can raise it and a code a contract can
      // raise but the registry cannot name is what the boundary redacts.
      'PENNSYNC_TENANT_AGENCY_REQUIRED',
      'PENNSYNC_TENANT_AGENCY_NOT_HELD',
      'PENNSYNC_TENANT_MEMBERSHIP_CHANGED',
      'PENNSYNC_TENANT_AGENCY_UNAVAILABLE',
    ]),
  }),
  // The clinical events a model extracted from a visit note, and the tasks and
  // alerts they imply. The original builds its row as `{…, ...event, …}`, so a
  // model answering an unexpected key would write it; the contract names the
  // ten fields the response schema declares and ignores the rest.
  getClinicalExtractionContext: Object.freeze({
    rpc: 'pennsync_contract_clinical_extract_context',
    params: Object.freeze(['patient_id', 'visit_id']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_patient_id: args.patient_id ?? null,
      p_visit_id: args.visit_id ?? null,
    }),
    codes: Object.freeze([
      'PENNSYNC_EXTRACT_AGENCY_NOT_HELD',
      'PENNSYNC_EXTRACT_SUBJECT_INVALID',
      'PENNSYNC_EXTRACT_PATIENT_NOT_VISIBLE',
      'PENNSYNC_EXTRACT_VISIT_NOT_FOUND',
    ]),
  }),
  recordClinicalEvents: Object.freeze({
    rpc: 'pennsync_contract_clinical_extract_record',
    params: Object.freeze(['patient_id', 'visit_id', 'events']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_patient_id: args.patient_id ?? null,
      p_visit_id: args.visit_id ?? null,
      p_events: args.events === undefined ? null : args.events,
    }),
    codes: Object.freeze([
      'PENNSYNC_EXTRACT_AGENCY_NOT_HELD',
      'PENNSYNC_EXTRACT_SUBJECT_INVALID',
      'PENNSYNC_EXTRACT_PATIENT_NOT_VISIBLE',
      'PENNSYNC_EXTRACT_VISIT_NOT_FOUND',
      'PENNSYNC_EXTRACT_INVALID',
      'PENNSYNC_EXTRACT_TOO_MANY',
    ]),
  }),
  // The chart a model reads to SUGGEST clinical tasks. It creates none — the
  // capability's name says "generate" and D64 is the reason to say plainly
  // that there is no write contract behind this one.
  readClinicalTaskContext: Object.freeze({
    rpc: 'pennsync_contract_clinical_task_context',
    params: Object.freeze(['patient_id']),
    body: (agencyId, args) => ({ p_agency: agencyId, p_patient_id: args.patient_id ?? null }),
    codes: Object.freeze([
      'PENNSYNC_TASK_CONTEXT_AGENCY_NOT_HELD',
      'PENNSYNC_TASK_CONTEXT_SUBJECT_INVALID',
      'PENNSYNC_TASK_CONTEXT_PURPOSE_FORBIDDEN',
      'PENNSYNC_TASK_CONTEXT_PATIENT_NOT_VISIBLE',
    ]),
  }),
  // Two chart reads for a model to analyse, and nothing behind them: a
  // capability that only reads needs only a read. Both originals scan five
  // thousand `User` rows to decide whether the patient is in the caller's
  // agency, and both interpolate the patient straight out of a service-role
  // row — the chart policies answer the first and D62's purpose projection
  // bounds the second.
  reviewClinicalEvents: Object.freeze({
    rpc: 'pennsync_contract_clinical_event_review',
    params: Object.freeze(['patient_id']),
    body: (agencyId, args) => ({ p_agency: agencyId, p_patient_id: args.patient_id ?? null }),
    codes: Object.freeze([
      'PENNSYNC_CLINICAL_AGENCY_NOT_HELD',
      'PENNSYNC_CLINICAL_SUBJECT_INVALID',
      'PENNSYNC_CLINICAL_PURPOSE_FORBIDDEN',
      'PENNSYNC_CLINICAL_PATIENT_NOT_VISIBLE',
    ]),
  }),
  readClinicalTrendContext: Object.freeze({
    rpc: 'pennsync_contract_clinical_trend_context',
    params: Object.freeze(['patient_id']),
    body: (agencyId, args) => ({ p_agency: agencyId, p_patient_id: args.patient_id ?? null }),
    codes: Object.freeze([
      'PENNSYNC_CLINICAL_AGENCY_NOT_HELD',
      'PENNSYNC_CLINICAL_SUBJECT_INVALID',
      'PENNSYNC_CLINICAL_PURPOSE_FORBIDDEN',
      'PENNSYNC_CLINICAL_PATIENT_NOT_VISIBLE',
    ]),
  }),
  // The follow-up tasks a finalized note implies: a chart read, a brokered
  // model call, and a write. The second capability D61 unblocked — these are
  // `Task` rows — and the second to apply D62's rule that a prompt may carry
  // what a read purpose discloses and nothing else.
  getFollowUpTaskContext: Object.freeze({
    rpc: 'pennsync_contract_follow_up_context',
    params: Object.freeze(['patient_id', 'visit_id']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_patient_id: args.patient_id ?? null,
      p_visit_id: args.visit_id === undefined ? null : args.visit_id,
    }),
    codes: Object.freeze([
      'PENNSYNC_FOLLOW_UP_AGENCY_NOT_HELD',
      'PENNSYNC_FOLLOW_UP_SUBJECT_INVALID',
      'PENNSYNC_FOLLOW_UP_PURPOSE_FORBIDDEN',
      'PENNSYNC_FOLLOW_UP_PATIENT_NOT_VISIBLE',
      'PENNSYNC_FOLLOW_UP_VISIT_NOT_FOUND',
    ]),
  }),
  recordFollowUpTasks: Object.freeze({
    rpc: 'pennsync_contract_follow_up_record',
    params: Object.freeze(['patient_id', 'visit_id', 'tasks']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_patient_id: args.patient_id ?? null,
      p_visit_id: args.visit_id === undefined ? null : args.visit_id,
      p_tasks: args.tasks === undefined ? null : args.tasks,
    }),
    codes: Object.freeze([
      'PENNSYNC_FOLLOW_UP_AGENCY_NOT_HELD',
      'PENNSYNC_FOLLOW_UP_SUBJECT_INVALID',
      'PENNSYNC_FOLLOW_UP_PURPOSE_FORBIDDEN',
      'PENNSYNC_FOLLOW_UP_PATIENT_NOT_VISIBLE',
      'PENNSYNC_FOLLOW_UP_VISIT_NOT_FOUND',
      'PENNSYNC_FOLLOW_UP_INVALID',
      'PENNSYNC_FOLLOW_UP_TOO_MANY',
    ]),
  }),
  // The clinical phrase library, in two halves because a model call sits
  // between them. The resolve decides which template answers a phrase and what
  // of the patient may go into the prompt; the use records the count.
  //
  // **This capability is why D61 exists.** `clinical_library_template`'s only
  // tenant path was its OPTIONAL `patient_id`, so every generic and every
  // agency-wide template was in no tenant and readable by nobody. With the
  // table carrying its own agency, the policies are the whole of the template
  // scoping — which is what lets the contract delete BOTH of the original's
  // five-thousand-row `User` scans.
  resolveClinicalPhrase: Object.freeze({
    rpc: 'pennsync_contract_clinical_phrase_resolve',
    params: Object.freeze(['phrase', 'patient_id']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_phrase: args.phrase ?? null,
      p_patient_id: args.patient_id === undefined ? null : args.patient_id,
    }),
    codes: Object.freeze([
      'PENNSYNC_PHRASE_AGENCY_NOT_HELD',
      'PENNSYNC_PHRASE_REQUIRED',
      'PENNSYNC_PHRASE_SUBJECT_INVALID',
      'PENNSYNC_PHRASE_SUBJECT_REQUIRED',
      'PENNSYNC_PHRASE_PURPOSE_FORBIDDEN',
      'PENNSYNC_PHRASE_PATIENT_NOT_VISIBLE',
    ]),
  }),
  recordClinicalPhraseUse: Object.freeze({
    rpc: 'pennsync_contract_clinical_phrase_used',
    params: Object.freeze(['template_id']),
    body: (agencyId, args) => ({
      p_agency: agencyId, p_template_id: args.template_id ?? null,
    }),
    codes: Object.freeze([
      'PENNSYNC_PHRASE_AGENCY_NOT_HELD',
      'PENNSYNC_PHRASE_SUBJECT_INVALID',
      'PENNSYNC_PHRASE_TEMPLATE_NOT_FOUND',
    ]),
  }),
  // The record half of the provider directory import. The CSV is parsed in
  // `provider-import.mjs` — text shaping is not authorization — and the store
  // decides who may import, which rows are the same provider and whether a
  // row is a create or an update.
  //
  // Its gate is D40's for the second time, and the original had the widening
  // half made already: `role === 'admin'` OR `account_type === 'agency_admin'`
  // OR `'super_admin'`, of which only the first has a successor, the second is
  // the self-editable label D23 says decides nothing, and the third is the
  // tier D14 and D22 removed.
  importProvidersCsv: Object.freeze({
    rpc: 'pennsync_contract_provider_import',
    params: Object.freeze(['rows']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_rows: args.rows === undefined ? null : args.rows,
    }),
    codes: Object.freeze([
      'PENNSYNC_PROVIDER_IMPORT_FORBIDDEN',
      'PENNSYNC_PROVIDER_IMPORT_INVALID',
      'PENNSYNC_PROVIDER_IMPORT_FIELD_UNSUPPORTED',
    ]),
  }),
  // The supplies a visit consumed, in two halves because a model call sits
  // between them: the context read authorizes the chart before the call is
  // paid for, and the record write does the whole of it in one transaction.
  //
  // **The port found a defect of D45's and D51's kind and the contract's
  // header records it.** The original creates a reorder `Task` with no
  // `patient_id` and an alert naming that task; `task` reaches tenancy through
  // `patient_id` here and the alert reaches it through `task_id`, so the pair
  // would be written where nobody — the assignee included — could read it.
  // The task is stamped with the authorized chart, which is where the
  // original's own `assigned_to: user.email` already puts it.
  getVisitSupplyContext: Object.freeze({
    rpc: 'pennsync_contract_visit_supply_context',
    params: Object.freeze(['patient_id', 'visit_id']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_patient_id: args.patient_id ?? null,
      p_visit_id: args.visit_id === undefined ? null : args.visit_id,
    }),
    codes: Object.freeze([
      'PENNSYNC_VISIT_SUPPLY_AGENCY_NOT_HELD',
      'PENNSYNC_VISIT_SUPPLY_SUBJECT_INVALID',
      'PENNSYNC_VISIT_SUPPLY_PATIENT_NOT_VISIBLE',
      'PENNSYNC_VISIT_SUPPLY_VISIT_NOT_FOUND',
    ]),
  }),
  recordVisitSupplyUsage: Object.freeze({
    rpc: 'pennsync_contract_visit_supply_record',
    params: Object.freeze(['patient_id', 'visit_id', 'supplies']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_patient_id: args.patient_id ?? null,
      p_visit_id: args.visit_id === undefined ? null : args.visit_id,
      p_supplies: args.supplies === undefined ? null : args.supplies,
    }),
    codes: Object.freeze([
      'PENNSYNC_VISIT_SUPPLY_AGENCY_NOT_HELD',
      'PENNSYNC_VISIT_SUPPLY_SUBJECT_INVALID',
      'PENNSYNC_VISIT_SUPPLY_PATIENT_NOT_VISIBLE',
      'PENNSYNC_VISIT_SUPPLY_VISIT_NOT_FOUND',
      'PENNSYNC_VISIT_SUPPLY_INVALID',
      'PENNSYNC_VISIT_SUPPLY_TOO_MANY',
    ]),
  }),
  // Supply forecasting from a patient's own usage log. The arithmetic is the
  // capability and it is ported term for term; the authorization is the D21
  // and D24 reconstruction one more time — the original's own comment calls
  // its `assigned_nurses` and `agency_name` scan an "RLS-independent code
  // check", and `supply_usage_log` reaches tenancy through `patient_id`
  // exactly as the chart does, so the policies answer all of it.
  predictSupplyNeeds: Object.freeze({
    rpc: 'pennsync_contract_supply_prediction_generate',
    params: Object.freeze(['patient_id']),
    body: (agencyId, args) => ({ p_agency: agencyId, p_patient_id: args.patient_id ?? null }),
    codes: Object.freeze([
      'PENNSYNC_SUPPLY_AGENCY_NOT_HELD',
      'PENNSYNC_SUPPLY_SUBJECT_INVALID',
      'PENNSYNC_SUPPLY_PATIENT_NOT_VISIBLE',
    ]),
  }),
  // Referral intake: six actions over one entity, and the largest capability
  // in the migration. Six entries because they are six statements with six
  // refusal sets, not because the original split them — it is one endpoint
  // whose `action` chooses among them, and the handler does the choosing so
  // the RPC stays fixed per entry and caller-chosen by nothing.
  //
  // There is no `listReferralAssignees` RPC of this contract's own beyond the
  // one below, and the reason is D34's: the assignee picker IS the roster, and
  // `pennsync_private.agency_roster` already carries the membership id and
  // version the published client validates.
  listAuthorizedReferrals: Object.freeze({
    rpc: 'pennsync_contract_referral_list',
    params: Object.freeze(['limit', 'patient_id', 'status', 'assigned_to']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_limit: args.limit === undefined ? 200 : args.limit,
      p_patient_id: args.patient_id === undefined ? null : args.patient_id,
      p_status: args.status === undefined ? null : args.status,
      p_assigned_to: args.assigned_to === undefined ? null : args.assigned_to,
    }),
    codes: REFERRAL_CODES,
  }),
  getAuthorizedReferral: Object.freeze({
    rpc: 'pennsync_contract_referral_get',
    params: Object.freeze(['referral_id']),
    body: (agencyId, args) => ({ p_agency: agencyId, p_referral_id: args.referral_id ?? null }),
    codes: REFERRAL_CODES,
  }),
  listAuthorizedReferralAssignees: Object.freeze({
    rpc: 'pennsync_contract_referral_assignees',
    params: Object.freeze([]),
    body: agencyId => ({ p_agency: agencyId }),
    codes: REFERRAL_CODES,
  }),
  createAuthorizedReferral: Object.freeze({
    rpc: 'pennsync_contract_referral_create',
    params: Object.freeze(['client_request_id', 'referral']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_client_request_id: args.client_request_id ?? null,
      p_referral: args.referral === undefined ? null : args.referral,
    }),
    codes: REFERRAL_CODES,
  }),
  updateAuthorizedReferral: Object.freeze({
    rpc: 'pennsync_contract_referral_update',
    params: Object.freeze(['referral_id', 'changes']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_referral_id: args.referral_id ?? null,
      p_changes: args.changes === undefined ? null : args.changes,
    }),
    codes: REFERRAL_CODES,
  }),
  archiveAuthorizedReferral: Object.freeze({
    rpc: 'pennsync_contract_referral_archive',
    params: Object.freeze(['referral_id']),
    body: (agencyId, args) => ({ p_agency: agencyId, p_referral_id: args.referral_id ?? null }),
    codes: REFERRAL_CODES,
  }),
  // The state-reportable incident. A sibling of `submitIncidentReport` rather
  // than an argument to it: `state_reportable` and `severity` are the
  // reviewer-only fields D44 keeps off a submit, and a caller who could pass
  // them to the ordinary one would have that control back. This endpoint sets
  // both itself, which is what it is for.
  submitStateIncident: Object.freeze({
    rpc: 'pennsync_contract_state_incident_submit',
    params: Object.freeze(['incident']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_incident: args.incident === undefined ? null : args.incident,
    }),
    codes: Object.freeze([
      'PENNSYNC_STATE_INCIDENT_AGENCY_NOT_HELD',
      'PENNSYNC_STATE_INCIDENT_INVALID',
      'PENNSYNC_STATE_INCIDENT_REQUIRED',
      'PENNSYNC_STATE_INCIDENT_PATIENT_NOT_VISIBLE',
    ]),
  }),
  // The dashboard's five collections. The capability that was PARKED on "two
  // field lists nobody has decided", and what unparked it is that the lists
  // are MEASURED: every column is read by a named dashboard widget, and the
  // contract's test re-derives the set from those widgets' own source.
  readDashboard: Object.freeze({
    rpc: 'pennsync_contract_dashboard',
    params: Object.freeze([]),
    body: agencyId => ({ p_agency: agencyId }),
    codes: Object.freeze(['PENNSYNC_DASHBOARD_AGENCY_NOT_HELD']),
  }),
  // The PDF search's corpus. D67's split: which rows a caller may read is
  // decided in SQL, and BM25 over the query they typed is arithmetic in the
  // service. Two shapes, because the original fetches two — a count that
  // projects no text at all, and a corpus that carries it.
  readPdfSearchCorpus: Object.freeze({
    rpc: 'pennsync_contract_pdf_search_corpus',
    params: Object.freeze(['document_type', 'patient_id', 'limit', 'count_only']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_document_type: args.document_type === undefined ? null : args.document_type,
      p_patient_id: args.patient_id === undefined ? null : args.patient_id,
      p_limit: args.limit === undefined ? null : args.limit,
      p_count_only: args.count_only === undefined ? false : args.count_only,
    }),
    codes: Object.freeze([
      'PENNSYNC_PDF_SEARCH_AGENCY_NOT_HELD',
      'PENNSYNC_PDF_SEARCH_DOCUMENT_TYPE_INVALID',
      'PENNSYNC_PDF_SEARCH_SUBJECT_INVALID',
      'PENNSYNC_PDF_SEARCH_PATIENT_NOT_VISIBLE',
    ]),
  }),
  // The chart export's read: one patient, their recent visits and their recent
  // incidents, in the exact columns that reach a model's prompt (D64).
  //
  // The original's whole authorization was an address on a carried row, an
  // `assigned_nurses` entry and the platform owner — the three things D21, D22
  // and D24 removed — so there is no gate beyond the chart, and the policies
  // are it.
  // The AI report's corpus, as counts. No chart and no colleague row crosses
  // this boundary: the original pulls nine collections into an isolate to count
  // them, and the counting happens in the store now.
  readReportMetrics: Object.freeze({
    rpc: 'pennsync_contract_report_metrics',
    params: Object.freeze(['start', 'end']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_start: args.start ?? null,
      p_end: args.end ?? null,
    }),
    codes: Object.freeze([
      'PENNSYNC_REPORT_AGENCY_NOT_HELD',
      'PENNSYNC_REPORT_FORBIDDEN',
      'PENNSYNC_REPORT_RANGE_INVALID',
      'PENNSYNC_REPORT_RANGE_TOO_WIDE',
    ]),
  }),
  readChartExportContext: Object.freeze({
    rpc: 'pennsync_contract_chart_export_context',
    params: Object.freeze(['patient_id', 'include_visits', 'include_incidents']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_patient_id: args.patient_id ?? null,
      p_include_visits: args.include_visits === undefined ? true : args.include_visits,
      p_include_incidents: args.include_incidents === undefined ? true : args.include_incidents,
    }),
    codes: Object.freeze([
      'PENNSYNC_CHART_EXPORT_AGENCY_NOT_HELD',
      'PENNSYNC_CHART_EXPORT_SUBJECT_INVALID',
      'PENNSYNC_CHART_EXPORT_PATIENT_NOT_VISIBLE',
    ]),
  }),
  // The roster report's page. Separate from `listAgencyRoster` because of its
  // GATE, not its answer: the roster admits every member of an agency, and
  // the original of `generateUserRosterPDF` admits only an `agency_admin` —
  // which its three-way test obscures, because `withTrustedClaims` strips a
  // claimed `account_type` and leaves one live branch.
  //
  // The two cursor codes are INHERITED: the contract delegates its paging to
  // `contract_roster_list` and those refusals really can reach a caller
  // through it. Declared rather than assumed, and its suite raises both.
  readRosterReport: Object.freeze({
    rpc: 'pennsync_contract_roster_report',
    params: Object.freeze(['limit', 'after']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_limit: args.limit === undefined ? null : args.limit,
      p_after: args.after === undefined ? null : args.after,
    }),
    codes: Object.freeze([
      'PENNSYNC_ROSTER_REPORT_AGENCY_NOT_HELD',
      'PENNSYNC_ROSTER_REPORT_FORBIDDEN',
      'PENNSYNC_ROSTER_CURSOR_INVALID',
      'PENNSYNC_ROSTER_CURSOR_UNKNOWN',
    ]),
  }),
  // The seven reference and configuration reads (D101). These are the first
  // contracts that replace no Base44 FUNCTION: the SPA called
  // `base44.entities.Physician.list(...)` and six like it straight through the
  // platform SDK, so what is ported is the CALL and what is decided is the
  // authorization Base44 was doing on our behalf. There is no original handler
  // to compare against, which is why each one's filter, order and row bound
  // come from the call site and are recorded in the migration's header.
  //
  // Their refusal vocabulary is SHARED, and for once that is right rather than
  // the shortcut the referral codes had to argue for: the seven are one
  // authorization — `reference_read_role`, membership and nothing else — so
  // `AGENCY_NOT_HELD` is a code every one of them raises from the same line.
  // The three that are not shared are declared only by the contract that can
  // raise them.
  listMedicareComplianceRules: Object.freeze({
    rpc: 'pennsync_contract_medicare_compliance_rule_list',
    params: Object.freeze(['limit']),
    body: (agencyId, args) => ({ p_agency: agencyId, p_limit: args.limit === undefined ? null : args.limit }),
    codes: REFERENCE_READ_CODES,
  }),
  listMedicareGuidelines: Object.freeze({
    rpc: 'pennsync_contract_medicare_guideline_list',
    params: Object.freeze(['limit', 'active']),
    // Absent is "no preference" and reaches the contract as null, which is the
    // absent filter rather than a third state. The one call site always asks
    // for the active rows, and asks for them explicitly.
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_limit: args.limit === undefined ? null : args.limit,
      p_active: args.active === undefined ? null : args.active,
    }),
    codes: REFERENCE_READ_CODES,
  }),
  listPhysicians: Object.freeze({
    rpc: 'pennsync_contract_physician_list',
    params: Object.freeze(['limit', 'order', 'active']),
    // `order` is a WORD from a fixed set, never a sort expression: three call
    // sites want three different orders and an order built from caller text is
    // not something a `stable` body can validate.
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_limit: args.limit === undefined ? null : args.limit,
      p_order: args.order ?? null,
      p_active: args.active === undefined ? null : args.active,
    }),
    codes: Object.freeze([...REFERENCE_READ_CODES, 'PENNSYNC_CONTRACT_ORDER_INVALID']),
  }),
  listDocumentTemplates: Object.freeze({
    rpc: 'pennsync_contract_document_template_list',
    params: Object.freeze(['limit']),
    body: (agencyId, args) => ({ p_agency: agencyId, p_limit: args.limit === undefined ? null : args.limit }),
    codes: REFERENCE_READ_CODES,
  }),
  listLibraryDocuments: Object.freeze({
    rpc: 'pennsync_contract_library_document_list',
    params: Object.freeze(['limit']),
    body: (agencyId, args) => ({ p_agency: agencyId, p_limit: args.limit === undefined ? null : args.limit }),
    codes: REFERENCE_READ_CODES,
  }),
  listOnCallShifts: Object.freeze({
    rpc: 'pennsync_contract_on_call_shift_list',
    params: Object.freeze(['limit', 'from', 'to']),
    // The window is TEXT both ways, so an impossible day is the contract's own
    // refusal rather than a cast error the HTTP boundary cannot classify.
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_limit: args.limit === undefined ? null : args.limit,
      p_from: args.from === undefined ? null : args.from,
      p_to: args.to === undefined ? null : args.to,
    }),
    codes: Object.freeze([...REFERENCE_READ_CODES,
      'PENNSYNC_CONTRACT_DATE_INVALID', 'PENNSYNC_CONTRACT_RANGE_INVALID']),
  }),
  listVisitPointConfigs: Object.freeze({
    rpc: 'pennsync_contract_visit_point_config_list',
    params: Object.freeze(['limit']),
    body: (agencyId, args) => ({ p_agency: agencyId, p_limit: args.limit === undefined ? null : args.limit }),
    codes: REFERENCE_READ_CODES,
  }),
  getAgencyRosterMember: Object.freeze({
    rpc: 'pennsync_contract_roster_get',
    params: Object.freeze(['user_id']),
    body: (agencyId, args) => ({ p_agency: agencyId, p_user_id: args.user_id ?? null }),
    nullable: true,
    codes: Object.freeze([
      'PENNSYNC_ROSTER_AGENCY_NOT_HELD',
      'PENNSYNC_ROSTER_SUBJECT_INVALID',
    ]),
  }),
  // The clinical library, patient education and per-agency configuration:
  // fourteen capabilities over seven entities the frontend reached DIRECTLY,
  // with no Base44 backend function behind any of them. What stands in for an
  // original is each entity's own `rls` block, quoted per contract in
  // `20260920570000_contract_clinical_library.sql`, and the authorization is
  // the contract's — not restated here.
  //
  // Each read answers `{ entries, complete }`. `complete` is not decoration: a
  // screen passing `ALL_ROWS` against a catalogue of forty rows is naming a
  // bound it does not expect to reach, and the contract saying it did not is
  // what lets a route serve that call site instead of refusing it.
  listClinicalPathways: Object.freeze({
    rpc: 'pennsync_contract_clinical_pathway_list',
    params: Object.freeze(['active_only', 'limit']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_active_only: args.active_only === undefined ? false : args.active_only,
      p_limit: args.limit === undefined ? null : args.limit,
    }),
    codes: Object.freeze([
      'PENNSYNC_PATHWAY_AGENCY_NOT_HELD',
    ]),
  }),
  manageClinicalPathway: Object.freeze({
    rpc: 'pennsync_contract_clinical_pathway_write',
    params: Object.freeze(['action', 'id', 'fields']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_action: args.action ?? null,
      p_id: args.id === undefined ? null : args.id,
      p_fields: args.fields === undefined ? null : args.fields,
    }),
    codes: Object.freeze([
      'PENNSYNC_PATHWAY_AGENCY_NOT_HELD',
      'PENNSYNC_PATHWAY_FORBIDDEN',
      'PENNSYNC_PATHWAY_ACTION_INVALID',
      'PENNSYNC_PATHWAY_ID_INVALID',
      'PENNSYNC_PATHWAY_NOT_FOUND',
      'PENNSYNC_PATHWAY_FIELDS_INVALID',
      'PENNSYNC_PATHWAY_FIELDS_EMPTY',
      'PENNSYNC_PATHWAY_FIELD_UNKNOWN',
      'PENNSYNC_PATHWAY_FIELD_REQUIRED',
      'PENNSYNC_PATHWAY_FIELD_RESERVED',
      'PENNSYNC_PATHWAY_CREATED_BY_FORBIDDEN',
    ]),
  }),
  listClinicalLibraryTemplates: Object.freeze({
    rpc: 'pennsync_contract_clinical_library_template_list',
    params: Object.freeze(['limit', 'offset']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_limit: args.limit === undefined ? null : args.limit,
      p_offset: args.offset === undefined ? null : args.offset,
    }),
    codes: Object.freeze([
      'PENNSYNC_LIBRARY_TEMPLATE_AGENCY_NOT_HELD',
      'PENNSYNC_LIBRARY_TEMPLATE_OFFSET_INVALID',
    ]),
  }),
  manageClinicalLibraryTemplate: Object.freeze({
    rpc: 'pennsync_contract_clinical_library_template_write',
    params: Object.freeze(['action', 'id', 'fields']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_action: args.action ?? null,
      p_id: args.id === undefined ? null : args.id,
      p_fields: args.fields === undefined ? null : args.fields,
    }),
    codes: Object.freeze([
      'PENNSYNC_LIBRARY_TEMPLATE_AGENCY_NOT_HELD',
      'PENNSYNC_LIBRARY_TEMPLATE_FORBIDDEN',
      'PENNSYNC_LIBRARY_TEMPLATE_ACTION_INVALID',
      'PENNSYNC_LIBRARY_TEMPLATE_ID_INVALID',
      'PENNSYNC_LIBRARY_TEMPLATE_NOT_FOUND',
      'PENNSYNC_LIBRARY_TEMPLATE_FIELDS_INVALID',
      'PENNSYNC_LIBRARY_TEMPLATE_FIELDS_EMPTY',
      'PENNSYNC_LIBRARY_TEMPLATE_FIELD_UNKNOWN',
      'PENNSYNC_LIBRARY_TEMPLATE_FIELD_REQUIRED',
      'PENNSYNC_LIBRARY_TEMPLATE_FIELD_RESERVED',
      'PENNSYNC_LIBRARY_TEMPLATE_CREATED_BY_FORBIDDEN',
    ]),
  }),
  listClinicalLibraryFolders: Object.freeze({
    rpc: 'pennsync_contract_clinical_library_folder_list',
    params: Object.freeze(['limit']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_limit: args.limit === undefined ? null : args.limit,
    }),
    codes: Object.freeze([
      'PENNSYNC_LIBRARY_FOLDER_AGENCY_NOT_HELD',
    ]),
  }),
  manageClinicalLibraryFolder: Object.freeze({
    rpc: 'pennsync_contract_clinical_library_folder_write',
    params: Object.freeze(['action', 'id', 'fields']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_action: args.action ?? null,
      p_id: args.id === undefined ? null : args.id,
      p_fields: args.fields === undefined ? null : args.fields,
    }),
    codes: Object.freeze([
      'PENNSYNC_LIBRARY_FOLDER_AGENCY_NOT_HELD',
      'PENNSYNC_LIBRARY_FOLDER_FORBIDDEN',
      'PENNSYNC_LIBRARY_FOLDER_ACTION_INVALID',
      'PENNSYNC_LIBRARY_FOLDER_ID_INVALID',
      'PENNSYNC_LIBRARY_FOLDER_NOT_FOUND',
      'PENNSYNC_LIBRARY_FOLDER_FIELDS_INVALID',
      'PENNSYNC_LIBRARY_FOLDER_FIELDS_EMPTY',
      'PENNSYNC_LIBRARY_FOLDER_FIELD_UNKNOWN',
      'PENNSYNC_LIBRARY_FOLDER_FIELD_REQUIRED',
      'PENNSYNC_LIBRARY_FOLDER_FIELD_RESERVED',
      'PENNSYNC_LIBRARY_FOLDER_CREATED_BY_FORBIDDEN',
    ]),
  }),
  listEducationMaterials: Object.freeze({
    rpc: 'pennsync_contract_education_material_list',
    params: Object.freeze(['published_only', 'limit']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_published_only: args.published_only === undefined ? false : args.published_only,
      p_limit: args.limit === undefined ? null : args.limit,
    }),
    codes: Object.freeze([
      'PENNSYNC_EDUCATION_MATERIAL_AGENCY_NOT_HELD',
    ]),
  }),
  manageEducationMaterial: Object.freeze({
    rpc: 'pennsync_contract_education_material_write',
    params: Object.freeze(['action', 'id', 'fields']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_action: args.action ?? null,
      p_id: args.id === undefined ? null : args.id,
      p_fields: args.fields === undefined ? null : args.fields,
    }),
    codes: Object.freeze([
      'PENNSYNC_EDUCATION_MATERIAL_AGENCY_NOT_HELD',
      'PENNSYNC_EDUCATION_MATERIAL_FORBIDDEN',
      'PENNSYNC_EDUCATION_MATERIAL_ACTION_INVALID',
      'PENNSYNC_EDUCATION_MATERIAL_ID_INVALID',
      'PENNSYNC_EDUCATION_MATERIAL_NOT_FOUND',
      'PENNSYNC_EDUCATION_MATERIAL_FIELDS_INVALID',
      'PENNSYNC_EDUCATION_MATERIAL_FIELDS_EMPTY',
      'PENNSYNC_EDUCATION_MATERIAL_FIELD_UNKNOWN',
      'PENNSYNC_EDUCATION_MATERIAL_FIELD_REQUIRED',
      'PENNSYNC_EDUCATION_MATERIAL_FIELD_RESERVED',
      'PENNSYNC_EDUCATION_MATERIAL_CREATED_BY_FORBIDDEN',
    ]),
  }),
  // The one capability whose tenancy is the CHART rather than the agency:
  // `patient_education_assignment` has no `agency_id` and every one of its
  // policies reaches the `patient` row it names, so `patient_id` is required
  // and there is no way to file against no chart.
  listPatientEducationAssignments: Object.freeze({
    rpc: 'pennsync_contract_patient_education_list',
    params: Object.freeze(['patient_id', 'limit']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_patient_id: args.patient_id ?? null,
      p_limit: args.limit === undefined ? null : args.limit,
    }),
    codes: Object.freeze([
      'PENNSYNC_PATIENT_EDUCATION_AGENCY_NOT_HELD',
      'PENNSYNC_PATIENT_EDUCATION_SUBJECT_INVALID',
    ]),
  }),
  managePatientEducationAssignment: Object.freeze({
    rpc: 'pennsync_contract_patient_education_write',
    params: Object.freeze(['action', 'id', 'fields']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_action: args.action ?? null,
      p_id: args.id === undefined ? null : args.id,
      p_fields: args.fields === undefined ? null : args.fields,
    }),
    codes: Object.freeze([
      'PENNSYNC_PATIENT_EDUCATION_AGENCY_NOT_HELD',
      'PENNSYNC_PATIENT_EDUCATION_FORBIDDEN',
      'PENNSYNC_PATIENT_EDUCATION_ACTION_INVALID',
      'PENNSYNC_PATIENT_EDUCATION_ID_INVALID',
      'PENNSYNC_PATIENT_EDUCATION_SUBJECT_INVALID',
      'PENNSYNC_PATIENT_EDUCATION_NOT_FOUND',
      'PENNSYNC_PATIENT_EDUCATION_FIELDS_INVALID',
      'PENNSYNC_PATIENT_EDUCATION_FIELDS_EMPTY',
      'PENNSYNC_PATIENT_EDUCATION_FIELD_UNKNOWN',
      'PENNSYNC_PATIENT_EDUCATION_FIELD_REQUIRED',
      'PENNSYNC_PATIENT_EDUCATION_FIELD_RESERVED',
      'PENNSYNC_PATIENT_EDUCATION_CREATED_BY_FORBIDDEN',
    ]),
  }),
  listCustomValidationRules: Object.freeze({
    rpc: 'pennsync_contract_validation_rule_list',
    params: Object.freeze(['limit']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_limit: args.limit === undefined ? null : args.limit,
    }),
    codes: Object.freeze([
      'PENNSYNC_VALIDATION_RULE_FORBIDDEN',
    ]),
  }),
  manageCustomValidationRule: Object.freeze({
    rpc: 'pennsync_contract_validation_rule_write',
    params: Object.freeze(['action', 'id', 'fields']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_action: args.action ?? null,
      p_id: args.id === undefined ? null : args.id,
      p_fields: args.fields === undefined ? null : args.fields,
    }),
    codes: Object.freeze([
      'PENNSYNC_VALIDATION_RULE_FORBIDDEN',
      'PENNSYNC_VALIDATION_RULE_ACTION_INVALID',
      'PENNSYNC_VALIDATION_RULE_ID_INVALID',
      'PENNSYNC_VALIDATION_RULE_NOT_FOUND',
      'PENNSYNC_VALIDATION_RULE_FIELDS_INVALID',
      'PENNSYNC_VALIDATION_RULE_FIELDS_EMPTY',
      'PENNSYNC_VALIDATION_RULE_FIELD_UNKNOWN',
      'PENNSYNC_VALIDATION_RULE_FIELD_REQUIRED',
      'PENNSYNC_VALIDATION_RULE_FIELD_RESERVED',
      'PENNSYNC_VALIDATION_RULE_CREATED_BY_FORBIDDEN',
    ]),
  }),
  // One table doing two unrelated jobs, so `scope` is not a convenience: a
  // personal preference row and an agency setting row differ only by whether
  // `user_email` is set, and a capability that did not say which it meant
  // would let one screen's save land on the other screen's row.
  readAiConfiguration: Object.freeze({
    rpc: 'pennsync_contract_ai_configuration_read',
    params: Object.freeze(['scope', 'limit']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_scope: args.scope ?? null,
      p_limit: args.limit === undefined ? null : args.limit,
    }),
    codes: Object.freeze([
      'PENNSYNC_AI_CONFIG_AGENCY_NOT_HELD',
      'PENNSYNC_AI_CONFIG_SCOPE_INVALID',
      'PENNSYNC_AI_CONFIG_FORBIDDEN',
    ]),
  }),
  saveAiConfiguration: Object.freeze({
    rpc: 'pennsync_contract_ai_configuration_save',
    params: Object.freeze(['scope', 'id', 'fields']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_scope: args.scope ?? null,
      p_id: args.id === undefined ? null : args.id,
      p_fields: args.fields === undefined ? null : args.fields,
    }),
    codes: Object.freeze([
      'PENNSYNC_AI_CONFIG_AGENCY_NOT_HELD',
      'PENNSYNC_AI_CONFIG_SCOPE_INVALID',
      'PENNSYNC_AI_CONFIG_FORBIDDEN',
      'PENNSYNC_AI_CONFIG_OWNER_FORBIDDEN',
      'PENNSYNC_AI_CONFIG_ID_INVALID',
      'PENNSYNC_AI_CONFIG_NOT_FOUND',
      'PENNSYNC_AI_CONFIG_FIELDS_INVALID',
      'PENNSYNC_AI_CONFIG_FIELDS_EMPTY',
      'PENNSYNC_AI_CONFIG_FIELD_UNKNOWN',
      'PENNSYNC_AI_CONFIG_FIELD_RESERVED',
      'PENNSYNC_AI_CONFIG_CREATED_BY_FORBIDDEN',
    ]),
  }),

  // Batch E: seven screens whose records the browser read RAW, with no Base44
  // function between them and the entity. So these are not ported names either
  // — what governed each call was the entity's own access block, and
  // `20260920580000_contract_screen_records.sql` carries it. Five of the seven
  // needed a gate the store's policies do not have; the contract has it, and
  // as everywhere else, none of it is restated here.
  //
  // `SCREEN_COMMON` is the shape the four helpers can raise from any of the
  // ten, and each entry adds only what its own body can raise — so a code one
  // contract cannot raise never crosses back from another.
  listChartClinicalEvents: Object.freeze({
    rpc: 'pennsync_contract_clinical_event_list',
    params: Object.freeze(['patient_id', 'limit']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_patient_id: args.patient_id ?? null,
      p_limit: args.limit === undefined ? null : args.limit,
    }),
    codes: SCREEN_CHART_CODES,
  }),
  listOcrCorrections: Object.freeze({
    rpc: 'pennsync_contract_ocr_feedback_list',
    // Three-valued: absent is "either", which is the dashboard's call, and a
    // boolean is the training monitor's. An explicit null is the same as
    // absent because the screens express "either" by not asking.
    params: Object.freeze(['applied_to_training', 'limit']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_applied_to_training: args.applied_to_training === undefined ? null : args.applied_to_training,
      p_limit: args.limit === undefined ? null : args.limit,
    }),
    codes: SCREEN_COMMON,
  }),
  listOcrTrainingRuns: Object.freeze({
    rpc: 'pennsync_contract_ocr_training_list',
    params: Object.freeze(['limit']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_limit: args.limit === undefined ? null : args.limit,
    }),
    codes: SCREEN_ADMIN_CODES,
  }),
  listSentEducationMaterials: Object.freeze({
    rpc: 'pennsync_contract_sent_education_list',
    params: Object.freeze(['limit']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_limit: args.limit === undefined ? null : args.limit,
    }),
    codes: SCREEN_COMMON,
  }),
  recordSentEducationMaterial: Object.freeze({
    rpc: 'pennsync_contract_sent_education_record',
    params: Object.freeze(['patient_id', 'material']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_patient_id: args.patient_id ?? null,
      p_material: args.material ?? null,
    }),
    codes: SCREEN_WRITE_CODES,
  }),
  listChartRecommendations: Object.freeze({
    rpc: 'pennsync_contract_patient_recommendation_list',
    params: Object.freeze(['patient_id', 'limit']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_patient_id: args.patient_id ?? null,
      p_limit: args.limit === undefined ? null : args.limit,
    }),
    codes: SCREEN_CHART_CODES,
  }),
  recordChartRecommendation: Object.freeze({
    rpc: 'pennsync_contract_patient_recommendation_record',
    params: Object.freeze(['patient_id', 'recommendation']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_patient_id: args.patient_id ?? null,
      p_recommendation: args.recommendation ?? null,
    }),
    codes: SCREEN_WRITE_CODES,
  }),
  lookupComplianceRule: Object.freeze({
    rpc: 'pennsync_contract_compliance_rule_lookup',
    params: Object.freeze(['rule_code', 'limit']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_rule_code: args.rule_code ?? null,
      p_limit: args.limit === undefined ? null : args.limit,
    }),
    codes: Object.freeze([...SCREEN_ADMIN_CODES, 'PENNSYNC_SCREEN_RULE_CODE_INVALID']),
  }),
  // The read takes an address and the save takes an id, and both REFUSE one
  // that is not the caller's rather than answering with the caller's own. The
  // screens send both, so dropping either would turn "this person's
  // preferences" into "whosever these are", which is right every time and
  // unverifiable.
  getMyNotificationPreferences: Object.freeze({
    rpc: 'pennsync_contract_notification_preference_get',
    params: Object.freeze(['user_email']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_user_email: args.user_email === undefined ? null : args.user_email,
    }),
    codes: Object.freeze([...SCREEN_COMMON, 'PENNSYNC_SCREEN_NOT_YOUR_ROWS']),
  }),
  saveMyNotificationPreferences: Object.freeze({
    rpc: 'pennsync_contract_notification_preference_save',
    params: Object.freeze(['expected_id', 'preference']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_expected_id: args.expected_id === undefined ? null : args.expected_id,
      p_preference: args.preference ?? null,
    }),
    codes: Object.freeze([
      ...SCREEN_COMMON,
      'PENNSYNC_SCREEN_PAYLOAD_INVALID',
      'PENNSYNC_SCREEN_FIELD_NOT_WRITABLE',
      'PENNSYNC_SCREEN_NOT_YOUR_ROWS',
      'PENNSYNC_SCREEN_PREFERENCE_NOT_OWNED',
      'PENNSYNC_SCREEN_PREFERENCE_CONFLICT',
      'PENNSYNC_SCREEN_CALLER_UNKNOWN',
      'PENNSYNC_SCREEN_FIELD_VALUE_INVALID',
    ]),
  }),
});
export const CONTRACT_NAMES = Object.freeze(Object.keys(RECORD_CONTRACTS));

/**
 * Every refusal any contract may raise. Declared per contract above and
 * unioned here, rather than kept as one flat list that every contract is
 * checked against.
 *
 * The difference matters in one direction only, and it is the direction that
 * misleads: a flat list lets a contract relay a code the contract it called
 * cannot raise. That is a branch nothing can take, and it reads like a
 * guarantee somebody wrote. With two contracts it was invisible; with three it
 * would have been `listPolicyLibrary` claiming it could answer
 * `PENNSYNC_ROSTER_CURSOR_UNKNOWN`.
 */
export const CONTRACT_CODES = Object.freeze([...new Set(
  Object.values(RECORD_CONTRACTS).flatMap(entry => entry.codes))].sort());
const REQUEST_TIMEOUT_MS = 15000;

/**
 * A contract capability bound to one caller, one agency and one request.
 *
 * `req` is read for its Authorization header and nothing else, and never
 * escapes this closure.
 */
export function contractCapability({ config, req, agencyId }, fetcher = fetch) {
  const bearer = req?.headers?.get('authorization') || '';
  return async function contract(name, args = {}) {
    const entry = Object.hasOwn(RECORD_CONTRACTS, name) ? RECORD_CONTRACTS[name] : null;
    if (!entry) fail(409, 'CONTRACT_UNKNOWN');
    if (!isObject(args)) fail(400, 'CONTRACT_ARGUMENTS_REQUIRED');
    if (Object.keys(args).some(key => !entry.params.includes(key))) fail(400, 'CONTRACT_ARGUMENTS_INVALID');
    if (!validAuthorityTarget(config.authorityUrl) || !validAuthorityKey(config.authorityKey)) {
      fail(503, 'AUTHORITY_NOT_CONFIGURED');
    }
    if (typeof agencyId !== 'string' || !ID.test(agencyId)) fail(400, 'AGENCY_REQUIRED');
    if (!/^Bearer\s+\S+$/i.test(bearer)) fail(401, 'AUTHENTICATION_REQUIRED');

    // Built before the try, so a refused argument is not reported as the store
    // being unreachable — the defect `records.mjs` had until its tests found it.
    const body = JSON.stringify(entry.body(agencyId, args));

    let response;
    try {
      response = await fetcher(`${config.authorityUrl}/rest/v1/rpc/${entry.rpc}`, {
        method: 'POST',
        headers: {
          apikey: config.authorityKey,
          Authorization: bearer,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch { fail(503, 'RECORD_STORE_UNREACHABLE'); }
    if ([401, 403].includes(response.status)) {
      // A contract's own refusal arrives as a database error rather than an
      // HTTP status, so 401/403 here is the gateway rejecting the token.
      const declared = await declaredRefusal(response, entry.codes);
      if (declared) fail(409, declared);
      fail(response.status, 'AUTHENTICATION_REJECTED');
    }
    let answer;
    try { answer = await readJson(response, MAX_UPSTREAM_BYTES); } catch { fail(503, 'RECORD_STORE_UNREADABLE'); }
    if (!response.ok || response.redirected) {
      const declared = isObject(answer) && entry.codes.includes(answer.message) ? answer.message : null;
      fail(declared ? 409 : 503, declared ?? 'CONTRACT_REFUSED');
    }
    // An absent roster member is `null`, which is an answer rather than an
    // outage: it is how "not there" and "not a colleague of yours" are made
    // indistinguishable, so a caller cannot learn that an id belongs to
    // somebody in an agency they cannot see.
    if (answer === null && entry.nullable) return null;
    if (!isObject(answer)) fail(503, 'RECORD_STORE_UNREADABLE');
    return answer;
  };

  async function declaredRefusal(response, codes) {
    let body;
    try { body = await readJson(response, MAX_UPSTREAM_BYTES); } catch { return null; }
    return isObject(body) && codes.includes(body.message) ? body.message : null;
  }
}
