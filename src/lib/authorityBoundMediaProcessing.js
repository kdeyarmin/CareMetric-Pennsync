import {
  assertTenantSdkRealmLeaseCurrent,
  captureTenantSdkRealmLease,
  getTenantSdkRealmAbortSignal,
  isTenantSdkRealmLeaseCurrent,
  StaleTenantSdkOperationError,
} from '@/lib/tenantSdkRealmGate';

const staleOperation = () => new StaleTenantSdkOperationError();

const NATIVE_MEDIA_CALLBACKS = [
  'onabort',
  'oncanplay',
  'oncanplaythrough',
  'ondurationchange',
  'onemptied',
  'onended',
  'onerror',
  'onloadeddata',
  'onloadedmetadata',
  'onloadstart',
  'onpause',
  'onplay',
  'onplaying',
  'onprogress',
  'onratechange',
  'onseeked',
  'onseeking',
  'onstalled',
  'onsuspend',
  'ontimeupdate',
  'onvolumechange',
  'onwaiting',
];

/** Detach protected native media synchronously while the DOM refs still exist. */
export function detachAuthorityBoundMediaTree(root) {
  if (!root?.querySelectorAll) return;

  for (const image of root.querySelectorAll('img')) {
    image.onload = null;
    image.onerror = null;
    image.removeAttribute('src');
    image.removeAttribute('srcset');
  }

  for (const video of root.querySelectorAll('video')) {
    for (const callback of NATIVE_MEDIA_CALLBACKS) {
      try { video[callback] = null; } catch { /* immutable native callback */ }
    }
    try { video.pause(); } catch { /* already stopped */ }
    try {
      if (
        video.ownerDocument?.pictureInPictureElement === video
        && video.ownerDocument.exitPictureInPicture
      ) void Promise.resolve(video.ownerDocument.exitPictureInPicture()).catch(() => {});
    } catch { /* Picture-in-Picture is unavailable or already closing */ }
    try { video.srcObject = null; } catch { /* no attached MediaStream */ }
    video.removeAttribute('src');
    video.removeAttribute('poster');
    for (const source of video.querySelectorAll('source')) source.removeAttribute('src');
    try { video.load(); } catch { /* browser already discarded media */ }
  }

  for (const canvas of root.querySelectorAll('canvas')) {
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * Own native media-processing resources inside one exact tenant lease.
 * Disposing the scope is terminal: registered browser callbacks/resources are
 * synchronously detached before any queued continuation can observe a new
 * authority.
 */
export function createAuthorityBoundMediaOperation(
  realmLease = captureTenantSdkRealmLease(),
) {
  const realmSignal = getTenantSdkRealmAbortSignal(realmLease);
  const controller = new AbortController();
  const signal = controller.signal;
  const teardowns = new Set();
  let active = true;

  const dispose = () => {
    if (!active) return;
    active = false;
    realmSignal.removeEventListener('abort', dispose);
    if (!signal.aborted) controller.abort();
    for (const teardown of [...teardowns].reverse()) {
      try { teardown(); } catch { /* continue detaching the remaining resources */ }
    }
    teardowns.clear();
  };

  const isCurrent = () => (
    active
    && realmSignal.aborted === false
    && signal.aborted === false
    && isTenantSdkRealmLeaseCurrent(realmLease)
  );

  const assertCurrent = () => {
    if (!active) throw staleOperation();
    return assertTenantSdkRealmLeaseCurrent(realmLease);
  };

  const addTeardown = (teardown) => {
    if (typeof teardown !== 'function') throw new TypeError('A teardown callback is required');
    if (!active) {
      teardown();
      return () => {};
    }
    teardowns.add(teardown);
    return () => teardowns.delete(teardown);
  };

  realmSignal.addEventListener('abort', dispose, { once: true });
  try {
    assertCurrent();
  } catch (error) {
    dispose();
    throw error;
  }

  return Object.freeze({
    addTeardown,
    assertCurrent,
    dispose,
    isCurrent,
    realmLease,
    signal,
  });
}

export function readAuthorityBoundDataUrl(operation, blob) {
  operation.assertCurrent();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    let settled = false;

    const detachCallbacks = () => {
      reader.onload = null;
      reader.onerror = null;
      reader.onabort = null;
    };
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      detachCallbacks();
      callback(value);
    };

    operation.addTeardown(() => {
      detachCallbacks();
      try {
        if (reader.readyState === FileReader.LOADING) reader.abort();
      } catch { /* the reader is already terminal */ }
      if (!settled) {
        settled = true;
        reject(staleOperation());
      }
    });

    reader.onload = () => {
      try {
        operation.assertCurrent();
        settle(resolve, reader.result);
      } catch (error) {
        settle(reject, error);
      }
    };
    reader.onerror = () => {
      try {
        operation.assertCurrent();
        settle(reject, reader.error || new Error('Unable to read image data'));
      } catch (error) {
        settle(reject, error);
      }
    };
    reader.onabort = () => settle(reject, staleOperation());

    try {
      reader.readAsDataURL(blob);
    } catch (error) {
      settle(reject, error);
    }
  });
}

export function loadAuthorityBoundImage(operation, source) {
  operation.assertCurrent();
  return new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;

    const detachCallbacks = () => {
      image.onload = null;
      image.onerror = null;
    };
    const detachSource = () => {
      detachCallbacks();
      try { image.removeAttribute('src'); } catch { image.src = ''; }
    };
    const settle = (callback, value, clearSource = false) => {
      if (settled) return;
      settled = true;
      if (clearSource) detachSource();
      else detachCallbacks();
      callback(value);
    };

    operation.addTeardown(() => {
      detachSource();
      if (!settled) {
        settled = true;
        reject(staleOperation());
      }
    });

    image.onload = () => {
      try {
        operation.assertCurrent();
        settle(resolve, image);
      } catch (error) {
        settle(reject, error, true);
      }
    };
    image.onerror = () => {
      try {
        operation.assertCurrent();
        settle(reject, new Error('Unable to decode image data'), true);
      } catch (error) {
        settle(reject, error, true);
      }
    };

    try {
      image.src = source;
    } catch (error) {
      settle(reject, error, true);
    }
  });
}
