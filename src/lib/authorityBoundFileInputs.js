import {
  captureTenantSdkRealmLease,
  getTenantSdkRealmAbortSignal,
  isTenantSdkRealmLeaseCurrent,
} from '@/lib/tenantSdkRealmGate';

const guardRecords = new WeakMap();

function isFileInput(value) {
  return value?.tagName === 'INPUT' && String(value.type || '').toLowerCase() === 'file';
}

function clearInput(input) {
  try { input.value = ''; } catch { /* constrained or already detached */ }
}

/**
 * Bind native file-picker activation to the exact tenant realm that launched
 * it. A chooser cannot itself be cancelled, but its eventual `change` event is
 * intercepted in capture phase before React or application listeners can read
 * files after a logout, cross-tab token change, or authority transition.
 */
export function installAuthorityBoundFileInputGuard(documentObject = document) {
  let record = guardRecords.get(documentObject);
  if (record) {
    record.references += 1;
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      record.removeReference();
    };
  }

  const pickerLeases = new WeakMap();
  const ownerWindow = documentObject.defaultView;
  const inputPrototype = ownerWindow?.HTMLInputElement?.prototype;
  const nativeShowPicker = inputPrototype?.showPicker;

  const discardLease = (input) => {
    const prior = pickerLeases.get(input);
    if (prior) {
      try { prior.signal.removeEventListener('abort', prior.abort); } catch { /* already gone */ }
      pickerLeases.delete(input);
    }
  };

  const preparePicker = (input) => {
    if (!isFileInput(input)) return true;
    discardLease(input);
    let lease;
    let signal;
    try {
      lease = captureTenantSdkRealmLease();
      signal = getTenantSdkRealmAbortSignal(lease);
    } catch {
      clearInput(input);
      return false;
    }
    const abort = () => {
      clearInput(input);
      pickerLeases.delete(input);
    };
    pickerLeases.set(input, { abort, lease, signal });
    signal.addEventListener('abort', abort, { once: true });
    if (!isTenantSdkRealmLeaseCurrent(lease)) {
      abort();
      return false;
    }
    return true;
  };

  const stopStaleActivation = (event) => {
    if (!isFileInput(event.target) || preparePicker(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const stopStaleSelection = (event) => {
    const input = event.target;
    if (!isFileInput(input)) return;
    const picker = pickerLeases.get(input);
    if (picker && isTenantSdkRealmLeaseCurrent(picker.lease)) return;
    clearInput(input);
    discardLease(input);
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const handlePickerCancel = (event) => {
    if (isFileInput(event.target)) discardLease(event.target);
  };

  const guardedShowPicker = function guardedShowPicker(...args) {
    if (!preparePicker(this)) return undefined;
    return Reflect.apply(nativeShowPicker, this, args);
  };

  documentObject.addEventListener('click', stopStaleActivation, true);
  documentObject.addEventListener('change', stopStaleSelection, true);
  documentObject.addEventListener('cancel', handlePickerCancel, true);
  if (inputPrototype && typeof nativeShowPicker === 'function') {
    try { inputPrototype.showPicker = guardedShowPicker; } catch { /* capture click remains active */ }
  }

  record = {
    references: 1,
    removeReference() {
      this.references -= 1;
      if (this.references > 0) return;
      documentObject.removeEventListener('click', stopStaleActivation, true);
      documentObject.removeEventListener('change', stopStaleSelection, true);
      documentObject.removeEventListener('cancel', handlePickerCancel, true);
      if (inputPrototype?.showPicker === guardedShowPicker) {
        try { inputPrototype.showPicker = nativeShowPicker; } catch { /* immutable prototype */ }
      }
      guardRecords.delete(documentObject);
    },
  };
  guardRecords.set(documentObject, record);

  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    record.removeReference();
  };
}
