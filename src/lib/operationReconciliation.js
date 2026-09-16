/**
 * In-memory association only. No property on an arbitrary SDK result grants a
 * receipt. Tokens, prompts, provider output and callbacks are never serialized.
 * The original executor and every membrane carrier independently check scope.
 */
const receipts = new WeakMap();
const objectLike = value => value !== null && (typeof value === 'object' || typeof value === 'function');

export function associateOperationReceipt(promise, receipt) {
  if (!objectLike(promise) || !receipt || typeof receipt.requestId !== 'string'
    || !/^[a-f0-9-]{36}$/i.test(receipt.requestId)
    || ![receipt.assertCurrent, receipt.markUncertain, receipt.reconcile].every(fn => typeof fn === 'function')) {
    throw new TypeError('An exact guarded operation receipt is required');
  }
  receipts.set(promise, Object.freeze({ ...receipt }));
  return promise;
}

export function carryOperationReceipt(source, guarded, assertCurrent) {
  const receipt = objectLike(source) ? receipts.get(source) : null;
  if (!receipt) return guarded;
  return associateOperationReceipt(guarded, {
    requestId: receipt.requestId,
    assertCurrent() { assertCurrent(); receipt.assertCurrent(); },
    markUncertain() { assertCurrent(); receipt.assertCurrent(); receipt.markUncertain(); },
    reconcile() { assertCurrent(); receipt.assertCurrent(); return receipt.reconcile(); },
  });
}

export function attachOperationReconciliation(error, source) {
  const receipt = objectLike(source) ? receipts.get(source) : null;
  if (!receipt || !objectLike(error)) return error;
  receipt.assertCurrent();
  receipt.markUncertain();
  // The ID is safe for a user-visible error. The guarded executor is deliberately
  // non-enumerable: JSON/logging the error never includes callbacks or content.
  Object.defineProperties(error, {
    requestId: { value: receipt.requestId, configurable: true, enumerable: true },
    reconcile: { value: () => {
      receipt.assertCurrent();
      return receipt.reconcile();
    }, configurable: true, enumerable: false },
  });
  return error;
}
