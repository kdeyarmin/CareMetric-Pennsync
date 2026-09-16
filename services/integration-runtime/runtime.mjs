import { randomUUID } from 'node:crypto';
import { IntegrationError, fail, ID, UUID, OPERATIONS, hash, readJson, seal, stable, unseal } from './safety.mjs';

const DEFAULT_APP = '694ec16e72e01b60d22f7cbf';
const ALLOWED_APPS = new Set([DEFAULT_APP, '6a9881683dc68a0bd54f1ef7']);
export const BUCKET = 'pennsync-external-integrations';
export function loadConfig(env = process.env) {
  const appId = env.INTEGRATIONS_APP_ID || DEFAULT_APP;
  if (!ALLOWED_APPS.has(appId)) throw new Error('INVALID_APP_BINDING');
  const operations = (env.INTEGRATIONS_ALLOWED_OPERATIONS || '').split(',').filter(Boolean);
  if (operations.some(operation => !OPERATIONS.includes(operation)) || new Set(operations).size !== operations.length) throw new Error('INVALID_OPERATION_CONFIGURATION');
  const origins = (env.INTEGRATIONS_ALLOWED_ORIGINS || 'https://caremetricai.base44.app,https://app.caremetricai.com').split(',');
  if (origins.some(origin => { try { const u = new URL(origin); return u.protocol !== 'https:' || u.origin !== origin; } catch { return true; } })) throw new Error('INVALID_CORS_ORIGIN');
  const supabaseUrl = env.SUPABASE_URL || '';
  if (supabaseUrl && supabaseUrl !== 'https://xsqobvvreaovwibxwyvv.supabase.co') throw new Error('INVALID_STORAGE_BINDING');
  const encryptionKey = env.INTEGRATIONS_ENCRYPTION_KEY || '';
  const hashKey = env.INTEGRATIONS_HASH_KEY || '';
  const configured = !!supabaseUrl && !!env.SUPABASE_SERVICE_ROLE_KEY
    && /^[a-f0-9]{64}$/.test(encryptionKey) && /^[a-f0-9]{64}$/.test(hashKey) && encryptionKey !== hashKey;
  return {
    appId, operations, origins, supabaseUrl, encryptionKey, hashKey, configured,
    released: env.INTEGRATIONS_RELEASE === 'enabled-v1', dailyLimit: 100,
    supabaseKey: env.SUPABASE_SERVICE_ROLE_KEY || '', anthropicKey: env.ANTHROPIC_API_KEY || '',
    model: env.INTEGRATIONS_AI_MODEL || 'claude-sonnet-4-6', sendgridKey: env.SENDGRID_API_KEY || '',
    fromEmail: env.NOTIFICATION_FROM_EMAIL || '',
    revision: /^[0-9a-f]{40}$/.test(env.RAILWAY_GIT_COMMIT_SHA || '') ? env.RAILWAY_GIT_COMMIT_SHA : 'unbound',
  };
}
export function publicReadiness(config) {
  const missingProviders = config.operations.filter(operation => {
    if (['InvokeLLM', 'ExtractDataFromUploadedFile'].includes(operation)) return !config.anthropicKey || !config.model;
    if (operation === 'SendEmail') return !config.sendgridKey || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(config.fromEmail);
    return false;
  });
  return { ready: config.configured && config.released && config.operations.length > 0 && !missingProviders.length,
    released: config.released, configured: config.configured, operations: config.operations, missingProviders,
    base44ExecutionDependency: true, trafficCutoverVerified: false, revision: config.revision };
}
export async function authorize(config, req, agencyId, fetcher = fetch) {
  if (!ID.test(agencyId || '')) fail(400, 'AGENCY_REQUIRED');
  const bearer = req.headers.get('authorization');
  if (!bearer || !/^Bearer [A-Za-z0-9._~-]{20,16000}$/.test(bearer)) fail(401, 'AUTHENTICATION_REQUIRED');
  // Explicit remaining Base44 execution dependency, not a zero-credit claim.
  const response = await fetcher(`https://base44.app/api/apps/${config.appId}/functions/getMyTenantContext`, {
    method: 'POST', headers: { Authorization: bearer, 'Content-Type': 'application/json', 'X-App-Id': config.appId },
    body: JSON.stringify({ agency_id: agencyId }), redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  if ([401, 403].includes(response.status)) fail(response.status, 'AUTHENTICATION_REJECTED');
  if (!response.ok) fail(503, 'AUTHORITY_UNAVAILABLE');
  const result = await readJson(response, 65536);
  const c = result?.tenant_context;
  if (!c || !ID.test(c.user_id || '') || typeof c.user_email !== 'string'
    || c.user_email.length > 320 || c.user_email !== c.user_email.trim().toLowerCase()
    || !/^[^\s@]+@[^\s@]+$/.test(c.user_email) || c.agency_id !== agencyId || c.agency?.id !== agencyId
    || !['active', 'trial'].includes(c.agency?.status)) fail(403, 'TENANT_AUTHORITY_INVALID');
  const owner = c.is_platform_owner === true && c.tenant_role === 'platform_owner'
    && c.membership_id === null && c.membership_version === null && c.membership_status === null && c.membership_key === null;
  const member = c.is_platform_owner === false && c.membership_status === 'active'
    && ID.test(c.membership_id || '') && c.membership_key === `${agencyId}:${c.user_id}`
    && Number.isSafeInteger(c.membership_version) && c.membership_version > 0
    && ['agency_admin', 'manager', 'clinician', 'office_staff', 'social_worker', 'spiritual_care'].includes(c.tenant_role);
  if (!owner && !member) fail(403, 'TENANT_AUTHORITY_INVALID');
  return {
    subject: hash(config.hashKey, [config.appId, agencyId, c.user_id]),
    snapshot: stable([c.user_id, c.user_email, agencyId, c.tenant_role, c.membership_id, c.membership_version, c.is_platform_owner, c.agency.status]),
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
export async function performDurable({ config, req, agencyId, operation, params, requestId, provider, store, authority }) {
  if (!ID.test(requestId || '')) fail(400, 'IDEMPOTENCY_KEY_REQUIRED');
  const before = await authority(config, req, agencyId);
  if (operation === 'SendEmail' && !before.canEmail) fail(403, 'EMAIL_ROLE_REQUIRED');
  const claim = randomUUID();
  const reservation = await store.reserve({ p_app_id: config.appId, p_subject: before.subject,
    p_operation: operation, p_request_id: requestId, p_payload_hash: hash(config.hashKey, params), p_claim: claim, p_daily_limit: config.dailyLimit });
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
    // Supabase links expire in 60s. Start the local lease before the operation,
    // never treat the 24h encrypted receipt lifetime as the link lifetime.
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
