// Executes offboard/reactivate through the server-side offboardUser function.
// Keeps UserManagement free of payload assembly details.

import { buildOffboardInvokeArgs } from './runUserOffboard.js';

/**
 * @param {object} opts
 * @param {object} opts.base44
 * @param {object} opts.targetUser
 * @param {object} opts.currentUser
 * @param {boolean} opts.enabling
 * @param {string} [opts.reason]
 */
export async function executeOffboardOrReactivate({ base44, targetUser, currentUser, enabling, reason } = {}) {
  const args = buildOffboardInvokeArgs({ targetUser, currentUser, enabling, reason });
  return base44.functions.invoke('offboardUser', args);
}
