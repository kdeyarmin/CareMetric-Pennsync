// Thin action adapter so UserManagement can offboard through the pure helper
// without duplicating patch/permission rules in the page component.

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
