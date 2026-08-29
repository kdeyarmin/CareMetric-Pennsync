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
 *   PURGE_FULL         PHI or diagnostic logs → remove entirely on logout.
 *   PURGE_AFTER_RETIREMENT
 *                      retired offline work queues → remove ONLY once
 *                      retiredOfflineQueue.js has positively completed (its flag
 *                      is set). Until then they may hold the sole copy of visit
 *                      notes and incident reports captured in the field.
 *   PURGE_SYNCED       legacy work queues that tag already-synced items → drop
 *                      those, keep anything still marked pending until recovered.
 *   PRESERVE           LIVE unsynced local drafts → never wiped (wiping on a
 *                      15-minute idle timeout mid-visit would be silent loss of
 *                      documented care).
 *   NON_PHI            bookkeeping/metadata (timestamps, id maps) — no purge.
 *
 * On the retirement gate: the recovery flush needs a connection and a successful
 * write, so it legitimately fails and retries on the next load. Purging those
 * queues unconditionally on logout/idle destroyed exactly the work the flush had
 * deliberately kept — including the stores it preserved BECAUSE an item could not
 * be safely mapped — so the promised recovery could never happen. Gating on the
 * flag keeps both properties: unsynced care survives the session, and once it is
 * on the server the local copy stops outliving the session on a shared device.
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
];

/**
 * Set by lib/retiredOfflineQueue.js once it has flushed every stranded item to
 * the server. Lives here so the purge and the retirement agree on one flag.
 * Bookkeeping, not PHI — deliberately not a LOCAL_PHI_KEYS entry.
 */
export const OFFLINE_RETIRED_FLAG = 'pennsync_offline_retired';

/**
 * Retired offline work queues: PHI that must come off a shared device, but only
 * after retiredOfflineQueue.js has confirmed it reached the server. Purging these
 * before that destroyed unsynced field documentation on any logout or idle
 * timeout that happened while the device was offline.
 */
export const PURGE_AFTER_RETIREMENT_KEYS = [
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
