// Ported handler registry.
//
// A handler appears here only after its Base44 original has been read and its
// behavior reproduced. Presence is not release: `runtime.mjs` requires each
// name to be listed in PENNSYNC_API_FUNCTIONS before it can be reached, and the
// list is empty unless an operator sets it.
//
// Every handler receives the caller's already-resolved current authority. A
// handler never resolves its own authority and never widens it.
import { exactObject, fail, isObject } from './contracts.mjs';
import {
  BAG_TECHNIQUE_FILENAME, SMART_NOTE_GUIDE_FILENAME, USER_MANUAL_FILENAME,
  buildBagTechniqueChecklist, buildSmartNoteGuide, buildUserManual, documentDate,
} from './documents.mjs';
import { analyzeReferralPriority as runReferralPriority } from './referral-priority.mjs';
import { analyzeReferralIntake as runReferralIntake } from './referral-intake.mjs';
import { generateReferralTasks as runReferralTasks } from './referral-tasks.mjs';
import { matchPatientWithAI as runPatientMatch } from './patient-match.mjs';
import { analyzeReferral as runReferralAnalysis } from './referral-analysis.mjs';
import { GUIDE_FORMAT, buildUserGuide } from './document-user-guide.mjs';
import { USER_GUIDE_PROMPTS, USER_GUIDE_SCHEMA, resolveGuideType } from './user-guide-prompts.mjs';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const validateEmail = (email) => {
  if (!email) return null;
  return EMAIL.test(email) ? null : 'Invalid email format. Must be in format: user@domain.com';
};

const validatePhone = (phone) => {
  if (!phone) return null;
  const cleaned = String(phone).replace(/\D/g, '');
  if (cleaned.length !== 10 && cleaned.length !== 11) return 'Phone number must be 10 digits (or 11 with country code)';
  if (cleaned.length === 11 && cleaned[0] !== '1') return '11-digit phone numbers must start with 1';
  return null;
};

const validateDate = (value, fieldName = 'date') => {
  if (!value) return null;
  if (!DATE.test(value)) return `${fieldName} must be in YYYY-MM-DD format (e.g., 2024-12-18)`;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return `Invalid ${fieldName}`;
  if (fieldName === 'date_of_birth' && parsed > new Date()) return 'Date of birth cannot be in the future';
  return null;
};

/**
 * Field-level validation ported from base44/functions/validatePatientData.
 *
 * The rules, messages and field names are preserved exactly so a migrated
 * caller sees the same result. The function reads no record and writes
 * nothing, which is why it is the first port: it exercises the transport,
 * release gate and authority path without moving clinical data.
 */
export function validatePatientData(patient) {
  const errors = [];
  const required = (field, message) => {
    const value = patient[field];
    if (!value || String(value).trim() === '') errors.push({ field, message });
  };
  required('first_name', 'First name is required');
  required('last_name', 'Last name is required');

  if (!patient.date_of_birth) {
    errors.push({ field: 'date_of_birth', message: 'Date of birth is required' });
  } else {
    const message = validateDate(patient.date_of_birth, 'date_of_birth');
    if (message) errors.push({ field: 'date_of_birth', message });
  }

  for (const [field, check, prefix] of [
    ['email', validateEmail, ''],
    ['phone', validatePhone, ''],
    ['emergency_contact_phone', validatePhone, 'Emergency contact phone: '],
    ['physician_email', validateEmail, 'Physician email: '],
    ['physician_phone', validatePhone, 'Physician phone: '],
    ['caregiver_email', validateEmail, 'Caregiver email: '],
    ['caregiver_phone', validatePhone, 'Caregiver phone: '],
  ]) {
    if (!patient[field]) continue;
    const message = check(patient[field]);
    if (message) errors.push({ field, message: prefix + message });
  }

  if (patient.admission_date) {
    const message = validateDate(patient.admission_date, 'admission_date');
    if (message) errors.push({ field: 'admission_date', message });
  }
  return errors;
}

/**
 * Each entry declares the shape it accepts. Unknown parameters are refused
 * rather than ignored, so a caller cannot smuggle an unreviewed field past a
 * handler that happens not to read it.
 */
/**
 * Renders a ported document. The builder is pure and parity-tested against its
 * Base44 original; this is the only place that needs a PDF library, and it is
 * loaded on first use so a deployment that never releases a document handler
 * never loads it.
 */
async function renderDocument(build, config) {
  const { jsPDF } = await import('jspdf');
  return build(new jsPDF(), {
    logoDataUrl: config?.documentLogoDataUrl || null,
    generatedOn: documentDate(),
  }).output('arraybuffer');
}

/** Answers with the bytes, as `generateBagTechniquePDF` and `generateUserManual` did. */
async function pdfResponse(build, filename, config) {
  return { binary: true, body: await renderDocument(build, config), contentType: 'application/pdf', filename };
}

/**
 * Answers with base64 inside the envelope, as `generateSmartNoteGuide` did.
 *
 * The original chunked the bytes through `String.fromCharCode` and `btoa` to
 * avoid blowing the argument limit on a large document; `Buffer` produces the
 * same string without the dance.
 */
async function pdfBase64Response(build, filename, config) {
  return { pdf: Buffer.from(await renderDocument(build, config)).toString('base64'), filename };
}

export const HANDLERS = Object.freeze({
  // Each original took no parameters and rendered the same document for any
  // authenticated caller. That is kept, with the membership this service
  // requires added, since it has no global scope.
  listPolicyLibrary: Object.freeze({
    // The first port that reads an entity row, and the first to reach a
    // reviewed per-capability contract rather than the generic family.
    // `PolicyLibrary` returns `doc_url` — a locator into our own storage — so
    // D16's ceiling keeps it out of the family on purpose; the contract hands
    // it to this capability's callers, which is a decision about one endpoint.
    //
    // The authorization is the contract's and is not restated here. Who may see
    // drafts and archived policies is answered by the database, where the rest
    // of this design puts authorization; a copy in this handler would be a
    // second answer to keep in agreement with it.
    handle({ params, contract }) {
      exactObject(params, ['mode'], 'INVALID_PARAMS');
      return contract('listPolicyLibrary', params);
    },
  }),
  listAgencyRoster: Object.freeze({
    // D23. Not a ported Base44 name: the original read the `User` entity from
    // each of 35 capabilities, and what replaces that is one reviewed contract
    // rather than 35 copies of a query.
    //
    // The authorization is the contract's and is not restated here — who sees
    // a colleague's telephone number and credentials is decided by the
    // authoritative tenant role in the database, not by this handler and not
    // by the self-editable `is_manager` flag on the carried row.
    handle({ params, contract }) {
      exactObject(params, ['limit', 'after'], 'INVALID_PARAMS');
      return contract('listAgencyRoster', params);
    },
  }),
  getAgencyRosterMember: Object.freeze({
    handle({ params, contract }) {
      exactObject(params, ['user_id'], 'INVALID_PARAMS');
      return contract('getAgencyRosterMember', params);
    },
  }),
  listAuthorizedPatients: Object.freeze({
    // The first ported capability that reads clinical rows.
    //
    // The original is 1,404 lines, and almost all of them are work Base44
    // forced on it: no row-level security, so it built the tenant query
    // itself, re-resolved the caller's membership four times around it,
    // re-read every care-team assignment after choosing the rows, and ran the
    // whole read twice to catch an authority change in between. Here the rows
    // a caller may see are decided by the policies on the table inside one
    // statement in one snapshot — tenancy from `caller_agencies()`, the chart
    // from D24 — so there is no window between the check and the read to
    // fence off, and nothing for this handler to re-check.
    //
    // What is left for the handler is the shape of the request, and the shape
    // is per mode, exactly as the original's is: naming `patient_ids` on a
    // page is not a request anybody meant, and neither is naming a cursor on
    // a batch. Who may see which fields is the contract's, in the database,
    // and is not restated here.
    handle({ params, contract }) {
      if (!isObject(params)) fail(400, 'INVALID_PARAMS');
      const mode = params.mode === undefined ? 'page' : params.mode;
      if (mode === 'page') {
        exactObject(params, ['mode', 'purpose', 'status', 'sort', 'page_size', 'after'], 'INVALID_PARAMS');
        // The contract orders by id ascending and has no second ordering to
        // offer. The original takes the argument and refuses anything else,
        // so a caller that sends it still gets the answer it expects.
        if (params.sort !== undefined && params.sort !== 'id_asc') fail(400, 'INVALID_PARAMS');
        const { mode: unused, sort: alsoUnused, ...rest } = params;
        return contract('listAuthorizedPatientsPage', rest);
      }
      if (mode === 'ids') {
        exactObject(params, ['mode', 'purpose', 'patient_ids'], 'INVALID_PARAMS');
        const { mode: unused, ...rest } = params;
        return contract('listAuthorizedPatientsBatch', rest);
      }
      fail(400, 'INVALID_PARAMS');
    },
  }),
  getAuthorizedPatient: Object.freeze({
    // One chart, under its own purposes. The contract answers null for a
    // chart that is not there and for one that is not this caller's, in the
    // same words, so that an id cannot be tested for existence; the original
    // answers 404 to both for the same reason, and so does this.
    async handle({ params, contract }) {
      exactObject(params, ['purpose', 'patient_id'], 'INVALID_PARAMS');
      const patient = await contract('getAuthorizedPatient', params);
      if (patient === null) fail(404, 'PATIENT_UNAVAILABLE');
      return { patient };
    },
  }),
  listAuthorizedVisits: Object.freeze({
    // The same shape as the patient list and for the same reasons; the one
    // thing worth naming is `patient_id`, which is what a chart's visit
    // history is. It narrows a read the caller is already entitled to and
    // cannot widen one: D24 decided which visits they can see at all.
    handle({ params, contract }) {
      exactObject(params, ['purpose', 'patient_id', 'status', 'sort', 'page_size', 'after'], 'INVALID_PARAMS');
      // The contract orders by id ascending and has no second ordering to
      // offer. The original takes the argument and refuses anything else.
      if (params.sort !== undefined && params.sort !== 'id_asc') fail(400, 'INVALID_PARAMS');
      const { sort: unused, ...rest } = params;
      return contract('listAuthorizedVisits', rest);
    },
  }),
  getAuthorizedVisit: Object.freeze({
    async handle({ params, contract }) {
      exactObject(params, ['purpose', 'visit_id'], 'INVALID_PARAMS');
      const visit = await contract('getAuthorizedVisit', params);
      if (visit === null) fail(404, 'VISIT_UNAVAILABLE');
      return { visit };
    },
  }),
  listAuthorizedDocuments: Object.freeze({
    // `binding_purpose` is what a document is attached to — a patient's chart
    // or a referral — and `patient_id` narrows to one chart. A caller who
    // does not open every chart must name one; that rule is the contract's,
    // not this handler's, because it is about who is asking.
    handle({ params, contract }) {
      exactObject(params, ['purpose', 'patient_id', 'binding_purpose', 'sort', 'page_size', 'after'],
        'INVALID_PARAMS');
      // The contract orders by document id ascending and has no second
      // ordering to offer. The original takes the argument and refuses
      // anything else, under its own name for the same order.
      if (params.sort !== undefined && params.sort !== 'document_id_asc') fail(400, 'INVALID_PARAMS');
      const { sort: unused, ...rest } = params;
      return contract('listAuthorizedDocuments', rest);
    },
  }),
  getAuthorizedDocument: Object.freeze({
    async handle({ params, contract }) {
      exactObject(params, ['purpose', 'document_id'], 'INVALID_PARAMS');
      const document = await contract('getAuthorizedDocument', params);
      if (document === null) fail(404, 'DOCUMENT_UNAVAILABLE');
      return { document };
    },
  }),
  createAuthorizedPatient: Object.freeze({
    // The first ported write. Which fields a client may supply is the
    // contract's, checked in SQL against a list extracted from the original
    // rather than retyped — so this handler does not carry a copy of it, and
    // a field added to the original reaches the database by regenerating
    // rather than by remembering.
    handle({ params, contract }) {
      exactObject(params, ['client_request_id', 'patient'], 'INVALID_PARAMS');
      if (!isObject(params.patient)) fail(400, 'INVALID_PARAMS');
      return contract('createAuthorizedPatient', params);
    },
  }),
  updateAuthorizedPatient: Object.freeze({
    // A caller names workflow actions, never a patch. Which actions exist,
    // which fields each one may touch and which roles may perform it are all
    // the contract's, checked in SQL against the original's own fenced
    // declaration — so this handler checks the envelope and nothing else, and
    // an action added to the original reaches the database by regenerating
    // rather than by remembering.
    handle({ params, contract }) {
      exactObject(params, ['patient_id', 'expected_updated_date', 'actions'], 'INVALID_PARAMS');
      if (!Array.isArray(params.actions)) fail(400, 'INVALID_PARAMS');
      return contract('updateAuthorizedPatient', params);
    },
  }),
  createAuthorizedVisit: Object.freeze({
    // Scheduling input and nothing else. Which fields a client may supply is
    // the contract's, checked in SQL against a list extracted from the
    // original, and so is who may schedule against which chart — so this
    // handler checks the envelope and carries no copy of either.
    handle({ params, contract }) {
      exactObject(params, ['patient_id', 'client_request_id', 'visit'], 'INVALID_PARAMS');
      if (!isObject(params.visit)) fail(400, 'INVALID_PARAMS');
      return contract('createAuthorizedVisit', params);
    },
  }),
  updateAuthorizedVisit: Object.freeze({
    // A caller names one workflow action and the fields it accepts. Which
    // actions exist, which this port serves, which inputs each accepts and who
    // may perform it are all the contract's — so this handler checks the
    // envelope and nothing else, and the four served actions grow by changing
    // the extraction rather than by editing here.
    handle({ params, contract }) {
      exactObject(params, ['visit_id', 'action', 'fields'], 'INVALID_PARAMS');
      if (!isObject(params.fields)) fail(400, 'INVALID_PARAMS');
      return contract('updateAuthorizedVisit', params);
    },
  }),
  getScopedPatientAlerts: Object.freeze({
    // "Scoped" in the original meant the caller's own charts, worked out from
    // `Patient.assigned_nurses`. It means D24's care team now, decided by the
    // policies, so this handler carries no scope of its own.
    handle({ params, contract }) {
      exactObject(params, ['patient_id', 'status', 'severity', 'limit'], 'INVALID_PARAMS');
      if (params.severity !== undefined && !Array.isArray(params.severity)) {
        fail(400, 'INVALID_PARAMS');
      }
      return contract('getScopedPatientAlerts', params);
    },
  }),
  updateScopedPatientAlert: Object.freeze({
    handle({ params, contract }) {
      exactObject(params, ['alert_id', 'action', 'resolution_notes'], 'INVALID_PARAMS');
      return contract('updateScopedPatientAlert', params);
    },
  }),
  getAuthorizedPatientNoteHistory: Object.freeze({
    handle({ params, contract }) {
      exactObject(params, ['patient_id', 'event_limit', 'offset'], 'INVALID_PARAMS');
      return contract('getAuthorizedPatientNoteHistory', params);
    },
  }),
  appendPatientNoteHistory: Object.freeze({
    // Every save appends an event; nothing edits one. The store enforces that
    // rather than the handler: D32 gives the table no update or delete policy
    // at all, because its own schema calls the row immutable.
    handle({ params, contract }) {
      exactObject(params, ['patient_id', 'mode', 'entry', 'clinical_notes'], 'INVALID_PARAMS');
      if (!isObject(params.entry)) fail(400, 'INVALID_PARAMS');
      return contract('appendPatientNoteHistory', params);
    },
  }),
  resendInvitation: Object.freeze({
    // Both names reach the one contract: the two originals are the same file.
    async handle({ params, contract }) {
      exactObject(params, ['invitation_id'], 'INVALID_PARAMS');
      return { ...(await contract('resendInvitation', params)), delivery_paused: true };
    },
  }),
  resendInvitationV2: Object.freeze({
    async handle({ params, contract }) {
      exactObject(params, ['invitation_id'], 'INVALID_PARAMS');
      return { ...(await contract('resendInvitation', params)), delivery_paused: true };
    },
  }),
  auditDataQuality: Object.freeze({
    handle({ params, contract }) {
      exactObject(params, [], 'INVALID_PARAMS');
      return contract('auditDataQuality', params);
    },
  }),
  reviewPersonnelCredential: Object.freeze({
    async handle({ params, contract }) {
      exactObject(params, ['credential_id', 'action', 'rejection_reason'], 'INVALID_PARAMS');
      return { ...(await contract('reviewPersonnelCredential', params)), delivery_paused: true };
    },
  }),
  submitPersonnelCredential: Object.freeze({
    async handle({ params, contract }) {
      exactObject(params, ['credential_id', 'renews_credential_id', 'credential'],
        'INVALID_PARAMS');
      if (!isObject(params.credential)) fail(400, 'INVALID_PARAMS');
      return { ...(await contract('submitPersonnelCredential', params)), delivery_paused: true };
    },
  }),
  submitTimeOffRequest: Object.freeze({
    // `delivery_paused` is reported the way the original reports it when
    // `OUTBOUND_DELIVERY_RELEASE` is not `enabled-v1`: the record work is done
    // and the approver email is not sent. Outbound delivery is the integration
    // runtime's, which is deployed and paused, so the shape a migrated caller
    // already handles is the honest answer.
    async handle({ params, contract }) {
      exactObject(params, ['request_type', 'start_date', 'end_date', 'half_day',
        'reason', 'coverage', 'manager_email'], 'INVALID_PARAMS');
      return { ...(await contract('submitTimeOffRequest', params)), delivery_paused: true };
    },
  }),
  cancelTimeOffRequest: Object.freeze({
    async handle({ params, contract }) {
      exactObject(params, ['request_id'], 'INVALID_PARAMS');
      return { ...(await contract('cancelTimeOffRequest', params)), delivery_paused: true };
    },
  }),
  reviewTimeOffRequest: Object.freeze({
    async handle({ params, contract }) {
      exactObject(params, ['request_id', 'decision', 'note'], 'INVALID_PARAMS');
      return { ...(await contract('reviewTimeOffRequest', params)), delivery_paused: true };
    },
  }),
  getApprovedTimeOff: Object.freeze({
    // The only one of the four that sends nothing, so it reports nothing.
    handle({ params, contract }) {
      exactObject(params, [], 'INVALID_PARAMS');
      return contract('getApprovedTimeOff', params);
    },
  }),
  getAiContentAgreementStatus: Object.freeze({
    handle({ params, contract }) {
      exactObject(params, [], 'INVALID_PARAMS');
      return contract('getAiContentAgreementStatus', params);
    },
  }),
  acceptAiContentAgreement: Object.freeze({
    // The original's body is exactly `{accepted: true, agreement_version}` and
    // nothing else. `accepted` carries no information a request to this
    // endpoint does not already carry, so it is required and then dropped:
    // a caller that sends `accepted: false` is refused rather than silently
    // treated as an acceptance.
    handle({ params, contract }) {
      exactObject(params, ['accepted', 'agreement_version'], 'INVALID_PARAMS');
      if (params.accepted !== true) fail(400, 'INVALID_PARAMS');
      return contract('acceptAiContentAgreement',
        { agreement_version: params.agreement_version });
    },
  }),
  policyAcknowledgment: Object.freeze({
    // The original defaults `action` to `acknowledge` when absent, and this
    // keeps that. `list` is refused HERE rather than at the contract, because
    // there is no contract to refuse it: its only performer was the platform
    // tier D14 and D22 removed, so nothing was written for it.
    handle({ params, contract }) {
      if (!isObject(params)) fail(400, 'INVALID_PARAMS');
      const action = params.action ?? 'acknowledge';
      if (action === 'list') fail(403, 'PENNSYNC_POLICY_ACK_ACTION_UNPORTED');
      if (action !== 'acknowledge') fail(400, 'INVALID_PARAMS');
      exactObject(params, ['action', 'acknowledgment_id', 'signed_name'], 'INVALID_PARAMS');
      return contract('acknowledgePolicy', params);
    },
  }),
  manageAgencyMembership: Object.freeze({
    // One Base44 capability with six actions reaching two contracts, five of
    // them served. `provision` is NOT filtered out here: it reaches the
    // contract and is refused by name, because a caller asking for it is
    // asking for something real in the original and deserves to be told which
    // it is rather than "unknown action".
    handle({ params, contract }) {
      if (!isObject(params)) fail(400, 'INVALID_PARAMS');
      if (params.action === 'inspect') {
        exactObject(params, ['action', 'target_user_id'], 'INVALID_PARAMS');
        return contract('inspectAgencyMembership', params);
      }
      exactObject(params,
        ['action', 'target_user_id', 'tenant_role', 'reason', 'expected_version'],
        'INVALID_PARAMS');
      return contract('transitionAgencyMembership', params);
    },
  }),
  listMyTenantMemberships: Object.freeze({
    // The originals take an empty body; so does this.
    handle({ params, contract }) {
      exactObject(params, [], 'INVALID_PARAMS');
      return contract('listMyTenantMemberships', params);
    },
  }),
  getMyTenantContext: Object.freeze({
    // The original's optional `agency_id` is not a parameter here: the
    // envelope already names the agency this request acts in, and a second way
    // to name it is a second thing that can disagree with the first.
    handle({ params, contract }) {
      exactObject(params,
        ['expected_membership_id', 'expected_membership_version'], 'INVALID_PARAMS');
      return contract('getMyTenantContext', params);
    },
  }),
  managePatientCareTeamAssignment: Object.freeze({
    // One Base44 capability with five actions, reaching two contracts — the
    // same shape `listAuthorizedPatients` has. `inspect` was the only action
    // the original served: the other four were refused at module scope by
    // `CARE_TEAM_ASSIGNMENT_MUTATIONS_ENABLED = false` before the handler read
    // anything, and D33 re-enables them because the owned store meets the
    // three conditions that pause names.
    //
    // The envelope is the original's and is action-dependent, which is why
    // there are three `exactObject` calls rather than one: an inspect carries
    // no request id, a grant carries no version, and a transition carries
    // both. Everything past the envelope — who may ask, who may be named, what
    // the reason must look like, which transition is legal — is the contract's.
    handle({ params, contract }) {
      if (!isObject(params)) fail(400, 'INVALID_PARAMS');
      const subject = ['patient_id', 'target_user_id'];
      if (params.action === 'inspect') {
        exactObject(params, ['action', ...subject], 'INVALID_PARAMS');
        return contract('inspectPatientCareTeamAssignment', params);
      }
      const transition = ['action', ...subject, 'client_request_id', 'reason'];
      exactObject(params, params.action === 'grant'
        ? transition : [...transition, 'expected_version'], 'INVALID_PARAMS');
      return contract('transitionPatientCareTeamAssignment', params);
    },
  }),
  generateBagTechniquePDF: Object.freeze({
    binary: true,
    handle({ params, config }) {
      exactObject(params, [], 'INVALID_PARAMS');
      return pdfResponse(buildBagTechniqueChecklist, BAG_TECHNIQUE_FILENAME, config);
    },
  }),
  generateSmartNoteGuide: Object.freeze({
    // Not a binary handler: this original answered with JSON carrying base64,
    // and a port answers the way its original did.
    handle({ params, config }) {
      exactObject(params, [], 'INVALID_PARAMS');
      return pdfBase64Response(buildSmartNoteGuide, SMART_NOTE_GUIDE_FILENAME, config);
    },
  }),
  generateUserGuidePDF: Object.freeze({
    binary: true,
    needsIntegration: true,
    // The only port that both asks a model and renders. The guide type is
    // resolved before anything else because it reaches the download filename:
    // an unresolved one could mislabel the file or carry into the header, which
    // is what the original's own comment guards against.
    async handle({ params, integration }) {
      exactObject(params, ['guide_type'], 'INVALID_PARAMS');
      const guideType = resolveGuideType(params.guide_type);
      const guideContent = await integration('InvokeLLM', {
        prompt: USER_GUIDE_PROMPTS[guideType],
        response_json_schema: structuredClone(USER_GUIDE_SCHEMA),
      });
      const { jsPDF } = await import('jspdf');
      // One clock read for both stamps, so a render that straddles midnight
      // cannot date its footer and its copyright to different years.
      const now = new Date();
      // Letter, as the original constructs it — not the A4 default.
      const body = buildUserGuide(new jsPDF(GUIDE_FORMAT), guideContent, {
        generatedOn: documentDate(now), year: now.getFullYear(),
      }).output('arraybuffer');
      return { binary: true, body, contentType: 'application/pdf', filename: `${guideType}_guide.pdf` };
    },
  }),
  generateUserManual: Object.freeze({
    binary: true,
    handle({ params, config }) {
      exactObject(params, [], 'INVALID_PARAMS');
      return pdfResponse(buildUserManual, USER_MANUAL_FILENAME, config);
    },
  }),
  analyzeReferral: Object.freeze({
    // Reaches the integration runtime, so releasing it without one configured
    // is a service that answers ready and then refuses every call.
    needsIntegration: true,
    // A dispatcher: the action decides which params are required, so the shape
    // is checked inside rather than by one `exactObject` here.
    handle({ params, integration }) {
      if (!isObject(params)) fail(400, 'INVALID_PARAMS');
      return runReferralAnalysis({ params, integration });
    },
  }),
  analyzeReferralIntake: Object.freeze({
    // Reaches the integration runtime, so releasing it without one configured
    // is a service that answers ready and then refuses every call.
    needsIntegration: true,
    handle({ params, integration }) {
      exactObject(params, ['extractedData', 'analysisResults'], 'INVALID_PARAMS');
      return runReferralIntake({ params, integration });
    },
  }),
  analyzeReferralPriority: Object.freeze({
    // Reaches the integration runtime, so releasing it without one configured
    // is a service that answers ready and then refuses every call.
    needsIntegration: true,
    // The first port that reaches outside the service. `integration` is bound
    // to this caller by `app.mjs`; the handler never sees the credential that
    // authorizes the brokered call.
    handle({ params, integration }) {
      exactObject(params, ['extractedData', 'analysisResults'], 'INVALID_PARAMS');
      return runReferralPriority({ params, integration });
    },
  }),
  generateReferralTasks: Object.freeze({
    // Reaches the integration runtime, so releasing it without one configured
    // is a service that answers ready and then refuses every call.
    needsIntegration: true,
    handle({ params, integration }) {
      exactObject(params, ['referralData', 'priorityAnalysis'], 'INVALID_PARAMS');
      return runReferralTasks({ params, integration });
    },
  }),
  matchPatientWithAI: Object.freeze({
    // Reaches the integration runtime, so releasing it without one configured
    // is a service that answers ready and then refuses every call.
    needsIntegration: true,
    handle({ params, integration }) {
      exactObject(params, ['extractedData', 'existingPatients'], 'INVALID_PARAMS');
      return runPatientMatch({ params, integration });
    },
  }),
  validatePatientData: Object.freeze({
    // Reproduces the original's authenticated-caller requirement, tightened to
    // a current agency membership because this service has no global scope.
    handle({ params }) {
      exactObject(params, ['patient'], 'INVALID_PARAMS');
      if (!isObject(params.patient)) fail(400, 'PATIENT_REQUIRED');
      const errors = validatePatientData(params.patient);
      return errors.length
        ? { valid: false, errors }
        : { valid: true, message: 'Patient data is valid' };
    },
  }),
});

export const HANDLER_NAMES = Object.freeze(Object.keys(HANDLERS).sort());
