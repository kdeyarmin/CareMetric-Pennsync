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
