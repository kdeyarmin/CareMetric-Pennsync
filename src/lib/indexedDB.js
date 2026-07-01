const DB_NAME = 'base44-offline-db';
const DB_VERSION = 1;

export const STORES = {
  PATIENTS: 'patients',
  DRAFT_NOTES: 'draft_notes',
  SYNC_QUEUE: 'sync_queue'
};

const openDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

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
};

export const savePatients = async (patients) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.PATIENTS, 'readwrite');
    const store = tx.objectStore(STORES.PATIENTS);
    patients.forEach(p => store.put(p));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
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
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.DRAFT_NOTES, 'readwrite');
    const store = tx.objectStore(STORES.DRAFT_NOTES);
    const request = store.put({ ...noteData, updatedAt: Date.now() });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const getDraftNotesLocally = async () => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.DRAFT_NOTES, 'readonly');
    const store = tx.objectStore(STORES.DRAFT_NOTES);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
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
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.DRAFT_NOTES, 'readwrite');
    const store = tx.objectStore(STORES.DRAFT_NOTES);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const addToSyncQueue = async (action, payload) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.SYNC_QUEUE, 'readwrite');
    const store = tx.objectStore(STORES.SYNC_QUEUE);
    const request = store.put({ action, payload, createdAt: Date.now() });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
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
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.SYNC_QUEUE, 'readwrite');
    const store = tx.objectStore(STORES.SYNC_QUEUE);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
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
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.PATIENTS, 'readwrite');
    const store = tx.objectStore(STORES.PATIENTS);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};