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
 * @returns {number|null} null when the value is empty or unparseable
 */
export function calculateAge(dob, now = new Date()) {
  const birth = parseLocalDate(dob);
  const today = parseLocalDate(now);
  if (!birth || !today) return null;
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age < 0 ? null : age;
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
 * Local midnight for a given moment (default: now).
 *
 * Rolling-window filters are pervasively written as `new Date()` minus N days
 * and then compared against a date-only field. That boundary carries the
 * CURRENT TIME OF DAY while the field parses at midnight, so the oldest day of
 * the window is always dropped — and a record dated TODAY sorts before "now",
 * so it falls out of an `>= today` upcoming filter too.
 *
 * @param {string|number|Date} [value]
 * @returns {Date|null} null when the value is unparseable
 */
export function startOfLocalDay(value = new Date()) {
  const d = parseLocalDate(value);
  if (!d) return null;
  const copy = new Date(d.getTime());
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/**
 * Local midnight `days` calendar days before `now` — the correct lower bound for
 * a "last N days" window over date-only fields.
 * @param {number} days
 * @param {Date} [now]
 * @returns {Date}
 */
export function daysAgoLocal(days, now = new Date()) {
  const start = startOfLocalDay(now) ?? new Date();
  start.setDate(start.getDate() - Number(days || 0));
  return start;
}

/**
 * Is a date-only (or datetime) value within the last `days` calendar days,
 * counting today as day 0 and including the boundary day in full?
 * @param {string|number|Date} value
 * @param {number} days
 * @param {Date} [now]
 * @returns {boolean} false when the value is missing or unparseable
 */
export function isWithinLastDays(value, days, now = new Date()) {
  const d = parseLocalDate(value);
  return d != null && d >= daysAgoLocal(days, now);
}

/**
 * Format a date-only value as a local calendar date string suitable for <input type="date">
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

/**
 * Whether a due date is overdue on the local calendar.
 *
 * Date-only values ("YYYY-MM-DD") compare against local midnight of `now`.
 * "Due today" is NOT overdue — only a due date strictly before today counts.
 * Datetime values compare against the full instant of `now`.
 *
 * @param {string|number|Date} dueDate
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isPastLocalDueDate(dueDate, now = new Date()) {
  if (dueDate == null || dueDate === "") return false;
  const raw = String(dueDate).trim();
  const dateOnly = /^\d{4}-\d{1,2}-\d{1,2}$/.test(raw);
  const due = parseLocalDate(dueDate);
  if (!due) return false;
  if (dateOnly) {
    const today = startOfLocalDay(now);
    return !!today && due < today;
  }
  return due < now;
}
