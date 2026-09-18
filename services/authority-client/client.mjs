// Staging acceptance transport. This is not selected by the production frontend.
export const STAGING_APP_ID = '6a9881683dc68a0bd54f1ef7';
export const AUTHORITY_CONTRACT = 'cm.pennsync.authority.staging.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const ACTORS = new Map([
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
  assignment: ['p_agency_id', 'p_patient_id', 'p_target_membership_id', 'p_action', 'p_expected_actor_version', 'p_expected_target_version', 'p_expected_assignment_version', 'p_request_id'],
  revoke_membership: ['p_agency_id', 'p_target_membership_id', 'p_expected_actor_version', 'p_expected_target_version', 'p_request_id'],
});

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
  // No hosted PennSync staging project has been approved and verified yet.
  // A correctly shaped URL or a caller-supplied approval flag is not a pin.
  // Add its exact immutable reference in a reviewed change after provisioning;
  // until then, reject hosted targets before accepting any password or token.
  if (!local) fail('INVALID_STAGING_TARGET');
  return Object.freeze({ ...config, base44UserId: ACTORS.get(config.email) });
}

function validateParams(method, input) {
  const keys = METHODS[method];
  if (!keys || !object(input) || Object.keys(input).some(key => !keys.includes(key))) fail('INVALID_AUTHORITY_REQUEST');
  const params = { ...input };
  for (const key of keys) {
    if (method === 'patients' && ['p_limit', 'p_after_id'].includes(key)) continue;
    if (!Object.hasOwn(params, key)) fail('INVALID_AUTHORITY_REQUEST');
  }
  for (const [key, value] of Object.entries(params)) {
    if (key === 'p_action') { if (!['grant', 'revoke'].includes(value)) fail('INVALID_AUTHORITY_REQUEST'); }
    else if (key === 'p_limit') { if (!Number.isSafeInteger(value) || value < 1 || value > 100) fail('INVALID_AUTHORITY_REQUEST'); }
    else if (key === 'p_after_id' && value === null) continue;
    else if (key.includes('_version')) {
      if (!Number.isSafeInteger(value) || value < (key === 'p_expected_assignment_version' ? 0 : 1)) fail('INVALID_AUTHORITY_REQUEST');
    } else if (key === 'p_request_id') { if (typeof value !== 'string' || !UUID.test(value)) fail('INVALID_AUTHORITY_REQUEST'); }
    else if (typeof value !== 'string' || !ID.test(value)) fail('INVALID_AUTHORITY_REQUEST');
  }
  return Object.freeze({ ...params, p_app_id: STAGING_APP_ID });
}

async function boundedJson(response, maxBytes, readTimeoutMs = 0) {
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) fail('INVALID_AUTHORITY_RESPONSE');
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
  if (!common(result) || !exact(result, resultKeys[method])) fail('INVALID_AUTHORITY_RESPONSE');
  if (method === 'context' && !context(result, params.p_agency_id)) fail('INVALID_AUTHORITY_RESPONSE');
  if (method === 'memberships' && (result.user_id !== config.base44UserId || result.user_email !== config.email
    || !Array.isArray(result.memberships) || result.memberships.length > 50
    || result.memberships.some(value => !context(value))
    || new Set(result.memberships.map(value => value.agency_id)).size !== result.memberships.length)) fail('INVALID_AUTHORITY_RESPONSE');
  if (['patients', 'patient'].includes(method) && !context(result.context, params.p_agency_id)) fail('INVALID_AUTHORITY_RESPONSE');
  if (method === 'patients' && (!Array.isArray(result.items) || result.items.length > (params.p_limit ?? 50)
    || result.items.some(value => !patient(value)) || new Set(result.items.map(value => value.id)).size !== result.items.length
    || (result.next_cursor !== null && result.next_cursor !== result.items.at(-1)?.id))) fail('INVALID_AUTHORITY_RESPONSE');
  if (method === 'patient' && (!patient(result.patient) || result.patient.id !== params.p_patient_id)) fail('INVALID_AUTHORITY_RESPONSE');
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
  async function request(path, { lease, bearer, body, noBody = false, method = 'POST', cleanup = false, receivedGrant }) {
    if (!cleanup) current(lease);
    const controller = new AbortController();
    if (!cleanup) pending.add(controller);
    let rejectCleanupDeadline;
    const cleanupDeadline = cleanup ? new Promise((_, reject) => { rejectCleanupDeadline = reject; }) : null;
    const timeout = setTimeout(() => {
      controller.abort(); rejectCleanupDeadline?.(new AuthorityClientError('AUTHORITY_REQUEST_ABORTED'));
    }, timeoutMs);
    const live = () => { if (!cleanup) current(lease); if (controller.signal.aborted) fail('AUTHORITY_REQUEST_ABORTED'); };
    try {
      const fetching = fetchImpl(config.projectUrl + path, {
        method, redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
        signal: controller.signal,
        headers: { apikey: config.publishableKey, 'Content-Type': 'application/json', Accept: 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const response = await (cleanupDeadline ? Promise.race([fetching, cleanupDeadline]) : fetching);
      // A late grant may already have created a native session. Inspect a
      // successfully delivered bounded grant only for exact-session cleanup;
      // the epoch still fences every authentication result and RPC admission.
      if (!receivedGrant) live();
      if (!response.ok) {
        if (cleanup) void response.body?.cancel().catch(() => {});
        else await response.body?.cancel().catch(() => {});
        fail(response.status === 401 ? 'AUTHENTICATION_FAILED' : response.status === 403 ? 'AUTHORITY_DENIED' : 'AUTHORITY_REQUEST_FAILED', response.status);
      }
      if (noBody) {
        if (cleanup) void response.body?.cancel().catch(() => {});
        else await response.body?.cancel().catch(() => {});
        live(); return null;
      }
      const result = await boundedJson(response, 1024 * 1024, receivedGrant ? timeoutMs : 0);
      if (receivedGrant) receivedGrant(result);
      live();
      return result;
    } catch (error) {
      const aborted = controller.signal.aborted;
      controller.abort();
      if (!cleanup) current(lease);
      if (error instanceof AuthorityClientError) throw error;
      fail(aborted ? 'AUTHORITY_REQUEST_ABORTED' : 'AUTHORITY_NETWORK_FAILED');
    } finally { clearTimeout(timeout); pending.delete(controller); }
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
          receivedGrant: value => {
            if (validGrant(value)) {
              candidate = value.access_token;
              if (!knownSessions.has(candidate)) knownSessions.set(candidate, { revoking: null });
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
      const result = await request(`/rest/v1/rpc/pennsync_staging_${method}`, { lease, bearer: token, body: params });
      current(lease);
      return validateResult(result, method, params, config);
    },
    async signOut() {
      invalidate();
      await revokeAllKnown();
    },
    invalidate,
  });
}
