// Thin action adapter so UserManagement can offboard through the pure helper
// without duplicating patch/permission rules in the page component.
// Full PHI cleanup (patient unassign, work-number release, on-call clear) runs
// server-side via base44.functions.invoke('offboardUser', ...).

import { canOffboardUser, buildUserOffboardingPatch } from './userOffboarding.js';

export function buildDisableOrEnableUserPayload({
  targetUser,
  currentUser,
  enabling,
  reason,
} = {}) {
  if (!targetUser) throw new Error('targetUser is required');
  if (enabling) {
    return {
      is_active: true,
      // Clear offboarding markers on re-enable; duty returns to available.
      duty_status: 'available',
      offboarded_at: '',
      offboarded_by: '',
      offboarding_reason: '',
    };
  }
  if (!canOffboardUser({
    currentUserEmail: currentUser?.email,
    targetUserEmail: targetUser.email,
    currentUserRole: currentUser?.role,
    currentUserAccountType: currentUser?.account_type,
  })) {
    throw new Error('You do not have permission to offboard this user');
  }
  return buildUserOffboardingPatch({
    targetUser,
    actorEmail: currentUser.email,
    reason: reason || `Disabled via User Management by ${currentUser.email}`,
  });
}

/** Prefer the server-side offboardUser function for full cleanup. */
export function buildOffboardInvokeArgs({ targetUser, currentUser, enabling, reason } = {}) {
  if (!targetUser?.id) throw new Error('targetUser is required');
  if (enabling) {
    return { action: 'reactivate', user_id: targetUser.id };
  }
  if (!canOffboardUser({
    currentUserEmail: currentUser?.email,
    targetUserEmail: targetUser.email,
    currentUserRole: currentUser?.role,
    currentUserAccountType: currentUser?.account_type,
  })) {
    throw new Error('You do not have permission to offboard this user');
  }
  return {
    user_id: targetUser.id,
    reason: reason || `Disabled via User Management by ${currentUser?.email || 'admin'}`,
  };
}
