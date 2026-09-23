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
  acceptAiContentAgreement: 'json',
  analyzeReferral: 'json',
  auditDataQuality: 'json',
  cancelTimeOffRequest: 'json',
  appendPatientNoteHistory: 'json',
  analyzeReferralIntake: 'json',
  analyzeReferralPriority: 'json',
  generateBagTechniquePDF: 'binary',
  generatePatientHandout: 'json',
  generatePatientChartPDF: 'json',
  generateReferralTasks: 'json',
  generateSmartNoteGuide: 'json',
  generateUserGuidePDF: 'binary',
  generateUserManual: 'binary',
  generateUserRosterPDF: 'binary',
  getAgencyRosterMember: 'json',
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
  syncCMSRegulations: 'json',
  triageReferralWithAI: 'json',
  updateAuthorizedPatient: 'json',
  savePayrollProfile: 'json',
  searchPDFs: 'json',
  saveVisitPointConfig: 'json',
  sendAccountReadyEmail: 'json',
  sendCredentialRenewalReminders: 'json',
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
  analyzeVisitForSupplyUsage: 'json',
  importProvidersCsv: 'json',
  expandClinicalPhrase: 'json',
  generateFollowUpTasks: 'json',
  analyzeAndGenerateClinicalTasks: 'json',
  extractClinicalEvents: 'json',
  analyzeClinicalEvents: 'json',
  analyzeClinicalTrends: 'json',
  predictSupplyNeeds: 'json',
  policyAcknowledgment: 'json',
  validatePatientData: 'json',
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

/** Credentials and tokens stay in this closure; no storage, refresh, or Base44 fallback. */
export function createStagingAuthorityClient(input, { fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const config = validateTarget(input);
  if (typeof fetchImpl !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) fail('INVALID_STAGING_TARGET');
  let epoch = 0;
  let token = null;
  const pending = new Set();
  // Candidate sessions never authorize RPCs. Retain only known access tokens in
  // memory until exact local-scope revocation succeeds; cleanup can be retried.
  const knownSessions = new Map();
  const invalidate = () => { epoch += 1; token = null; for (const controller of pending) controller.abort(); pending.clear(); };
  const current = lease => { if (lease !== epoch) fail('STALE_AUTHORITY_SESSION'); };
  const sameUser = user => object(user) && user.id === config.authUserId && user.email === config.email
    && user.role === 'authenticated' && user.is_anonymous === false
    && typeof user.email_confirmed_at === 'string' && Number.isFinite(Date.parse(user.email_confirmed_at));
  const validGrant = session => sameUser(session?.user) && typeof session.access_token === 'string'
    && session.access_token.length <= 16384 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(session.access_token)
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
  return Object.freeze({
    async signIn(password) {
      invalidate();
      const lease = epoch;
      let candidate = null;
      try {
        await revokeAllKnown(); current(lease);
        if (typeof password !== 'string' || password.length < 12 || password.length > 512) fail('INVALID_STAGING_CREDENTIAL');
        const session = await request('/auth/v1/token?grant_type=password', { lease, body: { email: config.email, password },
          receivedGrant: async (value, canceled) => {
            if (validGrant(value)) {
              candidate = value.access_token;
              if (!knownSessions.has(candidate)) knownSessions.set(candidate, { revoking: null });
              if (canceled) await revokeKnown(candidate);
            }
          } });
        if (!validGrant(session)) fail('AUTHENTICATION_IDENTITY_MISMATCH');
        const user = await request('/auth/v1/user', { lease, bearer: candidate, method: 'GET' });
        if (!sameUser(user)) fail('AUTHENTICATION_IDENTITY_MISMATCH');
        current(lease);
        token = candidate;
        return Object.freeze({ id: config.authUserId, email: config.email, provider: 'supabase', app_id: STAGING_APP_ID });
      } catch (error) {
        if (candidate) await revokeKnown(candidate);
        throw error;
      }
    },
    async rpc(method, input = {}) {
      const params = validateParams(method, input);
      if (!token) fail('AUTHENTICATION_REQUIRED');
      const lease = epoch;
      const result = await request(`/rest/v1/rpc/pennsync_staging_${method}`, { lease, bearer: token, body: params,
        ...(method === 'visit_documentation' ? { maxResponseBytes: VISIT_DOCUMENTATION_MAX_BYTES } : {}) });
      current(lease);
      return validateResult(result, method, params, config);
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
    async signOut() {
      invalidate();
      await revokeAllKnown();
    },
    invalidate,
  });
}
