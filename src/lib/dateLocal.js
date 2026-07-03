/**
 * Date-only ("YYYY-MM-DD") helpers that parse as PLAIN calendar components.
 *
 * `new Date("YYYY-MM-DD")` parses the string as UTC midnight, so in any timezone
 * behind UTC the local calendar day shifts back one (e.g. 1961-12-01 renders as
 * 1961-11-30). For admission / visit / birth dates — which are calendar dates
 * with no meaningful time-of-day — that shows the wrong day, which is material
 * near recert windows and at the Medicare-65 age boundary.
 *
 * These helpers build a LOCAL date from the date components instead, matching
 * the fix already inlined in Patients.jsx / PatientDetails.jsx. Datetime strings
 * (with a time component) fall through to the platform parser unchanged.
 */

/**
 * Parse a date-only or datetime value as a LOCAL Date.
 * @param {string|number|Date} value
 * @returns {Date|null} null when the value is empty or unparseable
 */
export function parseLocalDate(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(value).trim());
  if (iso) {
    const y = Number(iso[1]);
    const mo = Number(iso[2]) - 1;
    const day = Number(iso[3]);
    const d = new Date(y, mo, day);
    // Reject impossible calendar dates (e.g. "2026-02-31", "2026-13-01") that the
    // Date constructor would silently roll forward — fail closed rather than
    // surface a wrong DOB / admission date, matching this function's contract.
    if (d.getFullYear() !== y || d.getMonth() !== mo || d.getDate() !== day) return null;
    return d;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Format a date-only value with toLocaleDateString without the UTC day-shift.
 * @param {string|number|Date} value
 * @param {Intl.DateTimeFormatOptions} [opts]
 * @returns {string} "" when the value is empty or unparseable
 */
export function formatLocalDate(value, opts) {
  const d = parseLocalDate(value);
  return d ? d.toLocaleDateString(undefined, opts) : "";
}

/**
 * Whole-year age from a date of birth, computed on local calendar components so
 * it never flips a day early at the Medicare-band boundary.
 * @param {string|number|Date} dob
 * @param {Date} [now] reference date (defaults to today); injectable for testing
 * @returns {number|null} null when the value is empty or unparseable
 */
export function calculateAge(dob, now = new Date()) {
  const birth = parseLocalDate(dob);
  const today = parseLocalDate(now);
  if (!birth || !today) return null;
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

/**
 * Display-safe whole-year age from a date of birth.
 * @param {string|number|Date} dob
 * @param {Date} [now]
 * @param {string|null} [fallback]
 * @returns {number|string|null}
 */
export function formatAge(dob, now = new Date(), fallback = "Unknown") {
  const age = calculateAge(dob, now);
  return age == null ? fallback : age;
}

/**
 * Format a Date as a local calendar date string suitable for <input type="date">
 * values and date-only entity fields. Unlike toISOString().slice(0, 10), this
 * does not jump to tomorrow/ yesterday for users outside UTC.
 * @param {string|number|Date} [date]
 * @returns {string}
 */
export function toLocalISODate(date = new Date()) {
  const d = parseLocalDate(date);
  if (!d) return "";
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
