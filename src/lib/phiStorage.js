import { clearCachedPatients } from './indexedDB';
import { PURGE_FULL_PREFIXES, PURGE_SYNCED_KEYS } from './offlineKeys';

/**
 * Local PHI hygiene for shared/kiosk devices.
 *
 * The app caches re-fetchable PHI in localStorage and IndexedDB (patient roster,
 * recently-viewed patients, OASIS extracts, cached chart data). On logout and on
 * idle session timeout this must be purged so the next user on the same device
 * cannot read the previous user's patient data.
 *
 * The key classification (which keys to purge fully, drop-synced, or preserve)
 * now lives in ONE place — src/lib/offlineKeys.js — derived here, so the three
 * offline subsystems and this purge can't drift apart. See that file for the
 * rationale on preserving unsynced field work (wiping it on a mid-visit idle
 * timeout would be silent loss of documented care) vs. purging synced copies +
 * diagnostic logs (re-fetchable PHI that must not survive on a shared device).
 */

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
 * Purge re-fetchable cached PHI from local storage. Best-effort and never
 * throws. Returns a promise that resolves once the IndexedDB patient cache has
 * actually been cleared — await it before redirecting on logout/timeout so the
 * clear isn't abandoned mid-flight by the navigation, leaving the roster behind.
 */
export async function clearCachedPHI() {
  try {
    if (typeof localStorage !== 'undefined') {
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && PURGE_FULL_PREFIXES.some((p) => key === p || key.startsWith(p))) {
          toRemove.push(key);
        }
      }
      toRemove.forEach((key) => localStorage.removeItem(key));
      // Drop the synced (already-on-server) copies from the offline-work queues
      // while preserving anything still pending sync.
      purgeSyncedOfflineEntries();
    }
  } catch {
    /* storage unavailable — nothing to purge */
  }

  // Clear the IndexedDB patient cache (re-fetchable); preserves drafts/sync queue.
  try {
    await clearCachedPatients();
  } catch {
    /* indexedDB unavailable or clear failed — localStorage purge already done */
  }
}
