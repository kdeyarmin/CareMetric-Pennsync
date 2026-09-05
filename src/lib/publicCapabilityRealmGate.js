const MAX_CAPABILITY_SNAPSHOT_LENGTH = 16_000;

const leaseRecords = new WeakMap();
let activeLease = null;
let generation = 0;

function exactCapabilitySnapshot(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_CAPABILITY_SNAPSHOT_LENGTH
    && value.trim() === value;
}

export class PublicCapabilityRealmClosedError extends Error {
  constructor() {
    super('Public link operation unavailable while its capability is being verified');
    this.name = 'PublicCapabilityRealmClosedError';
    this.code = 'PUBLIC_CAPABILITY_REALM_CLOSED';
  }
}

export class StalePublicCapabilityOperationError extends Error {
  constructor() {
    super('Public link operation expired because the capability changed');
    this.name = 'StalePublicCapabilityOperationError';
    this.code = 'STALE_PUBLIC_CAPABILITY_OPERATION';
  }
}

function abortLease(lease) {
  const record = lease && leaseRecords.get(lease);
  try {
    record?.controller.abort();
  } catch {
    // Revocation must remain synchronous even if AbortController is missing or
    // a browser implementation throws unexpectedly.
  }
}

/**
 * Begin one exact public URL capability realm. Every activation revokes the
 * previous lease, even when the URL is identical, so browser history changes
 * cannot revive an old signer/follow-up/OAuth continuation.
 */
export function activatePublicCapabilityRealm(capabilitySnapshot) {
  if (!exactCapabilitySnapshot(capabilitySnapshot)) {
    closePublicCapabilityRealm();
    throw new TypeError('An exact public capability snapshot is required');
  }

  if (activeLease) abortLease(activeLease);
  generation += 1;
  const lease = Object.freeze({});
  leaseRecords.set(lease, {
    capabilitySnapshot,
    controller: new AbortController(),
    generation,
  });
  activeLease = lease;
  return lease;
}

/** Revoke only the supplied current lease; stale React cleanups are harmless. */
export function closePublicCapabilityRealm(lease = activeLease) {
  if (!lease || lease !== activeLease) return false;
  abortLease(lease);
  activeLease = null;
  generation += 1;
  return true;
}

export function isPublicCapabilityLeaseCurrent(lease) {
  const record = lease && leaseRecords.get(lease);
  return !!record
    && lease === activeLease
    && record.generation === generation
    && record.controller.signal.aborted === false;
}

export function hasActivePublicCapabilityRealm() {
  return activeLease !== null && isPublicCapabilityLeaseCurrent(activeLease);
}

export function assertPublicCapabilityLeaseCurrent(lease) {
  if (!isPublicCapabilityLeaseCurrent(lease)) {
    throw new StalePublicCapabilityOperationError();
  }
  return lease;
}

export function getPublicCapabilityAbortSignal(lease) {
  assertPublicCapabilityLeaseCurrent(lease);
  return leaseRecords.get(lease).controller.signal;
}

/**
 * Fence an exact raw public request at invocation and settlement. Callers that
 * perform several awaited native stages should put the entire stage chain in
 * `operation` or assert the lease between stages.
 */
export function runPublicCapabilityOperation(lease, operation) {
  if (!isPublicCapabilityLeaseCurrent(lease)) {
    return Promise.reject(new PublicCapabilityRealmClosedError());
  }
  if (typeof operation !== 'function') {
    return Promise.reject(new TypeError('A public capability operation is required'));
  }

  const operationGeneration = generation;
  let result;
  try {
    result = operation({ signal: leaseRecords.get(lease).controller.signal });
  } catch (error) {
    if (!isPublicCapabilityLeaseCurrent(lease) || generation !== operationGeneration) {
      return Promise.reject(new StalePublicCapabilityOperationError());
    }
    return Promise.reject(error);
  }

  return Promise.resolve(result).then(
    (value) => {
      if (!isPublicCapabilityLeaseCurrent(lease) || generation !== operationGeneration) {
        throw new StalePublicCapabilityOperationError();
      }
      return value;
    },
    (error) => {
      if (!isPublicCapabilityLeaseCurrent(lease) || generation !== operationGeneration) {
        throw new StalePublicCapabilityOperationError();
      }
      throw error;
    },
  );
}
