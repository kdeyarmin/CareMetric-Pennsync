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
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
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
 * @returns {number|null} null when the value is empty or unparseable
 */
export function calculateAge(dob) {
  const birth = parseLocalDate(dob);
  if (!birth) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}
