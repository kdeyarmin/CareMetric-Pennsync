import { QUEUE_CHANGED_EVENT } from '@/lib/offlineQueueEvent';

const DB_NAME = 'base44-offline-db';
const DB_VERSION = 1;

export const STORES = {
  PATIENTS: 'patients',
  DRAFT_NOTES: 'draft_notes',
  SYNC_QUEUE: 'sync_queue'
};

/**
 * Resolve only once the TRANSACTION COMMITS.
 *
 * `request.onsuccess` fires when the operation is staged, NOT when it is
 * durable — the transaction can still abort afterwards (quota exceeded, the tab
 * closing mid-commit, a storage error). Resolving on request success therefore
 * reported "saved offline" for writes that were then rolled back, which for
 * addToSyncQueue and saveDraftNoteLocally means a nurse's visit note or incident
 * silently disappearing in exactly the low-storage field conditions the offline
 * queue exists to survive. Waiting for `oncomplete` makes the resolved promise
 * mean the write is actually committed.
 *
 * Exported for direct testing of that contract.
 *
 * @param {IDBTransaction} tx
 * @param {IDBRequest} [request] optional — its result becomes the resolved value
 * @returns {Promise<any>}
 */
export function whenTransactionCommits(tx, request) {
  return new Promise((resolve, reject) => {
    let result;
    let failed = false;
    if (request) {
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => { failed = true; reject(request.error); };
    }
    tx.oncomplete = () => { if (!failed) resolve(result); };
    tx.onerror = () => { failed = true; reject(tx.error); };
    tx.onabort = () => {
      failed = true;
      reject(tx.error || new Error('IndexedDB transaction aborted'));
    };
  });
}

// One shared connection. Every exported call used to open its OWN connection and
// never close it; useOfflineQueue polls the pending count every 5 seconds, so a
// single shift leaked thousands of open IDBDatabase handles — and open
// connections block a future `onupgradeneeded`, so a schema bump would hang.
let dbPromise = null;

const openDB = () => {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      // Drop the memo if the connection goes away (another tab upgrading the
      // schema, or the browser evicting it) so the next call reopens instead of
      // handing out a dead handle forever.
      db.onclose = () => { dbPromise = null; };
      db.onversionchange = () => {
        dbPromise = null;
        db.close();
      };
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORES.PATIENTS)) {
        db.createObjectStore(STORES.PATIENTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.DRAFT_NOTES)) {
        db.createObjectStore(STORES.DRAFT_NOTES, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(STORES.SYNC_QUEUE)) {
        db.createObjectStore(STORES.SYNC_QUEUE, { keyPath: 'id', autoIncrement: true });
      }
    };
  });

  // A failed open must not be memoized, or every later call rejects forever.
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
};

export const savePatients = async (patients) => {
  const db = await openDB();
  const tx = db.transaction(STORES.PATIENTS, 'readwrite');
  const store = tx.objectStore(STORES.PATIENTS);
  patients.forEach(p => store.put(p));
  return whenTransactionCommits(tx);
};

export const getPatientsLocally = async () => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.PATIENTS, 'readonly');
    const store = tx.objectStore(STORES.PATIENTS);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const saveDraftNoteLocally = async (noteData) => {
  const db = await openDB();
  const tx = db.transaction(STORES.DRAFT_NOTES, 'readwrite');
  const store = tx.objectStore(STORES.DRAFT_NOTES);
  const request = store.put({ ...noteData, updatedAt: Date.now() });
  return whenTransactionCommits(tx, request);
};

/** Fetch a single draft by its (string) id, or null when absent. */
export const getDraftNoteLocally = async (id) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.DRAFT_NOTES, 'readonly');
    const store = tx.objectStore(STORES.DRAFT_NOTES);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
};

export const deleteDraftNoteLocally = async (id) => {
  const db = await openDB();
  const tx = db.transaction(STORES.DRAFT_NOTES, 'readwrite');
  const store = tx.objectStore(STORES.DRAFT_NOTES);
  const request = store.delete(id);
  return whenTransactionCommits(tx, request);
};

export const addToSyncQueue = async (action, payload) => {
  const db = await openDB();
  const tx = db.transaction(STORES.SYNC_QUEUE, 'readwrite');
  const store = tx.objectStore(STORES.SYNC_QUEUE);
  const request = store.put({ action, payload, createdAt: Date.now() });
  // Await the COMMIT before telling the caller (and the UI) the work is queued.
  const id = await whenTransactionCommits(tx, request);
  // Let any mounted sync-status widget refresh its pending count immediately
  // instead of waiting for its poll tick. The event name is shared with
  // offlineSync.js via a dependency-free module so the two can't drift.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(QUEUE_CHANGED_EVENT));
  }
  return id;
};

export const getSyncQueue = async () => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.SYNC_QUEUE, 'readonly');
    const store = tx.objectStore(STORES.SYNC_QUEUE);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const removeFromSyncQueue = async (id) => {
  const db = await openDB();
  const tx = db.transaction(STORES.SYNC_QUEUE, 'readwrite');
  const store = tx.objectStore(STORES.SYNC_QUEUE);
  const request = store.delete(id);
  return whenTransactionCommits(tx, request);
};

/**
 * Clear the locally-cached patient roster (PHI) on logout/timeout.
 *
 * Deliberately clears ONLY the re-fetchable PATIENTS cache and leaves
 * DRAFT_NOTES and SYNC_QUEUE intact: those hold unsynced field work, and wiping
 * them when a 15-minute idle timeout fires mid-visit (often while offline) would
 * be silent data loss. Re-fetchable patient PHI is purged; pending writes survive
 * until they sync.
 */
export const clearCachedPatients = async () => {
  const db = await openDB();
  const tx = db.transaction(STORES.PATIENTS, 'readwrite');
  const store = tx.objectStore(STORES.PATIENTS);
  const request = store.clear();
  // HIPAA purge: only report success once the clear is actually committed.
  return whenTransactionCommits(tx, request);
};