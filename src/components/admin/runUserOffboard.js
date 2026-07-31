// Thin action adapter so UserManagement can offboard through the pure helper
// without duplicating patch/permission rules in the page component.
// Full PHI cleanup (patient unassign, work-number release, on-call clear) runs
// server-side via base44.functions.invoke('offboardUser', ...).

import { canOffboardUser } from './userOffboarding.js';

// There is deliberately no direct-patch builder here any more. Offboarding runs
// entirely through the offboardUser function so the PHI sweeps (patient
// unassign, work-number release, on-call clear) cannot be skipped by a caller
// that only writes the User row.

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
