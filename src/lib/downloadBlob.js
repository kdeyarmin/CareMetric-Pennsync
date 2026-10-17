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
 * teardown. Resolves `false` only when the user dismisses the iOS share
 * sheet — a choice, not an error — so callers can skip a success toast.
 */
export function downloadAuthorityBoundBlob(blob, filename) {
  if (!(blob instanceof Blob)) throw new TypeError('A Blob is required');
  const lease = captureTenantSdkRealmLease();
  const downloadName = safeFilename(filename);

  if (isIosPlatform()) {
    const file = shareableFile(blob, downloadName);
    if (file) {
      assertTenantSdkRealmLeaseCurrent(lease);
      return navigator.share({ files: [file] }).then(
        () => true,
        (error) => {
          if (error && error.name === 'AbortError') return false;
          // Sharing refused (e.g. the tap's user activation expired during
          // document generation): fall back to the anchor path rather than
          // losing the document entirely.
          try {
            return anchorDownload(blob, downloadName, lease);
          } catch {
            return false;
          }
        },
      );
    }
  }
  return anchorDownload(blob, downloadName, lease);
}
