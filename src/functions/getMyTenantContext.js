import { base44 } from '@/api/base44Client';

const MAX_IDENTIFIER_LENGTH = 200;
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
    && ENABLED_AGENCY_STATUSES.has(agency.status);
}

function validTenantContext(context, requestedAgencyId) {
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
    && validAgency(context.agency, context.agency_id);
}

/**
 * Resolve an exact, server-owned tenant identity. The membership version is
 * part of the returned authority and must be included in any PHI query key.
 */
export async function getMyTenantContext(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('Tenant context options must be an object');
  }
  if (Object.keys(options).some((key) => key !== 'agencyId')) {
    throw new Error('Tenant context contains unsupported options');
  }
  const requestedAgencyId = options.agencyId === undefined
    ? null
    : options.agencyId;
  if (requestedAgencyId !== null && !exactIdentifier(requestedAgencyId)) {
    throw new Error('agencyId is invalid');
  }
  const payload = requestedAgencyId === null ? {} : { agency_id: requestedAgencyId };
  const response = await base44.functions.invoke('getMyTenantContext', payload);
  const result = response?.data ?? response;
  if (
    !exactKeys(result, ['tenant_context'])
    || !validTenantContext(result.tenant_context, requestedAgencyId)
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
