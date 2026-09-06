import { base44 } from '@/api/base44Client';

const INTAKE_ROLES = new Set(['agency_admin', 'manager', 'office_staff']);

function exactIdentifier(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 300
    && value.trim() === value
    && !value.startsWith('$')
    && !Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    });
}

function plainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return plainObject(value)
    && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}

function validHttpsUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 8192 || value.trim() !== value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

function validScope(scope, agencyId) {
  return exactKeys(scope, ['agency_id', 'membership_id', 'membership_version', 'tenant_role'])
    && scope.agency_id === agencyId
    && exactIdentifier(scope.membership_id)
    && Number.isSafeInteger(scope.membership_version)
    && scope.membership_version >= 1
    && INTAKE_ROLES.has(scope.tenant_role);
}

export async function getAuthorizedInboundReferralFax(options = {}) {
  if (!plainObject(options)
    || Object.keys(options).some((key) => ![
      'agencyId', 'referralId', 'incomingFaxId',
    ].includes(key))) throw new Error('Referral fax lookup options are invalid');
  const { agencyId, referralId, incomingFaxId } = options;
  if (!exactIdentifier(agencyId)
    || !exactIdentifier(referralId)
    || !exactIdentifier(incomingFaxId)) {
    throw new Error('Referral fax lookup identifiers are invalid');
  }
  const response = await base44.functions.invoke('getAuthorizedInboundReferralFax', {
    agency_id: agencyId,
    referral_id: referralId,
    incoming_fax_id: incomingFaxId,
  });
  const result = response?.data ?? response;
  if (!exactKeys(result, [
    'success', 'referral_id', 'incoming_fax_id', 'delivery', 'scope',
  ])
    || result.success !== true
    || result.referral_id !== referralId
    || result.incoming_fax_id !== incomingFaxId
    || !exactKeys(result.delivery, ['download_url'])
    || !validHttpsUrl(result.delivery.download_url)
    || !validScope(result.scope, agencyId)) {
    throw new Error(result?.error || 'Referral fax lookup failed');
  }
  return result;
}
