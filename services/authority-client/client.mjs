// Staging acceptance transport. This is not selected by the production frontend.
export const STAGING_APP_ID = '6a9881683dc68a0bd54f1ef7';
import { validVisitDocumentation, VISIT_DOCUMENTATION_MAX_BYTES } from './visit-documentation.mjs';
import { validVisitSchedule, validVisitScheduleParams } from './visits-schedule.mjs';
import { isReferralMethod, validReferralParams, validReferralResult } from './manual-referral.mjs';
import { validPatientContext } from './patient-context.mjs';

export const AUTHORITY_CONTRACT = 'cm.pennsync.authority.staging.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
/**
 * The four synthetic staging accounts, pinned here because this transport is
 * the synthetic staging path and nothing else. Exported so the hosted suite
 * can check the pins against `pennsync_private.identity_map`, which is the
 * authority: a pin for an identity the store has revoked, or a live mapped
 * identity this transport cannot address, is drift nothing else would report.
 */
export const ACTORS = new Map([
  ['info+pennsync-admin-a@caremetricai.com', '6aac58fe36c13a1c49ba7cf8'],
  ['info+pennsync-clinician-a@caremetricai.com', '6aac58ff8ec706a643a7aa42'],
  ['info+pennsync-clinician-empty@caremetricai.com', '6aac58ffa5f6252bcf92f11f'],
  ['info+pennsync-admin-b@caremetricai.com', '6aac5900bf4098977893276d'],
]);
const METHODS = Object.freeze({
  context: ['p_agency_id'],
  memberships: [],
  patients: ['p_agency_id', 'p_limit', 'p_after_id'],
  patient: ['p_agency_id', 'p_patient_id'],
  referral_patient: ['p_agency_id','p_patient_id'],
  referral_patients: ['p_agency_id','p_limit','p_after_id'],
  patient_context: ['p_agency_id', 'p_patient_id', 'p_purpose'],
  visit_documentation: ['p_agency_id', 'p_visit_id'],
  visits_schedule: ['p_agency_id', 'p_patient_id', 'p_status', 'p_page_size', 'p_cursor'],
  assignment: ['p_agency_id', 'p_patient_id', 'p_target_membership_id', 'p_action', 'p_expected_actor_version', 'p_expected_target_version', 'p_expected_assignment_version', 'p_request_id'],
  revoke_membership: ['p_agency_id', 'p_target_membership_id', 'p_expected_actor_version', 'p_expected_target_version', 'p_request_id'],
});

/**
 * Where the ported handlers live, and which of them answer bytes.
 *
 * Ten handlers were written into `services/pennsync-api` before anything could
 * call one: `src/` held no reference to the service at all, so every port was
 * unreachable from the app. This is the caller, and it lives here rather than
 * in a client of its own for one reason — the access token never leaves this
 * closure. Handing it to a second client to make the same call would undo the
 * containment that is the point of keeping it private.
 *
 * The map is written out rather than imported from the service: pulling
 * `handlers.mjs` into the browser bundle would drag roughly 480 lines of model
 * prompts and three document builders in with it, for a list of ten names.
 * `client.test.mjs` pins it against the service's own registry, so it cannot
 * drift from what the service actually serves.
 *
 * `binary` names the handlers whose Base44 originals answered with the PDF
 * itself. A migrated caller is not asked to decode something new, so those
 * still answer bytes here.
 */
export const API_TARGETS = Object.freeze([
  'https://pennsync-api-production.up.railway.app',
  'http://127.0.0.1:54341',
]);
export const PORTED_FUNCTIONS = Object.freeze({
  createAgencyTask: 'json',
  createNoteConversion: 'json',
  deletePdfTemplate: 'json',
  getAgencySettings: 'json',
  listAgencyTasks: 'json',
  listCarePlans: 'json',
  listFaceToFaceEncounters: 'json',
  listNoteConversions: 'json',
  listPatientDocumentRecords: 'json',
  listPdfTemplates: 'json',
  createPhysician: 'json',
  updatePhysician: 'json',
  deletePhysician: 'json',
  saveAgencySettings: 'json',
  saveCarePlan: 'json',
  saveFaceToFaceEncounter: 'json',
  savePdfTemplate: 'json',
  acceptAiContentAgreement: 'json',
  analyzeReferral: 'json',
  auditDataQuality: 'json',
  cancelTimeOffRequest: 'json',
  appendPatientNoteHistory: 'json',
  analyzeReferralIntake: 'json',
  analyzeReferralPriority: 'json',
  generateAIReport: 'binary',
  generateBagTechniquePDF: 'binary',
  generatePatientHandout: 'json',
  generatePatientChartPDF: 'json',
  generateReferralTasks: 'json',
  generateSmartNoteGuide: 'json',
  generateUserGuidePDF: 'binary',
  generateUserManual: 'binary',
  generateUserRosterPDF: 'binary',
  getAgencyRosterMember: 'json',
  getMyNotificationPreferences: 'json',
  listChartClinicalEvents: 'json',
  listChartRecommendations: 'json',
  listOcrCorrections: 'json',
  listOcrTrainingRuns: 'json',
  listSentEducationMaterials: 'json',
  lookupComplianceRule: 'json',
  recordChartRecommendation: 'json',
  recordSentEducationMaterial: 'json',
  saveMyNotificationPreferences: 'json',
  listBrokeredRecords: 'json',
  listMedicareComplianceRules: 'json',
  listMedicareGuidelines: 'json',
  listPhysicians: 'json',
  listDocumentTemplates: 'json',
  listLibraryDocuments: 'json',
  listOnCallShifts: 'json',
  listVisitPointConfigs: 'json',
  saveOnCallShift: 'json',
  deleteOnCallShift: 'json',
  updateLibraryDocument: 'json',
  deleteLibraryDocument: 'json',
  saveDocumentTemplate: 'json',
  deleteDocumentTemplate: 'json',
  checkAdrDeadlines: 'json',
  checkExpiredInvitations: 'json',
  createAuthorizedPatient: 'json',
  createAuthorizedVisit: 'json',
  createNotification: 'json',
  extractReferralDataForSmartNote: 'json',
  getAiContentAgreementStatus: 'json',
  getAuthorizedDocument: 'json',
  getDashboardData: 'json',
  getApprovedTimeOff: 'json',
  getScopedPatientAlerts: 'json',
  getAuthorizedPatient: 'json',
  getAuthorizedPatientNoteHistory: 'json',
  getAuthorizedVisit: 'json',
  listAgencyRoster: 'json',
  listClinicalPathways: 'json',
  manageClinicalPathway: 'json',
  listClinicalLibraryTemplates: 'json',
  manageClinicalLibraryTemplate: 'json',
  listClinicalLibraryFolders: 'json',
  manageClinicalLibraryFolder: 'json',
  listEducationMaterials: 'json',
  manageEducationMaterial: 'json',
  listPatientEducationAssignments: 'json',
  managePatientEducationAssignment: 'json',
  listCustomValidationRules: 'json',
  manageCustomValidationRule: 'json',
  readAiConfiguration: 'json',
  saveAiConfiguration: 'json',
  listAgencyIncidents: 'json',
  listComplianceAudits: 'json',
  listAdrAuditCases: 'json',
  listPersonnelCredentials: 'json',
  listPolicyAcknowledgments: 'json',
  createComplianceAudit: 'json',
  updateComplianceAudit: 'json',
  createAdrAuditCase: 'json',
  updateAdrAuditCase: 'json',
  deleteAdrAuditCase: 'json',
  listAuthorizedDocuments: 'json',
  listAuthorizedPatients: 'json',
  listAuthorizedVisits: 'json',
  listPolicyLibrary: 'json',
  manageAgencyMembership: 'json',
  manageAuthorizedReferral: 'json',
  manageMyNotifications: 'json',
  manageVehicleMaintenance: 'json',
  listMyTenantMemberships: 'json',
  getMyTenantContext: 'json',
  managePatientCareTeamAssignment: 'json',
  splitReferralPDF: 'json',
  syncCMSRegulations: 'json',
  triageReferralWithAI: 'json',
  updateAuthorizedPatient: 'json',
  savePayrollProfile: 'json',
  searchPDFs: 'json',
  saveVisitPointConfig: 'json',
  sendAccountReadyEmail: 'json',
  sendCredentialRenewalReminders: 'json',
  sendExpirationNotifications: 'json',
  sendPersonnelExpirationNotifications: 'json',
  sendWelcomeEmail: 'json',
  submitIncidentReport: 'json',
  submitPersonnelCredential: 'json',
  submitStateReportableIncident: 'json',
  submitTimeOffRequest: 'json',
  updateAuthorizedVisit: 'json',
  updateIncident: 'json',
  updateScopedPatientAlert: 'json',
  matchPatientWithAI: 'json',
  resendInvitation: 'json',
  resendInvitationV2: 'json',
  reviewPersonnelCredential: 'json',
  reviewTimeOffRequest: 'json',
  reviewTimesheet: 'json',
  submitTimesheet: 'json',
  setNurseDutyStatus: 'json',
  analyzeVisitForSupplyUsage: 'json',
  importProvidersCsv: 'json',
  expandClinicalPhrase: 'json',
  generateFollowUpTasks: 'json',
  analyzeAndGenerateClinicalTasks: 'json',
  extractClinicalDocument: 'json',
  extractClinicalEvents: 'json',
  extractPatientDataFromDocument: 'json',
  analyzeClinicalEvents: 'json',
  analyzeClinicalTrends: 'json',
  predictSupplyNeeds: 'json',
  distributePolicyAcknowledgment: 'json',
  policyAcknowledgment: 'json',
  validatePatientData: 'json',
});
/**
 * A JSON response allowance above the 1 MiB default, by handler name.
 *
 * `maxResponseBytes` defaults to 1 MiB, which is ample for a single record and
 * is NOT ample for a page of a few thousand. The five compliance list
 * capabilities are the first handlers here whose own SQL ceiling is larger than
 * that default can carry: measured from their projections in
 * `20260920660000_contract_compliance_reads.sql`, a page at each ceiling
 * serializes to 3.07 MiB for incidents, 1.94 for credentials and 1.74 for
 * audits with every value NULL — before a single report, finding or note. Left
 * at the default, a compliance screen asking for the page its Base44 original
 * asked for would get `INVALID_AUTHORITY_RESPONSE` for the WHOLE screen, which
 * is the shape of failure hardest to read back to a cause.
 *
 * Lowering the contract's ceiling instead was the other option and is worse: it
 * would show a nurse fewer rows than the platform showed, silently, which is
 * the narrowing these contracts are written not to do.
 *
 * The number is not a guess either way. `client-response-bounds.test.mjs` reads
 * each capability's projected keys and row ceiling out of that migration and
 * fails if this allowance is below what a null-valued page at the ceiling
 * needs, so widening a projection or raising a ceiling fails the build rather
 * than the screen. It is a BOUND rather than an expectation: a page of real
 * text can still exceed it, and that is a loud refusal, not a truncation.
 */
export const BULK_RESPONSE_BYTES = Object.freeze({
  listAgencyIncidents: 8 * 1024 * 1024,
  listComplianceAudits: 8 * 1024 * 1024,
  listAdrAuditCases: 8 * 1024 * 1024,
  listPersonnelCredentials: 8 * 1024 * 1024,
  listPolicyAcknowledgments: 8 * 1024 * 1024,
});
/** The ported API's one route shape. No caller names a path. */
const FUNCTION_PATH = name => `/v1/functions/${name}`;
/**
 * A ported handler gets longer than an authority RPC, because it is not one.
 *
 * `rpc` asks the database a bounded question and 15s is generous for it. A
 * ported handler may reach the integration runtime, which allows its own 30s
 * for a model call — so inheriting the RPC deadline aborted the browser at 15s
 * while both backend services were still working, and the larger referral
 * prompts and the eleven-section user guide are exactly the calls that take
 * that long. This exceeds the downstream deadline rather than matching it, so
 * the timeout that fires is the one that knows why.
 */
export const FUNCTION_TIMEOUT_MS = 45000;
const AGENCY = /^[A-Za-z0-9_-]{1,128}$/;

export class AuthorityClientError extends Error {
  constructor(code, status = null) { super(code); this.name = 'AuthorityClientError'; this.code = code; this.status = status; }
}
const fail = (code, status) => { throw new AuthorityClientError(code, status); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

function validateTarget(config) {
  if (!object(config) || config.appId !== STAGING_APP_ID || !UUID.test(config.authUserId)
    || !ACTORS.has(config.email) || typeof config.publishableKey !== 'string'
    || !/^sb_publishable_[A-Za-z0-9_-]{10,200}$/.test(config.publishableKey)) fail('INVALID_STAGING_TARGET');
  const local = config.projectRef === 'local-pennsync-authority' && config.projectUrl === 'http://127.0.0.1:54321';
  // Dedicated project approved and independently verified on 2026-09-18.
  // Both values must match exactly; URL shape and caller approval flags confer
  // no authority. Local acceptance harnesses retain their own local-only fence.
  const hosted = config.projectRef === 'xxtyweswohkvgkprimwa'
    && config.projectUrl === 'https://xxtyweswohkvgkprimwa.supabase.co';
  if (!local && !hosted) fail('INVALID_STAGING_TARGET');
  // The ported API is optional and pinned to the same fixed pair discipline.
  // An operator-supplied origin would let a misconfiguration point this
  // caller's bearer at a host we do not run, which is the whole reason the
  // authority project is pinned two lines above rather than merely shaped.
  if (config.apiUrl !== undefined && config.apiUrl !== null && !API_TARGETS.includes(config.apiUrl)) {
    fail('INVALID_STAGING_TARGET');
  }
  return Object.freeze({ ...config, apiUrl: config.apiUrl ?? null, base44UserId: ACTORS.get(config.email) });
}

/** The two authority methods a production caller may ask for, and nothing else. */
export const PRODUCTION_METHODS = Object.freeze(['context', 'memberships']);
const EMAIL = /^[^\s@]{1,128}@[^\s@.]+(?:\.[^\s@.]+)+$/;
const PROJECT_REF = /^[a-z]{20}$/;

/**
 * A production target, read from build configuration rather than pinned here.
 *
 * Staging is pinned to one app, one project and four accounts because it is one
 * reviewed environment. Production cannot be: the app id, the Supabase project
 * and the service origin are properties of a deployment, so this validates
 * their SHAPE and the relationships between them, and refuses anything that
 * would send a caller's bearer somewhere unintended.
 *
 * Three refusals are the load-bearing ones rather than the shape checks.
 * `projectUrl` has to be exactly `https://<projectRef>.supabase.co`, so the
 * origin is DERIVED from the reference and a mismatched pair cannot be
 * configured — the property the staging pin buys by enumeration, kept without
 * enumerating. The staging app id and the staging project are refused by name,
 * because a build that selected production mode and then pointed at the
 * synthetic store would read as production to every screen while standing on
 * synthetic rows. And `apiUrl` must be an origin and only an origin (no
 * credentials, no path, no query), because this caller's access token is sent
 * there: a path accepted here would let a configuration mistake post the
 * bearer to someone else's endpoint on a host we do run.
 */
export function validateProductionDeployment(config) {
  if (!object(config) || typeof config.appId !== 'string' || !/^[0-9a-f]{24}$/.test(config.appId)
    || config.appId === STAGING_APP_ID || typeof config.publishableKey !== 'string'
    || !/^sb_publishable_[A-Za-z0-9_-]{10,200}$/.test(config.publishableKey)) fail('INVALID_PRODUCTION_TARGET');
  // The local harness keeps its own exact pair, exactly as staging does: a
  // loopback origin is not a Supabase project and cannot be derived from a ref.
  const local = config.projectRef === 'local-pennsync-authority' && config.projectUrl === 'http://127.0.0.1:54321';
  const hosted = typeof config.projectRef === 'string' && PROJECT_REF.test(config.projectRef)
    && config.projectRef !== 'xxtyweswohkvgkprimwa'
    && config.projectUrl === `https://${config.projectRef}.supabase.co`;
  if (!local && !hosted) fail('INVALID_PRODUCTION_TARGET');
  if (typeof config.apiUrl !== 'string' || !validOrigin(config.apiUrl)) fail('INVALID_PRODUCTION_TARGET');
  return Object.freeze({ ...config });
}

/**
 * The deployment half, plus the one account this session acts as.
 *
 * Split so a build can validate its own configuration before anybody signs in —
 * production has no actor map to construct a client from, which is how staging
 * gets that check for free — while the closure still receives a frozen target
 * carrying both halves.
 */
function validateProductionTarget(config) {
  const deployment = validateProductionDeployment(config);
  if (typeof config.email !== 'string' || config.email !== config.email.trim().toLowerCase()
    || !EMAIL.test(config.email)) fail('INVALID_PRODUCTION_TARGET');
  return Object.freeze({ ...deployment, email: config.email });
}

/**
 * An origin and nothing more: `https://host[:port]`, or loopback over http for
 * the local harness. Parsed rather than matched, so a credential, a path, a
 * query or a fragment is refused by the URL's own fields instead of by a
 * pattern somebody has to get right.
 */
export function validOrigin(value) {
  let url;
  try { url = new URL(value); } catch { return false; }
  const loopback = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  return (url.protocol === 'https:' || loopback) && !url.username && !url.password
    && url.pathname === '/' && !url.search && !url.hash && value === url.origin;
}

function validateProductionParams(method, input, appId) {
  if (!PRODUCTION_METHODS.includes(method)) fail('INVALID_AUTHORITY_REQUEST');
  const keys = METHODS[method];
  if (!object(input) || !exact(input, keys)) fail('INVALID_AUTHORITY_REQUEST');
  for (const value of Object.values(input)) {
    if (typeof value !== 'string' || !ID.test(value)) fail('INVALID_AUTHORITY_REQUEST');
  }
  return Object.freeze({ ...input, p_app_id: appId });
}

/**
 * The production reading of an authority answer.
 *
 * Deliberately a second validator rather than a flag on the staging one. Most
 * of what that one asserts is synthetic — the pinned actor's legacy id, the
 * pinned e-mail, `agency.name like 'Synthetic %'` — and a production answer has
 * to fail every one of those while still being correct, so a shared validator
 * would be a list of exceptions where this is a list of requirements.
 *
 * What it does NOT assert is worth saying. `staging` and `synthetic` are
 * checked as booleans and not for their values: the store stamps both `true`
 * unconditionally (`pennsync_private.context_value`), so requiring `false`
 * would refuse the store we actually run against, and requiring `true` would
 * break on the day that stamp is corrected. The contract string is asserted,
 * because that is the shape promise and it does change deliberately.
 */
function validateProductionResult(result, method, params, config, authUserId) {
  const commonKeys = ['contract', 'app_id', 'auth_user_id', 'staging', 'synthetic'];
  const contextKeys = [...commonKeys, 'user_id', 'user_email', 'identity_version', 'is_platform_owner',
    'agency_id', 'membership_id', 'membership_key', 'membership_version', 'membership_status', 'tenant_role', 'agency'];
  const version = value => Number.isSafeInteger(value) && value >= 1;
  const common = value => object(value) && value.contract === AUTHORITY_CONTRACT
    && value.app_id === config.appId && value.auth_user_id === authUserId
    && typeof value.staging === 'boolean' && typeof value.synthetic === 'boolean';
  const subject = value => typeof value.user_id === 'string' && ID.test(value.user_id)
    && value.user_email === config.email;
  const context = (value, agencyId) => common(value) && exact(value, contextKeys) && subject(value)
    && version(value.identity_version) && value.is_platform_owner === false
    && typeof value.agency_id === 'string' && ID.test(value.agency_id)
    && (!agencyId || value.agency_id === agencyId)
    && typeof value.membership_id === 'string' && ID.test(value.membership_id)
    && value.membership_key === `${value.agency_id}:${value.user_id}` && version(value.membership_version)
    && value.membership_status === 'active'
    && ['agency_admin', 'manager', 'clinician', 'office_staff', 'social_worker', 'spiritual_care'].includes(value.tenant_role)
    && exact(value.agency, ['id', 'name', 'status']) && value.agency.id === value.agency_id
    && ['active', 'trial'].includes(value.agency.status)
    && typeof value.agency.name === 'string' && value.agency.name.length >= 1 && value.agency.name.length <= 120;
  if (method === 'context') {
    if (!context(result, params.p_agency_id)) fail('INVALID_AUTHORITY_RESPONSE');
    return result;
  }
  if (!common(result) || !exact(result, [...commonKeys, 'user_id', 'user_email', 'memberships']) || !subject(result)
    || !Array.isArray(result.memberships) || result.memberships.length > 50
    // Every listed membership has to be the SAME subject as the envelope: a
    // row for somebody else in a list addressed to this caller is the one
    // shape a per-row check alone would let through.
    || result.memberships.some(value => !context(value) || value.user_id !== result.user_id)
    || new Set(result.memberships.map(value => value.agency_id)).size !== result.memberships.length) {
    fail('INVALID_AUTHORITY_RESPONSE');
  }
  return result;
}

function validateParams(method, input) {
  if (isReferralMethod(method)) {
    if (!validReferralParams(method,input)) fail('INVALID_AUTHORITY_REQUEST');
    return Object.freeze({ ...input, ...(method === 's3_create' ? { p_fields:Object.freeze({ ...input.p_fields }) } : {}), p_app_id:STAGING_APP_ID });
  }
  if (method === 'visits_schedule') {
    if (!validVisitScheduleParams(input)) fail('INVALID_AUTHORITY_REQUEST');
    return Object.freeze({ ...input, p_cursor: input.p_cursor === null ? null : Object.freeze({ ...input.p_cursor }), p_app_id: STAGING_APP_ID });
  }
  const keys = METHODS[method];
  if (!keys || !object(input) || Object.keys(input).some(key => !keys.includes(key))) fail('INVALID_AUTHORITY_REQUEST');
  const params = { ...input };
  for (const key of keys) {
    if (method === 'patients' && ['p_limit', 'p_after_id'].includes(key)) continue;
    if (!Object.hasOwn(params, key)) fail('INVALID_AUTHORITY_REQUEST');
  }
  for (const [key, value] of Object.entries(params)) {
    if (key === 'p_action') { if (!['grant', 'revoke'].includes(value)) fail('INVALID_AUTHORITY_REQUEST'); }
    else if (key === 'p_purpose') { if (!['display', 'smart_note_context'].includes(value)) fail('INVALID_AUTHORITY_REQUEST'); }
    else if (key === 'p_limit') { if (!Number.isSafeInteger(value) || value < 1 || value > 100) fail('INVALID_AUTHORITY_REQUEST'); }
    else if (key === 'p_after_id' && value === null) continue;
    else if (key.includes('_version')) {
      if (!Number.isSafeInteger(value) || value < (key === 'p_expected_assignment_version' ? 0 : 1)) fail('INVALID_AUTHORITY_REQUEST');
    } else if (key === 'p_request_id' || key === 'p_visit_id') { if (typeof value !== 'string' || !UUID.test(value)) fail('INVALID_AUTHORITY_REQUEST'); }
    else if (typeof value !== 'string' || !ID.test(value)) fail('INVALID_AUTHORITY_REQUEST');
  }
  return Object.freeze({ ...params, p_app_id: STAGING_APP_ID });
}

async function boundedJson(response, maxBytes, readTimeoutMs = 0, expect = 'application/json') {
  if (!response.headers.get('content-type')?.toLowerCase().startsWith(expect)) fail('INVALID_AUTHORITY_RESPONSE');
  const declaredLength = response.headers.get('content-length');
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBytes)) fail('INVALID_AUTHORITY_RESPONSE');
  if (!response.body) fail('INVALID_AUTHORITY_RESPONSE');
  const reader = response.body.getReader();
  let bytes = 0;
  const chunks = [];
  let timer;
  const deadline = readTimeoutMs ? new Promise((_, reject) => {
    timer = setTimeout(() => reject(new AuthorityClientError('AUTHORITY_REQUEST_ABORTED')), readTimeoutMs);
  }) : null;
  try {
    for (;;) {
      const { value, done } = await (deadline ? Promise.race([reader.read(), deadline]) : reader.read());
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) fail('INVALID_AUTHORITY_RESPONSE');
      chunks.push(value);
    }
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
    // A ported document answers with the bytes its Base44 original answered
    // with, so the same capped read serves both and neither gets a second,
    // less careful path.
    if (expect !== 'application/json') return buffer;
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)); }
    catch { fail('INVALID_AUTHORITY_RESPONSE'); }
  } finally {
    clearTimeout(timer);
    if (deadline) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    else { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
}

function validateResult(result, method, params, config) {
  const commonKeys = ['contract', 'app_id', 'auth_user_id', 'staging', 'synthetic'];
  const contextKeys = [...commonKeys, 'user_id', 'user_email', 'identity_version', 'is_platform_owner', 'agency_id', 'membership_id', 'membership_key', 'membership_version', 'membership_status', 'tenant_role', 'agency'];
  const resultKeys = {
    context: contextKeys,
    memberships: [...commonKeys, 'user_id', 'user_email', 'memberships'],
    patients: [...commonKeys, 'context', 'items', 'next_cursor'],
    patient: [...commonKeys, 'context', 'patient'],
    referral_patient: [...commonKeys,'context','patient'],
    referral_patients: [...commonKeys,'context','items','next_cursor'],
    patient_context: [...commonKeys, 'context', 'purpose', 'patient', 'scope'],
    visit_documentation: [...commonKeys, 'context', 'purpose', 'visit', 'scope'],
    visits_schedule: [...commonKeys, 'context', 'purpose', 'visits', 'scope', 'page'],
    assignment: [...commonKeys, 'agency_id', 'action', 'request_id', 'replayed', 'patient_id', 'membership_id', 'membership_version', 'assignment_version', 'assignment_status'],
    revoke_membership: [...commonKeys, 'agency_id', 'action', 'request_id', 'replayed', 'membership_id', 'membership_version', 'membership_status'],
  };
  const version = value => Number.isSafeInteger(value) && value >= 1;
  const common = value => object(value) && value.contract === AUTHORITY_CONTRACT
    && value.app_id === STAGING_APP_ID && value.auth_user_id === config.authUserId
    && value.staging === true && value.synthetic === true;
  const context = (value, agencyId) => common(value) && exact(value, contextKeys) && value.user_id === config.base44UserId
    && value.user_email === config.email && version(value.identity_version)
    && value.is_platform_owner === false && typeof value.agency_id === 'string' && ID.test(value.agency_id)
    && (!agencyId || value.agency_id === agencyId) && typeof value.membership_id === 'string' && ID.test(value.membership_id)
    && value.membership_key === `${value.agency_id}:${config.base44UserId}` && version(value.membership_version)
    && value.membership_status === 'active' && ['agency_admin', 'manager', 'clinician', 'office_staff', 'social_worker', 'spiritual_care'].includes(value.tenant_role)
    && exact(value.agency, ['id', 'name', 'status']) && value.agency.id === value.agency_id && ['active', 'trial'].includes(value.agency.status)
    && typeof value.agency.name === 'string' && value.agency.name.startsWith('Synthetic ') && value.agency.name.length <= 120;
  const patient = value => exact(value, ['id', 'agency_id', 'display_name', 'version', 'synthetic']) && typeof value.id === 'string' && ID.test(value.id)
    && value.agency_id === params.p_agency_id && value.synthetic === true && version(value.version)
    && typeof value.display_name === 'string' && value.display_name.startsWith('Synthetic ') && value.display_name.length <= 120;
  if (isReferralMethod(method)) {
    if (!validReferralResult(result,method,params,context)) fail('INVALID_AUTHORITY_RESPONSE');
    return result;
  }
  if (!common(result) || !exact(result, resultKeys[method])) fail('INVALID_AUTHORITY_RESPONSE');
  if (method === 'context' && !context(result, params.p_agency_id)) fail('INVALID_AUTHORITY_RESPONSE');
  if (method === 'memberships' && (result.user_id !== config.base44UserId || result.user_email !== config.email
    || !Array.isArray(result.memberships) || result.memberships.length > 50
    || result.memberships.some(value => !context(value))
    || new Set(result.memberships.map(value => value.agency_id)).size !== result.memberships.length)) fail('INVALID_AUTHORITY_RESPONSE');
  if (['patients', 'patient', 'patient_context', 'visit_documentation', 'visits_schedule','referral_patient','referral_patients'].includes(method) && !context(result.context, params.p_agency_id)) fail('INVALID_AUTHORITY_RESPONSE');
  if (['referral_patient','referral_patients'].includes(method) && !['agency_admin','manager','office_staff'].includes(result.context.tenant_role)) fail('INVALID_AUTHORITY_RESPONSE');
  if (method === 'visits_schedule' && !validVisitSchedule(result, params)) fail('INVALID_AUTHORITY_RESPONSE');
  if (method === 'patient_context' && !validPatientContext(result, params)) fail('INVALID_AUTHORITY_RESPONSE');
  if (method === 'visit_documentation' && !validVisitDocumentation(result, params)) fail('INVALID_AUTHORITY_RESPONSE');
  if (['patients','referral_patients'].includes(method) && (!Array.isArray(result.items) || result.items.length > (params.p_limit ?? 50)
    || result.items.some(value => !patient(value)) || new Set(result.items.map(value => value.id)).size !== result.items.length
    || (result.next_cursor !== null && result.next_cursor !== result.items.at(-1)?.id))) fail('INVALID_AUTHORITY_RESPONSE');
  if (['patient','referral_patient'].includes(method) && (!patient(result.patient) || result.patient.id !== params.p_patient_id)) fail('INVALID_AUTHORITY_RESPONSE');
  if (['assignment', 'revoke_membership'].includes(method)) {
    if (result.agency_id !== params.p_agency_id || result.membership_id !== params.p_target_membership_id
      || result.request_id !== params.p_request_id.toLowerCase() || typeof result.replayed !== 'boolean') fail('INVALID_AUTHORITY_RESPONSE');
    if (method === 'assignment' && (result.action !== `${params.p_action}_assignment`
      || result.patient_id !== params.p_patient_id || result.membership_version !== params.p_expected_target_version
      || result.assignment_version !== params.p_expected_assignment_version + 1
      || result.assignment_status !== (params.p_action === 'grant' ? 'active' : 'revoked'))) fail('INVALID_AUTHORITY_RESPONSE');
    if (method === 'revoke_membership' && (result.action !== 'revoke_membership'
      || result.membership_version !== params.p_expected_target_version + 1 || result.membership_status !== 'revoked')) fail('INVALID_AUTHORITY_RESPONSE');
  }
  return result;
}

/**
 * No Base44 fallback, and the ACCESS token stays in this closure.
 *
 * This line used to read "no storage, refresh, or Base44 fallback", and two
 * thirds of that is no longer true: with a `sessionStore`, the rotated refresh
 * token is kept on the device and exchanged on boot, because the Base44 path a
 * build replaces comes back signed in after a reload and this one asked for a
 * password again. Without a store the closure is still the whole of it.
 */
export function createStagingAuthorityClient(input, options = {}) {
  return createAuthorityClient(validateTarget(input), 'staging', options);
}

/**
 * The same transport, for a real staff account on a production project.
 *
 * Shaped as a second ENTRY POINT into one closure rather than a second client,
 * because what differs between the two is small and auditable — which target is
 * accepted, how the caller's identity is established, and which authority
 * methods may be asked — while everything that makes this transport safe (the
 * epoch lease, the bounded read, the exact-session revocation, the token never
 * leaving the closure) is the same code in both. A copy would be a second place
 * for a session fence to rot.
 *
 * The difference that matters: staging pins the account's native UUID in
 * configuration and refuses any grant that does not match it, because the four
 * synthetic actors are provisioned once and known. Production cannot pin an id
 * it has never seen, so the identity is LEARNED from the first grant — and the
 * check that replaces the pin is that the grant's e-mail is the address that was
 * submitted, confirmed, and `authenticated` rather than anonymous. Every later
 * request in the session is then held to the id that grant established, so a
 * second answer about a different person is refused exactly as it is in staging.
 */
export function createProductionAuthorityClient(input, options = {}) {
  return createAuthorityClient(validateProductionTarget(input), 'production', options);
}

/**
 * A refresh token's shape, bounded here as well as in the device store.
 *
 * This value is SENT to the provider as a credential, so the client refuses to
 * send something that is not one rather than finding out from a 401 — the same
 * reason the access token's shape is checked in `validGrant`.
 */
const REFRESH_TOKEN = /^[A-Za-z0-9_-]{8,512}$/;
/**
 * An access token's shape: three dot-separated base64url segments.
 *
 * Named because two different questions ask it. `validGrant` asks whether a grant
 * may be USED, and the tracker below asks whether a string is a token this client
 * must revoke — and the second must not depend on the first, because a grant this
 * client refuses is still a session the provider minted.
 */
const ACCESS_TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function createAuthorityClient(config, mode,
  { fetchImpl = globalThis.fetch, timeoutMs = 15000, sessionStore = null } = {}) {
  const staging = mode === 'staging';
  const targetCode = staging ? 'INVALID_STAGING_TARGET' : 'INVALID_PRODUCTION_TARGET';
  if (typeof fetchImpl !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) fail(targetCode);
  let epoch = 0;
  let token = null;
  // Who this session is. Staging knows before it asks; production learns it from
  // the grant and then holds every later answer to it. Cleared with the epoch so
  // a fresh sign-in re-establishes it rather than inheriting the last one.
  let authUserId = staging ? config.authUserId : null;
  const pending = new Set();
  // Candidate sessions never authorize RPCs. Retain only known access tokens in
  // memory until exact local-scope revocation succeeds; cleanup can be retried.
  const knownSessions = new Map();
  const invalidate = () => {
    epoch += 1; token = null; if (!staging) authUserId = null;
    for (const controller of pending) controller.abort(); pending.clear();
  };
  const current = lease => { if (lease !== epoch) fail('STALE_AUTHORITY_SESSION'); };
  const sameUser = user => object(user) && user.email === config.email
    && typeof user.id === 'string' && UUID.test(user.id)
    && (authUserId === null ? !staging : user.id === authUserId)
    && user.role === 'authenticated' && user.is_anonymous === false
    && typeof user.email_confirmed_at === 'string' && Number.isFinite(Date.parse(user.email_confirmed_at));
  const validGrant = session => sameUser(session?.user) && typeof session.access_token === 'string'
    && session.access_token.length <= 16384 && ACCESS_TOKEN.test(session.access_token)
    && session.token_type === 'bearer';
  async function request(path, { lease, bearer, body, noBody = false, method = 'POST', cleanup = false,
    receivedGrant, maxResponseBytes = 1024 * 1024, origin = config.projectUrl, apikey = true,
    expect = 'application/json', deadlineMs = timeoutMs }) {
    if (!cleanup) current(lease);
    const controller = new AbortController();
    if (!cleanup) pending.add(controller);
    let rejectStopped;
    const stopped = new Promise((_, reject) => { rejectStopped = reject; });
    const onAbort = () => rejectStopped(new AuthorityClientError('AUTHORITY_REQUEST_ABORTED'));
    controller.signal.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(), deadlineMs);
    const live = () => { if (!cleanup) current(lease); if (controller.signal.aborted) fail('AUTHORITY_REQUEST_ABORTED'); };
    const execute = async () => {
      const response = await fetchImpl(origin + path, {
        method, redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
        signal: controller.signal,
        // The publishable key identifies the Supabase project, so it goes to
        // the Supabase project and nowhere else. The ported API authorizes on
        // the caller's bearer alone and is sent no key at all.
        headers: { ...(apikey ? { apikey: config.publishableKey } : {}), 'Content-Type': 'application/json',
          Accept: expect, ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      // A late grant may already have created a native session. Inspect a
      // successfully delivered bounded grant only for exact-session cleanup;
      // the epoch still fences every authentication result and RPC admission.
      if (!receivedGrant) live();
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        fail(response.status === 401 ? 'AUTHENTICATION_FAILED' : response.status === 403 ? 'AUTHORITY_DENIED' : 'AUTHORITY_REQUEST_FAILED', response.status);
      }
      if (noBody) {
        void response.body?.cancel().catch(() => {});
        live(); return null;
      }
      const result = await boundedJson(response, maxResponseBytes, deadlineMs, expect);
      if (receivedGrant) await receivedGrant(result, controller.signal.aborted || lease !== epoch);
      live();
      return result;
    };
    try {
      // The deadline covers fetch, body reads and cancellation even when an
      // injected transport ignores AbortSignal. A late grant continuation may
      // still receive a token and performs its own bounded exact-session cleanup.
      return await Promise.race([execute(), stopped]);
    } catch (error) {
      const aborted = controller.signal.aborted;
      controller.abort();
      if (!cleanup) current(lease);
      if (error instanceof AuthorityClientError) throw error;
      fail(aborted ? 'AUTHORITY_REQUEST_ABORTED' : 'AUTHORITY_NETWORK_FAILED');
    } finally {
      clearTimeout(timeout); pending.delete(controller);
      controller.signal.removeEventListener('abort', onAbort);
    }
  }
  function revokeKnown(bearer) {
    const record = knownSessions.get(bearer);
    if (!record) return Promise.resolve();
    if (!record.revoking) {
      record.revoking = request('/auth/v1/logout?scope=local', { bearer, noBody: true, cleanup: true })
        .then(() => { knownSessions.delete(bearer); })
        .catch(() => { fail('AUTHORITY_SESSION_CLEANUP_FAILED'); })
        .finally(() => { record.revoking = null; });
    }
    return record.revoking;
  }
  const revokeAllKnown = () => Promise.all([...knownSessions.keys()].map(revokeKnown));
  /**
   * Keep this grant's refresh token on the device, or leave nothing there.
   *
   * Called only after a session has been established, and never with anything
   * else: a provider that answers without a refresh token leaves the device with
   * no record rather than a stale one, because a record beside a session the app
   * cannot resume is a credential for a session nothing is tracking.
   */
  // A port may be synchronous (the browser's own storage is) or asynchronous (a
  // test's, or a device store that is not). Awaiting the result covers both, so
  // neither kind of port needs to know which the client expected.
  const device = {
    read: () => Promise.resolve(sessionStore.read()),
    write: value => Promise.resolve(sessionStore.write(value)),
    clear: () => Promise.resolve(sessionStore.clear()),
  };
  const persist = async session => {
    if (!sessionStore) return;
    const next = session?.refresh_token;
    if (typeof next === 'string' && REFRESH_TOKEN.test(next)) await device.write(next);
    else await device.clear();
  };
  /**
   * What a refusal means for the device record.
   *
   * A grant the provider REFUSED, or one that answered about somebody else, means
   * the stored token is spent or was never ours, so it goes. A transport failure
   * means nothing about the token: clearing it there would sign out every person
   * whose app booted offline or against a service that was briefly down, which is
   * worse than the thing it would protect. A token that really did die while the
   * transport failed is refused on the next boot and cleared then.
   */
  /**
   * Register the grant a CREDENTIAL EXCHANGE answered with, and revoke it at once
   * if the attempt is already over.
   *
   * It asks `validGrant` first, and that is deliberate rather than an oversight I
   * nearly "fixed". A grant that contradicts the identity this client is pinned or
   * bound to is not ours, and `client-lifecycle.test.mjs` asserts by name that such
   * a token is "rejected without treating its token as a cleanup credential" — the
   * client refuses the answer and touches nothing in it, rather than sending a
   * string out of an answer it just called untrustworthy. The session that may be
   * left behind is bounded by its own expiry and is known only to whoever produced
   * that answer.
   *
   * The opposite rule holds one step later, and the discriminator is whose
   * credential the request carried: a grant that comes back from a request made
   * with a session this client ALREADY accepted is ours by construction, so there
   * it is registered on the token's shape alone.
   */
  const trackGrant = async (value, canceled, accept) => {
    if (!validGrant(value)) return;
    const bearer = value.access_token;
    if (!knownSessions.has(bearer)) knownSessions.set(bearer, { revoking: null });
    accept(bearer);
    if (canceled) await revokeKnown(bearer);
  };
  const KEEP_ON = new Set(['AUTHORITY_NETWORK_FAILED', 'AUTHORITY_REQUEST_ABORTED',
    'AUTHORITY_REQUEST_FAILED', 'STALE_AUTHORITY_SESSION', 'AUTHORITY_SESSION_CLEANUP_FAILED']);
  return Object.freeze({
    async signIn(password) {
      invalidate();
      const lease = epoch;
      let candidate = null;
      try {
        await revokeAllKnown(); current(lease);
        if (typeof password !== 'string' || password.length < 12 || password.length > 512) {
          fail(staging ? 'INVALID_STAGING_CREDENTIAL' : 'INVALID_PRODUCTION_CREDENTIAL');
        }
        const session = await request('/auth/v1/token?grant_type=password', { lease, body: { email: config.email, password },
          receivedGrant: (value, canceled) => trackGrant(value, canceled, bearer => { candidate = bearer; }) });
        if (!validGrant(session)) fail('AUTHENTICATION_IDENTITY_MISMATCH');
        // Bind the production identity BEFORE the confirmation read, so that
        // read is a check rather than a second chance to establish one: the
        // `/user` answer now has to agree with the grant, which is the same
        // thing staging's pinned id asks of both.
        if (!staging) {
          current(lease);
          authUserId = session.user.id;
        }
        const user = await request('/auth/v1/user', { lease, bearer: candidate, method: 'GET' });
        if (!sameUser(user)) fail('AUTHENTICATION_IDENTITY_MISMATCH');
        current(lease);
        token = candidate;
        await persist(session);
        return Object.freeze({ id: authUserId, email: config.email, provider: 'supabase', app_id: config.appId });
      } catch (error) {
        // A learned identity that never produced a session is not one. Leaving
        // it bound would let the next failed attempt be checked against a
        // predecessor's grant instead of against nothing.
        if (!staging && !token) authUserId = null;
        // Everything registered, not only the candidate: a grant that was refused
        // was never a candidate and is exactly the one that would be left live.
        await revokeAllKnown();
        throw error;
      }
    },
    /**
     * Take up the session this device already holds, without a password.
     *
     * This is the half that makes a reload survivable, and it is deliberately the
     * SAME sequence as `signIn` from the grant onwards: the refreshed grant is
     * checked by `validGrant`, the production identity is bound from it, the
     * `/user` read has to agree, and only then does the token become usable. A
     * resumed session is therefore held to exactly what a password session is.
     *
     * The address is NOT learned here. The device record names whose session it
     * is, the client was constructed for that address, and `sameUser` compares
     * the provider's answer against it — so a token moved into somebody else's
     * record resumes nobody rather than resuming them as its new owner.
     *
     * READ THAT NARROWLY, as a reviewer had to point out. It is the TOKEN being
     * swapped that this refuses. A WHOLE record copied onto another device, address
     * and token together, does resume its owner there: the boot path reads the
     * record's own address and constructs the client for it, so there is nothing
     * for `sameUser` to disagree with. That is the same exposure as a copied
     * `base44_access_token`, and narrower, since this one is single-use and dies on
     * sign-out — see `signOut` for what that does and does not guarantee.
     *
     * Answers null when this device holds nothing, because that is the ordinary
     * case on a fresh browser and not a failure to report.
     */
    async resume() {
      if (!sessionStore) return null;
      invalidate();
      const lease = epoch;
      let candidate = null;
      let spent = null;
      try {
        // IT DROPS WHAT IT KNOWS RATHER THAN REVOKING IT, which is the opposite of
        // `signIn`, and a reviewer measured why it has to be. A realm close leaves
        // the provider's session live on purpose and `invalidate()` does not empty
        // `knownSessions`, so the bearer from before the close is still named here.
        // Revoking it ends that SESSION at the provider, and `scope=local` ends the
        // session rather than one token — so the refresh token on the device dies
        // with it and the exchange two lines down answers 401. A resume on the same
        // adapter therefore destroyed the session it was about to inherit, and
        // cleared the record on the way out. Dropping the names instead loses
        // nothing: a sign-out revokes, and these tokens are the ones a close
        // deliberately left live.
        //
        // And do NOT fix it by revoking AFTER the exchange: the rotated grant is in
        // the same provider session, so a local logout then would revoke what was
        // just resumed. A fixture that treats each access token as independently
        // live would pass either way, which is why this is written down here.
        knownSessions.clear(); current(lease);
        const stored = await device.read();
        if (stored === null || stored === undefined) return null;
        if (typeof stored !== 'string' || !REFRESH_TOKEN.test(stored)) {
          await device.clear();
          return null;
        }
        spent = stored;
        const session = await request('/auth/v1/token?grant_type=refresh_token', { lease, body: { refresh_token: stored },
          receivedGrant: (value, canceled) => trackGrant(value, canceled, bearer => { candidate = bearer; }) });
        if (!validGrant(session)) fail('AUTHENTICATION_IDENTITY_MISMATCH');
        if (!staging) { current(lease); authUserId = session.user.id; }
        const user = await request('/auth/v1/user', { lease, bearer: candidate, method: 'GET' });
        if (!sameUser(user)) fail('AUTHENTICATION_IDENTITY_MISMATCH');
        current(lease);
        token = candidate;
        // The exchange ROTATES: the token just sent is spent, so the device record
        // is replaced with the new one or emptied. Leaving the old one would make
        // every later boot fail against a token the provider has already retired.
        await persist(session);
        return Object.freeze({ id: authUserId, email: config.email, provider: 'supabase', app_id: config.appId });
      } catch (error) {
        if (!staging && !token) authUserId = null;
        await revokeAllKnown();
        // IT FORGETS ONLY WHAT IT SPENT. Another tab may have exchanged the same
        // record and written the rotated token while this attempt was in flight, so
        // an unconditional clear here deletes a record that is live and belongs to
        // a session somebody is using — the person stays signed in and the next
        // boot asks for a password anyway. A reviewer measured both interleavings.
        if (!KEEP_ON.has(error?.code) && spent !== null) {
          await Promise.resolve(sessionStore.clearSpent?.(spent) ?? device.clear()).catch(() => {});
        }
        throw error;
      }
    },
    async rpc(method, input = {}) {
      const params = staging
        ? validateParams(method, input)
        : validateProductionParams(method, input, config.appId);
      if (!token) fail('AUTHENTICATION_REQUIRED');
      const lease = epoch;
      // Both modes ask the same two wrappers, and the `staging_` in the name is
      // historical rather than a scope. `pennsync_private.context` and
      // `.memberships` read `pennsync_private.membership` and `.agency`
      // generally — nothing in either is synthetic-constrained — and the ported
      // business API already resolves EVERY caller's authority through
      // `pennsync_staging_context` (`services/pennsync-api/authority.mjs:16`).
      // So a production caller asking them is the path the service itself takes,
      // not a staging path borrowed; a renamed wrapper would be a migration
      // against a store that has already applied this one.
      const result = await request(`/rest/v1/rpc/pennsync_staging_${method}`, { lease, bearer: token, body: params,
        ...(method === 'visit_documentation' ? { maxResponseBytes: VISIT_DOCUMENTATION_MAX_BYTES } : {}) });
      current(lease);
      return staging
        ? validateResult(result, method, params, config)
        : validateProductionResult(result, method, params, config, authUserId);
    },
    /**
     * Call a released ported handler as this caller.
     *
     * Deliberately shaped like `rpc` above: the same lease, the same token out
     * of the same closure, the same refusal when there is no session. What
     * differs is the origin and that no publishable key is sent, because the
     * ported API authorizes on the bearer alone.
     *
     * `agencyId` is required and has no default. The Base44 originals accepted
     * any authenticated caller; the ported service requires a current agency
     * membership because it has no global scope. Defaulting it here would pick
     * a tenant on the caller's behalf, so a call site that has not been
     * reviewed for that is refused instead.
     */
    async callFunction(name, agencyId, params = {}) {
      if (!Object.hasOwn(PORTED_FUNCTIONS, name)) fail('PENNSYNC_API_FUNCTION_UNKNOWN');
      if (!config.apiUrl) fail('PENNSYNC_API_NOT_CONFIGURED');
      if (typeof agencyId !== 'string' || !AGENCY.test(agencyId)) fail('PENNSYNC_API_AGENCY_REQUIRED');
      if (!object(params)) fail('INVALID_AUTHORITY_REQUEST');
      if (!token) fail('AUTHENTICATION_REQUIRED');
      const lease = epoch;
      const binary = PORTED_FUNCTIONS[name] === 'binary';
      const result = await request(FUNCTION_PATH(name), {
        lease, bearer: token, body: { agency_id: agencyId, params },
        origin: config.apiUrl, apikey: false, deadlineMs: FUNCTION_TIMEOUT_MS,
        ...(binary ? { expect: 'application/pdf', maxResponseBytes: 8 * 1024 * 1024 } : {}),
        ...(!binary && Object.hasOwn(BULK_RESPONSE_BYTES, name)
          ? { maxResponseBytes: BULK_RESPONSE_BYTES[name] } : {}),
      });
      current(lease);
      // A document is its bytes. A JSON handler is wrapped by the service in
      // `{success, result, execution, base44ExecutionDependency}`, and that
      // envelope is unwrapped HERE — at one boundary — so a caller sees what
      // its Base44 original returned rather than a shape the Base44 path never
      // produced. Returning it unchanged was a real defect: the adapter then
      // wrapped it again, and a consumer reading `data.policies` found nothing
      // because the policies were at `data.result.policies`.
      if (binary) return result;
      if (!object(result) || result.success !== true || !Object.hasOwn(result, 'result')) {
        fail('PENNSYNC_API_RESPONSE_INVALID');
      }
      return result.result;
    },
    /**
     * End this session, and say whether the DEVICE should forget it too.
     *
     * The distinction is the whole reason persistence is worth anything, and it
     * is not a convenience. The app closes a READY realm by itself — after five
     * minutes, on returning to a tab that was hidden, on a back-forward restore
     * — and each of those paths ends the session as part of re-establishing a
     * fresh document, not because the person is leaving. If those forgot the
     * device record, a reload would ask for a password again and the Base44
     * behaviour this restores would be undone by the app's own housekeeping.
     *
     * So `forget` is TRUE by default, because a method named `signOut` that left
     * a usable credential behind would be the dangerous default, and the handful
     * of realm-closing callers pass false deliberately. The grants are revoked
     * either way: what survives a realm close is the refresh token on the device,
     * never a live access token in memory.
     */
    async signOut({ forget = true } = {}) {
      invalidate();
      if (!forget) {
        // A REALM CLOSE, and it deliberately revokes nothing. A local logout ends
        // the provider's session, and that session's refresh token dies with it —
        // so revoking here would leave the device record dead on arrival and the
        // person signing in again after every closure, which is the whole thing
        // this facility exists to end. What ends is the use: `invalidate` above
        // drops the access token out of memory and aborts everything in flight.
        //
        // The cost, stated rather than hidden: after a closure the session stays
        // live at the provider until its access token expires, so a token that
        // leaked elsewhere cannot be invalidated early. Base44 revokes nothing on a
        // realm close either, and the token it leaves live sits in storage, so this
        // is parity and not more. The provider's own session limits could bound it
        // further, which is a configuration question and not this client's.
        return;
      }
      // The record goes FIRST, before the network call that can fail: a sign-out
      // whose revoke never answers must still leave nothing on the device for the
      // next boot to resume from.
      //
      // WHICH IS NOT THE SAME AS THE COPY BEING DEAD, and the distinction is a
      // reviewer's. Clearing the record only empties THIS device; what kills a
      // record somebody already copied is the revoke below, and that is a network
      // call whose failure is swallowed — deliberately, because a sign-out must
      // complete offline. So the copy is dead when the revoke succeeded, and when it
      // did not the copy stays usable until the session expires at the provider.
      // Nothing here can close that, and claiming otherwise would overstate it.
      if (sessionStore) await device.clear().catch(() => {});
      await revokeAllKnown();
    },
    invalidate,
  });
}
