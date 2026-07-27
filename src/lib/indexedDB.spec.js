import { describe, it, expect } from 'vitest';
import { whenTransactionCommits } from './indexedDB.js';

/**
 * Pins the durability contract of the offline store's write path.
 *
 * IndexedDB fires `request.onsuccess` when an operation is STAGED, not when it
 * is durable — the transaction can still abort afterwards (quota exceeded, the
 * tab closing mid-commit). The offline queue previously resolved on request
 * success, so `addToSyncQueue` reported a nurse's visit note or incident as
 * "saved offline" for writes that were then rolled back — silent data loss in
 * exactly the low-storage field conditions the queue exists to survive.
 *
 * jsdom has no IndexedDB and the repo carries no fake-indexeddb, so these use a
 * minimal stub that reproduces the event ORDERING that matters. That is the
 * whole point of the test: request-success-then-abort must reject, not resolve.
 */
function makeTx() {
  return { oncomplete: null, onerror: null, onabort: null, error: null };
}
function makeRequest(result) {
  return { onsuccess: null, onerror: null, result, error: null };
}

describe('whenTransactionCommits', () => {
  it('resolves with the request result only after the transaction commits', async () => {
    const tx = makeTx();
    const request = makeRequest(42);
    const promise = whenTransactionCommits(tx, request);

    request.onsuccess();
    let settled = false;
    promise.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false); // staged, not yet durable

    tx.oncomplete();
    await expect(promise).resolves.toBe(42);
  });

  it('REJECTS when the transaction aborts after the request succeeded', async () => {
    const tx = makeTx();
    const request = makeRequest('queued-id');
    const promise = whenTransactionCommits(tx, request);

    request.onsuccess();      // operation staged — the old code resolved here
    tx.error = new Error('QuotaExceededError');
    tx.onabort();

    await expect(promise).rejects.toThrow('QuotaExceededError');
  });

  it('rejects with a clear error when an abort carries no error object', async () => {
    const tx = makeTx();
    const promise = whenTransactionCommits(tx, makeRequest(1));
    tx.onabort();
    await expect(promise).rejects.toThrow('IndexedDB transaction aborted');
  });

  it('rejects when the transaction errors', async () => {
    const tx = makeTx();
    const promise = whenTransactionCommits(tx, makeRequest(1));
    tx.error = new Error('tx failed');
    tx.onerror();
    await expect(promise).rejects.toThrow('tx failed');
  });

  it('rejects when the request itself fails', async () => {
    const tx = makeTx();
    const request = makeRequest(null);
    const promise = whenTransactionCommits(tx, request);
    request.error = new Error('write failed');
    request.onerror();
    await expect(promise).rejects.toThrow('write failed');
  });

  it('does not resolve after a failure even if oncomplete still fires', async () => {
    const tx = makeTx();
    const request = makeRequest(null);
    const promise = whenTransactionCommits(tx, request);
    request.error = new Error('write failed');
    request.onerror();
    tx.oncomplete();   // must not flip an already-rejected promise to success
    await expect(promise).rejects.toThrow('write failed');
  });

  it('supports multi-write transactions with no single request to track', async () => {
    // savePatients stages many put()s and only cares that the batch committed.
    const tx = makeTx();
    const promise = whenTransactionCommits(tx);
    tx.oncomplete();
    await expect(promise).resolves.toBeUndefined();
  });
});
