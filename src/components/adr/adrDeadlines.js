// ADR deadline-reminder planner — decides which open ADR cases get an in-app
// reminder notification today. Canonical copy of the logic inlined into
// base44/functions/checkAdrDeadlines/entry.ts (Deno functions cannot import
// from src/; keep the two in step when editing).
//
// Cadence: a reminder fires at 7 / 3 / 1 / 0 days before the response deadline
// and then daily while overdue, up to 7 days past due (after that the case has
// been handled or abandoned outside this loop — don't nag forever). At most
// one notification per case per calendar day, tracked by
// AdrAuditCase.deadline_reminders.last_notified_date.
//
// Pure + offline (unit-tested with `node --test`); no React, no SDK, no `@/`
// imports. Dates are date-only strings compared as calendar days in UTC so the
// result is deterministic wherever the job runs.

export const OPEN_ADR_STATUSES = [
  "letter_uploaded",
  "checklist_ready",
  "packet_uploaded",
  "packet_verified",
  "packet_generated",
];

export const REMINDER_DAYS_BEFORE = [7, 3, 1, 0];
export const MAX_OVERDUE_REMINDER_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Parse a YYYY-MM-DD date-only string to UTC midnight ms, or null. */
export function parseDateOnlyUTC(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(ms);
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) {
    return null;
  }
  return ms;
}

const MONTH_NAMES = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function isoIfValid(y, mo, d) {
  const iso = `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return parseDateOnlyUTC(iso) === null ? null : iso;
}

/**
 * Normalize a letter-extracted date to the strict YYYY-MM-DD the reminder
 * planner requires. The UI's tolerant parser rendered "07/03/2026" and
 * "July 3, 2026" as live deadlines while parseDateOnlyUTC rejected them — an
 * armed-looking due date whose reminders silently never fired.
 * @returns {string|null}
 */
export function normalizeDueDateString(value) {
  const s = String(value || "").trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(s); // ISO date or datetime
  if (m) return isoIfValid(m[1], m[2], m[3]);
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s); // US M/D/YYYY
  if (m) return isoIfValid(m[3], m[1], m[2]);
  m = /^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s); // Month D, YYYY
  if (m) {
    const mo = MONTH_NAMES[m[1].toLowerCase()];
    return mo ? isoIfValid(m[3], mo, m[2]) : null;
  }
  return null;
}

/**
 * Resolve the response due date from the letter analysis. MAC letters often
 * state only a day count ("within 45 days of the date of this letter") — with
 * no absolute date extracted, the case used to have NO deadline at all: no
 * reminders, no due-soon stat, no banner. When only letter_date +
 * response_due_days are available the date is computed and flagged `derived`
 * so the UI can ask the user to confirm it.
 * @param {{ response_due_date?: string, letter_date?: string, response_due_days?: number }} analysis
 * @returns {{ date: string|null, derived: boolean }}
 */
export function resolveResponseDueDate(analysis = {}) {
  const direct = normalizeDueDateString(analysis.response_due_date);
  if (direct) return { date: direct, derived: false };
  const letterIso = normalizeDueDateString(analysis.letter_date);
  const days = Number(analysis.response_due_days);
  if (letterIso && Number.isInteger(days) && days > 0 && days <= 365) {
    const d = new Date(parseDateOnlyUTC(letterIso) + days * DAY_MS);
    return { date: isoIfValid(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()), derived: true };
  }
  return { date: null, derived: false };
}

/**
 * Plan today's deadline reminders.
 *
 * @param {{ cases: Array<object>, todayIso: string }} opts todayIso is the
 *   job's calendar date as YYYY-MM-DD (passed in for determinism/testing)
 * @returns {Array<{ case_id: string, user_email: string, days_left: number,
 *   priority: string, title: string, message: string }>}
 */
export function planAdrDeadlineReminders({ cases = [], todayIso } = {}) {
  const todayMs = parseDateOnlyUTC(todayIso);
  if (todayMs === null) return [];
  const plans = [];
  for (const c of cases) {
    if (!c || !OPEN_ADR_STATUSES.includes(c.status)) continue;
    if (!c.created_by) continue;
    const dueMs = parseDateOnlyUTC(c.response_due_date);
    if (dueMs === null) continue;
    const daysLeft = Math.round((dueMs - todayMs) / DAY_MS);
    const inPreWindow = REMINDER_DAYS_BEFORE.includes(daysLeft);
    const inOverdueWindow = daysLeft < 0 && daysLeft >= -MAX_OVERDUE_REMINDER_DAYS;
    if (!inPreWindow && !inOverdueWindow) continue;
    if (c.deadline_reminders?.last_notified_date === todayIso) continue; // already reminded today
    const name = c.case_name || c.patient_name || "an ADR case";
    const title =
      daysLeft > 0
        ? `⏰ ADR response due in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`
        : daysLeft === 0
          ? "⏰ ADR response due TODAY"
          : `🚨 ADR response overdue by ${-daysLeft} day${daysLeft === -1 ? "" : "s"}`;
    const message =
      daysLeft >= 0
        ? `${name}: the documentation response is due ${c.response_due_date}. Documentation not received by the deadline is treated as missing and the claim is denied.`
        : `${name}: the response deadline (${c.response_due_date}) has passed. Submit immediately and contact the contractor — late documentation is treated as missing.`;
    plans.push({
      case_id: c.id,
      user_email: c.created_by,
      days_left: daysLeft,
      priority: daysLeft <= 1 ? "critical" : "high",
      title,
      message,
    });
  }
  return plans;
}
