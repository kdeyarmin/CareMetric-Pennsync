import { downloadAuthorityBoundBlob } from '@/lib/downloadBlob';

/**
 * downloadCsv — the browser "download UI" layer for CSV exports.
 *
 * Pairs with src/components/admin/csvExport.js, which is deliberately kept
 * pure/DOM-free so its RFC-4180 escaping is unit-tested under node. This module
 * is the single canonical place that turns a CSV string into a downloaded file,
 * replacing the copy of this helper that several export panels each defined
 * locally. Guards the DOM work so a blocked/unsupported download can't throw
 * out of a click handler.
 *
 * Returns whether the download was triggered, and accepts an optional `onError`
 * so callers that want user-visible feedback (e.g. a toast) can surface a failure
 * without re-implementing the guard. On platforms where delivery is
 * asynchronous (the iOS share path in downloadAuthorityBoundBlob) the return
 * is a Promise for the same boolean — callers that report success must await
 * it; the promise never rejects, because an asynchronous failure is routed
 * to `onError` and resolves `false` exactly like a synchronous one. A
 * dismissed share sheet resolves `false` WITHOUT calling `onError` — the
 * user chose not to take the file, which is not a failure to surface.
 *
 * @param {string} filename  suggested download filename (e.g. `report_2026-06.csv`)
 * @param {string} csv        the CSV text to download
 * @param {{ onError?: (error: unknown) => void }} [options]
 * @returns {boolean | Promise<boolean>} true if the download was triggered, false if it failed
 */
export function downloadCsv(filename, csv, { onError } = {}) {
  let delivered;
  try {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    delivered = downloadAuthorityBoundBlob(blob, filename);
  } catch (error) {
    // Download unsupported/blocked in this environment — never throw out of the
    // caller's click handler; let the caller optionally surface the failure.
    onError?.(error);
    return false;
  }
  if (delivered && typeof delivered.then === 'function') {
    return delivered.then(
      (ok) => ok,
      (error) => {
        onError?.(error);
        return false;
      },
    );
  }
  return delivered;
}
