// Independent tenant authority for the ported business API.
//
// This service never holds a credential that can read past its caller. The
// caller's own Supabase Auth access token is replayed to the owned authority
// store's fixed context RPC; the API gateway verifies the signature and the
// database authorizes the read. The publishable key identifies the project,
// not the caller.
//
// Deliberately self-contained: each Railway service builds from its own
// directory, so this cannot import the external runtime's copy. `parity.test.mjs`
// asserts the two modules agree on every security-relevant constant.
import { ID, UUID, fail, isObject, readJson } from './contracts.mjs';

export const AUTHORITY_CONTRACT = 'cm.pennsync.authority.staging.v1';
/** Fixed RPC name. No caller, request or environment value selects it. */
export const AUTHORITY_RPC = 'pennsync_staging_context';
export const AUTHORITY_TARGETS = Object.freeze([
  'https://xxtyweswohkvgkprimwa.supabase.co',
  'http://127.0.0.1:54321',
]);
export const TENANT_ROLES = Object.freeze(['agency_admin', 'manager', 'clinician', 'office_staff', 'social_worker', 'spiritual_care']);
export const CONTEXT_KEYS = Object.freeze(['contract', 'app_id', 'auth_user_id', 'staging', 'synthetic',
  'user_id', 'user_email', 'identity_version', 'is_platform_owner', 'agency_id', 'membership_id',
  'membership_key', 'membership_version', 'membership_status', 'tenant_role', 'agency']);

const exact = (value, keys) => isObject(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const version = value => Number.isSafeInteger(value) && value >= 1;

export const validAuthorityKey = value =>
  typeof value === 'string' && /^sb_publishable_[A-Za-z0-9_-]{10,200}$/.test(value);
export const validAuthorityTarget = value =>
  typeof value === 'string' && AUTHORITY_TARGETS.includes(value);

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
    // The owned store issues no platform-owner context, so no handler can be
    // reached with a global scope through this path.
    && value.is_platform_owner === false
    && typeof value.agency_id === 'string' && ID.test(value.agency_id) && value.agency_id === agencyId
    && typeof value.membership_id === 'string' && ID.test(value.membership_id)
    && value.membership_key === `${value.agency_id}:${value.user_id}`
    && version(value.membership_version) && value.membership_status === 'active'
    && TENANT_ROLES.includes(value.tenant_role)
    && exact(value.agency, ['id', 'name', 'status']) && value.agency.id === value.agency_id
    && ['active', 'trial'].includes(value.agency.status)
    && typeof value.agency.name === 'string' && value.agency.name.length <= 120;
}

/** Resolve the caller's current authority. Every handler runs behind this. */
export async function resolveAuthority(config, req, agencyId, fetcher = fetch) {
  if (!validAuthorityTarget(config.authorityUrl) || !validAuthorityKey(config.authorityKey)) {
    fail(503, 'AUTHORITY_NOT_CONFIGURED');
  }
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
  // A frozen projection: a handler cannot widen its own caller's authority.
  return Object.freeze({
    authUserId: context.auth_user_id,
    userId: context.user_id,
    userEmail: context.user_email,
    agencyId: context.agency_id,
    membershipId: context.membership_id,
    membershipVersion: context.membership_version,
    tenantRole: context.tenant_role,
  });
}
