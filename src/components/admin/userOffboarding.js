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
    // Stop the offboarded user's record from ROUTING work: an incoming/masked
    // call must not bridge to their personal cell, and on-call/off-duty logic
    // keys off duty_status + these fields.
    personal_cell_e164: '',
    scheduled_off_duty_start: '',
    scheduled_off_duty_end: '',
    offboarded_at: at,
    offboarded_by: actorEmail,
    offboarding_reason: note.slice(0, 1000),
  };
}

// Server-side offboardUser function implements these requirements:
//   1. User.is_active:false + audit fields + clear routing numbers
//   2. Remove email from every Patient.assigned_nurses
//   3. Release PhoneNumber.assigned_to_email + clear User work number fields
//   4. Clear OnCallShift assignments and cancel pending invitations
// Remaining platform gap: Base44 entity-API rejection of is_active:false sessions
// (Layout already blocks the browser shell).
export const OFFBOARDING_SERVER_SIDE_REQUIREMENTS = Object.freeze([
  'enforce_is_active_server_side',
  'unassign_from_patients',
  'release_work_number',
  'deactivate_on_call_shifts',
]);
