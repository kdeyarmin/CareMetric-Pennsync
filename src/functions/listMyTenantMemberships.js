import { tenantAuthorityClient } from '@/api/base44Client';

const MAX_IDENTIFIER_LENGTH = 200;
const MAX_AGENCY_NAME_LENGTH = 200;
const MAX_ACTIVE_MEMBERSHIPS = 25;
const TENANT_ROLES = new Set([
  'agency_admin',
  'manager',
  'clinician',
  'office_staff',
  'social_worker',
  'spiritual_care',
]);
const ENABLED_AGENCY_STATUSES = new Set(['active', 'trial']);
const SUBJECT_KEYS = ['user_id', 'user_email', 'is_platform_owner'];
const MEMBERSHIP_KEYS = [
  'membership_id',
  'membership_key',
  'membership_version',
  'agency_id',
  'tenant_role',
  'membership_status',
  'agency',
];
const AGENCY_KEYS = ['id', 'name', 'status'];

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

function validSubject(subject) {
  if (!exactKeys(subject, SUBJECT_KEYS)) return false;
  const normalizedEmail = canonicalEmail(subject.user_email);
  return exactIdentifier(subject.user_id)
    && !!normalizedEmail
    && subject.user_email === normalizedEmail
    && typeof subject.is_platform_owner === 'boolean';
}

function validAgency(agency, agencyId) {
  return exactKeys(agency, AGENCY_KEYS)
    && agency.id === agencyId
    && typeof agency.name === 'string'
    && agency.name.length > 0
    && agency.name.length <= MAX_AGENCY_NAME_LENGTH
    && agency.name.trim() === agency.name
    && !hasUnsafeAgencyName(agency.name)
    && ENABLED_AGENCY_STATUSES.has(agency.status);
}

function validMembership(membership, subject) {
  return exactKeys(membership, MEMBERSHIP_KEYS)
    && exactIdentifier(membership.membership_id)
    && exactIdentifier(membership.agency_id)
    && membership.membership_key === `${membership.agency_id}:${subject.user_id}`
    && Number.isSafeInteger(membership.membership_version)
    && membership.membership_version >= 1
    && TENANT_ROLES.has(membership.tenant_role)
    && membership.membership_status === 'active'
    && validAgency(membership.agency, membership.agency_id);
}

function validMembershipList(memberships, subject) {
  if (!Array.isArray(memberships) || memberships.length > MAX_ACTIVE_MEMBERSHIPS) {
    return false;
  }
  if (subject.is_platform_owner && memberships.length !== 0) return false;

  const ids = new Set();
  const keys = new Set();
  const agencyIds = new Set();
  let previousAgencyId = null;
  for (const membership of memberships) {
    if (!validMembership(membership, subject)) return false;
    if (
      ids.has(membership.membership_id)
      || keys.has(membership.membership_key)
      || agencyIds.has(membership.agency_id)
      || (previousAgencyId !== null && membership.agency_id <= previousAgencyId)
    ) {
      return false;
    }
    ids.add(membership.membership_id);
    keys.add(membership.membership_key);
    agencyIds.add(membership.agency_id);
    previousAgencyId = membership.agency_id;
  }
  return true;
}

const TRANSIENT_MEMBERSHIP_STATUSES = new Set([429, 500, 502, 503, 504]);
const MEMBERSHIP_RETRY_DELAYS_MS = [250, 750];
let membershipListInflight = null;

function membershipStatus(error) {
  const status = error?.response?.status ?? error?.status ?? null;
  return Number.isInteger(status) ? status : null;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// A full document load asks for memberships before any workspace can open.
// Overlapping reloads make the hosted function answer 500 (a provider 429/503
// is still mapped to that generic 500 until the function is redeployed). One
// failure used to leave the gate on "No clinical workspace was opened".
// Identical in-flight callers share one attempt, and a transient status is
// retried before that gate can open. 401, 403, and 409 are not retried.
async function invokeMembershipList() {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await tenantAuthorityClient.listMyTenantMemberships();
    } catch (error) {
      const wait = MEMBERSHIP_RETRY_DELAYS_MS[attempt];
      if (wait === undefined || !TRANSIENT_MEMBERSHIP_STATUSES.has(membershipStatus(error))) {
        throw error;
      }
      await delay(wait);
    }
  }
}

function shareMembershipList() {
  if (membershipListInflight) return membershipListInflight;
  const promise = invokeMembershipList();
  membershipListInflight = promise;
  promise.finally(() => {
    if (membershipListInflight === promise) membershipListInflight = null;
  }).catch(() => {
    // The caller awaits `promise` itself. This only absorbs the derived
    // finally-chain rejection so a refused list is not an unhandled rejection.
  });
  return promise;
}

/**
 * Return validated selector options without selecting or caching a tenant.
 * Call getMyTenantContext({ agencyId }) separately after an explicit choice.
 */
export async function listMyTenantMemberships() {
  const response = await shareMembershipList();
  const result = response?.data ?? response;
  if (
    !exactKeys(result, ['subject', 'memberships'])
    || !validSubject(result.subject)
    || !validMembershipList(result.memberships, result.subject)
  ) {
    throw new Error(result?.error || 'Tenant membership list failed integrity validation');
  }

  return {
    subject: { ...result.subject },
    memberships: result.memberships.map((membership) => ({
      ...membership,
      agency: { ...membership.agency },
    })),
  };
}
