import { PURGE_FULL_PREFIXES, PURGE_SYNCED_KEYS } from './localPhiKeys';

/**
 * Local PHI hygiene for shared/kiosk devices.
 *
 * Earlier versions cached re-fetchable PHI in localStorage (patient roster,
 * recently-viewed patients, OASIS extracts, cached chart data). Offline mode is
 * gone, so nothing writes those any more — but a returning nurse's device can
 * still hold them, and on logout and idle session timeout they must be purged so
 * the next user on the same device cannot read the previous user's patient data.
 *
 * The key classification (purge fully, drop-synced, or preserve) lives in ONE
 * place — src/lib/localPhiKeys.js — and is derived here so the registry and this
 * purge can't drift apart. See that file for the rationale on preserving the live
 * visit-draft autosave (wiping it on a mid-visit idle timeout would be silent loss
 * of documented care) vs. purging everything else.
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
 * Purge cached PHI from local storage. Best-effort and never throws. Async so
 * callers can keep awaiting it before redirecting on logout/timeout.
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
      // Drop the synced (already-on-server) copies from the retired work queues
      // while preserving anything still marked pending, which
      // lib/retiredOfflineQueue.js recovers on the next online load.
      purgeSyncedOfflineEntries();
    }
  } catch {
    /* storage unavailable — nothing to purge */
  }
}
