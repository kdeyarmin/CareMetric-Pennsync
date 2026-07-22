// Pure helper for the Phase 1 offboarding workflow. It prepares the minimum
// auditable patch needed to deactivate an app user without deleting historical
// clinical/training/payroll records.

export function canOffboardUser({ currentUserEmail, targetUserEmail, currentUserRole, currentUserAccountType } = {}) {
  if (!currentUserEmail || !targetUserEmail) return false;
  if (currentUserEmail === targetUserEmail) return false;
  const role = String(currentUserRole || '').toLowerCase();
  const accountType = String(currentUserAccountType || role).toLowerCase();
  return role === 'admin' || ['agency_admin', 'super_admin'].includes(accountType);
}

export function buildUserOffboardingPatch({ targetUser, actorEmail, reason, at = new Date().toISOString() } = {}) {
  if (!targetUser?.email && !targetUser?.id) throw new Error('targetUser is required');
  if (!actorEmail) throw new Error('actorEmail is required');
  const note = String(reason || '').trim();
  if (!note) throw new Error('offboarding reason is required');
  return {
    is_active: false,
    duty_status: 'off_duty',
    offboarded_at: at,
    offboarded_by: actorEmail,
    offboarding_reason: note.slice(0, 1000),
  };
}
