import { createPageUrl } from '@/utils';

const MAX_IDENTIFIER_LENGTH = 200;

export function isExactPatientDetailsRouteIdentifier(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_IDENTIFIER_LENGTH
    && value.trim() === value
    && !value.startsWith('$');
}

/** Return an exact, encoded PatientDetails URL, or null when either scope is unsafe. */
export function createPatientDetailsRouteHref(patientId, agencyId) {
  if (
    !isExactPatientDetailsRouteIdentifier(patientId)
    || !isExactPatientDetailsRouteIdentifier(agencyId)
  ) return null;
  const params = new URLSearchParams();
  params.set('id', patientId);
  params.set('agencyId', agencyId);
  return `${createPageUrl('PatientDetails')}?${params.toString()}`;
}
