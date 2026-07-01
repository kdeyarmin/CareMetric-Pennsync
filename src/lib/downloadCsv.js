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
 * @param {string} filename  suggested download filename (e.g. `report_2026-06.csv`)
 * @param {string} csv        the CSV text to download
 */
export function downloadCsv(filename, csv) {
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
  } catch {
    // Download unsupported/blocked in this environment — fail silently rather
    // than throwing out of the caller's click handler.
  }
}
