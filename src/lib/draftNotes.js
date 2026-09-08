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
 * The content is PHI: it is the nurse's in-progress note. Records are stamped
 * with the opaque digest from an exact authority lease. Same-authority refresh
 * recovery preserves them; logout, account/tenant changes, or an unprovable
 * authority purge them before another protected tree can mount.
 */

import {
  isAuthorityDraftLeaseCurrent,
  requireCurrentAuthorityDraftLease,
} from '@/lib/phiStorage';

const DB_NAME = 'pennsync-drafts';
const DB_VERSION = 1;
const STORE = 'draft_notes';
const AUTHORITY_FIELD = 'authority_marker';

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

/** Save (or replace) a draft under one captured, still-current authority. */
export const saveDraftNoteLocally = async (noteData, authorityLease) => {
  const authorityMarker = requireCurrentAuthorityDraftLease(authorityLease);
  const db = await openDB();
  // Recheck after the asynchronous open and immediately before transaction
  // creation. If an old component resumed after a tenant switch, it cannot
  // enqueue its write behind the new authority's completed clear transaction.
  if (requireCurrentAuthorityDraftLease(authorityLease) !== authorityMarker) {
    throw new Error('Draft authority changed before save');
  }
  const tx = db.transaction(STORE, 'readwrite');
  const request = tx.objectStore(STORE).put({
    ...noteData,
    savedAt: Date.now(),
    [AUTHORITY_FIELD]: authorityMarker,
  });
  return whenTransactionCommits(tx, request);
};

/** Read a draft only when its record and caller carry the exact current digest. */
export const getDraftNoteLocally = async (id, authorityLease) => {
  const authorityMarker = requireCurrentAuthorityDraftLease(authorityLease);
  const db = await openDB();
  if (requireCurrentAuthorityDraftLease(authorityLease) !== authorityMarker) {
    throw new Error('Draft authority changed before read');
  }
  const tx = db.transaction(STORE, 'readonly');
  const request = tx.objectStore(STORE).get(id);
  const record = await whenTransactionCommits(tx, request);
  if (!isAuthorityDraftLeaseCurrent(authorityLease)) {
    throw new Error('Draft authority changed during read');
  }
  if (!record || record[AUTHORITY_FIELD] !== authorityMarker) return undefined;
  const result = { ...record };
  delete result[AUTHORITY_FIELD];
  return result;
};

/** Drop only a draft owned by the captured current authority. */
export const deleteDraftNoteLocally = async (id, authorityLease) => {
  const authorityMarker = requireCurrentAuthorityDraftLease(authorityLease);
  const db = await openDB();
  if (requireCurrentAuthorityDraftLease(authorityLease) !== authorityMarker) {
    throw new Error('Draft authority changed before delete');
  }
  const tx = db.transaction(STORE, 'readwrite');
  const objectStore = tx.objectStore(STORE);
  const request = objectStore.get(id);

  return new Promise((resolve, reject) => {
    let deleted = false;
    let failed = false;
    const fail = (value, fallback) => {
      if (failed) return;
      failed = true;
      reject(value instanceof Error ? value : new Error(value?.message || fallback));
    };
    request.onerror = () => fail(request.error, 'IndexedDB draft read failed');
    request.onsuccess = () => {
      try {
        if (requireCurrentAuthorityDraftLease(authorityLease) !== authorityMarker) {
          throw new Error('Draft authority changed during delete');
        }
        if (request.result?.[AUTHORITY_FIELD] === authorityMarker) {
          objectStore.delete(id);
          deleted = true;
        }
      } catch (error) {
        try { tx.abort(); } catch { /* transaction may already be inactive */ }
        fail(error, 'Draft delete failed');
      }
    };
    tx.oncomplete = () => { if (!failed) resolve(deleted); };
    tx.onerror = () => fail(tx.error, 'IndexedDB transaction failed');
    tx.onabort = () => fail(tx.error, 'IndexedDB transaction aborted');
  });
};
