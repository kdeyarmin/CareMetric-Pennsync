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

/**
 * Synchronously create, activate, and revoke a protected Blob download under
 * one captured tenant lease. No library-owned timer may dispatch the click
 * after authority teardown.
 */
export function downloadAuthorityBoundBlob(blob, filename) {
  if (!(blob instanceof Blob)) throw new TypeError('A Blob is required');
  const lease = captureTenantSdkRealmLease();
  const downloadName = safeFilename(filename);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
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
    URL.revokeObjectURL(url);
  }
}
