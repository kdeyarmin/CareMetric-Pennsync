import {
  assertTenantSdkRealmLeaseCurrent,
  captureTenantSdkRealmLease,
} from '@/lib/tenantSdkRealmGate';

function safeFilename(value) {
  const filename = typeof value === 'string' ? value.trim() : '';
  const hasControlCharacter = [...filename].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 31 || codePoint === 127;
  });
  if (!filename || filename.length > 240 || hasControlCharacter) {
    throw new TypeError('A valid download filename is required');
  }
  return filename.replace(/[\\/]/g, '_');
}

// iOS has no working path for a programmatic Blob download: Safari ignores
// the anchor `download` attribute for blob URLs, and the in-app webviews
// (installed web app, embedded containers) have no download handler at all,
// so the anchor click lands nowhere and the file silently never opens. The
// Web Share API with a File payload works in both — the share sheet previews
// the document and offers Save to Files and send targets. Desktop browsers
// keep the classic anchor download.
function isIosPlatform() {
  if (typeof navigator === 'undefined') return false;
  const userAgent = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/.test(userAgent)) return true;
  // iPadOS reports a Macintosh user agent; touch points distinguish it.
  return userAgent.includes('Macintosh') && (navigator.maxTouchPoints || 0) > 1;
}

function shareableFile(blob, filename) {
  if (typeof navigator === 'undefined'
    || typeof navigator.share !== 'function'
    || typeof navigator.canShare !== 'function'
    || typeof File !== 'function') return null;
  try {
    const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
    return navigator.canShare({ files: [file] }) ? file : null;
  } catch {
    return null;
  }
}

// The browser resolves the blob asynchronously once the click lands, and
// Safari is notably slow to start: revoking the object URL in the same task
// cancels the fetch and the download silently never happens. Revocation is
// therefore deferred — the timer only frees the URL afterwards; it
// dispatches nothing, so the lease rule below is untouched.
const REVOKE_DELAY_MS = 60_000;
function revokeLater(url) {
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

function anchorDownload(blob, downloadName, lease) {
  const anchor = document.createElement('a');
  const url = URL.createObjectURL(blob);
  try {
    assertTenantSdkRealmLeaseCurrent(lease);
    anchor.href = url;
    anchor.download = downloadName;
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    assertTenantSdkRealmLeaseCurrent(lease);
    anchor.click();
    assertTenantSdkRealmLeaseCurrent(lease);
    return true;
  } finally {
    anchor.remove();
    revokeLater(url);
  }
}

/**
 * Dispatch a protected Blob download under one captured tenant lease. The
 * dispatch (anchor click or share initiation) happens synchronously under
 * the lease; no library-owned timer dispatches anything after authority
 * teardown.
 *
 * Delivery result: `true` once the file is handed off. On the iOS share
 * path the return is a Promise: it resolves `false` ONLY when the user
 * dismisses the share sheet — a choice, not an error, so callers can skip
 * a success toast — and it REJECTS when sharing itself fails, so an
 * awaiting caller can report a real failure instead of claiming a
 * delivery that never happened. There is deliberately no anchor fallback
 * after a failed share on iOS: the webviews this path exists for have no
 * blob-anchor download handler, so the fallback would report success for
 * a file the user never received. (When file sharing is unavailable at
 * all, the anchor path below is the only mechanism the platform offers
 * and is used as before.) The promise carries an internal handled branch
 * so fire-and-forget callers never produce an unhandled rejection;
 * awaiting callers still receive the rejection from the returned promise
 * itself.
 */
export function downloadAuthorityBoundBlob(blob, filename) {
  if (!(blob instanceof Blob)) throw new TypeError('A Blob is required');
  const lease = captureTenantSdkRealmLease();
  const downloadName = safeFilename(filename);

  if (isIosPlatform()) {
    const file = shareableFile(blob, downloadName);
    if (file) {
      assertTenantSdkRealmLeaseCurrent(lease);
      const delivery = navigator.share({ files: [file] }).then(
        () => true,
        (error) => {
          if (error && error.name === 'AbortError') return false;
          throw error;
        },
      );
      delivery.catch(() => {});
      return delivery;
    }
  }
  return anchorDownload(blob, downloadName, lease);
}
