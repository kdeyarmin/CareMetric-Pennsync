/**
 * csvExport — pure RFC 4180 CSV generation for admin data exports.
 *
 * Kept separate from the download UI so the escaping (commas, quotes, newlines)
 * is unit-tested in isolation. Callers pass a column spec and records; the
 * component layer turns the returned string into a downloadable Blob.
 *
 * PHI note: the column specs the admin panel uses export metadata only — never
 * SMS message bodies or recording media — so a compliance export can't leak PHI.
 */

/**
 * Escape a single CSV field per RFC 4180 (quote when it contains , " CR or LF),
 * and neutralize spreadsheet formula injection. A field starting with = + - @
 * (or a control char) is evaluated as a formula by Excel/Sheets — RFC quoting
 * does NOT prevent that — so we prefix it with a single quote first. This also
 * makes a phone number like "+12155550100" render as text rather than a formula.
 */
export function escapeCsvField(value) {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Build a CSV string.
 *
 * @param {Array<{ key: string, label: string, format?: (value: any, row: any) => any }>} columns
 * @param {Array<object>} records
 * @returns {string} CSV text with a header row, CRLF line endings.
 */
export function toCsv(columns, records) {
  const cols = Array.isArray(columns) ? columns : [];
  const rows = Array.isArray(records) ? records : [];
  const header = cols.map((c) => escapeCsvField(c.label)).join(",");
  const lines = rows.map((row) =>
    cols
      .map((c) => {
        const raw = row ? row[c.key] : undefined;
        const value = typeof c.format === "function" ? c.format(raw, row) : raw;
        return escapeCsvField(value);
      })
      .join(",")
  );
  return [header, ...lines].join("\r\n");
}

/**
 * Join an array of row-arrays into a safe CSV string. Every cell is run through
 * `escapeCsvField` (RFC 4180 quoting + spreadsheet formula-injection neutralization),
 * so components that build their own ragged/multi-section row arrays can swap an
 * unsafe `rows.map(r => r.join(',')).join('\n')` for `toCsvRows(rows)` without
 * restructuring their data.
 * Accepts any input and coerces defensively (non-array → [], non-array row →
 * single-cell row), so the param type is intentionally loose.
 * @param {any} rows  an array of row-arrays
 * @param {{ eol?: string }} [opts]
 * @returns {string}
 */
export function toCsvRows(rows, { eol = "\r\n" } = {}) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => (Array.isArray(row) ? row : [row]).map(escapeCsvField).join(","))
    .join(eol);
}

/** A filename-safe timestamp like 2026-06-02_1430 for export filenames. */
export function exportTimestamp(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
}
