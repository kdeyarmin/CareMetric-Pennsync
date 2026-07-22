// Canonical outbound delivery state helpers for fax/SMS/email/signature/provider
// follow-up workflows. Existing feature code can map provider-specific statuses
// to this vocabulary incrementally; the helpers stay pure and idempotent.

export const OUTBOUND_DELIVERY_STATUS = Object.freeze({
  DRAFT: 'draft',
  QUEUED: 'queued',
  SENDING: 'sending',
  SENT: 'sent',
  DELIVERED: 'delivered',
  FAILED_TRANSIENT: 'failed_transient',
  FAILED_PERMANENT: 'failed_permanent',
  RETRY_EXHAUSTED: 'retry_exhausted',
  CANCELLED: 'cancelled',
});

export const TERMINAL_DELIVERY_STATUSES = Object.freeze([
  OUTBOUND_DELIVERY_STATUS.DELIVERED,
  OUTBOUND_DELIVERY_STATUS.FAILED_PERMANENT,
  OUTBOUND_DELIVERY_STATUS.RETRY_EXHAUSTED,
  OUTBOUND_DELIVERY_STATUS.CANCELLED,
]);

export function normalizeOutboundDeliveryStatus(status) {
  if (!status || typeof status !== 'string') return null;
  const normalized = status.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return Object.values(OUTBOUND_DELIVERY_STATUS).includes(normalized) ? normalized : null;
}

export function isTerminalDeliveryStatus(status) {
  return TERMINAL_DELIVERY_STATUSES.includes(normalizeOutboundDeliveryStatus(status));
}

export function shouldDeadLetterDelivery({ status, retryCount = 0, maxRetries = 3 } = {}) {
  const normalized = normalizeOutboundDeliveryStatus(status);
  if (normalized === OUTBOUND_DELIVERY_STATUS.RETRY_EXHAUSTED) return true;
  if (normalized === OUTBOUND_DELIVERY_STATUS.FAILED_PERMANENT) return true;
  if (normalized !== OUTBOUND_DELIVERY_STATUS.FAILED_TRANSIENT) return false;
  return Number(retryCount) >= Number(maxRetries);
}

export function nextDeliveryStateForProviderStatus(providerStatus, { retryCount = 0, maxRetries = 3 } = {}) {
  const raw = String(providerStatus || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['queued', 'accepted', 'scheduled'].includes(raw)) return OUTBOUND_DELIVERY_STATUS.QUEUED;
  if (['sending', 'processing', 'initiated'].includes(raw)) return OUTBOUND_DELIVERY_STATUS.SENDING;
  if (['sent', 'submitted'].includes(raw)) return OUTBOUND_DELIVERY_STATUS.SENT;
  if (['delivered', 'completed', 'signed', 'responded'].includes(raw)) return OUTBOUND_DELIVERY_STATUS.DELIVERED;
  if (['cancelled', 'canceled'].includes(raw)) return OUTBOUND_DELIVERY_STATUS.CANCELLED;
  if (['failed_permanent', 'rejected', 'undeliverable', 'invalid_destination', 'opted_out'].includes(raw)) {
    return OUTBOUND_DELIVERY_STATUS.FAILED_PERMANENT;
  }
  if (Number(retryCount) >= Number(maxRetries)) return OUTBOUND_DELIVERY_STATUS.RETRY_EXHAUSTED;
  return OUTBOUND_DELIVERY_STATUS.FAILED_TRANSIENT;
}

export function createDeliveryAttemptEvent({
  channel,
  messageId,
  providerMessageId = null,
  fromStatus,
  toStatus,
  retryCount = 0,
  maxRetries = 3,
  reason = null,
  at = new Date().toISOString(),
} = {}) {
  const next = normalizeOutboundDeliveryStatus(toStatus);
  if (!channel || !messageId || !next) {
    throw new Error('Delivery events require channel, messageId, and canonical toStatus');
  }
  return {
    channel,
    message_id: messageId,
    provider_message_id: providerMessageId,
    from_status: normalizeOutboundDeliveryStatus(fromStatus),
    to_status: next,
    retry_count: Number(retryCount) || 0,
    max_retries: Number(maxRetries) || 0,
    dead_letter: shouldDeadLetterDelivery({ status: next, retryCount, maxRetries }),
    reason,
    occurred_at: at,
  };
}
