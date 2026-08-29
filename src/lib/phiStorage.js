import {
  PURGE_FULL_PREFIXES,
  PURGE_SYNCED_KEYS,
  PURGE_AFTER_RETIREMENT_KEYS,
  OFFLINE_RETIRED_FLAG,
} from './localPhiKeys';

/**
 * Local PHI hygiene for shared/kiosk devices.
 *
 * Earlier versions cached re-fetchable PHI in localStorage (patient roster,
 * recently-viewed patients, OASIS extracts, cached chart data) and in the
 * `base44-offline-db` IndexedDB database. Offline mode is gone, so nothing writes
 * those any more — but a returning nurse's device can still hold them, and on
 * logout and idle session timeout they must be purged so the next user on the
 * same device cannot read the previous user's patient data.
 *
 * The key classification (purge fully, purge once retired, drop-synced, or
 * preserve) lives in ONE place — src/lib/localPhiKeys.js — and is derived here so
 * the registry and this purge can't drift apart. See that file for the rationale
 * on preserving the live visit-draft autosave (wiping it on a mid-visit idle
 * timeout would be silent loss of documented care), and on why the retired
 * offline queues are gated behind the retirement flag rather than purged
 * outright.
 */

const LEGACY_DB_NAME = 'base44-offline-db';
/** Only the re-fetchable roster is cleared; the queue and drafts are not ours. */
const LEGACY_PATIENT_STORE = 'patients';

/** Has retiredOfflineQueue.js confirmed every stranded item reached the server? */
function retirementCompleted() {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(OFFLINE_RETIRED_FLAG) === '1';
  } catch {
    return false;
  }
}

/**
 * Drop the already-synced entries from an offline-work queue while preserving
 * anything still pending sync. Best-effort: a malformed value is left untouched
 * (it isn't re-fetchable PHI we can safely interpret), never throwing.
 */
function purgeSyncedOfflineEntries() {
  if (typeof localStorage === 'undefined') return;
  for (const key of PURGE_SYNCED_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const items = JSON.parse(raw);
      if (!Array.isArray(items)) continue;
      const pending = items.filter((item) => !item?.synced);
      if (pending.length === 0) {
        localStorage.removeItem(key);
      } else if (pending.length !== items.length) {
        localStorage.setItem(key, JSON.stringify(pending));
      }
    } catch {
      /* malformed entry — leave as-is */
    }
  }
}

/**
 * Clear the retired IndexedDB patient roster.
 *
 * When the retirement flush cannot finish (device offline, or a queued write
 * failed) it deliberately keeps `base44-offline-db` for the next attempt — which
 * also keeps that database's cached `patients` roster readable by whoever uses
 * the device next. Only that store is cleared: `sync_queue` and `draft_notes` in
 * the same database hold unsynced work the retirement still has to recover.
 */
async function clearLegacyPatientCache() {
  if (typeof indexedDB === 'undefined') return;
  // Retirement deletes the whole database; don't recreate an empty one to clear it.
  if (retirementCompleted()) return;

  try {
    // Opening without a version CREATES the database when absent. Skip that
    // entirely on devices that never ran offline mode, where the API allows.
    if (typeof indexedDB.databases === 'function') {
      const databases = await indexedDB.databases();
      if (Array.isArray(databases) && !databases.some((entry) => entry?.name === LEGACY_DB_NAME)) return;
    }
  } catch {
    /* enumeration unsupported or blocked — fall through and try to open */
  }

  await new Promise((resolve) => {
    let open;
    try {
      // No version argument: never triggers an upgrade, so this cannot change the
      // schema of a database the retirement still needs to read.
      open = indexedDB.open(LEGACY_DB_NAME);
    } catch {
      return resolve();
    }
    open.onerror = () => resolve();
    open.onblocked = () => resolve();
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(LEGACY_PATIENT_STORE)) {
        db.close();
        return resolve();
      }
      try {
        const tx = db.transaction(LEGACY_PATIENT_STORE, 'readwrite');
        tx.objectStore(LEGACY_PATIENT_STORE).clear();
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); resolve(); };
      } catch {
        db.close();
        resolve();
      }
    };
  });
}

/**
 * Purge cached PHI from local storage. Best-effort and never throws. Async so
 * callers can keep awaiting it before redirecting on logout/timeout.
 */
export async function clearCachedPHI() {
  try {
    if (typeof localStorage !== 'undefined') {
      const prefixes = [...PURGE_FULL_PREFIXES];
      // The retired offline queues only come off the device once their contents
      // are on the server; before that they can be the sole copy of a visit note
      // or incident report captured in the field.
      if (retirementCompleted()) prefixes.push(...PURGE_AFTER_RETIREMENT_KEYS);

      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && prefixes.some((p) => key === p || key.startsWith(p))) {
          toRemove.push(key);
        }
      }
      toRemove.forEach((key) => localStorage.removeItem(key));
      // Drop the synced (already-on-server) copies from the retired work queues
      // while preserving anything still marked pending, which
      // lib/retiredOfflineQueue.js recovers on the next online load.
      purgeSyncedOfflineEntries();
    }
  } catch {
    /* storage unavailable — nothing to purge */
  }

  try {
    await clearLegacyPatientCache();
  } catch {
    /* indexedDB unavailable or clear failed — the localStorage purge still ran */
  }
}
