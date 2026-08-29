/**
 * localPhiKeys — the SINGLE registry of every local-storage key the app has ever
 * used to hold PHI, plus how each is treated by the logout/idle purge
 * (clearCachedPHI).
 *
 * OFFLINE MODE HAS BEEN REMOVED. Nothing in the app writes an offline queue or
 * patient cache any more. The keys below are kept for one reason: a returning
 * nurse's device may still hold PHI written under them by an earlier version,
 * and the logout/idle purge has to keep cleaning that up. The classification
 * lives here so the purge is DERIVED from one list and a test can assert no key
 * is missed.
 *
 * Classification (HIPAA — shared/kiosk devices):
 *   PURGE_FULL    PHI or diagnostic logs → remove entirely on logout.
 *   PURGE_SYNCED  legacy work queues that tag already-synced items → drop those,
 *                 keep anything still marked pending until it is recovered.
 *   PRESERVE      LIVE unsynced local drafts → never wiped (wiping on a 15-minute
 *                 idle timeout mid-visit would be silent loss of documented care).
 *   NON_PHI       bookkeeping/metadata (timestamps, id maps) — no purge needed.
 *
 * Anything a retired offline queue still holds is recovered once, on the next
 * online load, by lib/retiredOfflineQueue.js — which then deletes it. That
 * recovery is what allows these to be purge-on-logout rather than kept forever.
 */

export const LOCAL_PHI_KEYS = {
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

  // ── retired app-params key ────────────────────────────────────────────────────
  // Prior app versions persisted the full landing URL (which can carry
  // ?patientId=/?referral_id= deep-link params) under this key on every load.
  // No live code writes or reads it anymore; kept so the purge cleans the stale
  // copy off shared devices.
  APP_PARAM_FROM_URL: 'base44_from_url',
};

const K = LOCAL_PHI_KEYS;

/** Re-fetchable PHI / diagnostic logs — removed entirely (exact key or prefix). */
export const PURGE_FULL_PREFIXES = [
  K.PATIENTS, K.PATIENT_DATA, K.CACHE_TIMESTAMP,
  K.RECENT_PATIENTS_PREFIX, K.FAVORITE_PATIENTS_PREFIX, K.OASIS_DATA_PREFIX,
  K.PENN_CACHE_PREFIX, K.PENN_SYNC_ERRORS, K.PENN_SYNC_STATUS,
  K.APP_PARAM_FROM_URL,
  // Retired offline queues. These used to be PRESERVEd because the sync worker
  // would eventually upload them; with offline mode gone nothing ever will, so
  // retiredOfflineQueue.js recovers their contents once and the purge then stops
  // them outliving the session on a shared device.
  K.PENDING, K.VISIT_DRAFTS, K.CONFLICTS, K.SYNC_QUEUE,
];

/** Offline-work queues: drop the synced entries, keep what's still pending. */
export const PURGE_SYNCED_KEYS = [K.PENN_PENDING_VISITS, K.PENN_PENDING_UPDATES];

/**
 * LIVE unsynced local drafts — intentionally preserved across logout/idle.
 *
 * Only the visit-draft autosave remains (the OASIS assessment editor writes
 * `visit_draft_oasis_<patient>_<type>`). It is a refresh-recovery draft, not an
 * offline queue, so it survives the removal of offline mode — and wiping it on
 * an idle timeout mid-assessment would discard work the nurse is still typing.
 */
export const PRESERVE_KEYS = [K.VISIT_DRAFT_PREFIX];

/** Bookkeeping/metadata (no PHI) — no purge needed. */
export const NON_PHI_KEYS = [
  K.LAST_SYNC, K.ID_MAP,
  K.PENDING_VISITS, K.PENDING_NOTES, K.PENDING_VITALS, K.PENDING_TASKS,
];
