import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OUTBOUND_DELIVERY_STATUS,
  createDeliveryAttemptEvent,
  isTerminalDeliveryStatus,
  nextDeliveryStateForProviderStatus,
  normalizeOutboundDeliveryStatus,
  shouldDeadLetterDelivery,
} from './outboundDeliveryState.js';

test('normalizeOutboundDeliveryStatus canonicalizes delivery spellings', () => {
  assert.equal(normalizeOutboundDeliveryStatus('Failed Transient'), OUTBOUND_DELIVERY_STATUS.FAILED_TRANSIENT);
  assert.equal(normalizeOutboundDeliveryStatus('retry-exhausted'), OUTBOUND_DELIVERY_STATUS.RETRY_EXHAUSTED);
  assert.equal(normalizeOutboundDeliveryStatus('mystery'), null);
});

test('nextDeliveryStateForProviderStatus maps provider-specific statuses', () => {
  assert.equal(nextDeliveryStateForProviderStatus('accepted'), OUTBOUND_DELIVERY_STATUS.QUEUED);
  assert.equal(nextDeliveryStateForProviderStatus('processing'), OUTBOUND_DELIVERY_STATUS.SENDING);
  assert.equal(nextDeliveryStateForProviderStatus('submitted'), OUTBOUND_DELIVERY_STATUS.SENT);
  assert.equal(nextDeliveryStateForProviderStatus('completed'), OUTBOUND_DELIVERY_STATUS.DELIVERED);
  assert.equal(nextDeliveryStateForProviderStatus('opted_out'), OUTBOUND_DELIVERY_STATUS.FAILED_PERMANENT);
  assert.equal(nextDeliveryStateForProviderStatus('gateway_timeout', { retryCount: 1, maxRetries: 3 }), OUTBOUND_DELIVERY_STATUS.FAILED_TRANSIENT);
  assert.equal(nextDeliveryStateForProviderStatus('gateway_timeout', { retryCount: 3, maxRetries: 3 }), OUTBOUND_DELIVERY_STATUS.RETRY_EXHAUSTED);
});

test('shouldDeadLetterDelivery catches permanent and retry-exhausted failures', () => {
  assert.equal(shouldDeadLetterDelivery({ status: 'failed_permanent' }), true);
  assert.equal(shouldDeadLetterDelivery({ status: 'retry_exhausted' }), true);
  assert.equal(shouldDeadLetterDelivery({ status: 'failed_transient', retryCount: 2, maxRetries: 3 }), false);
  assert.equal(shouldDeadLetterDelivery({ status: 'failed_transient', retryCount: 3, maxRetries: 3 }), true);
  assert.equal(shouldDeadLetterDelivery({ status: 'delivered' }), false);
});

test('terminal statuses include delivered and unrecoverable outcomes', () => {
  assert.equal(isTerminalDeliveryStatus('delivered'), true);
  assert.equal(isTerminalDeliveryStatus('failed_permanent'), true);
  assert.equal(isTerminalDeliveryStatus('sending'), false);
});

test('createDeliveryAttemptEvent records traceable provider/id/retry/dead-letter state', () => {
  const event = createDeliveryAttemptEvent({
    channel: 'fax',
    messageId: 'fax-1',
    providerMessageId: 'telnyx-1',
    fromStatus: 'sent',
    toStatus: 'failed_transient',
    retryCount: 4,
    maxRetries: 4,
    reason: 'busy',
    at: '2026-07-22T00:00:00.000Z',
  });
  assert.deepEqual(event, {
    channel: 'fax',
    message_id: 'fax-1',
    provider_message_id: 'telnyx-1',
    from_status: 'sent',
    to_status: 'failed_transient',
    retry_count: 4,
    max_retries: 4,
    dead_letter: true,
    reason: 'busy',
    occurred_at: '2026-07-22T00:00:00.000Z',
  });
  assert.throws(() => createDeliveryAttemptEvent({ channel: 'sms', toStatus: 'queued' }), /Delivery events require/);
});
