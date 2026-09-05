import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const AUTHORITY_A = '["user-a","nurse@example.test","agency-a","membership-a",4,"nurse",false]';
const AUTHORITY_B = '["user-a","nurse@example.test","agency-b","membership-b",9,"nurse",false]';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function restoreGlobal(name, descriptor) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete globalThis[name];
}

/** Transactional store used by the real draftNotes implementation. */
function createIndexedDbHarness() {
  const records = new Map();
  const transactions = [];
  const deferredOpenRequests = [];
  let deferNextOpen = false;

  const database = {
    objectStoreNames: { contains: (name) => name === 'draft_notes' },
    close() {},
    transaction(storeName, mode) {
      if (storeName !== 'draft_notes') throw new Error(`Unknown store: ${storeName}`);
      transactions.push({ storeName, mode });
      let pending = 0;
      let completionQueued = false;
      let aborted = false;
      const transaction = {
        error: null,
        abort() {
          if (aborted) return;
          aborted = true;
          queueMicrotask(() => transaction.onabort?.({ target: transaction }));
        },
        objectStore(name) {
          if (name !== storeName) throw new Error(`Unknown store: ${name}`);
          const enqueue = (operation) => {
            const request = {};
            pending += 1;
            queueMicrotask(() => {
              if (aborted) return;
              try {
                request.result = operation();
                request.onsuccess?.({ target: request });
              } catch (error) {
                request.error = error;
                transaction.error = error;
                request.onerror?.({ target: request });
                transaction.onerror?.({ target: transaction });
              } finally {
                pending -= 1;
                if (pending === 0 && !completionQueued && !transaction.error && !aborted) {
                  completionQueued = true;
                  queueMicrotask(() => {
                    if (!aborted) transaction.oncomplete?.({ target: transaction });
                  });
                }
              }
            });
            return request;
          };
          return {
            clear: () => enqueue(() => { records.clear(); }),
            put: (record) => enqueue(() => {
              records.set(record.id, structuredClone(record));
              return record.id;
            }),
            get: (id) => enqueue(() => {
              const record = records.get(id);
              return record ? structuredClone(record) : undefined;
            }),
            delete: (id) => enqueue(() => { records.delete(id); }),
          };
        },
      };
      return transaction;
    },
  };

  const succeedOpen = (request) => {
    request.result = database;
    request.onsuccess?.({ target: request });
  };

  return {
    indexedDB: {
      databases: async () => [{ name: 'pennsync-drafts', version: 1 }],
      open(name) {
        const request = {};
        if (name !== 'pennsync-drafts') {
          queueMicrotask(() => {
            request.error = new Error(`Unknown database: ${name}`);
            request.onerror?.({ target: request });
          });
        } else if (deferNextOpen) {
          deferNextOpen = false;
          deferredOpenRequests.push(request);
        } else {
          queueMicrotask(() => succeedOpen(request));
        }
        return request;
      },
    },
    deferOneOpen() { deferNextOpen = true; },
    releaseDeferredOpen() {
      const request = deferredOpenRequests.shift();
      if (!request) throw new Error('No deferred IndexedDB open');
      queueMicrotask(() => succeedOpen(request));
    },
    putRaw(record) { records.set(record.id, structuredClone(record)); },
    records: () => Array.from(records.values(), (record) => structuredClone(record)),
    transactions,
  };
}

describe('authority-bound durable Smart Note drafts', () => {
  let indexedDbDescriptor;
  let cryptoDescriptor;
  let draftDb;
  let phiStorage;
  let draftNotes;

  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDbDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    draftDb = createIndexedDbHarness();
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: draftDb.indexedDB,
    });
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: webcrypto,
    });
    vi.resetModules();
    phiStorage = await import('./phiStorage');
    draftNotes = await import('./draftNotes');
  });

  afterEach(() => {
    restoreGlobal('indexedDB', indexedDbDescriptor);
    restoreGlobal('crypto', cryptoDescriptor);
    vi.resetModules();
  });

  it('stamps records and restores them only through the same current lease', async () => {
    const authority = await phiStorage.reconcileAuthorityBoundDrafts(AUTHORITY_A);
    const lease = phiStorage.captureAuthorityDraftLease();

    await draftNotes.saveDraftNoteLocally({
      id: 'draft_patient-1',
      note: 'same-authority note',
      patientId: 'patient-1',
    }, lease);

    expect(draftDb.records()[0]).toMatchObject({
      id: 'draft_patient-1',
      note: 'same-authority note',
      authority_marker: authority.marker,
    });
    const restored = await draftNotes.getDraftNoteLocally('draft_patient-1', lease);
    expect(restored).toMatchObject({
      id: 'draft_patient-1',
      note: 'same-authority note',
      patientId: 'patient-1',
    });
    expect(restored.authority_marker).toBeUndefined();
    await expect(
      draftNotes.deleteDraftNoteLocally('draft_patient-1', lease),
    ).resolves.toBe(true);
    expect(draftDb.records()).toEqual([]);
  });

  it('refuses a stored record carrying another authority digest', async () => {
    const first = await phiStorage.reconcileAuthorityBoundDrafts(AUTHORITY_A);
    await phiStorage.reconcileAuthorityBoundDrafts(AUTHORITY_B);
    const currentLease = phiStorage.captureAuthorityDraftLease();
    draftDb.putRaw({
      id: 'draft_patient-1',
      note: 'foreign note',
      authority_marker: first.marker,
    });

    await expect(
      draftNotes.getDraftNoteLocally('draft_patient-1', currentLease),
    ).resolves.toBeUndefined();
    await expect(
      draftNotes.deleteDraftNoteLocally('draft_patient-1', currentLease),
    ).resolves.toBe(false);
    expect(draftDb.records()).toHaveLength(1);
  });

  it('on reload preserves a selected matching marker and purges a different selection', async () => {
    const first = await phiStorage.reconcileAuthorityBoundDrafts(AUTHORITY_A);
    const lease = phiStorage.captureAuthorityDraftLease();
    localStorage.setItem('visit_draft_patient-1', '{"note":"visit"}');
    sessionStorage.setItem('smart_note_draft_v2:patient-1', '{"note":"session"}');
    await draftNotes.saveDraftNoteLocally({
      id: 'draft_patient-1',
      note: 'durable note',
    }, lease);

    // A browser reload has persisted stores but no in-memory lease/key. The
    // selector remains locked until the user chooses; choosing the exact prior
    // authority must recover rather than silently discard the work.
    vi.resetModules();
    const reloadedSameAuthority = await import('./phiStorage');
    const same = await reloadedSameAuthority.reconcileAuthorityBoundDrafts(AUTHORITY_A);

    expect(same).toEqual({ preserved: true, marker: first.marker });
    expect(localStorage.getItem('visit_draft_patient-1')).toBe('{"note":"visit"}');
    expect(sessionStorage.getItem('smart_note_draft_v2:patient-1')).toBe('{"note":"session"}');
    expect(draftDb.records()).toHaveLength(1);

    // A separate reload followed by choosing another membership has no trusted
    // continuity. It must clear every live surface before activating that lease.
    vi.resetModules();
    const reloadedOtherAuthority = await import('./phiStorage');
    const other = await reloadedOtherAuthority.reconcileAuthorityBoundDrafts(AUTHORITY_B);

    expect(other.preserved).toBe(false);
    expect(other.marker).not.toBe(first.marker);
    expect(localStorage.getItem('visit_draft_patient-1')).toBeNull();
    expect(sessionStorage.getItem('smart_note_draft_v2:patient-1')).toBeNull();
    expect(
      sessionStorage.getItem(reloadedOtherAuthority.DRAFT_SESSION_AUTHORITY_MARKER_KEY),
    ).toBe(other.marker);
    expect(draftDb.records()).toEqual([]);
  });

  it('clears stale per-tab session drafts when another tab already set the shared marker', async () => {
    const first = await phiStorage.reconcileAuthorityBoundDrafts(AUTHORITY_A);

    // Obtain B's valid shared marker, then reconstruct tab B's independent old-A
    // session state. In browsers, localStorage/IndexedDB are shared while each
    // tab owns a separate sessionStorage area.
    const second = await phiStorage.reconcileAuthorityBoundDrafts(AUTHORITY_B);
    localStorage.setItem('visit_draft_patient-b', '{"note":"shared B draft"}');
    draftDb.putRaw({
      id: 'draft_patient-b',
      note: 'durable B draft',
      authority_marker: second.marker,
    });
    sessionStorage.clear();
    sessionStorage.setItem(
      phiStorage.DRAFT_SESSION_AUTHORITY_MARKER_KEY,
      first.marker,
    );
    sessionStorage.setItem('smart_note_draft_v2:patient-a', '{"note":"stale A note"}');

    vi.resetModules();
    const staleTabBoot = await import('./phiStorage');
    const result = await staleTabBoot.reconcileAuthorityBoundDrafts(AUTHORITY_B);

    expect(result).toEqual({ preserved: false, marker: second.marker });
    expect(sessionStorage.getItem('smart_note_draft_v2:patient-a')).toBeNull();
    expect(
      sessionStorage.getItem(staleTabBoot.DRAFT_SESSION_AUTHORITY_MARKER_KEY),
    ).toBe(second.marker);
    // The shared surfaces were already proven B and remain available to B.
    expect(localStorage.getItem('visit_draft_patient-b')).toBe('{"note":"shared B draft"}');
    expect(draftDb.records()).toEqual([{
      id: 'draft_patient-b',
      note: 'durable B draft',
      authority_marker: second.marker,
    }]);
  });

  it('rejects a stale deferred write that resumes after another authority activates', async () => {
    await phiStorage.reconcileAuthorityBoundDrafts(AUTHORITY_A);
    const staleLease = phiStorage.captureAuthorityDraftLease();
    draftDb.deferOneOpen();
    const pendingOldWrite = draftNotes.saveDraftNoteLocally({
      id: 'draft_patient-1',
      note: 'old authority note',
    }, staleLease);

    const transition = phiStorage.reconcileAuthorityBoundDrafts(AUTHORITY_B);
    expect(phiStorage.isAuthorityDraftLeaseCurrent(staleLease)).toBe(false);
    await transition;
    draftDb.releaseDeferredOpen();

    await expect(pendingOldWrite).rejects.toThrow('Draft authority lease is stale or unavailable');
    expect(draftDb.records()).toEqual([]);

    // This is the dynamic-import form of the same race: the old component
    // captured its lease before loading draftNotes, but calls save only later.
    await expect(draftNotes.saveDraftNoteLocally({
      id: 'draft_patient-2',
      note: 'late old authority note',
    }, staleLease)).rejects.toThrow('Draft authority lease is stale or unavailable');
    expect(draftDb.records()).toEqual([]);
  });

  it('does not let an old post-save continuation delete the new authority same-id draft', async () => {
    await phiStorage.reconcileAuthorityBoundDrafts(AUTHORITY_A);
    const staleComponentLease = phiStorage.captureAuthorityDraftLease();
    const backendSave = deferred();
    const lateClear = backendSave.promise.then(() => (
      draftNotes.deleteDraftNoteLocally('draft_patient-1', staleComponentLease)
    ));

    await phiStorage.reconcileAuthorityBoundDrafts(AUTHORITY_B);
    const currentLease = phiStorage.captureAuthorityDraftLease();
    await draftNotes.saveDraftNoteLocally({
      id: 'draft_patient-1',
      note: 'new authority note',
    }, currentLease);

    backendSave.resolve();
    await expect(lateClear).rejects.toThrow('Draft authority lease is stale or unavailable');
    await expect(
      draftNotes.getDraftNoteLocally('draft_patient-1', currentLease),
    ).resolves.toMatchObject({ note: 'new authority note' });
  });
});
