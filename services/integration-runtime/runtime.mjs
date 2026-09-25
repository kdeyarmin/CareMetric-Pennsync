import { randomUUID } from 'node:crypto';
import { BROWSER_CONTRACT, bindingFromContext } from './caller-binding.mjs';
import { AUTHORITY_APP_PINS, AUTHORITY_MODES, independentAuthorize, validAuthorityKey, validAuthorityTarget } from './authority.mjs';
import { BROWSER_FORBIDDEN_OPERATIONS, IntegrationError, fail, ID, UUID, OPERATIONS, hash, readJson, seal, stable, unseal } from './safety.mjs';

const DEFAULT_APP = '694ec16e72e01b60d22f7cbf';
const ALLOWED_APPS = new Set([DEFAULT_APP, '6a9881683dc68a0bd54f1ef7']);
export const BUCKET = 'pennsync-external-integrations';
export function loadConfig(env = process.env) {
  // Kept separate from the resolved id so independent mode can tell a binding an
  // operator chose from one that merely defaulted. Deliberately untrimmed: a value
  // with stray whitespace still fails ALLOWED_APPS as it does today.
  const explicitApp = env.INTEGRATIONS_APP_ID || '';
  const appId = explicitApp || DEFAULT_APP;
  if (!ALLOWED_APPS.has(appId)) throw new Error('INVALID_APP_BINDING');
  const operations = (env.INTEGRATIONS_ALLOWED_OPERATIONS || '').split(',').filter(Boolean);
  if (operations.some(operation => !OPERATIONS.includes(operation)) || new Set(operations).size !== operations.length) throw new Error('INVALID_OPERATION_CONFIGURATION');
  const browserOperations = (env.INTEGRATIONS_BROWSER_OPERATIONS || '').split(',').filter(Boolean);
  if (browserOperations.some(operation => !operations.includes(operation))
    || new Set(browserOperations).size !== browserOperations.length) throw new Error('INVALID_BROWSER_OPERATION_CONFIGURATION');
  // Its own code, not the subset one: the subset check passes for a forbidden
  // operation the moment the service list carries it, which is how this became
  // reachable at all. A distinct name says which rule refused the boot.
  if (browserOperations.some(operation => BROWSER_FORBIDDEN_OPERATIONS.includes(operation))) throw new Error('BROWSER_FORBIDDEN_OPERATION');
  const origins = (env.INTEGRATIONS_ALLOWED_ORIGINS || 'https://caremetricai.base44.app,https://app.caremetricai.com').split(',');
  if (origins.some(origin => { try { const u = new URL(origin); return u.protocol !== 'https:' || u.origin !== origin; } catch { return true; } })) throw new Error('INVALID_CORS_ORIGIN');
  const supabaseUrl = env.SUPABASE_URL || '';
  if (supabaseUrl && supabaseUrl !== 'https://xsqobvvreaovwibxwyvv.supabase.co') throw new Error('INVALID_STORAGE_BINDING');
  const encryptionKey = env.INTEGRATIONS_ENCRYPTION_KEY || '';
  const hashKey = env.INTEGRATIONS_HASH_KEY || '';
  // The retained Base44 authority callback stays the default. Independence is
  // an explicit operator selection with its own reviewed target and key, so a
  // missing or malformed setting can never silently change who authorizes.
  const authorityMode = env.INTEGRATIONS_AUTHORITY_MODE || 'base44';
  if (!AUTHORITY_MODES.includes(authorityMode)) throw new Error('INVALID_AUTHORITY_MODE');
  const authorityUrl = env.INTEGRATIONS_AUTHORITY_URL || '';
  const authorityKey = env.INTEGRATIONS_AUTHORITY_PUBLISHABLE_KEY || '';
  if (authorityUrl && !validAuthorityTarget(authorityUrl)) throw new Error('INVALID_AUTHORITY_TARGET');
  // A secret or service-role key here would read past the caller's authority.
  if (authorityKey && !validAuthorityKey(authorityKey)) throw new Error('INVALID_AUTHORITY_KEY');
  const authorityConfigured = validAuthorityTarget(authorityUrl) && validAuthorityKey(authorityKey);
  if (authorityMode === 'independent' && !authorityConfigured) throw new Error('INCOMPLETE_AUTHORITY_CONFIGURATION');
  // In independent mode the app id stops being a label and becomes the request's
  // key into the owned store: `actor()` admits exactly the one app its deployment
  // was pinned to, and the store's pin defaults to STAGING while this default is
  // PRODUCTION. A defaulted binding is therefore the one combination that reports
  // ready and is refused by every authorization call. Make the operator say which
  // app this runtime serves rather than inherit a default from the other path.
  if (authorityMode === 'independent' && !explicitApp) throw new Error('IMPLICIT_APP_BINDING');
  // Stating a binding is not the same as stating the RIGHT one, and the wrong
  // one fails exactly as invisibly as the defaulted one did. A target with no
  // declared pin refuses rather than defaulting, so adding one to
  // AUTHORITY_TARGETS forces the decision instead of inheriting silence.
  if (authorityMode === 'independent') {
    if (!Object.hasOwn(AUTHORITY_APP_PINS, authorityUrl)) throw new Error('UNPINNED_AUTHORITY_TARGET');
    const pin = AUTHORITY_APP_PINS[authorityUrl];
    if (pin !== null && appId !== pin) throw new Error('APP_BINDING_MISMATCH');
  }
  const configured = !!supabaseUrl && !!env.SUPABASE_SERVICE_ROLE_KEY
    && /^[a-f0-9]{64}$/.test(encryptionKey) && /^[a-f0-9]{64}$/.test(hashKey) && encryptionKey !== hashKey
    && (authorityMode !== 'independent' || authorityConfigured);
  return {
    appId, appStated: !!explicitApp,
    operations, browserOperations, browserReleased: env.INTEGRATIONS_BROWSER_RELEASE === 'enabled-v2',
    origins, supabaseUrl, encryptionKey, hashKey, configured,
    authorityMode, authorityUrl, authorityKey, authorityConfigured,
    released: env.INTEGRATIONS_RELEASE === 'enabled-v1', dailyLimit: 100,
    supabaseKey: env.SUPABASE_SERVICE_ROLE_KEY || '', anthropicKey: env.ANTHROPIC_API_KEY || '',
    model: env.INTEGRATIONS_AI_MODEL || 'claude-sonnet-4-6', sendgridKey: env.SENDGRID_API_KEY || '',
    fromEmail: env.NOTIFICATION_FROM_EMAIL || '',
    revision: /^[0-9a-f]{40}$/.test(env.RAILWAY_GIT_COMMIT_SHA || '') ? env.RAILWAY_GIT_COMMIT_SHA : 'unbound',
  };
}
export function validSender(value) {
  return typeof value === 'string' && value.length <= 320 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
}
/** Single source of truth for the disclosed dependency, used by readiness and every response. */
export const hasBase44ExecutionDependency = config =>
  !(config.authorityMode === 'independent' && config.authorityConfigured === true);
export function publicReadiness(config) {
  const missingProviders = config.operations.filter(operation => {
    if (['InvokeLLM', 'ExtractDataFromUploadedFile'].includes(operation)) return !config.anthropicKey || !config.model;
    if (operation === 'SendEmail') return !config.sendgridKey || !validSender(config.fromEmail);
    return false;
  });
  const independent = !hasBase44ExecutionDependency(config);
  return { ready: config.configured && config.released && config.operations.length > 0 && !missingProviders.length,
    released: config.released, configured: config.configured, operations: config.operations, missingProviders,
    // Derived from the selected authority, never asserted. An independent
    // reading means no Base44 call remains in this path; it is not evidence
    // that production traffic moved.
    authorityMode: independent ? 'independent' : 'base44',
    base44ExecutionDependency: !independent, trafficCutoverVerified: false, revision: config.revision,
    // Which app this deployment keys into the owned store with, and whether the
    // operator chose it. `pennsync-api` publishes the same pair for the same
    // reason: every other field here is a shape question, so a binding that is
    // merely WRONG passes all of them. Neither id is a secret; both are
    // literals in this file.
    appId: config.appId, appStated: config.appStated === true,
    browserContract: BROWSER_CONTRACT, browserRevisionBound: /^[a-f0-9]{40}$/.test(config.revision || ''),
    browserReleased: config.browserReleased === true, browserOperations: config.browserOperations || [],
    browserReady: config.configured && config.released && config.browserReleased === true
      && (config.browserOperations?.length || 0) > 0 && !missingProviders.length
      && /^[a-f0-9]{40}$/.test(config.revision || '') };
}
export async function authorize(config, req, agencyId, fetcher = fetch) {
  // Exactly one authority path runs. There is no fallback between them: an
  // independent failure never retries through Base44, and the reverse cannot
  // happen either.
  if (config.authorityMode === 'independent') return independentAuthorize(config, req, agencyId, fetcher);
  if (agencyId !== null && (typeof agencyId !== 'string' || !ID.test(agencyId))) fail(400, 'AGENCY_REQUIRED');
  const bearer = req.headers.get('authorization');
  if (!bearer || !/^Bearer [A-Za-z0-9._~-]{20,16000}$/.test(bearer)) fail(401, 'AUTHENTICATION_REQUIRED');
  // Explicit remaining Base44 execution dependency, not a zero-credit claim.
  const response = await fetcher(`https://base44.app/api/apps/${config.appId}/functions/getMyTenantContext`, {
    method: 'POST', headers: { Authorization: bearer, 'Content-Type': 'application/json', 'X-App-Id': config.appId },
    body: JSON.stringify(agencyId === null ? {} : { agency_id: agencyId }), redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  if ([401, 403].includes(response.status)) fail(response.status, 'AUTHENTICATION_REJECTED');
  if (!response.ok || response.redirected) fail(503, 'AUTHORITY_UNAVAILABLE');
  const result = await readJson(response, 65536);
  const c = result?.tenant_context;
  if (!c || typeof c.user_id !== 'string' || !ID.test(c.user_id) || typeof c.user_email !== 'string'
    || c.user_email.length > 320 || c.user_email !== c.user_email.trim().toLowerCase()
    || !/^[^\s@]+@[^\s@]+$/.test(c.user_email) || c.agency_id !== agencyId) fail(403, 'TENANT_AUTHORITY_INVALID');
  const scopedAgency = agencyId !== null && c.agency?.id === agencyId && ['active', 'trial'].includes(c.agency?.status);
  const owner = c.is_platform_owner === true && c.tenant_role === 'platform_owner'
    && c.membership_id === null && c.membership_version === null && c.membership_status === null && c.membership_key === null
    && (agencyId === null ? c.agency === null : scopedAgency);
  const member = scopedAgency && c.is_platform_owner === false && c.membership_status === 'active'
    && typeof c.membership_id === 'string' && ID.test(c.membership_id) && c.membership_key === `${agencyId}:${c.user_id}`
    && Number.isSafeInteger(c.membership_version) && c.membership_version > 0
    && ['agency_admin', 'manager', 'clinician', 'office_staff', 'social_worker', 'spiritual_care'].includes(c.tenant_role);
  if (!owner && !member) fail(403, 'TENANT_AUTHORITY_INVALID');
  return {
    subject: hash(config.hashKey, [config.appId, agencyId, c.user_id]),
    snapshot: stable([c.user_id, c.user_email, agencyId, c.tenant_role, c.membership_id, c.membership_version, c.is_platform_owner, c.agency?.status ?? null]),
    // v1 preserves its existing explicitly scoped owner operation. The v2
    // browser has exactly the global owner context established by AuthContext.
    binding: owner && agencyId !== null ? null : bindingFromContext(c),
    canEmail: owner || ['agency_admin', 'manager'].includes(c.tenant_role),
  };
}
export function createStore(config, fetcher = fetch) {
  const headers = { apikey: config.supabaseKey, Authorization: `Bearer ${config.supabaseKey}`, 'Content-Type': 'application/json' };
  async function rpc(name, body) {
    const response = await fetcher(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
      method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) fail(503, 'INTEGRATION_STATE_UNAVAILABLE');
    return readJson(response, 24 * 1024 * 1024);
  }
  return {
    reserve: body => rpc('cm_integration_reserve', body), finish: body => rpc('cm_integration_finish', body),
    fileGet: body => rpc('cm_integration_file_get', body), fileRecord: body => rpc('cm_integration_file_record', body),
  };
}
function usableResult(operation, result) {
  if (operation === 'CreateFileSignedUrl' && (!Number.isSafeInteger(result?.expires_at_ms) || result.expires_at_ms <= Date.now())) {
    fail(409, 'SIGNED_URL_EXPIRED_REQUEST_NEW_LINK');
  }
  return result;
}
export async function performDurable({ config, req, agencyId, operation, params, requestId, provider, store, authority, requestBinding = null, admit = () => () => {} }) {
  if (typeof requestId !== 'string' || !ID.test(requestId)) fail(400, 'IDEMPOTENCY_KEY_REQUIRED');
  const before = await authority(config, req, agencyId);
  if (operation === 'SendEmail' && !before.canEmail) fail(403, 'EMAIL_ROLE_REQUIRED');
  const release = admit(before);
  try { return await performOwned({ config, req, agencyId, operation, params, requestId, provider, store, authority, requestBinding, before }); }
  finally { release(); }
}
async function performOwned({ config, req, agencyId, operation, params, requestId, provider, store, authority, requestBinding, before }) {
  const claim = randomUUID();
  const reservation = await store.reserve({ p_app_id: config.appId, p_subject: before.subject,
    p_operation: operation, p_request_id: requestId,
    // v2 and v1 receipts cannot collide; v2 binds the exact reviewed service
    // revision and independently verified caller expectation to durable state.
    p_payload_hash: hash(config.hashKey, requestBinding === null ? params : { requestBinding, params }), p_claim: claim, p_daily_limit: config.dailyLimit });
  if (!reservation || !['owned', 'completed', 'conflict', 'pending', 'quota', 'uncertain', 'failed'].includes(reservation.outcome)) fail(503, 'INVALID_RESERVATION');
  if (reservation.outcome === 'quota') fail(429, 'DAILY_OPERATION_LIMIT');
  if (!['owned', 'completed'].includes(reservation.outcome)) fail(409, 'OPERATION_RECONCILIATION_REQUIRED');
  if (typeof reservation.id !== 'string' || !UUID.test(reservation.id)) fail(503, 'INVALID_RESERVATION');
  let started = false;
  try {
    const check = await authority(config, req, agencyId);
    if (check.snapshot !== before.snapshot || check.subject !== before.subject) fail(409, 'AUTHORITY_CHANGED');
    if (reservation.outcome === 'completed') return usableResult(operation, unseal(config.encryptionKey, `${config.appId}:${before.subject}:${reservation.id}`, reservation.result));
    started = true;
    let result = await provider(operation, params, { subject: before.subject, jobId: reservation.id });
    result = usableResult(operation, result);
    const encrypted = seal(config.encryptionKey, `${config.appId}:${before.subject}:${reservation.id}`, result);
    const saved = await store.finish({ p_id: reservation.id, p_claim: claim, p_state: 'completed', p_result: encrypted });
    if (saved !== true) fail(409, 'RESULT_RECONCILIATION_REQUIRED');
    const after = await authority(config, req, agencyId);
    if (after.snapshot !== before.snapshot || after.subject !== before.subject) fail(409, 'AUTHORITY_CHANGED');
    return usableResult(operation, result);
  } catch (error) {
    if (reservation.outcome === 'owned') {
      await store.finish({ p_id: reservation.id, p_claim: claim, p_state: started ? 'uncertain' : 'failed', p_result: null }).catch(() => {});
    }
    if (error instanceof IntegrationError) throw error;
    fail(503, started ? 'OPERATION_OUTCOME_UNCERTAIN' : 'AUTHORITY_UNAVAILABLE');
  }
}
