/**
 * offlineKeys — the SINGLE registry of every offline localStorage key the app has
 * used, plus how each is treated by the logout/idle PHI purge (clearCachedPHI).
 *
 * The offline mutation queue is now unified on the IndexedDB `sync_queue`
 * (src/lib/indexedDB.js + src/lib/offlineSync.js) — every offline write goes
 * through addToSyncQueue and one worker drains it. Several older localStorage
 * subsystems that each kept their own queue were removed in that consolidation:
 *   - src/components/mobile/OfflineStorage.jsx     (penn_sync_offline_*)  [deleted]
 *   - src/components/offline/OfflineSyncService.jsx (offline_sync_queue …) [deleted]
 *   - src/components/mobile/OfflineSyncManager.jsx  (offline_visit_drafts) [deleted]
 *
 * Their KEYS are deliberately retained here (and in the purge lists below): a
 * returning nurse may still have PHI left in localStorage under these keys by a
 * prior app version, and the logout/idle purge must keep cleaning that up. Live
 * code no longer writes them; the classification exists so the purge is DERIVED
 * from one list and a test can assert nothing is missed.
 *
 * Classification (HIPAA — shared/kiosk devices):
 *   PURGE_FULL    re-fetchable PHI or diagnostic logs → remove entirely on logout.
 *   PURGE_SYNCED  offline-work queues that retain already-synced copies → drop the
 *                 synced entries, KEEP anything still pending sync.
 *   PRESERVE      unsynced field documentation → NEVER wiped (wiping on a 15-min
 *                 idle timeout mid-visit would be silent loss of documented care).
 *   NON_PHI       bookkeeping/metadata (timestamps, id maps) — no purge needed.
 *
 * Note: the canonical IndexedDB sync_queue is PHI but is preserved across logout
 * by clearCachedPatients() (which clears only the patient cache store), matching
 * the PRESERVE treatment of the retired localStorage queues.
 */

export const OFFLINE_KEYS = {
  // ── retired mobile/OfflineStorage.jsx (prefix 'penn_sync_offline_') ────────────
  // Subsystem removed; keys kept so the purge still cleans stale data from prior
  // app versions on a returning nurse's device.
  PENN_PENDING_VISITS: 'penn_sync_offline_pending_visits',
  PENN_PENDING_UPDATES: 'penn_sync_offline_pending_updates',
  PENN_SYNC_ERRORS: 'penn_sync_offline_sync_errors',
  PENN_SYNC_STATUS: 'penn_sync_offline_sync_status',
  PENN_CACHE_PREFIX: 'penn_sync_offline_cache_', // cacheData(key) → penn_sync_offline_cache_<key>

  // ── retired offline/OfflineSyncService.jsx localStorage queue ─────────────────
  // Also removed; keys retained for stale-data purge only (no live writers).
  PENDING_VISITS: 'offline_pending_visits', // placeholder, never written
  PENDING_NOTES: 'offline_pending_notes',   //   ""
  PENDING_VITALS: 'offline_pending_vitals', //   ""
  PENDING_TASKS: 'offline_pending_tasks',   //   ""
  SYNC_QUEUE: 'offline_sync_queue',         // legacy LS mutation queue (PHI, unsynced)
  LAST_SYNC: 'offline_last_sync',
  CONFLICTS: 'offline_conflicts',
  ID_MAP: 'offline_id_map',

  // ── generic offline cache + drafts (OfflinePatientSelector, autosave drafts) ──
  PENDING: 'offline_pending',               // retired addPendingChange queue (stale-data purge)
  VISIT_DRAFTS: 'offline_visit_drafts',     // retired draft store (stale-data purge)
  PATIENTS: 'offline_patients',             // full cached patient roster
  PATIENT_DATA: 'offline_patient_data',
  CACHE_TIMESTAMP: 'offline_cache_timestamp',

  // ── per-entity prefixes (suffixed with a user/patient id at write time) ───────
  RECENT_PATIENTS_PREFIX: 'recentPatients_',
  FAVORITE_PATIENTS_PREFIX: 'favoritedPatients_',
  OASIS_DATA_PREFIX: 'oasis_data_',
  VISIT_DRAFT_PREFIX: 'visit_draft_',
};

const K = OFFLINE_KEYS;

/** Re-fetchable PHI / diagnostic logs — removed entirely (exact key or prefix). */
export const PURGE_FULL_PREFIXES = [
  K.PATIENTS, K.PATIENT_DATA, K.CACHE_TIMESTAMP,
  K.RECENT_PATIENTS_PREFIX, K.FAVORITE_PATIENTS_PREFIX, K.OASIS_DATA_PREFIX,
  K.PENN_CACHE_PREFIX, K.PENN_SYNC_ERRORS, K.PENN_SYNC_STATUS,
];

/** Offline-work queues: drop the synced entries, keep what's still pending. */
export const PURGE_SYNCED_KEYS = [K.PENN_PENDING_VISITS, K.PENN_PENDING_UPDATES];

/** Unsynced field documentation — intentionally preserved across logout/idle. */
export const PRESERVE_KEYS = [
  K.PENDING, K.VISIT_DRAFTS, K.CONFLICTS, K.SYNC_QUEUE, K.VISIT_DRAFT_PREFIX,
];

/** Bookkeeping/metadata (no PHI) — no purge needed. */
export const NON_PHI_KEYS = [
  K.LAST_SYNC, K.ID_MAP,
  K.PENDING_VISITS, K.PENDING_NOTES, K.PENDING_VITALS, K.PENDING_TASKS,
];
