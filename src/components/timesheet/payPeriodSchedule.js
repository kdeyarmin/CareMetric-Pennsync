/**
 * Biweekly pay-period schedule.
 *
 * The agency runs on a fixed calendar:
 *   • Pay period: two weeks, Sunday → Saturday (14 days inclusive).
 *   • Timesheets are due before NOON on the Monday after the period ends
 *     (period_end Saturday + 2 days).
 *   • Payday is the Friday after the period ends (period_end + 6 days — the
 *     Friday of the week timesheets are due), unless a bank holiday shifts it
 *     (see PAYDAY_OVERRIDES).
 *
 * Anchored to the known cycle: Sun 2026-06-28 → Sat 2026-07-11, due Mon
 * 2026-07-13 12:00 PM, payday Fri 2026-07-17. The prior period (6/14–6/27)
 * pays 7/4 instead of Fri 7/3 because 7/3 is the observed Independence Day
 * holiday. Every other period is derived from this cadence.
 *
 * Pure and unit-tested (payPeriodSchedule.test.js). Date math uses UTC-midpoint
 * differencing so DST transitions can't shift a period boundary.
 */

import { parseISODate, toISODate } from "../timeoff/timeOffUtils.js";
import { payPeriodLabel } from "./timesheetUtils.js";

/** A Sunday that starts an aligned pay period. */
export const ANCHOR_START = "2026-06-14";
const PERIOD_DAYS = 14;
const DAY_MS = 86400000;

/**
 * Paydays that fall on (or next to) a bank holiday and move off the normal
 * Friday. Keyed by the scheduled Friday; value is the actual pay date.
 */
const PAYDAY_OVERRIDES = {
  // Fri 2026-07-03 is the observed Independence Day holiday; pay lands Sat 7/4.
  "2026-07-03": "2026-07-04",
};

function addDays(iso, n) {
  const d = parseISODate(iso);
  if (!d) return "";
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/** UTC midnight ms for an ISO date — DST-safe for whole-day differences. */
function utcMs(iso) {
  const d = parseISODate(iso);
  if (!d) return NaN;
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Index (…-1, 0, 1…) of the aligned period containing a date. */
export function periodIndexForDate(dateOrIso) {
  const iso = dateOrIso instanceof Date ? toISODate(dateOrIso) : String(dateOrIso).slice(0, 10);
  const diffDays = Math.floor((utcMs(iso) - utcMs(ANCHOR_START)) / DAY_MS);
  return Math.floor(diffDays / PERIOD_DAYS);
}

/** Build the full descriptor for the pay period at a given index. */
export function payPeriodByIndex(index) {
  const start = addDays(ANCHOR_START, index * PERIOD_DAYS); // Sunday
  const end = addDays(start, PERIOD_DAYS - 1); // Saturday
  const dueDate = addDays(end, 2); // Monday
  const scheduledPayday = addDays(end, 6); // Friday of the due week
  const payday = PAYDAY_OVERRIDES[scheduledPayday] ?? scheduledPayday;
  return {
    index,
    start,
    end,
    dueDate,
    dueTime: "12:00", // noon, local
    dueDateTime: `${dueDate}T12:00:00`,
    payday,
    key: `${start}__${end}`,
    label: payPeriodLabel(start, end),
  };
}

/** The pay period that contains `now`. */
export function currentPayPeriod(now = new Date()) {
  return payPeriodByIndex(periodIndexForDate(now));
}

/**
 * A window of pay periods around `now` — a few future, the current one, and
 * several past — newest first, for a submission dropdown.
 */
export function listPayPeriods({ now = new Date(), back = 8, forward = 1 } = {}) {
  const cur = periodIndexForDate(now);
  const out = [];
  for (let i = cur + forward; i >= cur - back; i--) out.push(payPeriodByIndex(i));
  return out;
}

/** Does a start/end pair land exactly on an aligned Sunday→Saturday period? */
export function isAlignedPayPeriod(start, end) {
  const s = parseISODate(start);
  const e = parseISODate(end);
  if (!s || !e) return false;
  const diff = Math.round((utcMs(start) - utcMs(ANCHOR_START)) / DAY_MS);
  if (diff % PERIOD_DAYS !== 0) return false;
  return end === addDays(start, PERIOD_DAYS - 1) && s.getDay() === 0;
}

/** Has a period passed its noon-Monday submission deadline? */
export function isPastDue(period, now = new Date()) {
  if (!period?.dueDate) return false;
  const [y, m, d] = period.dueDate.split("-").map(Number);
  const due = new Date(y, m - 1, d, 12, 0, 0, 0); // noon local
  return now.getTime() > due.getTime();
}

/** "Mon, Jun 29, 2026 · 12:00 PM" — the submission deadline. */
export function dueLabel(period) {
  const d = parseISODate(period?.dueDate);
  if (!d) return "—";
  return `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })} · 12:00 PM`;
}

/** "Fri, Jul 17, 2026" — the payday. */
export function paydayLabel(period) {
  const d = parseISODate(period?.payday);
  if (!d) return "—";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}
