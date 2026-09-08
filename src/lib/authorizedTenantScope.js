const IMMUTABLE_TENANT_SCOPE_FIELDS = Object.freeze([
  'user_id',
  'agency_id',
  'membership_id',
  'membership_version',
  'tenant_role',
]);

function exactIdentifier(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 200
    && value.trim() === value
    && !value.startsWith('$');
}

function validMembershipScope(scope) {
  if (!scope || scope.tenant_role === 'platform_owner') return false;
  return exactIdentifier(scope.user_id)
    && exactIdentifier(scope.agency_id)
    && exactIdentifier(scope.membership_id)
    && Number.isSafeInteger(scope.membership_version)
    && scope.membership_version >= 1
    && exactIdentifier(scope.tenant_role);
}

/**
 * Patient and Visit brokers reauthorize independently. A combined projection
 * is safe only when both fresh results belong to the exact same immutable
 * membership authority; two independent `isSuccess` flags are not sufficient
 * during an account, agency, or membership transition.
 */
export function sameAuthorizedTenantScope(left, right) {
  // Platform owners intentionally have null membership identity. Agency-wide
  // combined views stay unavailable until a reviewed owner -> agency selector
  // can supply an exact tenant-bound membership authority.
  if (!validMembershipScope(left) || !validMembershipScope(right)) return false;
  return IMMUTABLE_TENANT_SCOPE_FIELDS.every((field) => (
    left[field] === right[field]
  ));
}

export function authorizedTenantScopeKey(scope) {
  if (!validMembershipScope(scope)) return null;
  return JSON.stringify(IMMUTABLE_TENANT_SCOPE_FIELDS.map((field) => scope[field]));
}

export default sameAuthorizedTenantScope;
