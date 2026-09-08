export const TENANT_BROWSER_AUTHORITY_EPOCH_KEY = 'pennsync_tenant_browser_authority_epoch_v1';
export const TENANT_BROWSER_AUTHORITY_REVOCATION_PREFIX =
  'pennsync_tenant_browser_authority_revoked_v1:';

const MAX_EPOCH_LENGTH = 200;
const TENANT_BROWSER_AUTHORITY_PROBE_PREFIX =
  'pennsync_tenant_browser_authority_probe_v1:';
let memoryEpoch = null;

function exactEpoch(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_EPOCH_LENGTH;
}

function freshEpoch() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function browserStorage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch (error) {
    // A real browser document without shared storage cannot uphold the
    // synchronous cross-tab boundary. Only non-browser runtimes use memory.
    throw sharedStorageError(error);
  }
}

function revocationKey(epoch) {
  return `${TENANT_BROWSER_AUTHORITY_REVOCATION_PREFIX}${epoch}`;
}

function sharedStorageError(error) {
  return new Error('Shared browser authority storage is unavailable', { cause: error });
}

function verifyWritable(storage, epoch) {
  const probeKey = `${TENANT_BROWSER_AUTHORITY_PROBE_PREFIX}${epoch}`;
  try {
    if (storage.getItem(TENANT_BROWSER_AUTHORITY_EPOCH_KEY) !== epoch) {
      throw new Error('Shared browser authority epoch changed');
    }
    // Never rewrite the current pointer here: another tab may rotate it after
    // the initial read. A distinct probe establishes writability without
    // allowing this stale context to restore its old epoch.
    storage.setItem(probeKey, '1');
    if (storage.getItem(probeKey) !== '1') {
      throw new Error('Shared browser authority probe did not persist');
    }
    if (storage.getItem(TENANT_BROWSER_AUTHORITY_EPOCH_KEY) !== epoch) {
      throw new Error('Shared browser authority epoch changed');
    }
    storage.removeItem(probeKey);
  } catch (error) {
    try { storage.removeItem(probeKey); } catch { /* preserve original failure */ }
    throw sharedStorageError(error);
  }
}

export function readBrowserAuthorityEpoch() {
  const storage = browserStorage();
  if (!storage) return memoryEpoch;
  try {
    return storage.getItem(TENANT_BROWSER_AUTHORITY_EPOCH_KEY);
  } catch (error) {
    throw sharedStorageError(error);
  }
}

/** Establish a fresh shared epoch for a new browser authority realm. */
export function rotateBrowserAuthorityEpoch() {
  const next = freshEpoch();
  const storage = browserStorage();
  if (!storage) {
    memoryEpoch = next;
    return next;
  }

  let previous = null;
  try {
    previous = storage.getItem(TENANT_BROWSER_AUTHORITY_EPOCH_KEY);
    if (previous === next) {
      throw new Error('Shared browser authority epoch did not rotate');
    }
    // A new epoch is unpublished and therefore cannot legitimately be revoked.
    // Clear/verify its slot before publishing the pointer. Removing this marker
    // afterward would race with another tab that observes and revokes `next`,
    // resurrecting authority that was already closed.
    const nextRevocation = revocationKey(next);
    storage.removeItem(nextRevocation);
    if (storage.getItem(nextRevocation) !== null) {
      throw new Error('Shared browser authority revocation slot did not clear');
    }
    storage.setItem(TENANT_BROWSER_AUTHORITY_EPOCH_KEY, next);
    if (storage.getItem(TENANT_BROWSER_AUTHORITY_EPOCH_KEY) !== next) {
      throw new Error('Shared browser authority epoch did not persist');
    }
  } catch (error) {
    throw sharedStorageError(error);
  }
  memoryEpoch = next;
  // Once the current pointer differs, old gates fail synchronously without a
  // marker. Retiring that marker keeps localStorage bounded across sessions.
  if (exactEpoch(previous) && previous !== next) {
    try { storage.removeItem(revocationKey(previous)); } catch { /* mismatch is sufficient */ }
  }
  return next;
}

/**
 * Revoke one pinned epoch without overwriting a newer tab's current epoch.
 * This per-epoch tombstone avoids a stale tab replacing newly established
 * authority during a compare-then-set race.
 */
export function invalidateBrowserAuthorityEpoch(expected = readBrowserAuthorityEpoch()) {
  const storage = browserStorage();
  if (!storage) {
    memoryEpoch = freshEpoch();
    return true;
  }
  if (!exactEpoch(expected)) return true;
  try {
    if (storage.getItem(TENANT_BROWSER_AUTHORITY_EPOCH_KEY) !== expected) return true;
    const key = revocationKey(expected);
    storage.setItem(key, '1');
    if (storage.getItem(key) !== '1') {
      throw new Error('Shared browser authority revocation did not persist');
    }
    return true;
  } catch (error) {
    throw sharedStorageError(error);
  }
}

export function browserAuthorityEpochMatches(expected) {
  if (!exactEpoch(expected)) return false;
  try {
    const storage = browserStorage();
    if (!storage) return memoryEpoch === expected;
    return storage.getItem(TENANT_BROWSER_AUTHORITY_EPOCH_KEY) === expected
      && storage.getItem(revocationKey(expected)) !== '1';
  } catch {
    return false;
  }
}

export function ensureBrowserAuthorityEpoch() {
  const current = readBrowserAuthorityEpoch();
  if (exactEpoch(current) && browserAuthorityEpochMatches(current)) {
    const storage = browserStorage();
    if (storage) verifyWritable(storage, current);
    return current;
  }
  return rotateBrowserAuthorityEpoch();
}

export function isBrowserAuthorityEpochStorageKey(key) {
  return key === TENANT_BROWSER_AUTHORITY_EPOCH_KEY
    || (typeof key === 'string' && key.startsWith(TENANT_BROWSER_AUTHORITY_REVOCATION_PREFIX));
}
