/**
 * offlineKeys — the SINGLE registry of every offline localStorage key the app
 * uses, plus how each is treated by the logout/idle PHI purge (clearCachedPHI).
 *
 * Historically three offline subsystems each kept their own key constants:
 *   - src/components/mobile/OfflineStorage.jsx     (penn_sync_offline_*)
 *   - src/components/offline/OfflineSyncService.jsx (offline_*)
 *   - the IndexedDB SYNC_QUEUE (src/lib/indexedDB.js — IndexedDB stores, not LS)
 * Those overlapping namespaces made it impossible to audit whether the PHI purge
 * covered every key. This module unifies the localStorage namespace so the purge
 * is DERIVED from one classified list and a test can assert nothing is missed.
 *
 * Classification (HIPAA — shared/kiosk devices):
 *   PURGE_FULL    re-fetchable PHI or diagnostic logs → remove entirely on logout.
 *   PURGE_SYNCED  offline-work queues that retain already-synced copies → drop the
 *                 synced entries, KEEP anything still pending sync.
 *   PRESERVE      unsynced field documentation → NEVER wiped (wiping on a 15-min
 *                 idle timeout mid-visit would be silent loss of documented care).
 *   NON_PHI       bookkeeping/metadata (timestamps, id maps) — no purge needed.
 */

export const OFFLINE_KEYS = {
  // ── mobile/OfflineStorage.jsx (STORAGE_PREFIX = 'penn_sync_offline_') ──────────
  PENN_PENDING_VISITS: 'penn_sync_offline_pending_visits',
  PENN_PENDING_UPDATES: 'penn_sync_offline_pending_updates',
  PENN_SYNC_ERRORS: 'penn_sync_offline_sync_errors',
  PENN_SYNC_STATUS: 'penn_sync_offline_sync_status',
  PENN_CACHE_PREFIX: 'penn_sync_offline_cache_', // cacheData(key) → penn_sync_offline_cache_<key>

  // ── offline/OfflineSyncService.jsx ────────────────────────────────────────────
  PENDING_VISITS: 'offline_pending_visits', // declared in STORAGE_KEYS (currently unused)
  PENDING_NOTES: 'offline_pending_notes',   //   ""
  PENDING_VITALS: 'offline_pending_vitals', //   ""
  PENDING_TASKS: 'offline_pending_tasks',   //   ""
  SYNC_QUEUE: 'offline_sync_queue',         // the live mutation queue (PHI, unsynced)
  LAST_SYNC: 'offline_last_sync',
  CONFLICTS: 'offline_conflicts',           // shared with OfflineStorage.storeConflict
  ID_MAP: 'offline_id_map',

  // ── generic offline cache + drafts (OfflineStorage / OfflinePatientSelector) ──
  PENDING: 'offline_pending',               // OfflineStorage.addPendingChange queue
  VISIT_DRAFTS: 'offline_visit_drafts',
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
