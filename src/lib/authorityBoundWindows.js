import {
  captureTenantSdkRealmLease,
  getTenantSdkRealmAbortSignal,
  hasPinnedTenantSdkRealm,
  isTenantSdkRealmLeaseCurrent,
  isTenantSdkRealmOpen,
  poisonTenantSdkRealm,
} from '@/lib/tenantSdkRealmGate';
import {
  closePublicCapabilityRealm,
  hasActivePublicCapabilityRealm,
  isPublicCapabilityLeaseCurrent,
} from '@/lib/publicCapabilityRealmGate';

const authorityBoundObjectUrls = new Map();
const interceptorRecords = new WeakMap();
const defaultUrlConstructor = typeof URL !== 'undefined' ? URL : null;
const defaultRevokeObjectUrl = defaultUrlConstructor?.revokeObjectURL;
const BLOCKED_EVENT_TYPES = Object.freeze([
  'click',
  'auxclick',
  'pointerdown',
  'mousedown',
  'mouseup',
  'contextmenu',
  'dragstart',
  'keydown',
  'submit',
]);

function localName(value) {
  return String(value?.localName || value?.tagName || '').toLowerCase();
}

function isNavigationElement(value) {
  const name = localName(value);
  return name === 'a' || name === 'area';
}

function hasNavigationHref(value) {
  if (!isNavigationElement(value)) return false;
  try {
    if (value.hasAttribute?.('href')) return true;
    return typeof value.href?.baseVal === 'string' && value.href.baseVal.length > 0;
  } catch {
    return false;
  }
}

function navigationHref(value) {
  try {
    if (typeof value?.href === 'string') return value.href;
    if (typeof value?.href?.baseVal === 'string') return value.href.baseVal;
    return value?.getAttribute?.('href') || '';
  } catch {
    return '';
  }
}

function isNativeExternalHandoff(url, ownerWindow = window) {
  try {
    return ['tel:', 'mailto:', 'sms:'].includes(
      new ownerWindow.URL(url, ownerWindow.location.href).protocol,
    );
  } catch {
    return false;
  }
}

function isBlobUrl(url, ownerWindow = window) {
  try {
    return new ownerWindow.URL(url, ownerWindow.location.href).protocol === 'blob:';
  } catch {
    return false;
  }
}

function baseTarget(documentObject) {
  try {
    return documentObject.querySelector('base[target]')?.getAttribute('target') || '';
  } catch {
    return '';
  }
}

function explicitOrBaseTarget(element, documentObject, attribute = 'target') {
  try {
    if (element?.hasAttribute?.(attribute)) return element.getAttribute(attribute) || '';
  } catch {
    // A malformed/custom element target is treated as the document default.
  }
  return baseTarget(documentObject);
}

function effectiveFormTarget(form, submitter, documentObject) {
  try {
    if (submitter?.hasAttribute?.('formtarget')) {
      return submitter.getAttribute('formtarget') || '';
    }
  } catch {
    // Continue with the form target.
  }
  return explicitOrBaseTarget(form, documentObject);
}

function isNonSelfTarget(target) {
  const raw = String(target ?? '');
  // Only the exact empty default and ASCII-case-insensitive `_self` are known
  // to reuse this browsing context. Do not trim: whitespace can become a named
  // context in browser target-name processing.
  return raw !== '' && raw.toLowerCase() !== '_self';
}

function eventPath(event) {
  try {
    const path = event?.composedPath?.();
    if (Array.isArray(path) && path.length > 0) return path;
  } catch {
    // Fall back to the retargeted event node below.
  }
  const path = [];
  let node = event?.target || null;
  while (node) {
    path.push(node);
    node = node.parentNode || node.host || null;
  }
  return path;
}

function pathFind(event, predicate) {
  return eventPath(event).find((node) => {
    try { return predicate(node); } catch { return false; }
  }) || null;
}

function isSubmitControl(value) {
  const name = localName(value);
  if (name === 'button') {
    const type = String(value.type || 'submit').toLowerCase();
    return type === 'submit';
  }
  if (name === 'input') {
    const type = String(value.type || '').toLowerCase();
    return type === 'submit' || type === 'image';
  }
  return false;
}

function formForControl(value) {
  try { return value?.form || null; } catch { return null; }
}

function isAuxiliaryGesture(event) {
  if (!event) return false;
  if (event.type === 'auxclick' || event.type === 'contextmenu' || event.type === 'dragstart') {
    return true;
  }
  if (event.type === 'keydown') {
    return event.key === 'Enter'
      && (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey);
  }
  return Number(event.button || 0) !== 0
    || event.ctrlKey === true
    || event.metaKey === true
    || event.shiftKey === true
    || event.altKey === true;
}

function nativeFormSubmissionAllowed() {
  if (isTenantSdkRealmOpen() || hasActivePublicCapabilityRealm()) return true;
  // Initial sign-in/reset forms render before a tenant is pinned. Once a
  // protected realm has existed, its terminal close also closes native form
  // continuations for the rest of this document.
  return !hasPinnedTenantSdkRealm();
}

function isTrackedObjectUrl(url) {
  return authorityBoundObjectUrls.has(String(url));
}

function shouldBlockNavigation(element, documentObject, ownerWindow) {
  if (!hasNavigationHref(element)) return false;
  const href = navigationHref(element);
  // Closing a staff realm is terminal for this document. A retained anchor or
  // delayed `.click()` must not write raw patient/referral identifiers into
  // same-tab history after teardown. A public-only document has never pinned a
  // staff realm and remains usable; after a staff realm closes we fail closed
  // because a global active public lease cannot prove which retained node owns
  // an activation.
  if (hasPinnedTenantSdkRealm() && !isTenantSdkRealmOpen()) return true;
  if (isNonSelfTarget(explicitOrBaseTarget(element, documentObject))) return true;
  if (isBlobUrl(href, ownerWindow)) {
    // A browser-owned blob viewer is not revocable. Only a tracked, explicit
    // download may receive an object URL while exact tenant authority is live.
    return !isTenantSdkRealmOpen()
      || !isTrackedObjectUrl(href)
      || !element.hasAttribute?.('download');
  }
  if (element.hasAttribute?.('download') && !isTenantSdkRealmOpen()) return true;
  return isNativeExternalHandoff(href, ownerWindow)
    && !isTenantSdkRealmOpen()
    && !hasActivePublicCapabilityRealm();
}

function shouldBlockSubmit(form, submitter, documentObject) {
  if (!form) return false;
  return isNonSelfTarget(effectiveFormTarget(form, submitter, documentObject))
    || !nativeFormSubmissionAllowed();
}

function blockEvent(event) {
  try { event.preventDefault(); } catch { /* non-cancelable synthetic event */ }
  try { event.stopImmediatePropagation(); } catch { /* non-DOM event shim */ }
}

function armTenantEventThroughDispatch(event, ownerWindow) {
  if (!isTenantSdkRealmOpen()) return false;
  let lease;
  let signal;
  try {
    lease = captureTenantSdkRealmLease();
    signal = getTenantSdkRealmAbortSignal(lease);
  } catch {
    blockEvent(event);
    return false;
  }
  let armed = true;
  const abort = () => {
    if (armed) blockEvent(event);
  };
  signal.addEventListener('abort', abort, { once: true });
  if (!isTenantSdkRealmLeaseCurrent(lease)) abort();
  const disarm = () => {
    armed = false;
    try { signal.removeEventListener('abort', abort); } catch { /* already detached */ }
  };
  if (typeof ownerWindow.queueMicrotask === 'function') ownerWindow.queueMicrotask(disarm);
  else Promise.resolve().then(disarm);
  return armed && isTenantSdkRealmLeaseCurrent(lease);
}

function targetBelongsToDocument(target, documentObject) {
  try {
    return !target?.ownerDocument || target.ownerDocument === documentObject;
  } catch {
    return false;
  }
}

function temporarilyConnectActivation(target, documentObject) {
  if (!target || !targetBelongsToDocument(target, documentObject)) return null;
  if (target.isConnected) return () => {};
  const form = isSubmitControl(target) ? formForControl(target) : null;
  const mount = form && !form.isConnected ? form : target;
  const destination = documentObject.body || documentObject.documentElement;
  if (!destination) return null;
  const originalParent = mount.parentNode;
  const originalNext = mount.nextSibling;
  try {
    destination.append(mount);
  } catch {
    return null;
  }
  return () => {
    try {
      if (originalParent) originalParent.insertBefore(mount, originalNext);
      else mount.remove();
    } catch {
      try { mount.remove(); } catch { /* already detached */ }
    }
  };
}

function shouldBlockDispatchedEvent(target, event, documentObject, ownerWindow) {
  const type = String(event?.type || '').toLowerCase();
  if (!BLOCKED_EVENT_TYPES.includes(type)) return false;
  if (type === 'submit') {
    const form = localName(target) === 'form' ? target : event?.target;
    return !targetBelongsToDocument(form, documentObject)
      || shouldBlockSubmit(form, event?.submitter, documentObject);
  }
  if (type === 'keydown' && event?.key !== 'Enter') return false;
  if (isNavigationElement(target) && hasNavigationHref(target)) {
    return !targetBelongsToDocument(target, documentObject)
      || isAuxiliaryGesture(event)
      || shouldBlockNavigation(target, documentObject, ownerWindow);
  }
  if (isSubmitControl(target)) {
    return !targetBelongsToDocument(target, documentObject)
      || shouldBlockSubmit(formForControl(target), target, documentObject);
  }
  if (type === 'keydown') {
    return shouldBlockSubmit(formForControl(target), null, documentObject);
  }
  return false;
}

function restoreOwnProperty(target, property, descriptor) {
  try {
    if (descriptor) Reflect.defineProperty(target, property, descriptor);
    else Reflect.deleteProperty(target, property);
  } catch {
    // Best effort only during a failed bootstrap. The realm is already poisoned.
  }
}

function patchFunction(target, property, replacement, restorers, { required = false } = {}) {
  if (!target) {
    if (required) throw new Error(`Missing browser authority surface: ${String(property)}`);
    return null;
  }
  let original;
  try { original = Reflect.get(target, property); } catch { original = null; }
  if (typeof original !== 'function') {
    if (required) throw new Error(`Missing browser authority function: ${String(property)}`);
    return null;
  }
  const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
  const installed = Reflect.defineProperty(target, property, {
    configurable: true,
    enumerable: descriptor?.enumerable === true,
    writable: false,
    value: replacement,
  });
  if (!installed || Reflect.get(target, property) !== replacement) {
    restoreOwnProperty(target, property, descriptor);
    throw new Error(`Unable to install browser authority guard: ${String(property)}`);
  }
  restorers.push(() => restoreOwnProperty(target, property, descriptor));
  return original;
}

function patchSetter(target, property, afterSet, restorers) {
  if (!target) return false;
  const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
  if (typeof descriptor?.set !== 'function') return false;
  const nativeSetter = descriptor.set;
  const guardedSetter = function guardedSetter(value) {
    const result = Reflect.apply(nativeSetter, this, [value]);
    afterSet(this);
    return result;
  };
  const installed = Reflect.defineProperty(target, property, {
    ...descriptor,
    set: guardedSetter,
  });
  if (!installed || Reflect.getOwnPropertyDescriptor(target, property)?.set !== guardedSetter) {
    restoreOwnProperty(target, property, descriptor);
    throw new Error(`Unable to install browser authority setter guard: ${String(property)}`);
  }
  restorers.push(() => restoreOwnProperty(target, property, descriptor));
  return true;
}

function trackAuthorityBoundObjectUrl(url, nativeRevoke, signal = null) {
  const key = String(url);
  if (authorityBoundObjectUrls.has(key)) return key;
  let active = true;
  const revoke = () => {
    if (!active) return;
    active = false;
    authorityBoundObjectUrls.delete(key);
    try { signal?.removeEventListener('abort', revoke); } catch { /* already detached */ }
    try { nativeRevoke(key); } catch { /* already revoked */ }
  };
  authorityBoundObjectUrls.set(key, { revoke });
  try { signal?.addEventListener('abort', revoke, { once: true }); } catch { revoke(); }
  return active ? key : null;
}

/**
 * Auxiliary browsing contexts are intentionally unavailable in this source
 * checkpoint. A cross-origin page can opt into COOP and sever its WindowProxy;
 * native wrappers can redirect the request to Safari, a share sheet, a print
 * controller, or WKDownload. None of those surfaces can be synchronously
 * scrubbed when the exact tenant lease is revoked, so returning a raw child
 * handle would make the boundary dishonest.
 */
export function openAuthorityBoundWindow(_url = '', _target = '_blank', _features = '') {
  if (!isTenantSdkRealmOpen()) return null;
  return null;
}

/** Public capabilities share the same explicit auxiliary-window pause. */
export function openPublicCapabilityWindow(
  lease,
  _url = '',
  _target = '_blank',
  _features = '',
) {
  if (!isPublicCapabilityLeaseCurrent(lease)) return null;
  return null;
}

/**
 * Register an app-created object URL before it can reach a download/media sink.
 * Arbitrary stored blob: strings are rejected because active Blob content can
 * inherit the app origin. Registered URLs are revoked directly by the tenant
 * lease abort as well as by explicit boundary teardown.
 */
export function registerAuthorityBoundObjectUrl(url) {
  if (!isTenantSdkRealmOpen() || typeof url !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'blob:' || parsed.origin !== window.location.origin) return null;
  if (authorityBoundObjectUrls.has(parsed.href)) return parsed.href;
  if (typeof defaultRevokeObjectUrl !== 'function') return null;

  let lease;
  let signal;
  try {
    lease = captureTenantSdkRealmLease();
    signal = getTenantSdkRealmAbortSignal(lease);
  } catch {
    return null;
  }
  const tracked = trackAuthorityBoundObjectUrl(parsed.href, (value) => (
    Reflect.apply(defaultRevokeObjectUrl, defaultUrlConstructor, [value])
  ), signal);
  if (!tracked || !isTenantSdkRealmLeaseCurrent(lease)) {
    authorityBoundObjectUrls.get(parsed.href)?.revoke();
    return null;
  }
  return parsed.href;
}

/** Revoke every tracked object URL before cache/storage teardown can await. */
export function closeAuthorityBoundWindows() {
  for (const record of [...authorityBoundObjectUrls.values()]) {
    try { record.revoke(); } catch { /* continue closing every URL */ }
  }
}

/**
 * Install one atomic, document-lifetime membrane over every reachable browser
 * auxiliary-context and object-URL entry point. Any failed required patch rolls
 * back partial changes, revokes already tracked URLs, and poisons the tenant
 * realm so App must not bootstrap on a partially guarded browser.
 */
export function installAuthorityBoundLinkInterceptor(documentObject = document) {
  let record = interceptorRecords.get(documentObject);
  if (record) {
    record.references += 1;
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      record.removeReference();
    };
  }

  const ownerWindow = documentObject.defaultView;
  if (!ownerWindow) {
    poisonTenantSdkRealm();
    throw new Error('A browser document is required for auxiliary-context containment');
  }

  const restorers = [];
  const listeners = [];
  const activeActivationEvents = new Set();
  const addListener = (target, type, listener) => {
    target.addEventListener(type, listener, true);
    listeners.push(() => target.removeEventListener(type, listener, true));
  };
  const rollback = () => {
    closeAuthorityBoundWindows();
    for (const remove of [...listeners].reverse()) {
      try { remove(); } catch { /* continue rollback */ }
    }
    for (const restore of [...restorers].reverse()) {
      try { restore(); } catch { /* continue rollback */ }
    }
  };

  const armActivationEvent = (event) => {
    activeActivationEvents.add(event);
    const release = () => activeActivationEvents.delete(event);
    if (typeof ownerWindow.queueMicrotask === 'function') ownerWindow.queueMicrotask(release);
    else Promise.resolve().then(release);
    if (armTenantEventThroughDispatch(event, ownerWindow)) return true;
    release();
    return false;
  };

  const blockActiveTargetMutation = (element, attributeName) => {
    const name = String(attributeName || '').toLowerCase();
    const elementName = localName(element);
    const controlsAuxiliaryTarget = (
      (name === 'target' && ['a', 'area', 'form', 'base'].includes(elementName))
      || (name === 'formtarget' && isSubmitControl(element))
    );
    const controlsNavigationPayload = (
      isNavigationElement(element)
      && (name === 'href' || name === 'download')
    );
    if (!controlsAuxiliaryTarget && !controlsNavigationPayload) return;
    let unsafe = false;
    if (controlsAuxiliaryTarget) {
      let currentTarget = '';
      try { currentTarget = element.getAttribute(name) ?? ''; } catch { currentTarget = 'unknown'; }
      unsafe = isNonSelfTarget(currentTarget);
    } else {
      unsafe = shouldBlockNavigation(element, documentObject, ownerWindow);
    }
    if (!unsafe) return;
    for (const event of [...activeActivationEvents]) blockEvent(event);
  };

  const handleActivation = (event) => {
    if (event.defaultPrevented) return;
    const type = String(event.type || '').toLowerCase();
    if (type === 'submit') {
      const form = localName(event.target) === 'form' ? event.target : null;
      if (shouldBlockSubmit(form, event.submitter, documentObject)) blockEvent(event);
      else if (isTenantSdkRealmOpen()) armActivationEvent(event);
      return;
    }

    const navigation = pathFind(event, (node) => (
      isNavigationElement(node) && hasNavigationHref(node)
    ));
    if (navigation) {
      if (
        isAuxiliaryGesture(event)
        || shouldBlockNavigation(navigation, documentObject, ownerWindow)
      ) blockEvent(event);
      else if (isTenantSdkRealmOpen()) armActivationEvent(event);
      return;
    }

    const submitter = pathFind(event, isSubmitControl);
    if (submitter) {
      if (shouldBlockSubmit(formForControl(submitter), submitter, documentObject)) {
        blockEvent(event);
      } else if (isTenantSdkRealmOpen()) {
        // A closed shadow root can hide its submitter from document capture.
        // Arm the click itself so revocation inside a target listener prevents
        // the native form activation that follows dispatch.
        armActivationEvent(event);
      }
      return;
    }

    if (type === 'keydown' && event.key === 'Enter') {
      const formControl = pathFind(event, (node) => !!formForControl(node));
      if (shouldBlockSubmit(formForControl(formControl), null, documentObject)) {
        blockEvent(event);
      } else if (isTenantSdkRealmOpen()) {
        armActivationEvent(event);
      }
    }
  };

  const guardShadowRoot = (shadowRoot) => {
    if (!shadowRoot) return;
    for (const type of BLOCKED_EVENT_TYPES) addListener(shadowRoot, type, handleActivation);
  };

  const guardExistingOpenShadowRoots = (root) => {
    let elements = [];
    try { elements = [...root.querySelectorAll('*')]; } catch { return; }
    for (const element of elements) {
      let shadowRoot = null;
      try { shadowRoot = element.shadowRoot; } catch { /* closed/unavailable */ }
      if (!shadowRoot) continue;
      guardShadowRoot(shadowRoot);
      guardExistingOpenShadowRoots(shadowRoot);
    }
  };

  try {
    const windowPrototype = ownerWindow.Window?.prototype;
    const nativeWindowOpen = ownerWindow.open;
    if (typeof nativeWindowOpen !== 'function') throw new Error('window.open is unavailable');
    const guardedWindowOpen = () => null;
    patchFunction(ownerWindow, 'open', guardedWindowOpen, restorers, { required: true });
    if (typeof windowPrototype?.open === 'function') {
      patchFunction(windowPrototype, 'open', guardedWindowOpen, restorers);
    }
    const guardedWindowPrint = () => undefined;
    if (typeof ownerWindow.print === 'function') {
      patchFunction(ownerWindow, 'print', guardedWindowPrint, restorers);
    }
    if (typeof windowPrototype?.print === 'function') {
      patchFunction(windowPrototype, 'print', guardedWindowPrint, restorers);
    }

    const documentPrototype = ownerWindow.Document?.prototype;
    const nativeDocumentOpen = documentPrototype?.open || documentObject.open;
    if (typeof nativeDocumentOpen === 'function') {
      // Both the legacy auxiliary-context overload and the zero-argument stream
      // overload are unavailable. The latter returns a durable raw Document
      // writer that a stale continuation could keep using after revocation.
      const guardedDocumentOpen = () => null;
      patchFunction(documentObject, 'open', guardedDocumentOpen, restorers);
      if (typeof documentPrototype?.open === 'function') {
        patchFunction(documentPrototype, 'open', guardedDocumentOpen, restorers);
      }
    }

    const eventTargetPrototype = ownerWindow.EventTarget?.prototype;
    const nativeDispatchEvent = eventTargetPrototype?.dispatchEvent;
    if (typeof nativeDispatchEvent !== 'function') {
      throw new Error('EventTarget.dispatchEvent is unavailable');
    }
    const guardedDispatchEvent = function guardedDispatchEvent(event) {
      if (shouldBlockDispatchedEvent(this, event, documentObject, ownerWindow)) {
        blockEvent(event);
        return false;
      }
      const type = String(event?.type || '').toLowerCase();
      if (
        isTenantSdkRealmOpen()
        && (
          (isNavigationElement(this) && hasNavigationHref(this))
          || isSubmitControl(this)
          || type === 'submit'
          || (type === 'keydown' && !!formForControl(this))
        )
        && !armActivationEvent(event)
      ) return false;
      return Reflect.apply(nativeDispatchEvent, this, [event]);
    };
    patchFunction(eventTargetPrototype, 'dispatchEvent', guardedDispatchEvent, restorers, {
      required: true,
    });

    const elementPrototype = ownerWindow.Element?.prototype;
    const nativeSetAttribute = elementPrototype?.setAttribute;
    if (typeof nativeSetAttribute === 'function') {
      const guardedSetAttribute = function guardedSetAttribute(name, value) {
        const result = Reflect.apply(nativeSetAttribute, this, [name, value]);
        blockActiveTargetMutation(this, name);
        return result;
      };
      patchFunction(elementPrototype, 'setAttribute', guardedSetAttribute, restorers, {
        required: true,
      });
    }
    const nativeSetAttributeNs = elementPrototype?.setAttributeNS;
    if (typeof nativeSetAttributeNs === 'function') {
      const guardedSetAttributeNs = function guardedSetAttributeNs(namespace, name, value) {
        const result = Reflect.apply(nativeSetAttributeNs, this, [namespace, name, value]);
        blockActiveTargetMutation(this, name);
        return result;
      };
      patchFunction(elementPrototype, 'setAttributeNS', guardedSetAttributeNs, restorers);
    }
    for (const method of ['setAttributeNode', 'setAttributeNodeNS']) {
      const nativeSetAttributeNode = elementPrototype?.[method];
      if (typeof nativeSetAttributeNode !== 'function') continue;
      const guardedSetAttributeNode = function guardedSetAttributeNode(attribute) {
        const result = Reflect.apply(nativeSetAttributeNode, this, [attribute]);
        blockActiveTargetMutation(this, attribute?.localName || attribute?.name);
        return result;
      };
      patchFunction(elementPrototype, method, guardedSetAttributeNode, restorers);
    }

    const namedNodeMapPrototype = ownerWindow.NamedNodeMap?.prototype;
    for (const method of ['setNamedItem', 'setNamedItemNS']) {
      const nativeSetNamedItem = namedNodeMapPrototype?.[method];
      if (typeof nativeSetNamedItem !== 'function') continue;
      const guardedSetNamedItem = function guardedSetNamedItem(attribute) {
        const result = Reflect.apply(nativeSetNamedItem, this, [attribute]);
        blockActiveTargetMutation(
          attribute?.ownerElement,
          attribute?.localName || attribute?.name,
        );
        return result;
      };
      patchFunction(namedNodeMapPrototype, method, guardedSetNamedItem, restorers);
    }

    const targetSetters = [
      [ownerWindow.HTMLAnchorElement?.prototype, 'target', 'target'],
      [ownerWindow.HTMLAnchorElement?.prototype, 'href', 'href'],
      [ownerWindow.HTMLAnchorElement?.prototype, 'download', 'download'],
      [ownerWindow.HTMLAreaElement?.prototype, 'target', 'target'],
      [ownerWindow.HTMLAreaElement?.prototype, 'href', 'href'],
      [ownerWindow.HTMLAreaElement?.prototype, 'download', 'download'],
      [ownerWindow.HTMLFormElement?.prototype, 'target', 'target'],
      [ownerWindow.HTMLBaseElement?.prototype, 'target', 'target'],
      [ownerWindow.HTMLButtonElement?.prototype, 'formTarget', 'formtarget'],
      [ownerWindow.HTMLInputElement?.prototype, 'formTarget', 'formtarget'],
    ];
    for (const [prototype, property, attribute] of targetSetters) {
      patchSetter(
        prototype,
        property,
        (element) => blockActiveTargetMutation(element, attribute),
        restorers,
      );
    }
    patchSetter(
      ownerWindow.Attr?.prototype,
      'value',
      (attribute) => blockActiveTargetMutation(
        attribute.ownerElement,
        attribute.localName || attribute.name,
      ),
      restorers,
    );

    const nativeAttachShadow = elementPrototype?.attachShadow;
    if (typeof nativeAttachShadow === 'function') {
      const guardedAttachShadow = function guardedAttachShadow(...args) {
        const shadowRoot = Reflect.apply(nativeAttachShadow, this, args);
        guardShadowRoot(shadowRoot);
        return shadowRoot;
      };
      patchFunction(elementPrototype, 'attachShadow', guardedAttachShadow, restorers);
      // Bootstrap runs before App imports, but also protect any declarative/open
      // shadow tree already present in the host document.
      guardExistingOpenShadowRoots(documentObject);
    }

    const htmlElementPrototype = ownerWindow.HTMLElement?.prototype;
    const nativeElementClick = htmlElementPrototype?.click;
    if (typeof nativeElementClick !== 'function') throw new Error('HTMLElement.click is unavailable');
    const guardedElementClick = function guardedElementClick(...args) {
      if (
        !targetBelongsToDocument(this, documentObject)
        || (isNavigationElement(this) && shouldBlockNavigation(this, documentObject, ownerWindow))
        || (isSubmitControl(this)
          && shouldBlockSubmit(formForControl(this), this, documentObject))
      ) return undefined;
      const restorePosition = temporarilyConnectActivation(this, documentObject);
      if (!restorePosition) return undefined;
      try {
        return Reflect.apply(nativeElementClick, this, args);
      } finally {
        restorePosition();
      }
    };
    const clickPrototypes = [
      htmlElementPrototype,
      ownerWindow.HTMLAnchorElement?.prototype,
      ownerWindow.HTMLAreaElement?.prototype,
      ownerWindow.HTMLButtonElement?.prototype,
      ownerWindow.HTMLInputElement?.prototype,
    ].filter((value, index, all) => value && all.indexOf(value) === index);
    for (const prototype of clickPrototypes) {
      patchFunction(prototype, 'click', guardedElementClick, restorers, {
        required: prototype === htmlElementPrototype,
      });
    }

    const formPrototype = ownerWindow.HTMLFormElement?.prototype;
    const nativeFormSubmit = formPrototype?.submit;
    if (typeof nativeFormSubmit !== 'function') {
      throw new Error('HTMLFormElement.submit is unavailable');
    }
    const guardedFormSubmit = function guardedFormSubmit(...args) {
      if (
        !targetBelongsToDocument(this, documentObject)
        || shouldBlockSubmit(this, null, documentObject)
      ) return undefined;
      return Reflect.apply(nativeFormSubmit, this, args);
    };
    patchFunction(formPrototype, 'submit', guardedFormSubmit, restorers, { required: true });
    const nativeRequestSubmit = formPrototype.requestSubmit;
    if (typeof nativeRequestSubmit === 'function') {
      const guardedRequestSubmit = function guardedRequestSubmit(submitter) {
        if (
          !targetBelongsToDocument(this, documentObject)
          || !targetBelongsToDocument(submitter, documentObject)
          || shouldBlockSubmit(this, submitter, documentObject)
        ) return undefined;
        const restorePosition = temporarilyConnectActivation(this, documentObject);
        if (!restorePosition) return undefined;
        try {
          return Reflect.apply(nativeRequestSubmit, this, arguments);
        } finally {
          restorePosition();
        }
      };
      patchFunction(formPrototype, 'requestSubmit', guardedRequestSubmit, restorers);
    }

    const urlConstructors = [ownerWindow.URL, ownerWindow.webkitURL]
      .filter((value, index, all) => value && all.indexOf(value) === index);
    for (const urlConstructor of urlConstructors) {
      const nativeCreateObjectUrl = urlConstructor.createObjectURL;
      const nativeRevokeObjectUrl = urlConstructor.revokeObjectURL;
      if (typeof nativeCreateObjectUrl !== 'function') continue;
      if (typeof nativeRevokeObjectUrl !== 'function') {
        throw new Error('URL.createObjectURL cannot be installed without revokeObjectURL');
      }
      const guardedCreateObjectUrl = function guardedCreateObjectUrl(...args) {
        const lease = captureTenantSdkRealmLease();
        const signal = getTenantSdkRealmAbortSignal(lease);
        const url = Reflect.apply(nativeCreateObjectUrl, urlConstructor, args);
        if (!isTenantSdkRealmLeaseCurrent(lease)) {
          try { Reflect.apply(nativeRevokeObjectUrl, urlConstructor, [url]); } catch { /* best effort */ }
          throw new DOMException(
            'Object URL creation expired because workspace authority changed',
            'InvalidStateError',
          );
        }
        const tracked = trackAuthorityBoundObjectUrl(url, (value) => (
          Reflect.apply(nativeRevokeObjectUrl, urlConstructor, [value])
        ), signal);
        if (!tracked) {
          try { Reflect.apply(nativeRevokeObjectUrl, urlConstructor, [url]); } catch { /* best effort */ }
          throw new DOMException('Object URL tracking is unavailable', 'InvalidStateError');
        }
        return tracked;
      };
      const guardedRevokeObjectUrl = function guardedRevokeObjectUrl(url) {
        const tracked = authorityBoundObjectUrls.get(String(url));
        if (tracked) {
          tracked.revoke();
          return undefined;
        }
        return Reflect.apply(nativeRevokeObjectUrl, urlConstructor, [url]);
      };
      patchFunction(
        urlConstructor,
        'createObjectURL',
        guardedCreateObjectUrl,
        restorers,
        { required: true },
      );
      patchFunction(
        urlConstructor,
        'revokeObjectURL',
        guardedRevokeObjectUrl,
        restorers,
        { required: true },
      );
    }

    for (const type of BLOCKED_EVENT_TYPES) addListener(documentObject, type, handleActivation);
    addListener(ownerWindow, 'pagehide', () => {
      // This listener is installed before App imports and therefore survives a
      // React crash/unmount. A document exit terminally closes both raw realms
      // and revokes every tracked object URL before bfcache can preserve them.
      poisonTenantSdkRealm();
      closePublicCapabilityRealm();
      closeAuthorityBoundWindows();
    });

    record = {
      references: 1,
      removeReference() {
        this.references -= 1;
        if (this.references > 0) return;
        rollback();
        interceptorRecords.delete(documentObject);
      },
    };
    interceptorRecords.set(documentObject, record);
  } catch (error) {
    rollback();
    interceptorRecords.delete(documentObject);
    poisonTenantSdkRealm();
    throw error;
  }

  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    record.removeReference();
  };
}
