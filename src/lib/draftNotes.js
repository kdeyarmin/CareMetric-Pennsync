/**
 * draftNotes — durable local autosave for a clinical note that is still being
 * written. NOT an offline queue.
 *
 * Offline mode is gone, and with it the `base44-offline-db` database that used
 * to hold the mutation queue, the patient cache AND this draft store. Draft
 * recovery is a different feature: it exists so a nurse who closes the tab,
 * runs out of battery, or crashes the browser mid-note does not lose the text
 * they had typed. SmartNoteAssistant also mirrors the draft into sessionStorage,
 * which covers a reload but not a closed tab — this is the durable half.
 *
 * Kept on its OWN database so the retired offline one can be deleted outright.
 * The content is PHI: it is the nurse's in-progress note. It is deliberately not
 * wiped by the logout/idle purge (see lib/localPhiKeys.js — wiping unsubmitted
 * documentation on a 15-minute idle timeout mid-visit would be silent loss of
 * documented care); it is cleared when the note is saved to the chart.
 */

const DB_NAME = 'pennsync-drafts';
const DB_VERSION = 1;
const STORE = 'draft_notes';

let dbPromise = null;

function openDB() {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB unavailable'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => {
      dbPromise = null; // let the next call retry rather than caching the failure
      reject(request.error || new Error('IndexedDB open failed'));
    };
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
  });
  return dbPromise;
}

/**
 * Resolve only once the TRANSACTION COMMITS.
 *
 * `request.onsuccess` fires when the operation is staged, NOT when it is
 * durable — the transaction can still abort afterwards (quota exceeded, the tab
 * closing mid-commit). Resolving on request success therefore reported a draft
 * as saved for writes that were then rolled back, in exactly the low-storage
 * conditions this store exists to survive.
 */
function whenTransactionCommits(tx, request) {
  const asError = (value, fallback) =>
    value instanceof Error ? value : new Error(value?.message || fallback);

  return new Promise((resolve, reject) => {
    let result;
    let failed = false;
    const fail = (value, fallback) => {
      failed = true;
      reject(asError(value, fallback));
    };
    if (request) {
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => fail(request.error, 'IndexedDB request failed');
    }
    tx.oncomplete = () => { if (!failed) resolve(result); };
    tx.onerror = () => fail(tx.error, 'IndexedDB transaction failed');
    tx.onabort = () => fail(tx.error, 'IndexedDB transaction aborted');
  });
}

/** Save (or replace) the draft under a caller-chosen id. */
export const saveDraftNoteLocally = async (noteData) => {
  const db = await openDB();
  const tx = db.transaction(STORE, 'readwrite');
  const request = tx.objectStore(STORE).put({ ...noteData, savedAt: Date.now() });
  return whenTransactionCommits(tx, request);
};

/** Read a draft back, or undefined when there is none. */
export const getDraftNoteLocally = async (id) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

/** Drop a draft once its note has reached the chart. */
export const deleteDraftNoteLocally = async (id) => {
  const db = await openDB();
  const tx = db.transaction(STORE, 'readwrite');
  const request = tx.objectStore(STORE).delete(id);
  return whenTransactionCommits(tx, request);
};
