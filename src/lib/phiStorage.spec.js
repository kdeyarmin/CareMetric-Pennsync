// Regression tests for the HIPAA logout/idle-timeout PHI purge.
//
// The purge must (1) remove re-fetchable cached PHI, (2) remove the synced
// (already-uploaded) copies of offline work, and (3) PRESERVE work still pending
// sync — wiping unsynced field documentation on a 15-min idle timeout would be
// silent loss of care. These cases lock that contract in.
//
// clearCachedPHI also clears the retired IndexedDB patient roster. jsdom has no
// IndexedDB, so that branch is inert here and these cases cover the localStorage
// half plus the retirement gate.
import { webcrypto } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { OFFLINE_RETIRED_FLAG } from './localPhiKeys';
import {
  captureAuthorityDraftLease,
  clearCachedPHI,
  DRAFT_AUTHORITY_MARKER_KEY,
  DRAFT_LOGOUT_TOMBSTONE_KEY,
  DRAFT_SESSION_AUTHORITY_MARKER_KEY,
  invalidateAuthorityDraftLeaseForTransition,
  invalidatePersistedAuthorityDraftMarkersForLogout,
  isAuthorityDraftLeaseCurrent,
  purgeAuthorityBoundDrafts,
  purgeRefetchablePhiForAuthorityTransition,
  reconcileAuthorityBoundDrafts,
  requireCurrentAuthorityDraftLease,
} from './phiStorage';

function restoreGlobal(name, descriptor) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete globalThis[name];
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

/**
 * Small transactional IndexedDB implementation for the one production surface
 * under test. Records live in the harness store; production must open the named
 * database, start a read/write transaction, and commit clear() to remove them.
 * This intentionally does not replace the clear function with a spy.
 */
function createDraftIndexedDbHarness(initialRecords = [], {
  storeInitiallyExists = true,
  exposeDatabases = true,
} = {}) {
  const records = new Map(initialRecords.map((record) => [record.id, { ...record }]));
  const transactions = [];
  const openCalls = [];
  let failClear = false;
  let storeExists = storeInitiallyExists;

  const db = {
    objectStoreNames: {
      contains: (name) => name === 'draft_notes' && storeExists,
    },
    createObjectStore(name, options) {
      if (name !== 'draft_notes' || options?.keyPath !== 'id') {
        throw new Error('Unexpected draft object store schema');
      }
      storeExists = true;
      return {};
    },
    close() {},
    transaction(storeName, mode) {
      if (storeName !== 'draft_notes' || !storeExists) {
        throw new Error(`Unknown store: ${storeName}`);
      }
      const transaction = {
        error: null,
        objectStore(name) {
          if (name !== storeName) throw new Error(`Unknown store: ${name}`);
          return {
            clear() {
              const request = {};
              queueMicrotask(() => {
                if (failClear) {
                  const error = new Error('IndexedDB clear aborted');
                  request.error = error;
                  transaction.error = error;
                  request.onerror?.({ target: request });
                  transaction.onabort?.({ target: transaction });
                  return;
                }
                records.clear();
                request.result = undefined;
                request.onsuccess?.({ target: request });
                transaction.oncomplete?.({ target: transaction });
              });
              return request;
            },
          };
        },
      };
      transactions.push({ storeName, mode });
      return transaction;
    },
  };

  const indexedDbHarness = {
    open(name) {
      openCalls.push(name);
      const request = {};
      queueMicrotask(() => {
        if (name !== 'pennsync-drafts') {
          request.error = new Error(`Unknown database: ${name}`);
          request.onerror?.({ target: request });
          return;
        }
        request.result = db;
        if (!storeExists) request.onupgradeneeded?.({ target: request });
        request.onsuccess?.({ target: request });
      });
      return request;
    },
  };
  if (exposeDatabases) {
    indexedDbHarness.databases = async () => [{ name: 'pennsync-drafts', version: 1 }];
  }

  return {
    indexedDB: indexedDbHarness,
    records: () => Array.from(records.values()),
    storeExists: () => storeExists,
    put: (record) => records.set(record.id, { ...record }),
    setFailClear: (value) => { failClear = value; },
    openCalls,
    transactions,
  };
}

function createLegacyPatientDbHarness(initialRecords = [], { ignoreClear = false } = {}) {
  const records = new Map(initialRecords.map((record) => [record.id, { ...record }]));
  const transactions = [];
  const openCalls = [];
  const db = {
    objectStoreNames: { contains: (name) => name === 'patients' },
    close() {},
    transaction(storeName, mode) {
      if (storeName !== 'patients') throw new Error(`Unknown store: ${storeName}`);
      transactions.push({ storeName, mode });
      const transaction = {
        error: null,
        objectStore(name) {
          if (name !== storeName) throw new Error(`Unknown store: ${name}`);
          const request = {};
          return {
            clear() {
              queueMicrotask(() => {
                if (!ignoreClear) records.clear();
                request.onsuccess?.({ target: request });
                transaction.oncomplete?.({ target: transaction });
              });
              return request;
            },
            count() {
              queueMicrotask(() => {
                request.result = records.size;
                request.onsuccess?.({ target: request });
                transaction.oncomplete?.({ target: transaction });
              });
              return request;
            },
          };
        },
      };
      return transaction;
    },
  };
  return {
    indexedDB: {
      databases: async () => [{ name: 'base44-offline-db', version: 1 }],
      open(name) {
        openCalls.push(name);
        const request = {};
        queueMicrotask(() => {
          if (name !== 'base44-offline-db') {
            request.error = new Error(`Unknown database: ${name}`);
            request.onerror?.({ target: request });
            return;
          }
          request.result = db;
          request.onsuccess?.({ target: request });
        });
        return request;
      },
    },
    records: () => Array.from(records.values()),
    openCalls,
    transactions,
  };
}

describe('clearCachedPHI', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('purges re-fetchable cached PHI keys', async () => {
    localStorage.setItem('offline_patients', '[{"id":"p1"}]');
    localStorage.setItem('recentPatients_user1', '["p1"]');
    localStorage.setItem('oasis_data_abc', '{"m0":1}');
    localStorage.setItem('penn_sync_offline_cache_roster', '{"data":[]}');

    await clearCachedPHI();

    expect(localStorage.getItem('offline_patients')).toBeNull();
    expect(localStorage.getItem('recentPatients_user1')).toBeNull();
    expect(localStorage.getItem('oasis_data_abc')).toBeNull();
    expect(localStorage.getItem('penn_sync_offline_cache_roster')).toBeNull();
  });

  it('purges the sync-error log (full item PHI + stack traces)', async () => {
    localStorage.setItem(
      'penn_sync_offline_sync_errors',
      JSON.stringify([{ itemData: { nurse_notes: 'PHI' }, stack: 'Error: ...' }])
    );
    localStorage.setItem('penn_sync_offline_sync_status', '{"isSyncing":false}');

    await clearCachedPHI();

    expect(localStorage.getItem('penn_sync_offline_sync_errors')).toBeNull();
    expect(localStorage.getItem('penn_sync_offline_sync_status')).toBeNull();
  });

  it('preserves an in-progress local draft', async () => {
    // The OASIS assessment autosave. Wiping it on a 15-minute idle timeout
    // mid-assessment would be silent loss of documented care.
    localStorage.setItem('visit_draft_42', '{"notes":"still being written"}');

    await clearCachedPHI();

    expect(localStorage.getItem('visit_draft_42')).not.toBeNull();
  });

  const seedRetiredQueues = () => {
    localStorage.setItem('offline_pending', '[{"id":"c1"}]');
    localStorage.setItem('offline_visit_drafts', '{"v1":"draft"}');
    localStorage.setItem('offline_sync_queue', '[{"id":"q1"}]');
    localStorage.setItem('offline_conflicts', '[{"id":"x1"}]');
  };
  const retiredQueueValues = () => [
    localStorage.getItem('offline_pending'),
    localStorage.getItem('offline_visit_drafts'),
    localStorage.getItem('offline_sync_queue'),
    localStorage.getItem('offline_conflicts'),
  ];

  it('purges retired replay queues after retirement but keeps manual conflicts quarantined', async () => {
    // retiredOfflineQueue.js sets this flag only after a complete flush. After
    // that these are duplicates of server state, and leaving them on a shared
    // device is pure exposure.
    seedRetiredQueues();
    localStorage.setItem(OFFLINE_RETIRED_FLAG, '1');

    await clearCachedPHI();

    expect(retiredQueueValues()).toEqual([null, null, null, '[{"id":"x1"}]']);
  });

  it('KEEPS the retired offline queues until retirement has completed', async () => {
    // Regression: these were purged unconditionally. The recovery flush needs a
    // connection, so a nurse who documented a visit offline and then logged out
    // (or idled out) had that documentation destroyed before it was ever sent —
    // including the stores the migration deliberately preserved because an item
    // could not be safely mapped.
    seedRetiredQueues();
    // no retirement flag: the flush has not confirmed anything reached the server

    await clearCachedPHI();

    expect(retiredQueueValues()).toEqual([
      '[{"id":"c1"}]',
      '{"v1":"draft"}',
      '[{"id":"q1"}]',
      '[{"id":"x1"}]',
    ]);
  });

  it('drops synced offline visits but keeps unsynced ones', async () => {
    localStorage.setItem(
      'penn_sync_offline_pending_visits',
      JSON.stringify([
        { id: 'offline_1', synced: true, data: { nurse_notes: 'sent' } },
        { id: 'offline_2', synced: false, data: { nurse_notes: 'pending' } },
      ])
    );

    await clearCachedPHI();

    const remaining = JSON.parse(
      localStorage.getItem('penn_sync_offline_pending_visits')
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('offline_2');
    expect(remaining[0].synced).toBe(false);
  });

  it('removes the pending-visits key entirely when every entry is synced', async () => {
    localStorage.setItem(
      'penn_sync_offline_pending_updates',
      JSON.stringify([
        { visitId: 'v1', synced: true },
        { visitId: 'v2', synced: true },
      ])
    );

    await clearCachedPHI();

    expect(localStorage.getItem('penn_sync_offline_pending_updates')).toBeNull();
  });

  it('leaves a malformed offline-queue value untouched rather than throwing', async () => {
    localStorage.setItem('penn_sync_offline_pending_visits', 'not-json');

    await expect(clearCachedPHI()).resolves.toBeUndefined();
    expect(localStorage.getItem('penn_sync_offline_pending_visits')).toBe('not-json');
  });
});

describe('authority-bound live draft storage', () => {
  const AUTHORITY_A = '["user-a","nurse@example.test","agency-a","membership-a",4,"nurse",false]';
  const AUTHORITY_B = '["user-a","nurse@example.test","agency-b","membership-b",9,"nurse",false]';
  let indexedDbDescriptor;
  let cryptoDescriptor;
  let draftDb;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDbDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    draftDb = createDraftIndexedDbHarness();
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: draftDb.indexedDB,
    });
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: webcrypto,
    });
  });

  afterEach(() => {
    restoreGlobal('indexedDB', indexedDbDescriptor);
    restoreGlobal('crypto', cryptoDescriptor);
  });

  it('preserves every live draft surface only for the exact same opaque marker', async () => {
    const first = await reconcileAuthorityBoundDrafts(AUTHORITY_A);
    expect(first.preserved).toBe(false);
    const firstLease = captureAuthorityDraftLease();
    expect(isAuthorityDraftLeaseCurrent(firstLease)).toBe(true);

    localStorage.setItem('visit_draft_patient-1', '{"note":"visit"}');
    localStorage.setItem('pennsync.oasis.draft.v2|patient-1|SOC|E2|schema', '{"m1800":"1"}');
    sessionStorage.setItem('smart_note_draft_v2:patient-1', '{"note":"session"}');
    draftDb.put({ id: 'draft_patient-1', note: 'durable note' });

    const marker = localStorage.getItem(DRAFT_AUTHORITY_MARKER_KEY);
    const transactionsBefore = draftDb.transactions.length;
    const second = await reconcileAuthorityBoundDrafts(AUTHORITY_A);

    expect(second).toEqual({ preserved: true, marker });
    expect(captureAuthorityDraftLease()).toBe(firstLease);
    expect(isAuthorityDraftLeaseCurrent(firstLease)).toBe(true);
    expect(marker).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(marker).not.toContain('user-a');
    expect(marker).not.toContain('agency-a');
    expect(sessionStorage.getItem(DRAFT_SESSION_AUTHORITY_MARKER_KEY)).toBe(marker);
    expect(localStorage.getItem('visit_draft_patient-1')).toBe('{"note":"visit"}');
    expect(localStorage.getItem('pennsync.oasis.draft.v2|patient-1|SOC|E2|schema')).toBe('{"m1800":"1"}');
    expect(sessionStorage.getItem('smart_note_draft_v2:patient-1')).toBe('{"note":"session"}');
    expect(draftDb.records()).toEqual([{ id: 'draft_patient-1', note: 'durable note' }]);
    expect(draftDb.transactions).toHaveLength(transactionsBefore);
  });

  it('purges local, session, and committed IndexedDB drafts when authority differs', async () => {
    const first = await reconcileAuthorityBoundDrafts(AUTHORITY_A);
    const firstMarker = first.marker;
    localStorage.setItem('visit_draft_patient-1', '{"note":"visit"}');
    localStorage.setItem('pennsync.oasis.draft.v2|patient-1|SOC|E2|schema', '{"m1800":"1"}');
    localStorage.setItem('unrelated-preference', 'keep');
    sessionStorage.setItem('smart_note_draft_v2:patient-1', '{"note":"session"}');
    sessionStorage.setItem('referral_prepopulate:r1', '{"roughNote":"referral PHI"}');
    draftDb.put({ id: 'draft_patient-1', note: 'durable note' });

    // These are the only remaining copies of retired offline field work. Tenant
    // draft reconciliation must not consume the recovery subsystem's queues.
    localStorage.setItem('offline_pending', '[{"id":"pending"}]');
    localStorage.setItem('offline_visit_drafts', '{"old":"draft"}');
    localStorage.setItem('offline_sync_queue', '[{"id":"queued"}]');
    localStorage.setItem('penn_sync_offline_pending_visits', '[{"synced":false}]');

    const staleLease = captureAuthorityDraftLease();
    const reconciliation = reconcileAuthorityBoundDrafts(AUTHORITY_B);

    // Revocation is synchronous, before SHA-256 and IndexedDB cleanup await.
    expect(isAuthorityDraftLeaseCurrent(staleLease)).toBe(false);
    const result = await reconciliation;

    expect(result.preserved).toBe(false);
    expect(result.marker).not.toBe(firstMarker);
    expect(localStorage.getItem(DRAFT_AUTHORITY_MARKER_KEY)).toBe(result.marker);
    expect(localStorage.getItem('visit_draft_patient-1')).toBeNull();
    expect(localStorage.getItem('pennsync.oasis.draft.v2|patient-1|SOC|E2|schema')).toBeNull();
    expect(localStorage.getItem('unrelated-preference')).toBe('keep');
    expect(sessionStorage.getItem('smart_note_draft_v2:patient-1')).toBeNull();
    expect(sessionStorage.getItem('referral_prepopulate:r1')).toBeNull();
    expect(sessionStorage.getItem(DRAFT_SESSION_AUTHORITY_MARKER_KEY)).toBe(result.marker);
    expect(draftDb.records()).toEqual([]);
    expect(draftDb.transactions.at(-1)).toEqual({
      storeName: 'draft_notes',
      mode: 'readwrite',
    });
    expect(localStorage.getItem('offline_pending')).toBe('[{"id":"pending"}]');
    expect(localStorage.getItem('offline_visit_drafts')).toBe('{"old":"draft"}');
    expect(localStorage.getItem('offline_sync_queue')).toBe('[{"id":"queued"}]');
    expect(localStorage.getItem('penn_sync_offline_pending_visits')).toBe('[{"synced":false}]');
    expect(isAuthorityDraftLeaseCurrent(captureAuthorityDraftLease())).toBe(true);
  });

  it('explicitly purges live drafts and the marker without touching recovery queues', async () => {
    await reconcileAuthorityBoundDrafts(AUTHORITY_A);
    localStorage.setItem('visit_draft_patient-1', '{"note":"visit"}');
    localStorage.setItem('offline_conflicts', '[{"id":"recover-me"}]');
    sessionStorage.setItem('smart_note_patient_v1', '{"patientId":"patient-1"}');
    draftDb.put({ id: 'draft_patient-1', note: 'durable note' });

    await purgeAuthorityBoundDrafts();

    expect(captureAuthorityDraftLease()).toBeNull();
    expect(localStorage.getItem(DRAFT_AUTHORITY_MARKER_KEY)).toBeNull();
    expect(sessionStorage.getItem(DRAFT_SESSION_AUTHORITY_MARKER_KEY)).toBeNull();
    expect(localStorage.getItem('visit_draft_patient-1')).toBeNull();
    expect(sessionStorage.length).toBe(0);
    expect(draftDb.records()).toEqual([]);
    expect(localStorage.getItem('offline_conflicts')).toBe('[{"id":"recover-me"}]');
  });

  it('clears synchronous draft storage and starts IndexedDB destruction before yielding', async () => {
    await reconcileAuthorityBoundDrafts(AUTHORITY_A);
    localStorage.setItem('visit_draft_patient-1', '{"note":"visit"}');
    sessionStorage.setItem('smart_note_draft_v2:patient-1', '{"note":"session"}');
    draftDb.put({ id: 'draft_patient-1', note: 'durable note' });
    draftDb.openCalls.length = 0;

    const purge = purgeAuthorityBoundDrafts();

    expect(localStorage.getItem('visit_draft_patient-1')).toBeNull();
    expect(sessionStorage.length).toBe(0);
    expect(draftDb.openCalls).toEqual(['pennsync-drafts']);
    await purge;
    expect(draftDb.records()).toEqual([]);
  });

  it('rejects when browser storage silently retains authority-bound drafts', async () => {
    await reconcileAuthorityBoundDrafts(AUTHORITY_A);
    localStorage.setItem('visit_draft_patient-1', '{"note":"must remove"}');
    const nativeRemoveItem = Storage.prototype.removeItem;
    const removal = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function remove(key) {
      if (this === localStorage && key === 'visit_draft_patient-1') return;
      return nativeRemoveItem.call(this, key);
    });

    await expect(purgeAuthorityBoundDrafts()).rejects.toThrow(
      'Authority-bound draft purge failed',
    );
    removal.mockRestore();

    expect(captureAuthorityDraftLease()).toBeNull();
    expect(localStorage.getItem('visit_draft_patient-1')).not.toBeNull();
  });

  it('rejects when clearing protected session state is silently ineffective', async () => {
    await reconcileAuthorityBoundDrafts(AUTHORITY_A);
    sessionStorage.setItem('smart_note_draft_v2:patient-1', '{"note":"must remove"}');
    const nativeClear = Storage.prototype.clear;
    const clearing = vi.spyOn(Storage.prototype, 'clear').mockImplementation(function clear() {
      if (this === sessionStorage) return;
      return nativeClear.call(this);
    });

    await expect(purgeAuthorityBoundDrafts()).rejects.toThrow(
      'Authority-bound draft purge failed',
    );
    clearing.mockRestore();

    expect(captureAuthorityDraftLease()).toBeNull();
    expect(sessionStorage.getItem('smart_note_draft_v2:patient-1')).not.toBeNull();
  });

  it('can synchronously fence stale writers without destructively deciding draft continuity', async () => {
    const authority = await reconcileAuthorityBoundDrafts(AUTHORITY_A);
    const staleLease = captureAuthorityDraftLease();
    localStorage.setItem('visit_draft_patient-1', '{"note":"locked"}');

    invalidateAuthorityDraftLeaseForTransition();

    expect(isAuthorityDraftLeaseCurrent(staleLease)).toBe(false);
    expect(captureAuthorityDraftLease()).toBeNull();
    expect(localStorage.getItem(DRAFT_AUTHORITY_MARKER_KEY)).toBe(authority.marker);
    expect(localStorage.getItem('visit_draft_patient-1')).toBe('{"note":"locked"}');

    const revalidated = await reconcileAuthorityBoundDrafts(AUTHORITY_A);
    expect(revalidated).toEqual({ preserved: true, marker: authority.marker });
    expect(localStorage.getItem('visit_draft_patient-1')).toBe('{"note":"locked"}');
    expect(isAuthorityDraftLeaseCurrent(captureAuthorityDraftLease())).toBe(true);
  });

  it('revokes another tab lease as soon as a shared logout tombstone appears', async () => {
    await reconcileAuthorityBoundDrafts(AUTHORITY_A);
    const otherTabLease = captureAuthorityDraftLease();
    expect(isAuthorityDraftLeaseCurrent(otherTabLease)).toBe(true);

    // A different same-origin tab cannot mutate this module's in-memory epoch,
    // but its logout fence writes the shared localStorage tombstone.
    localStorage.setItem(DRAFT_LOGOUT_TOMBSTONE_KEY, 'required');

    expect(isAuthorityDraftLeaseCurrent(otherTabLease)).toBe(false);
    localStorage.removeItem(DRAFT_LOGOUT_TOMBSTONE_KEY);
    expect(isAuthorityDraftLeaseCurrent(otherTabLease)).toBe(false);
    expect(() => requireCurrentAuthorityDraftLease(otherTabLease)).toThrow(
      'Draft authority lease is stale or unavailable',
    );
  });

  it('synchronously removes both persisted markers at logout so leftovers cannot be trusted', async () => {
    const authority = await reconcileAuthorityBoundDrafts(AUTHORITY_A);
    const staleLease = captureAuthorityDraftLease();
    localStorage.setItem('visit_draft_patient-1', '{"note":"must purge next boot"}');
    draftDb.put({ id: 'draft_patient-1', note: 'must purge next boot' });

    invalidatePersistedAuthorityDraftMarkersForLogout();

    expect(isAuthorityDraftLeaseCurrent(staleLease)).toBe(false);
    expect(localStorage.getItem(DRAFT_AUTHORITY_MARKER_KEY)).toBeNull();
    expect(sessionStorage.getItem(DRAFT_SESSION_AUTHORITY_MARKER_KEY)).toBeNull();
    // The synchronous fence does not pretend the asynchronous destruction ran.
    expect(localStorage.getItem('visit_draft_patient-1')).not.toBeNull();
    expect(draftDb.records()).toHaveLength(1);

    const nextBoot = await reconcileAuthorityBoundDrafts(AUTHORITY_A);
    expect(nextBoot).toEqual({ preserved: false, marker: authority.marker });
    expect(localStorage.getItem('visit_draft_patient-1')).toBeNull();
    expect(draftDb.records()).toEqual([]);
  });

  it('forces a same-authority purge after interrupted logout marker removal', async () => {
    const authority = await reconcileAuthorityBoundDrafts(AUTHORITY_A);
    localStorage.setItem('visit_draft_patient-1', '{"note":"must not return"}');
    draftDb.put({ id: 'draft_patient-1', note: 'must not return' });

    const nativeRemoveItem = Storage.prototype.removeItem;
    const removal = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function remove(key) {
      if (this === localStorage && key === DRAFT_AUTHORITY_MARKER_KEY) {
        throw new Error('marker removal interrupted');
      }
      return nativeRemoveItem.call(this, key);
    });
    expect(() => invalidatePersistedAuthorityDraftMarkersForLogout()).toThrow(
      'Authority draft marker invalidation failed',
    );
    removal.mockRestore();

    expect(localStorage.getItem(DRAFT_AUTHORITY_MARKER_KEY)).toBe(authority.marker);
    expect(localStorage.getItem(DRAFT_LOGOUT_TOMBSTONE_KEY)).toBe('required');
    expect(sessionStorage.getItem(DRAFT_SESSION_AUTHORITY_MARKER_KEY)).toBeNull();

    const nextLogin = await reconcileAuthorityBoundDrafts(AUTHORITY_A);
    expect(nextLogin.preserved).toBe(false);
    expect(localStorage.getItem('visit_draft_patient-1')).toBeNull();
    expect(draftDb.records()).toEqual([]);
    expect(localStorage.getItem(DRAFT_LOGOUT_TOMBSTONE_KEY)).toBeNull();
  });

  it('creates the exact draft store when strict cleanup opens a fresh browser database', async () => {
    const freshDraftDb = createDraftIndexedDbHarness([], {
      storeInitiallyExists: false,
      exposeDatabases: false,
    });
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: freshDraftDb.indexedDB,
    });

    await purgeAuthorityBoundDrafts();

    expect(freshDraftDb.storeExists()).toBe(true);
    expect(freshDraftDb.transactions.at(-1)).toEqual({
      storeName: 'draft_notes',
      mode: 'readwrite',
    });
  });

  it('does not let a stale digest continuation reactivate authority after a newer fence', async () => {
    const first = await reconcileAuthorityBoundDrafts(AUTHORITY_A);
    const digest = deferred();
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { subtle: { digest: () => digest.promise } },
    });

    const staleReconciliation = reconcileAuthorityBoundDrafts(AUTHORITY_B);
    expect(captureAuthorityDraftLease()).toBeNull();
    invalidateAuthorityDraftLeaseForTransition();
    digest.resolve(new Uint8Array(32).buffer);

    await expect(staleReconciliation).rejects.toThrow(
      'Draft authority reconciliation was superseded',
    );
    expect(captureAuthorityDraftLease()).toBeNull();
    expect(localStorage.getItem(DRAFT_AUTHORITY_MARKER_KEY)).toBe(first.marker);
    expect(sessionStorage.getItem(DRAFT_SESSION_AUTHORITY_MARKER_KEY)).toBe(first.marker);
  });

  it('rejects a failed destructive transaction and leaves no marker to falsely preserve', async () => {
    await reconcileAuthorityBoundDrafts(AUTHORITY_A);
    localStorage.setItem('visit_draft_patient-1', '{"note":"visit"}');
    draftDb.put({ id: 'draft_patient-1', note: 'durable note' });
    draftDb.setFailClear(true);

    await expect(reconcileAuthorityBoundDrafts(AUTHORITY_B)).rejects.toThrow(
      'Authority-bound draft purge failed',
    );

    expect(captureAuthorityDraftLease()).toBeNull();
    expect(localStorage.getItem(DRAFT_AUTHORITY_MARKER_KEY)).toBeNull();
    expect(sessionStorage.getItem(DRAFT_SESSION_AUTHORITY_MARKER_KEY)).toBeNull();
    expect(localStorage.getItem('visit_draft_patient-1')).toBeNull();
    expect(draftDb.records()).toEqual([{ id: 'draft_patient-1', note: 'durable note' }]);
  });

  it('does not persist an authority marker without an exact authority key', async () => {
    localStorage.setItem('visit_draft_patient-1', '{"note":"unresolved"}');

    await expect(reconcileAuthorityBoundDrafts('')).rejects.toThrow(
      'An exact tenant authority key is required',
    );

    expect(localStorage.getItem(DRAFT_AUTHORITY_MARKER_KEY)).toBeNull();
    expect(localStorage.getItem('visit_draft_patient-1')).toBe('{"note":"unresolved"}');
  });

  it('strictly purges and verifies re-fetchable PHI while preserving recovery work', async () => {
    const legacyDb = createLegacyPatientDbHarness([
      { id: 'patient-1', first_name: 'Sensitive' },
    ]);
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: legacyDb.indexedDB,
    });
    localStorage.setItem('offline_patients', '[{"id":"patient-1"}]');
    localStorage.setItem('recentPatients_user-a', '["patient-1"]');
    localStorage.setItem('penn_sync_offline_cache_roster', '{"data":[]}');
    sessionStorage.setItem('caremetric-mobile-tab-paths', '{"Patients":"/PatientDetails?id=patient-1"}');
    localStorage.setItem('visit_draft_patient-1', '{"note":"live"}');
    localStorage.setItem('pennsync.oasis.draft.v2|patient-1|SOC|E2|schema', '{"m1800":"1"}');
    sessionStorage.setItem('smart_note_draft_v2:patient-1', '{"note":"live"}');
    localStorage.setItem('offline_pending', '[{"id":"pending"}]');
    localStorage.setItem('offline_sync_queue', '[{"id":"queued"}]');
    localStorage.setItem('offline_conflicts', '[{"id":"manual"}]');

    await purgeRefetchablePhiForAuthorityTransition();

    expect(localStorage.getItem('offline_patients')).toBeNull();
    expect(localStorage.getItem('recentPatients_user-a')).toBeNull();
    expect(localStorage.getItem('penn_sync_offline_cache_roster')).toBeNull();
    expect(sessionStorage.getItem('caremetric-mobile-tab-paths')).toBeNull();
    expect(legacyDb.records()).toEqual([]);
    expect(legacyDb.transactions).toEqual([
      { storeName: 'patients', mode: 'readwrite' },
      { storeName: 'patients', mode: 'readonly' },
    ]);
    expect(localStorage.getItem('visit_draft_patient-1')).not.toBeNull();
    expect(localStorage.getItem('pennsync.oasis.draft.v2|patient-1|SOC|E2|schema')).not.toBeNull();
    expect(sessionStorage.getItem('smart_note_draft_v2:patient-1')).not.toBeNull();
    expect(localStorage.getItem('offline_pending')).not.toBeNull();
    expect(localStorage.getItem('offline_sync_queue')).not.toBeNull();
    expect(localStorage.getItem('offline_conflicts')).not.toBeNull();
  });

  it('starts the authoritative legacy patient clear without awaiting database enumeration', async () => {
    const legacyDb = createLegacyPatientDbHarness([
      { id: 'patient-1', first_name: 'Sensitive' },
    ]);
    legacyDb.indexedDB.databases = vi.fn(() => new Promise(() => {}));
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: legacyDb.indexedDB,
    });
    localStorage.setItem('offline_patients', '[{"id":"patient-1"}]');

    const purge = purgeRefetchablePhiForAuthorityTransition();

    expect(localStorage.getItem('offline_patients')).toBeNull();
    expect(legacyDb.indexedDB.databases).not.toHaveBeenCalled();
    expect(legacyDb.openCalls).toEqual(['base44-offline-db']);
    await purge;
    expect(legacyDb.records()).toEqual([]);
  });

  it('rejects when the legacy patient-store clear cannot be verified', async () => {
    const legacyDb = createLegacyPatientDbHarness(
      [{ id: 'patient-1', first_name: 'Sensitive' }],
      { ignoreClear: true },
    );
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: legacyDb.indexedDB,
    });

    await expect(purgeRefetchablePhiForAuthorityTransition()).rejects.toThrow(
      'Refetchable PHI purge failed',
    );
    expect(legacyDb.records()).toHaveLength(1);
  });
});
