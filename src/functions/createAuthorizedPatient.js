import { base44 } from '@/api/base44Client';

export function createPatientRequestId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `patient-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Create a Patient through the tenant-authorizing backend broker.
 *
 * Authority selectors are accepted only through options so a clinical form
 * payload cannot silently smuggle tenant or retry metadata. The function
 * returns the narrow canonical Patient row verified by the backend.
 */
export async function createAuthorizedPatient(fields, {
  agencyId = null,
  clientRequestId = null,
  functions = null,
} = {}) {
  const payload = {
    ...(fields || {}),
    client_request_id: clientRequestId || createPatientRequestId(),
  };
  delete payload.agency_id;
  if (agencyId) payload.agency_id = agencyId;

  const response = functions
    ? await functions.invoke('createAuthorizedPatient', payload)
    : await base44.functions.invoke('createAuthorizedPatient', payload);
  const result = response?.data ?? response;
  if (!result?.patient?.id) {
    throw new Error(result?.error || 'Patient creation failed');
  }
  return result.patient;
}
