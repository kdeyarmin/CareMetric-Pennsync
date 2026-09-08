import {
  assertTenantSdkRealmLeaseCurrent,
  captureTenantSdkRealmLease,
} from '@/lib/tenantSdkRealmGate';

const installedClipboards = new WeakMap();

/**
 * Guard the browser clipboard sink for the whole document. Copy is an explicit,
 * irreversible user handoff once the native call begins; this boundary prevents
 * a queued stale click from initiating a new copy after authority changed.
 * Returns null when a present Clipboard API cannot be wrapped safely.
 */
export function installAuthorityBoundClipboard(clipboard = navigator.clipboard) {
  if (!clipboard || typeof clipboard.writeText !== 'function') return () => {};
  const existing = installedClipboards.get(clipboard);
  if (existing) return existing.cleanup;

  const nativeWriteText = clipboard.writeText;
  const guardedWriteText = function guardedWriteText(...args) {
    const lease = captureTenantSdkRealmLease();
    assertTenantSdkRealmLeaseCurrent(lease);
    let result;
    try {
      result = Reflect.apply(nativeWriteText, this, args);
    } catch (error) {
      assertTenantSdkRealmLeaseCurrent(lease);
      throw error;
    }
    return Promise.resolve(result).then(
      (value) => {
        assertTenantSdkRealmLeaseCurrent(lease);
        return value;
      },
      (error) => {
        assertTenantSdkRealmLeaseCurrent(lease);
        throw error;
      },
    );
  };

  let installed = false;
  try {
    Object.defineProperty(clipboard, 'writeText', {
      configurable: true,
      enumerable: true,
      writable: false,
      value: guardedWriteText,
    });
    installed = clipboard.writeText === guardedWriteText;
  } catch {
    installed = false;
  }
  if (!installed) return null;

  let removed = false;
  const cleanup = () => {
    if (removed) return;
    removed = true;
    if (clipboard.writeText === guardedWriteText) {
      try {
        Object.defineProperty(clipboard, 'writeText', {
          configurable: true,
          enumerable: true,
          writable: true,
          value: nativeWriteText,
        });
      } catch { /* document-lifetime installation normally is never removed */ }
    }
    installedClipboards.delete(clipboard);
  };
  installedClipboards.set(clipboard, { cleanup });
  return cleanup;
}
