// Federal holidays that always require all-day on-call coverage, plus the
// weekday overnight rule (Mon-Thu 5pm -> 9am next day). All date math is done in
// plain Y-M-D strings to avoid timezone drift.

const pad = (n) => String(n).padStart(2, "0");
export const toISO = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

// Date of the Nth given weekday in a month. weekday: 0=Sun..6=Sat.
function nthWeekday(year, month /* 1-12 */, weekday, n) {
  const first = new Date(year, month - 1, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  const day = 1 + offset + (n - 1) * 7;
  return toISO(year, month, day);
}

// Last given weekday in a month.
function lastWeekday(year, month /* 1-12 */, weekday) {
  const last = new Date(year, month, 0); // day 0 of next month = last day
  const offset = (last.getDay() - weekday + 7) % 7;
  return toISO(year, month, last.getDate() - offset);
}

// Returns { [isoDate]: holidayName } for the six required holidays in a year.
export function getHolidaysForYear(year) {
  return {
    [toISO(year, 1, 1)]: "New Year's Day",
    [lastWeekday(year, 5, 1)]: "Memorial Day", // last Monday of May
    [toISO(year, 7, 4)]: "Independence Day",
    [nthWeekday(year, 9, 1, 1)]: "Labor Day", // 1st Monday of September
    [nthWeekday(year, 11, 4, 4)]: "Thanksgiving Day", // 4th Thursday of November
    [toISO(year, 12, 25)]: "Christmas Day",
  };
}

// Convenience: holiday name for a specific Date, or null.
export function holidayNameFor(date) {
  const map = getHolidaysForYear(date.getFullYear());
  const iso = toISO(date.getFullYear(), date.getMonth() + 1, date.getDate());
  return map[iso] || null;
}

// Overnight weekday coverage is needed Monday(1) through Thursday(4).
export function needsOvernight(date) {
  const dow = date.getDay();
  return dow >= 1 && dow <= 4;
}