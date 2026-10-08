// Local calendar dates for OASIS-derived follow-up tasks.
//
// `toISOString()` converts to UTC and would roll a due date a day late when a
// task is created in the evening in any US timezone, so every offset is taken
// from a fresh local date. Pure — no React, no SDK.

/** YYYY-MM-DD for today plus `days`, in the browser's local calendar. */
export function addDaysToToday(days, now = new Date()) {
  const offset = Number.isFinite(days) ? Math.trunc(days) : 0;
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
