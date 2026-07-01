/**
 * The DOM CustomEvent name dispatched whenever the canonical offline queue (the
 * IndexedDB sync_queue) changes — an item enqueued (addToSyncQueue) or drained
 * (drainSyncQueue). Mounted status widgets listen for it to refresh their pending
 * count immediately instead of waiting for their poll tick.
 *
 * It lives in this dependency-free leaf module so both src/lib/indexedDB.js and
 * src/lib/offlineSync.js can import the single source of truth without creating an
 * import cycle between them (indexedDB.js must not import offlineSync.js, which
 * imports it back). A rename here updates both sides at once.
 */
export const QUEUE_CHANGED_EVENT = 'offline-queue-changed';
