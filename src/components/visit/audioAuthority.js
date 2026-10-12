/**
 * Keep the last verified audio binding while note history refetches the same
 * patient, visit, and tenant membership. A window-focus refetch sets
 * fetchStatus off idle and would otherwise clear the binding mid-transcription,
 * dropping a completed transcript or failing the in-flight request as a
 * patient change. A real identity change, a failed authorization, or a settled
 * chart that is no longer ready still clears it.
 */
export function retainAudioAuthorityWhileNoteHistoryRechecks({
  previous,
  patientId,
  visitId,
  tenantScope,
  exactPatientReady,
  noteHistorySucceeded,
  noteHistoryFailed,
  noteHistoryIdle,
  patientAuthorizationFailed,
  visitAuthorizationFailed,
}) {
  if (!previous) return null;
  if (
    !exactPatientReady
    || !noteHistorySucceeded
    || noteHistoryFailed
    || noteHistoryIdle
    || patientAuthorizationFailed
    || visitAuthorizationFailed
  ) return null;
  if (previous.patient_id !== patientId) return null;
  if ((previous.visit_id || null) !== (visitId || null)) return null;
  if (!tenantScope) return null;
  if (previous.user_id !== tenantScope.user_id) return null;
  if (previous.agency_id !== tenantScope.agency_id) return null;
  if (previous.membership_id !== tenantScope.membership_id) return null;
  if (previous.membership_version !== tenantScope.membership_version) return null;
  if (previous.tenant_role !== tenantScope.tenant_role) return null;
  return previous;
}
