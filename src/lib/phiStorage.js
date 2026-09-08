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

const CURRENT_DRAFT_DB_NAME = 'pennsync-drafts';
const CURRENT_DRAFT_STORE = 'draft_notes';
const LIVE_DRAFT_LOCAL_PREFIXES = Object.freeze([
  'visit_draft_',
  'pennsync.oasis.draft.v2',
]);
const REFETCHABLE_SESSION_KEYS = Object.freeze([
  // May retain patient/referral ids in saved deep-link query strings.
  'caremetric-mobile-tab-paths',
]);
const AUTHORITY_MARKER_DOMAIN = 'pennsync-authority-bound-drafts-v1\0';

/**
 * Contains only a domain-separated SHA-256 digest, never a user, membership, or
 * agency identifier. It is deliberately outside LOCAL_PHI_KEYS: the value is
 * authority bookkeeping and is removed by the authority-draft purge below.
 */
export const DRAFT_AUTHORITY_MARKER_KEY = 'pennsync.draft_authority.sha256.v1';
export const DRAFT_SESSION_AUTHORITY_MARKER_KEY = 'pennsync.session_draft_authority.sha256.v1';
export const DRAFT_LOGOUT_TOMBSTONE_KEY = 'pennsync.draft_logout_purge_required.v1';

let authorityDraftLeaseEpoch = 0;
let activeAuthorityKey = null;
let activeAuthorityDraftLease = null;
const authorityDraftLeaseMarkers = new WeakMap();

/**
 * Synchronous transition fence. AuthContext calls this at the very beginning of
 * every authority teardown, before awaiting pending mutations or browser-store
 * cleanup, so no old async continuation can start another durable draft write.
 */
export function invalidateAuthorityDraftLeaseForTransition() {
  authorityDraftLeaseEpoch += 1;
  activeAuthorityKey = null;
  activeAuthorityDraftLease = null;
}

// localStorage changes are delivered to every *other* same-origin tab. Revoke
// that tab's in-memory capability when logout fencing or a marker rotation is
// observed so an old tab cannot become writable again after a same-authority
// login recreates the deterministic authority digest.
if (typeof globalThis.addEventListener === 'function') {
  globalThis.addEventListener('storage', (event) => {
    if (
      event?.key === DRAFT_LOGOUT_TOMBSTONE_KEY
      || event?.key === DRAFT_AUTHORITY_MARKER_KEY
    ) {
      invalidateAuthorityDraftLeaseForTransition();
    }
  });
}

/**
 * Logout fence used before any asynchronous teardown. Removing both persisted
 * markers guarantees that an interrupted/abandoned purge cannot make the next
 * boot treat leftover drafts as proven same-authority state.
 */
export function invalidatePersistedAuthorityDraftMarkersForLogout() {
  invalidateAuthorityDraftLeaseForTransition();
  const errors = [];
  // Persist the destructive intent before removing either marker. If redirect
  // navigation interrupts the async purge—or marker removal itself fails—the
  // next reconciliation must purge even when the old digest matches the same
  // account. The tombstone is removed only after all draft stores are empty.
  try {
    const storage = requiredStorage('localStorage');
    storage.setItem(DRAFT_LOGOUT_TOMBSTONE_KEY, 'required');
    if (storage.getItem(DRAFT_LOGOUT_TOMBSTONE_KEY) !== 'required') {
      throw new Error('Local logout purge tombstone could not be persisted');
    }
  } catch (error) {
    errors.push(error);
  }
  try {
    const storage = requiredStorage('sessionStorage');
    storage.setItem(DRAFT_LOGOUT_TOMBSTONE_KEY, 'required');
    if (storage.getItem(DRAFT_LOGOUT_TOMBSTONE_KEY) !== 'required') {
      throw new Error('Session logout purge tombstone could not be persisted');
    }
  } catch (error) {
    errors.push(error);
  }
  try {
    const storage = requiredStorage('localStorage');
    storage.removeItem(DRAFT_AUTHORITY_MARKER_KEY);
    if (storage.getItem(DRAFT_AUTHORITY_MARKER_KEY) !== null) {
      throw new Error('Local authority marker could not be removed');
    }
  } catch (error) {
    errors.push(error);
  }
  try {
    const storage = requiredStorage('sessionStorage');
    storage.removeItem(DRAFT_SESSION_AUTHORITY_MARKER_KEY);
    if (storage.getItem(DRAFT_SESSION_AUTHORITY_MARKER_KEY) !== null) {
      throw new Error('Session authority marker could not be removed');
    }
  } catch (error) {
    errors.push(error);
  }
  aggregatePurgeErrors(errors, 'Authority draft marker invalidation failed');
}

function activateAuthorityDraftLease(exactAuthorityKey, marker) {
  authorityDraftLeaseEpoch += 1;
  const lease = Object.freeze({ epoch: authorityDraftLeaseEpoch });
  authorityDraftLeaseMarkers.set(lease, marker);
  activeAuthorityKey = exactAuthorityKey;
  activeAuthorityDraftLease = lease;
  return lease;
}

function requireAuthorityDraftOperationEpoch(expectedEpoch) {
  if (authorityDraftLeaseEpoch !== expectedEpoch) {
    throw new Error('Draft authority reconciliation was superseded');
  }
}

function requiredStorage(name) {
  let storage;
  try {
    storage = globalThis[name];
  } catch (error) {
    throw new Error(`${name} is unavailable`, { cause: error });
  }
  if (!storage) throw new Error(`${name} is unavailable`);
  return storage;
}

function aggregatePurgeErrors(errors, message = 'Authority-bound draft purge failed') {
  if (errors.length > 0) {
    throw new AggregateError(errors, message);
  }
}

function logoutDraftPurgeIsRequired() {
  return requiredStorage('localStorage').getItem(DRAFT_LOGOUT_TOMBSTONE_KEY) !== null
    || requiredStorage('sessionStorage').getItem(DRAFT_LOGOUT_TOMBSTONE_KEY) !== null;
}

function clearLogoutDraftPurgeTombstonesStrict() {
  const errors = [];
  for (const storageName of ['localStorage', 'sessionStorage']) {
    try {
      const storage = requiredStorage(storageName);
      storage.removeItem(DRAFT_LOGOUT_TOMBSTONE_KEY);
      if (storage.getItem(DRAFT_LOGOUT_TOMBSTONE_KEY) !== null) {
        throw new Error(`${storageName} logout purge tombstone could not be removed`);
      }
    } catch (error) {
      errors.push(error);
    }
  }
  aggregatePurgeErrors(errors);
}

function purgeLocalDraftsAndMarkerStrict() {
  const storage = requiredStorage('localStorage');
  const errors = [];
  const keys = [];

  try {
    storage.removeItem(DRAFT_AUTHORITY_MARKER_KEY);
    if (storage.getItem(DRAFT_AUTHORITY_MARKER_KEY) !== null) {
      throw new Error('Local authority marker could not be removed');
    }
  } catch (error) {
    errors.push(error);
  }

  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && LIVE_DRAFT_LOCAL_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        keys.push(key);
      }
    }
  } catch (error) {
    errors.push(error);
  }

  for (const key of keys) {
    try {
      storage.removeItem(key);
      if (storage.getItem(key) !== null) {
        throw new Error(`Local draft key could not be removed: ${key}`);
      }
    } catch (error) {
      errors.push(error);
    }
  }

  aggregatePurgeErrors(errors);
}

function purgeSessionStateStrict() {
  // Protected session state includes Smart Note drafts, its remembered patient,
  // and referral prepopulation notes. Clearing the whole per-tab store avoids a
  // future draft key silently escaping an incomplete prefix registry.
  const storage = requiredStorage('sessionStorage');
  storage.clear();
  if (storage.length !== 0) {
    throw new Error('Protected session state could not be cleared');
  }
}

/**
 * Clear the CURRENT durable draft store and resolve only after the read/write
 * transaction commits. Unlike the legacy database cleanup below, every failure
 * rejects: callers must keep the protected UI blocked when cross-authority
 * draft destruction cannot be proven complete.
 */
async function clearCurrentDraftNotesStrict() {
  if (typeof indexedDB === 'undefined') return;

  await new Promise((resolve, reject) => {
    let openRequest;
    try {
      openRequest = indexedDB.open(CURRENT_DRAFT_DB_NAME);
    } catch (error) {
      reject(error);
      return;
    }

    openRequest.onerror = () => {
      reject(openRequest.error || new Error('Draft database open failed'));
    };
    openRequest.onblocked = () => {
      reject(new Error('Draft database open was blocked'));
    };
    openRequest.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(CURRENT_DRAFT_STORE)) {
        db.createObjectStore(CURRENT_DRAFT_STORE, { keyPath: 'id' });
      }
    };
    openRequest.onsuccess = () => {
      const db = openRequest.result;
      if (!db.objectStoreNames.contains(CURRENT_DRAFT_STORE)) {
        db.close();
        resolve();
        return;
      }

      let transaction;
      try {
        transaction = db.transaction(CURRENT_DRAFT_STORE, 'readwrite');
        transaction.objectStore(CURRENT_DRAFT_STORE).clear();
      } catch (error) {
        db.close();
        reject(error);
        return;
      }

      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        db.close();
        callback(value);
      };
      transaction.oncomplete = () => finish(resolve);
      transaction.onerror = () => finish(
        reject,
        transaction.error || new Error('Draft clear transaction failed'),
      );
      transaction.onabort = () => finish(
        reject,
        transaction.error || new Error('Draft clear transaction aborted'),
      );
    };
  });
}

async function opaqueAuthorityMarker(exactAuthorityKey) {
  if (
    typeof exactAuthorityKey !== 'string'
    || exactAuthorityKey.length === 0
    || exactAuthorityKey.length > 4096
  ) {
    throw new TypeError('An exact tenant authority key is required');
  }
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof TextEncoder === 'undefined') {
    throw new Error('SHA-256 authority marker support is unavailable');
  }
  const encoded = new TextEncoder().encode(`${AUTHORITY_MARKER_DOMAIN}${exactAuthorityKey}`);
  const digest = await subtle.digest('SHA-256', encoded);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}`;
}

/**
 * Capture the current in-memory write capability before beginning asynchronous
 * draft work (including a dynamic import). A transition invalidates the object
 * by identity before destructive storage work begins, so an old component's
 * continuation cannot write under a newly activated authority.
 */
export function captureAuthorityDraftLease() {
  return activeAuthorityDraftLease;
}

/** True only while this exact lease and its persisted digest remain active. */
export function isAuthorityDraftLeaseCurrent(lease) {
  if (!lease || lease !== activeAuthorityDraftLease) return false;
  const marker = authorityDraftLeaseMarkers.get(lease);
  if (!marker) return false;
  try {
    const isCurrent = !logoutDraftPurgeIsRequired()
      && requiredStorage('localStorage').getItem(DRAFT_AUTHORITY_MARKER_KEY) === marker
      && requiredStorage('sessionStorage').getItem(DRAFT_SESSION_AUTHORITY_MARKER_KEY) === marker;
    if (!isCurrent) invalidateAuthorityDraftLeaseForTransition();
    return isCurrent;
  } catch {
    invalidateAuthorityDraftLeaseForTransition();
    return false;
  }
}

/**
 * Validate a captured lease immediately before an IndexedDB transaction and
 * return the opaque digest to bind onto its record.
 */
export function requireCurrentAuthorityDraftLease(lease) {
  if (!isAuthorityDraftLeaseCurrent(lease)) {
    throw new Error('Draft authority lease is stale or unavailable');
  }
  return authorityDraftLeaseMarkers.get(lease);
}

/**
 * Strictly destroy live draft state for the current browser authority and its
 * opaque marker. Retired offline recovery queues are intentionally untouched.
 *
 * Any failed destructive operation rejects. A caller must not mount another
 * tenant's protected tree after such a rejection.
 */
export async function purgeAuthorityBoundDrafts() {
  // Synchronous fence: stale async continuations are refused even while the
  // localStorage/sessionStorage/IndexedDB destruction below is still pending.
  invalidateAuthorityDraftLeaseForTransition();
  const errors = [];
  try {
    purgeLocalDraftsAndMarkerStrict();
  } catch (error) {
    errors.push(error);
  }
  try {
    purgeSessionStateStrict();
  } catch (error) {
    errors.push(error);
  }
  try {
    await clearCurrentDraftNotesStrict();
  } catch (error) {
    errors.push(error);
  }
  aggregatePurgeErrors(errors);
  clearLogoutDraftPurgeTombstonesStrict();
}

/**
 * Reconcile live browser drafts after an exact tenant authority is resolved.
 * The drafts survive only when the persisted opaque marker exactly matches this
 * authority. A missing/different marker first triggers a strict purge; only
 * after every destructive operation commits is the new marker persisted.
 *
 * @returns {{preserved: boolean, marker: string}} marker is an opaque digest.
 */
export async function reconcileAuthorityBoundDrafts(exactAuthorityKey) {
  if (
    typeof exactAuthorityKey !== 'string'
    || exactAuthorityKey.length === 0
    || exactAuthorityKey.length > 4096
  ) {
    throw new TypeError('An exact tenant authority key is required');
  }

  let logoutPurgeRequired;
  try {
    logoutPurgeRequired = logoutDraftPurgeIsRequired();
  } catch (error) {
    invalidateAuthorityDraftLeaseForTransition();
    throw error;
  }

  // The common revalidation path is synchronous up to its resolved Promise and
  // keeps the current lease alive. A changed key or tampered/missing persisted
  // marker revokes the old lease before SHA-256 or any destructive async work.
  if (
    !logoutPurgeRequired
    && activeAuthorityKey === exactAuthorityKey
    && activeAuthorityDraftLease
  ) {
    const activeMarker = authorityDraftLeaseMarkers.get(activeAuthorityDraftLease);
    let persistedMarker;
    try {
      persistedMarker = requiredStorage('localStorage').getItem(DRAFT_AUTHORITY_MARKER_KEY);
    } catch (error) {
      invalidateAuthorityDraftLeaseForTransition();
      throw error;
    }
    if (persistedMarker === activeMarker) {
      let sessionMarker;
      try {
        sessionMarker = requiredStorage('sessionStorage').getItem(
          DRAFT_SESSION_AUTHORITY_MARKER_KEY,
        );
      } catch (error) {
        invalidateAuthorityDraftLeaseForTransition();
        throw error;
      }
      if (sessionMarker === activeMarker) {
        return { preserved: true, marker: activeMarker };
      }
    }
    invalidateAuthorityDraftLeaseForTransition();
  } else if (activeAuthorityDraftLease || activeAuthorityKey) {
    invalidateAuthorityDraftLeaseForTransition();
  }

  // Reserve a unique epoch before the first await. A later transition/reconcile
  // synchronously advances it, preventing this continuation from writing stale
  // markers or reactivating an old lease when SHA-256/IndexedDB resumes.
  invalidateAuthorityDraftLeaseForTransition();
  const reconciliationEpoch = authorityDraftLeaseEpoch;
  const marker = await opaqueAuthorityMarker(exactAuthorityKey);
  requireAuthorityDraftOperationEpoch(reconciliationEpoch);
  const storage = requiredStorage('localStorage');
  const sharedMarkerMatches = !logoutPurgeRequired
    && storage.getItem(DRAFT_AUTHORITY_MARKER_KEY) === marker;
  if (sharedMarkerMatches) {
    const session = requiredStorage('sessionStorage');
    const sessionMarkerMatches = session.getItem(DRAFT_SESSION_AUTHORITY_MARKER_KEY) === marker;
    if (sessionMarkerMatches) {
      requireAuthorityDraftOperationEpoch(reconciliationEpoch);
      activateAuthorityDraftLease(exactAuthorityKey, marker);
      return { preserved: true, marker };
    }

    // localStorage and IndexedDB are shared by same-origin tabs and are already
    // proven to belong to this authority. sessionStorage is per-tab, so another
    // tab may have switched the shared marker while this tab still carries an
    // old Smart Note/referral draft. Clear only this unproved tab state; wiping
    // the proven shared stores here would destroy another same-authority tab's
    // valid draft.
    purgeSessionStateStrict();
    const writableSession = requiredStorage('sessionStorage');
    writableSession.setItem(DRAFT_SESSION_AUTHORITY_MARKER_KEY, marker);
    if (writableSession.getItem(DRAFT_SESSION_AUTHORITY_MARKER_KEY) !== marker) {
      throw new Error('Session authority marker could not be persisted');
    }
    requireAuthorityDraftOperationEpoch(reconciliationEpoch);
    activateAuthorityDraftLease(exactAuthorityKey, marker);
    return { preserved: false, marker };
  }

  const purge = purgeAuthorityBoundDrafts();
  const purgeEpoch = authorityDraftLeaseEpoch;
  await purge;
  requireAuthorityDraftOperationEpoch(purgeEpoch);

  const writableStorage = requiredStorage('localStorage');
  const writableSession = requiredStorage('sessionStorage');
  writableStorage.setItem(DRAFT_AUTHORITY_MARKER_KEY, marker);
  writableSession.setItem(DRAFT_SESSION_AUTHORITY_MARKER_KEY, marker);
  if (
    writableStorage.getItem(DRAFT_AUTHORITY_MARKER_KEY) !== marker
    || writableSession.getItem(DRAFT_SESSION_AUTHORITY_MARKER_KEY) !== marker
  ) {
    throw new Error('Authority markers could not be persisted');
  }
  requireAuthorityDraftOperationEpoch(purgeEpoch);
  activateAuthorityDraftLease(exactAuthorityKey, marker);
  return { preserved: false, marker };
}

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

function purgeTargetedStorageStrict(storageName, matchers) {
  const storage = requiredStorage(storageName);
  const keys = [];
  const errors = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && matchers.some((prefix) => key === prefix || key.startsWith(prefix))) {
        keys.push(key);
      }
    }
  } catch (error) {
    errors.push(error);
  }
  for (const key of keys) {
    try {
      storage.removeItem(key);
      if (storage.getItem(key) !== null) throw new Error(`${storageName} key was not removed`);
    } catch (error) {
      errors.push(error);
    }
  }
  aggregatePurgeErrors(errors);
}

async function clearAndVerifyLegacyPatientCacheStrict() {
  if (typeof indexedDB === 'undefined') return;

  await new Promise((resolve, reject) => {
    let request;
    let db = null;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      try { db?.close(); } catch { /* transaction result remains authoritative */ }
      callback(value);
    };
    try {
      request = indexedDB.open(LEGACY_DB_NAME);
    } catch (error) {
      reject(error);
      return;
    }
    request.onerror = () => finish(
      reject,
      request.error || new Error('Legacy patient database open failed'),
    );
    request.onblocked = () => finish(reject, new Error('Legacy patient database open blocked'));
    request.onsuccess = () => {
      db = request.result;
      if (settled) {
        try { db.close(); } catch { /* already rejected */ }
        return;
      }
      try {
        if (!db.objectStoreNames.contains(LEGACY_PATIENT_STORE)) {
          finish(resolve);
          return;
        }
        const clearTx = db.transaction(LEGACY_PATIENT_STORE, 'readwrite');
        clearTx.objectStore(LEGACY_PATIENT_STORE).clear();
        clearTx.onerror = () => finish(
          reject,
          clearTx.error || new Error('Legacy patient cache clear failed'),
        );
        clearTx.onabort = () => finish(
          reject,
          clearTx.error || new Error('Legacy patient cache clear aborted'),
        );
        clearTx.oncomplete = () => {
          if (settled) return;
          try {
            const verifyTx = db.transaction(LEGACY_PATIENT_STORE, 'readonly');
            const countRequest = verifyTx.objectStore(LEGACY_PATIENT_STORE).count();
            let remaining = null;
            countRequest.onsuccess = () => { remaining = countRequest.result; };
            countRequest.onerror = () => finish(
              reject,
              countRequest.error || new Error('Legacy patient cache verification failed'),
            );
            verifyTx.onerror = () => finish(
              reject,
              verifyTx.error || new Error('Legacy patient verification transaction failed'),
            );
            verifyTx.onabort = () => finish(
              reject,
              verifyTx.error || new Error('Legacy patient verification transaction aborted'),
            );
            verifyTx.oncomplete = () => {
              if (remaining !== 0) {
                finish(reject, new Error('Legacy patient cache was not empty after clear'));
              } else {
                finish(resolve);
              }
            };
          } catch (error) {
            finish(reject, error);
          }
        };
      } catch (error) {
        finish(reject, error);
      }
    };
  });
}

/**
 * Strict authority-transition purge for re-fetchable PHI only. Live drafts and
 * every retired/quarantined recovery queue remain untouched for their separate
 * authority reconciliation or supervised recovery flows. Any removal, commit,
 * or verification failure rejects so the protected tree stays blocked.
 */
export async function purgeRefetchablePhiForAuthorityTransition() {
  const errors = [];
  try {
    purgeTargetedStorageStrict('localStorage', PURGE_FULL_PREFIXES);
  } catch (error) {
    errors.push(error);
  }
  try {
    purgeTargetedStorageStrict('sessionStorage', REFETCHABLE_SESSION_KEYS);
  } catch (error) {
    errors.push(error);
  }
  try {
    await clearAndVerifyLegacyPatientCacheStrict();
  } catch (error) {
    errors.push(error);
  }
  aggregatePurgeErrors(errors, 'Refetchable PHI purge failed');
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
