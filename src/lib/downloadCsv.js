/**
 * downloadCsv — the browser "download UI" layer for CSV exports.
 *
 * Pairs with src/components/admin/csvExport.js, which is deliberately kept
 * pure/DOM-free so its RFC-4180 escaping is unit-tested under node. This module
 * is the single canonical place that turns a CSV string into a downloaded file,
 * replacing the copy of this helper that several export panels each defined
 * locally. Guards the DOM work in try/catch so a blocked/unsupported download
 * can't throw out of a click handler.
 *
 * Returns whether the download was triggered, and accepts an optional `onError`
 * so callers that want user-visible feedback (e.g. a toast) can surface a failure
 * without re-implementing the guard.
 *
 * @param {string} filename  suggested download filename (e.g. `report_2026-06.csv`)
 * @param {string} csv        the CSV text to download
 * @param {{ onError?: (error: unknown) => void }} [options]
 * @returns {boolean} true if the download was triggered, false if it failed
 */
export function downloadCsv(filename, csv, { onError } = {}) {
  try {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch (error) {
    // Download unsupported/blocked in this environment — never throw out of the
    // caller's click handler; let the caller optionally surface the failure.
    onError?.(error);
    return false;
  }
}
