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
