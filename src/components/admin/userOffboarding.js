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
    // keys off duty_status + these fields. (Releasing the shared PhoneNumber
    // row and OnCallShift assignments are separate entity writes the
    // offboarding action must also perform — see the note below.)
    personal_cell_e164: '',
    scheduled_off_duty_start: '',
    scheduled_off_duty_end: '',
    offboarded_at: at,
    offboarded_by: actorEmail,
    offboarding_reason: note.slice(0, 1000),
  };
}

// NOTE for the offboarding ACTION that consumes this patch (not yet wired into
// the UI): the patch above only deactivates the User record. A complete
// offboarding must ALSO, server-side:
//   1. Enforce is_active server-side — a deactivated user's still-valid session
//      otherwise keeps reading PHI through the entity API / functions. The app
//      shell (Layout) blocks a deactivated user in the browser, but that is
//      cosmetic; the backend must reject is_active:false callers.
//   2. Remove the user from every Patient.assigned_nurses (Patient read RLS
//      keys off it — otherwise patient PHI stays readable).
//   3. Release the shared work number: unset PhoneNumber.assigned_to_email and
//      the User's work_phone_number / twilio_phone_number_sid.
//   4. Deactivate their OnCallShift rows and revoke pending UserInvitations.
export const OFFBOARDING_SERVER_SIDE_REQUIREMENTS = Object.freeze([
  'enforce_is_active_server_side',
  'unassign_from_patients',
  'release_work_number',
  'deactivate_on_call_shifts',
]);
