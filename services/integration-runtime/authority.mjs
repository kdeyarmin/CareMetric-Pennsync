// Independent tenant authority for the external runtime.
//
// This path contains no Base44 client, function name, origin, credential or
// fallback. The caller's own Supabase Auth access token is replayed to the
// owned authority store's context RPC; the API gateway verifies its signature
// and the database independently authorizes the read. A publishable key is the
// only key this module holds, and it confers no authority by itself.
//
// Selecting this mode is what makes `base44ExecutionDependency` false. It is
// not, by itself, evidence of a traffic cutover.
import { bindingFromContext } from './caller-binding.mjs';
import { ID, UUID, fail, hash, readJson, stable } from './safety.mjs';

export const AUTHORITY_CONTRACT = 'cm.pennsync.authority.staging.v1';
/** Fixed RPC name. No caller, request or environment value selects it. */
export const AUTHORITY_RPC = 'pennsync_staging_context';
export const AUTHORITY_MODES = Object.freeze(['base44', 'independent']);
/** The two reviewed targets, exactly as the strict client pins them. */
export const AUTHORITY_TARGETS = Object.freeze([
  'https://xxtyweswohkvgkprimwa.supabase.co',
  'http://127.0.0.1:54321',
]);
/**
 * Which app id each reviewed target's store is pinned to.
 *
 * In independent mode the app id is the request's key into the owned store:
 * `actor()` admits exactly the app its deployment was pinned to. So a STATED
 * but wrong id is refused by every authorization call while readiness — a set
 * of shape questions — still reads true. `IMPLICIT_APP_BINDING` already refuses
 * a DEFAULTED id; this is the half where an operator states the other reviewed
 * app instead.
 *
 * Declared per target and re-checked against AUTHORITY_TARGETS, never inferred.
 * "The production app id is always wrong" would stop being true the day a
 * production project joins the target list; what is actually true is that a
 * given store carries a given pin. `null` means the pin is not knowable here
 * and owes the reason beside it.
 */
export const AUTHORITY_APP_PINS = Object.freeze({
  // The owned staging store. One PennSync database exists and its pin is staging.
  'https://xxtyweswohkvgkprimwa.supabase.co': '6a9881683dc68a0bd54f1ef7',
  // A local stack is built from whichever migrations the developer applied, so
  // its pin is not a property of this file. Unconstrained, deliberately.
  'http://127.0.0.1:54321': null,
});

/**
 * Did the request reach the DATABASE, or did the gateway refuse the key?
 *
 * Both answer 401 and only the body separates them, measured against the real
 * cluster on 2026-09-25. A live key reaches PostgREST and PostgreSQL refuses
 * the anonymous caller:
 *   {"code":"42501","details":null,"hint":null,
 *    "message":"permission denied for function pennsync_staging_context"}
 * A revoked or malformed key never gets that far:
 *   {"message":"Invalid API key","hint":"Double check your API key."}
 *
 * So a SQLSTATE in the body is the evidence that the KEY was accepted, which
 * the status alone cannot carry. Read it alongside the refusal, never instead
 * of it: an anonymous SUCCESS would be the real defect and is still caught by
 * requiring the refusal too.
 */
export function authorityKeyAccepted(body) {
  return !!body && typeof body === 'object' && !Array.isArray(body)
    && typeof body.code === 'string' && /^[0-9A-Z]{5}$/.test(body.code);
}

const ROLES = Object.freeze(['agency_admin', 'manager', 'clinician', 'office_staff', 'social_worker', 'spiritual_care']);
const EMAIL_ROLES = Object.freeze(['agency_admin', 'manager']);
const CONTEXT_KEYS = Object.freeze(['contract', 'app_id', 'auth_user_id', 'staging', 'synthetic',
  'user_id', 'user_email', 'identity_version', 'is_platform_owner', 'agency_id', 'membership_id',
  'membership_key', 'membership_version', 'membership_status', 'tenant_role', 'agency']);

const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const version = value => Number.isSafeInteger(value) && value >= 1;

/**
 * A modern publishable key only. A secret or service-role key in this slot is
 * a configuration defect, not a usable fallback: it would let the runtime read
 * past the caller's own authority.
 */
export function validAuthorityKey(value) {
  return typeof value === 'string' && /^sb_publishable_[A-Za-z0-9_-]{10,200}$/.test(value);
}

export function validAuthorityTarget(value) {
  return typeof value === 'string' && AUTHORITY_TARGETS.includes(value);
}

/** Exact current-context contract. Any missing, extra or drifted field denies. */
export function validContext(value, { appId, agencyId }) {
  return exact(value, CONTEXT_KEYS)
    && value.contract === AUTHORITY_CONTRACT && value.app_id === appId
    && typeof value.auth_user_id === 'string' && UUID.test(value.auth_user_id)
    && value.staging === true && value.synthetic === true
    && typeof value.user_id === 'string' && ID.test(value.user_id)
    && typeof value.user_email === 'string' && value.user_email.length <= 320
    && value.user_email === value.user_email.trim().toLowerCase()
    && /^[^\s@]+@[^\s@]+$/.test(value.user_email)
    && version(value.identity_version)
    // The owned store issues no platform-owner context. A global or owner
    // scope therefore cannot be obtained through this path at all.
    && value.is_platform_owner === false
    && typeof value.agency_id === 'string' && ID.test(value.agency_id) && value.agency_id === agencyId
    && typeof value.membership_id === 'string' && ID.test(value.membership_id)
    && value.membership_key === `${value.agency_id}:${value.user_id}`
    && version(value.membership_version) && value.membership_status === 'active'
    && ROLES.includes(value.tenant_role)
    && exact(value.agency, ['id', 'name', 'status']) && value.agency.id === value.agency_id
    && ['active', 'trial'].includes(value.agency.status)
    && typeof value.agency.name === 'string' && value.agency.name.length <= 120;
}

/**
 * Resolve current authority from the owned store.
 *
 * The subject preimage carries this mode, so a receipt created under the
 * retained Base44 path can never be replayed as an independent one, and the
 * reverse is equally impossible.
 */
export async function independentAuthorize(config, req, agencyId, fetcher = fetch) {
  if (!validAuthorityTarget(config.authorityUrl) || !validAuthorityKey(config.authorityKey)) {
    fail(503, 'AUTHORITY_NOT_CONFIGURED');
  }
  // No owner or global scope exists in the owned store; fail closed instead of
  // silently widening an agency-less request into one.
  if (agencyId === null) fail(403, 'AGENCY_REQUIRED');
  if (typeof agencyId !== 'string' || !ID.test(agencyId)) fail(400, 'AGENCY_REQUIRED');
  const bearer = req.headers.get('authorization');
  if (!bearer || !/^Bearer [A-Za-z0-9._~-]{20,16000}$/.test(bearer)) fail(401, 'AUTHENTICATION_REQUIRED');
  let response;
  try {
    response = await fetcher(`${config.authorityUrl}/rest/v1/rpc/${AUTHORITY_RPC}`, {
      method: 'POST',
      headers: {
        apikey: config.authorityKey,
        Authorization: bearer,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ p_app_id: config.appId, p_agency_id: agencyId }),
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
  } catch { fail(503, 'AUTHORITY_UNAVAILABLE'); }
  if ([401, 403].includes(response.status)) fail(response.status, 'AUTHENTICATION_REJECTED');
  if (!response.ok || response.redirected) fail(503, 'AUTHORITY_UNAVAILABLE');
  const context = await readJson(response, 65536);
  if (!validContext(context, { appId: config.appId, agencyId })) fail(403, 'TENANT_AUTHORITY_INVALID');
  return {
    subject: hash(config.hashKey, ['independent', config.appId, agencyId, context.auth_user_id, context.user_id]),
    snapshot: stable(['independent', context.auth_user_id, context.user_id, context.user_email, context.identity_version,
      agencyId, context.tenant_role, context.membership_id, context.membership_version, context.agency.status]),
    binding: bindingFromContext(context),
    canEmail: EMAIL_ROLES.includes(context.tenant_role),
  };
}
