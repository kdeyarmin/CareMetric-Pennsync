export function buildMobileVisitReadiness({ patientCached, hasPatientContext, hasDraftNote, pendingSyncCount = 0, isOnline = true, hasRequiredForms = true } = {}) {
  const blockers = [];
  const warnings = [];
  if (!patientCached) blockers.push('Cache the patient chart before starting field documentation.');
  if (!hasPatientContext) blockers.push('Load patient demographics, care plan, medications, allergies, and recent notes.');
  if (!hasRequiredForms) blockers.push('Required visit forms are not available on this device.');
  if (!hasDraftNote) warnings.push('Start or restore a draft visit note before leaving the patient record.');
  if (!isOnline) warnings.push('Device is offline; changes must remain queued until sync succeeds.');
  if (pendingSyncCount > 0) warnings.push(`${pendingSyncCount} item${pendingSyncCount === 1 ? '' : 's'} pending sync.`);
  return {
    ready: blockers.length === 0,
    canStartVisit: blockers.length === 0,
    blockers,
    warnings,
    severity: blockers.length ? 'blocked' : warnings.length ? 'warning' : 'ready',
  };
}
