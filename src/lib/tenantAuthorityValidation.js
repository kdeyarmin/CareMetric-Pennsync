// Pure validation used by the startup authority handshake. No I/O or state.
const MAX_IDENTIFIER_LENGTH = 200;

function exactIdentifier(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_IDENTIFIER_LENGTH
    && value.trim() === value
    && !value.startsWith('$');
}

function canonicalEmail(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized
    && normalized.length <= 320
    && normalized.includes('@')
    && !/\s/.test(normalized)
    ? normalized
    : null;
}

function exactPrincipal(user) {
  const email = canonicalEmail(user?.email);
  if (!exactIdentifier(user?.id) || !email) return null;
  return { user_id: user.id, user_email: email };
}

function subjectMatchesPrincipal(subject, principal) {
  return !!subject
    && !!principal
    && subject.user_id === principal.user_id
    && subject.user_email === principal.user_email
    && typeof subject.is_platform_owner === 'boolean';
}

function exactAgencyMatch(left, right) {
  if (left === null || right === null) return left === right;
  return !!left
    && !!right
    && left.id === right.id
    && left.name === right.name
    && left.status === right.status;
}

function contextMatchesMembership(context, subject, membership) {
  return !!context
    && !!subject
    && !!membership
    && context.user_id === subject.user_id
    && context.user_email === subject.user_email
    && context.is_platform_owner === false
    && subject.is_platform_owner === false
    && context.membership_id === membership.membership_id
    && context.membership_key === membership.membership_key
    && context.membership_version === membership.membership_version
    && context.agency_id === membership.agency_id
    && context.tenant_role === membership.tenant_role
    && context.membership_status === membership.membership_status
    && exactAgencyMatch(context.agency, membership.agency);
}

function contextMatchesOwner(context, subject) {
  return !!context
    && !!subject
    && subject.is_platform_owner === true
    && context.user_id === subject.user_id
    && context.user_email === subject.user_email
    && context.is_platform_owner === true
    && context.membership_id === null
    && context.membership_key === null
    && context.membership_version === null
    && context.tenant_role === 'platform_owner'
    && context.membership_status === null
    && context.agency_id === null
    && context.agency === null;
}

function frozenMemberships(memberships) {
  return Object.freeze(memberships.map((membership) => Object.freeze({
    ...membership,
    agency: Object.freeze({ ...membership.agency }),
  })));
}

function responseStatus(error) {
  return error?.response?.status ?? error?.status ?? null;
}

function tenantError(type, message) {
  return Object.freeze({ type, message });
}

function authorityIntegrityError(message) {
  const error = new Error(message);
  error.isDefinitiveTenantAuthorityFailure = true;
  return error;
}

function browserRealmAuthorityError() {
  const error = authorityIntegrityError(
    'Workspace authority changed. Sign out and reopen the app before using another workspace.',
  );
  error.isBrowserRealmAuthorityChange = true;
  return error;
}

function isDefinitiveTenantAuthorityFailure(error) {
  const status = responseStatus(error);
  return error?.isDefinitiveTenantAuthorityFailure === true
    || status === 401
    || status === 403;
}

function authoritySnapshot(principal, context) {
  if (!principal || !context) return null;
  return JSON.stringify([
    principal.user_id,
    principal.user_email,
    context.agency_id,
    context.membership_id,
    context.membership_version,
    context.tenant_role,
    context.is_platform_owner,
    context.agency?.status ?? null,
  ]);
}

export {
  exactIdentifier, exactPrincipal, subjectMatchesPrincipal,
  contextMatchesMembership, contextMatchesOwner, frozenMemberships,
  responseStatus, tenantError, authorityIntegrityError,
  browserRealmAuthorityError, isDefinitiveTenantAuthorityFailure, authoritySnapshot,
};