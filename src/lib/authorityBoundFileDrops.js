import {
  captureTenantSdkRealmLease,
  getTenantSdkRealmAbortSignal,
  isTenantSdkRealmLeaseCurrent,
} from '@/lib/tenantSdkRealmGate';

const guardRecords = new WeakMap();
const DROP_ZONE_ATTRIBUTE = 'data-authority-file-drop-zone';

function transferContainsFiles(transfer) {
  if (!transfer) return false;
  try {
    if (Number(transfer.files?.length) > 0) return true;
  } catch {
    // Continue with the drag metadata available in protected drag mode.
  }
  try {
    if (Array.from(transfer.items || []).some((item) => item?.kind === 'file')) return true;
  } catch {
    // Some WebKit versions expose a non-iterable DataTransferItemList.
  }
  try {
    const types = transfer.types;
    if (typeof types?.contains === 'function' && types.contains('Files')) return true;
    return Array.from(types || []).includes('Files');
  } catch {
    return false;
  }
}

function clearTransfer(transfer) {
  try { transfer?.items?.clear?.(); } catch { /* native drop data can be read-only */ }
  try { transfer?.clearData?.(); } catch { /* native drop data can be read-only */ }
}

function blockEvent(event) {
  clearTransfer(event.dataTransfer);
  try { event.dataTransfer.dropEffect = 'none'; } catch { /* native drop effect can be read-only */ }
  event.preventDefault();
  event.stopImmediatePropagation();
}

function eventTargetsEnabledDropZone(event) {
  let path = [];
  try { path = event.composedPath?.() || []; } catch { /* use parent traversal below */ }
  if (path.length === 0) {
    let node = event.target;
    while (node) {
      path.push(node);
      node = node.parentNode || node.host || null;
    }
  }
  return path.some((node) => (
    node?.hasAttribute?.(DROP_ZONE_ATTRIBUTE)
    && node.disabled !== true
    && node.getAttribute?.('aria-disabled') !== 'true'
  ));
}

function targetBelongsToDocument(documentObject, target) {
  if (!target) return false;
  try {
    return target === documentObject
      || target === documentObject.defaultView
      || documentObject.documentElement?.contains(target) === true
      || target.getRootNode?.({ composed: true }) === documentObject;
  } catch {
    return false;
  }
}

/**
 * Bind an OS/browser file drag to the exact tenant realm in which it entered
 * the document. Native drag payloads cannot always be erased, so stale drops
 * are also stopped in document capture before React or application listeners
 * can observe DataTransfer.files.
 */
export function installAuthorityBoundFileDropGuard(documentObject = document) {
  let installation = guardRecords.get(documentObject);
  if (installation) {
    installation.references += 1;
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      installation.removeReference();
    };
  }

  const ownerWindow = documentObject.defaultView;
  let activeRecord = null;

  const discardRecord = (record) => {
    if (!record || record.discarded) return;
    record.discarded = true;
    record.activeEvent = null;
    if (record.signal && record.abort) {
      try { record.signal.removeEventListener('abort', record.abort); } catch { /* already gone */ }
    }
    if (activeRecord === record) activeRecord = null;
  };

  const captureSession = ({ acquireAuthority = true } = {}) => {
    const record = {
      abort: null,
      activeEvent: null,
      consumed: false,
      depth: 0,
      discarded: false,
      lease: null,
      signal: null,
      stale: true,
    };
    activeRecord = record;

    // Orphan dragover cannot be treated as a new trusted gesture. Latch the
    // session denied so a later synthetic dragenter cannot authorize it.
    if (!acquireAuthority) return record;

    try {
      record.lease = captureTenantSdkRealmLease();
      record.signal = getTenantSdkRealmAbortSignal(record.lease);
      record.stale = false;
    } catch {
      return record;
    }

    record.abort = () => {
      record.stale = true;
      if (record.activeEvent) blockEvent(record.activeEvent);
    };
    record.signal.addEventListener('abort', record.abort, { once: true });
    if (!isTenantSdkRealmLeaseCurrent(record.lease)) record.abort();
    return record;
  };

  const keepEventArmedThroughDispatch = (record, event) => {
    record.activeEvent = event;
    const disarm = () => {
      if (record.activeEvent === event) record.activeEvent = null;
    };
    if (typeof ownerWindow?.queueMicrotask === 'function') ownerWindow.queueMicrotask(disarm);
    else Promise.resolve().then(disarm);
  };

  const discardIfDragStartWasCancelled = (record, event) => {
    const finish = () => {
      if (event.defaultPrevented && activeRecord === record) {
        discardRecord(record);
      }
    };
    if (typeof ownerWindow?.queueMicrotask === 'function') ownerWindow.queueMicrotask(finish);
    else Promise.resolve().then(finish);
  };

  const recordIsCurrent = (record) => (
    !!record
    && !record.discarded
    && !record.stale
    && isTenantSdkRealmLeaseCurrent(record.lease)
  );

  const captureDragStart = (event) => {
    // dragstart definitively begins a new in-document drag. Capture even when
    // the browser has not populated file metadata yet, then retain the session
    // across the distinct DataTransfer wrappers created for later DnD events.
    discardRecord(activeRecord);
    const record = captureSession();
    if (transferContainsFiles(event.dataTransfer)) {
      if (!recordIsCurrent(record)) blockEvent(event);
      else keepEventArmedThroughDispatch(record, event);
    }
    discardIfDragStartWasCancelled(record, event);
  };

  const captureDragEnter = (event) => {
    if (!transferContainsFiles(event.dataTransfer)) return;
    const record = activeRecord || captureSession();
    record.depth += 1;
    if (!recordIsCurrent(record) || !eventTargetsEnabledDropZone(event)) blockEvent(event);
    else {
      // Canceling dragenter selects this marked element as the immediate drop
      // target in the HTML DnD processing model without hiding the event from
      // the component's own handlers.
      event.preventDefault();
      keepEventArmedThroughDispatch(record, event);
    }
  };

  const captureDragOver = (event) => {
    if (!transferContainsFiles(event.dataTransfer)) return;
    const record = activeRecord || captureSession({ acquireAuthority: false });
    if (!recordIsCurrent(record) || !eventTargetsEnabledDropZone(event)) blockEvent(event);
    else {
      event.preventDefault();
      keepEventArmedThroughDispatch(record, event);
    }
  };

  const captureDragLeave = (event) => {
    if (!activeRecord || !transferContainsFiles(event.dataTransfer)) return;
    const record = activeRecord;
    record.depth = Math.max(0, record.depth - 1);
    const relatedTarget = event.relatedTarget;
    const explicitlyOutside = relatedTarget
      && !targetBelongsToDocument(documentObject, relatedTarget);
    // Standards-compliant engines identify an in-document next target via
    // relatedTarget. Older WebKit reports null even for parent/child moves, so
    // retain the gesture until its balanced enter/leave depth reaches zero.
    if (explicitlyOutside || (!relatedTarget && record.depth === 0)) {
      discardRecord(activeRecord);
    }
  };

  const captureDrop = (event) => {
    const transfer = event.dataTransfer;
    const record = activeRecord;
    if (!transferContainsFiles(transfer)) {
      discardRecord(record);
      return;
    }
    if (
      !recordIsCurrent(record)
      || record.consumed
      || !eventTargetsEnabledDropZone(event)
    ) {
      if (record) record.stale = true;
      blockEvent(event);
      discardRecord(record);
      return;
    }

    // Keep the abort hook live for the remainder of this event dispatch. If a
    // later capture listener closes authority synchronously, React must still
    // be prevented from observing the files.
    record.consumed = true;
    keepEventArmedThroughDispatch(record, event);
    const finish = () => discardRecord(record);
    if (typeof ownerWindow?.queueMicrotask === 'function') ownerWindow.queueMicrotask(finish);
    else Promise.resolve().then(finish);
  };

  const finishDrag = () => discardRecord(activeRecord);

  const finishAllDrags = () => discardRecord(activeRecord);

  documentObject.addEventListener('dragstart', captureDragStart, true);
  documentObject.addEventListener('dragenter', captureDragEnter, true);
  documentObject.addEventListener('dragover', captureDragOver, true);
  documentObject.addEventListener('dragleave', captureDragLeave, true);
  documentObject.addEventListener('drop', captureDrop, true);
  documentObject.addEventListener('dragend', finishDrag, true);
  ownerWindow?.addEventListener('pagehide', finishAllDrags);

  installation = {
    references: 1,
    removeReference() {
      this.references -= 1;
      if (this.references > 0) return;
      documentObject.removeEventListener('dragstart', captureDragStart, true);
      documentObject.removeEventListener('dragenter', captureDragEnter, true);
      documentObject.removeEventListener('dragover', captureDragOver, true);
      documentObject.removeEventListener('dragleave', captureDragLeave, true);
      documentObject.removeEventListener('drop', captureDrop, true);
      documentObject.removeEventListener('dragend', finishDrag, true);
      ownerWindow?.removeEventListener('pagehide', finishAllDrags);
      finishAllDrags();
      guardRecords.delete(documentObject);
    },
  };
  guardRecords.set(documentObject, installation);

  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    installation.removeReference();
  };
}
