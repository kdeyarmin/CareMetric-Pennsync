/**
 * escapeHtml — escape the five HTML-significant characters so untrusted text can
 * be safely interpolated into an HTML string (e.g. generated education handouts,
 * PDF search-result highlighting).
 *
 * Canonical replacement for the copies that several generators defined inline.
 * Null/undefined coerce to an empty string so callers don't have to guard.
 *
 * @param {unknown} str
 * @returns {string}
 */
export function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
