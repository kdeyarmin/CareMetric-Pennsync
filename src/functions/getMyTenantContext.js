import { base44, tenantAuthorityClient } from '@/api/base44Client';

const MAX_IDENTIFIER_LENGTH = 200;
const MAX_AGENCY_NAME_LENGTH = 200;
const TENANT_ROLES = new Set([
  'agency_admin',
  'manager',
  'clinician',
  'office_staff',
  'social_worker',
  'spiritual_care',
]);
const ENABLED_AGENCY_STATUSES = new Set(['active', 'trial']);
const CONTEXT_KEYS = [
  'user_id',
  'user_email',
  'membership_id',
  'membership_key',
  'membership_version',
  'agency_id',
  'tenant_role',
  'membership_status',
  'is_platform_owner',
  'agency',
];

function hasUnsafeAgencyName(value) {
  return [...value].some((character) => {
    const point = character.codePointAt(0);
    return point <= 0x1f
      || (point >= 0x7f && point <= 0x9f)
      || point === 0x061c
      || point === 0x200e
      || point === 0x200f
      || (point >= 0x202a && point <= 0x202e)
      || (point >= 0x2066 && point <= 0x2069);
  });
}

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
  if (
    !normalized
    || normalized.length > 320
    || !normalized.includes('@')
    || /\s/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function validAgency(agency, agencyId) {
  return exactKeys(agency, ['id', 'name', 'status'])
    && agency.id === agencyId
    && typeof agency.name === 'string'
    && agency.name.length > 0
    && agency.name.length <= MAX_AGENCY_NAME_LENGTH
    && agency.name.trim() === agency.name
    && !hasUnsafeAgencyName(agency.name)
    && ENABLED_AGENCY_STATUSES.has(agency.status);
}

function validTenantContext(context, requestedAgencyId, expectedMembership) {
  if (!exactKeys(context, CONTEXT_KEYS)) return false;
  const normalizedEmail = canonicalEmail(context.user_email);
  if (
    !exactIdentifier(context.user_id)
    || !normalizedEmail
    || context.user_email !== normalizedEmail
    || typeof context.is_platform_owner !== 'boolean'
    || (requestedAgencyId !== null && context.agency_id !== requestedAgencyId)
  ) {
    return false;
  }

  if (context.membership_id === null) {
    if (expectedMembership !== null) return false;
    if (requestedAgencyId === null && context.agency_id !== null) return false;
    const agencyIsValid = context.agency_id === null
      ? context.agency === null
      : exactIdentifier(context.agency_id) && validAgency(context.agency, context.agency_id);
    return context.membership_key === null
      && context.membership_version === null
      && context.tenant_role === 'platform_owner'
      && context.membership_status === null
      && context.is_platform_owner === true
      && agencyIsValid;
  }

  return exactIdentifier(context.membership_id)
    && exactIdentifier(context.agency_id)
    && context.membership_key === `${context.agency_id}:${context.user_id}`
    && Number.isSafeInteger(context.membership_version)
    && context.membership_version >= 1
    && TENANT_ROLES.has(context.tenant_role)
    && context.membership_status === 'active'
    && context.is_platform_owner === false
    && (
      expectedMembership === null
      || (
        context.membership_id === expectedMembership.id
        && context.membership_version === expectedMembership.version
      )
    )
    && validAgency(context.agency, context.agency_id);
}

/**
 * Resolve an exact, server-owned tenant identity. The membership version is
 * part of the returned authority and must be included in any PHI query key.
 */
async function resolveMyTenantContext(options, invokeTenantContext) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('Tenant context options must be an object');
  }
  const allowedKeys = new Set([
    'agencyId',
    'expectedMembershipId',
    'expectedMembershipVersion',
  ]);
  if (Object.keys(options).some((key) => !allowedKeys.has(key))) {
    throw new Error('Tenant context contains unsupported options');
  }
  const requestedAgencyId = options.agencyId === undefined
    ? null
    : options.agencyId;
  if (requestedAgencyId !== null && !exactIdentifier(requestedAgencyId)) {
    throw new Error('agencyId is invalid');
  }
  const hasExpectedId = Object.hasOwn(options, 'expectedMembershipId');
  const hasExpectedVersion = Object.hasOwn(options, 'expectedMembershipVersion');
  if (hasExpectedId !== hasExpectedVersion) {
    throw new Error('Expected membership id and version must be provided together');
  }
  if ((hasExpectedId || hasExpectedVersion) && requestedAgencyId === null) {
    throw new Error('agencyId is required for an expected membership');
  }
  let expectedMembership = null;
  if (hasExpectedId && hasExpectedVersion) {
    if (
      !exactIdentifier(options.expectedMembershipId)
      || !Number.isSafeInteger(options.expectedMembershipVersion)
      || options.expectedMembershipVersion < 1
    ) {
      throw new Error('Expected membership identity is invalid');
    }
    expectedMembership = {
      id: options.expectedMembershipId,
      version: options.expectedMembershipVersion,
    };
  }
  const payload = requestedAgencyId === null ? {} : { agency_id: requestedAgencyId };
  if (expectedMembership) {
    payload.expected_membership_id = expectedMembership.id;
    payload.expected_membership_version = expectedMembership.version;
  }
  const response = await invokeTenantContext(payload);
  const result = response?.data ?? response;
  if (
    !exactKeys(result, ['tenant_context'])
    || !validTenantContext(result.tenant_context, requestedAgencyId, expectedMembership)
  ) {
    throw new Error(result?.error || 'Tenant context failed integrity validation');
  }
  return {
    tenant_context: {
      ...result.tenant_context,
      agency: result.tenant_context.agency
        ? { ...result.tenant_context.agency }
        : null,
    },
  };
}

/**
 * Revalidate authority from inside an already-open protected realm. This path
 * must remain behind the SDK membrane so a retained hook cannot call the raw
 * authenticated transport after the realm has closed.
 */
export function getMyTenantContext(options = {}) {
  return resolveMyTenantContext(
    options,
    (payload) => base44.functions.invoke('getMyTenantContext', payload),
  );
}

/**
 * AuthContext-only bootstrap seam used before a tenant realm can be opened.
 * Generation checks and a full-document terminal policy fence this call.
 */
export function bootstrapMyTenantContext(options = {}) {
  return resolveMyTenantContext(
    options,
    (payload) => tenantAuthorityClient.getMyTenantContext(payload),
  );
}
