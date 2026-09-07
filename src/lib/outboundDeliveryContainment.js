/**
 * Browser code must never release or perform human-directed delivery directly.
 * Staging stays visibly fail-closed until each UI path is replaced by a
 * purpose-specific, server-authorized broker protected by the backend release
 * gate. Do not add a VITE_* escape hatch here: browser flags are user-controlled.
 */
export const OUTBOUND_DELIVERY_PAUSED_CODE = 'OUTBOUND_DELIVERY_RELEASE_PAUSED';
export const OUTBOUND_DELIVERY_PAUSED_MESSAGE =
  'Outbound delivery is paused in this environment.';

export function outboundDeliveryPausedError() {
  const error = new Error(OUTBOUND_DELIVERY_PAUSED_MESSAGE);
  error.code = OUTBOUND_DELIVERY_PAUSED_CODE;
  error.retryable = false;
  return error;
}

export function rejectOutboundDelivery() {
  return Promise.reject(outboundDeliveryPausedError());
}
