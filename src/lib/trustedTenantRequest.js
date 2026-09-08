import {
  getTenantAuthorityKey,
  getTrustedTenantContext,
} from '@/lib/roles';

const MAX_IDENTIFIER_LENGTH = 200;

function exactIdentifier(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_IDENTIFIER_LENGTH
    && value.trim() === value
    && !value.startsWith('$');
}

/**
 * Convert AuthContext's already-bound service-owned authority into an explicit
 * getMyTenantContext request. A caller-supplied agency may only narrow to the
 * currently selected agency; it can never switch authority inside a data hook.
 */
export function trustedTenantRequest(user, requestedAgencyId = null) {
  const context = getTrustedTenantContext(user);
  const authorityKey = getTenantAuthorityKey(user);
  if (!context || !authorityKey || !exactIdentifier(context.agency_id)) return null;
  if (requestedAgencyId !== null && requestedAgencyId !== context.agency_id) return null;

  const options = { agencyId: context.agency_id };
  if (context.membership_id !== null) {
    if (
      !exactIdentifier(context.membership_id)
      || !Number.isSafeInteger(context.membership_version)
      || context.membership_version < 1
    ) return null;
    options.expectedMembershipId = context.membership_id;
    options.expectedMembershipVersion = context.membership_version;
  }

  return Object.freeze({
    authorityKey,
    userId: context.user_id,
    userEmail: context.user_email,
    agencyId: context.agency_id,
    membershipId: context.membership_id,
    membershipVersion: context.membership_version,
    tenantRole: context.tenant_role,
    isPlatformOwner: context.is_platform_owner,
    options: Object.freeze(options),
  });
}

/** Exact comparison after the broker revalidates the selected authority. */
export function tenantContextMatchesRequest(context, request) {
  return !!context
    && !!request
    && context.user_id === request.userId
    && context.user_email === request.userEmail
    && context.agency_id === request.agencyId
    && context.membership_id === request.membershipId
    && context.membership_version === request.membershipVersion
    && context.tenant_role === request.tenantRole
    && context.is_platform_owner === request.isPlatformOwner;
}
