/**
 * scheduledSms — pure helpers for scheduling a text to send later.
 *
 * A nurse composes a message and picks a future send time; it's stored as a
 * pending ScheduledSms row and a cron dispatcher (dispatchScheduledSms) sends it
 * when due. The scheduling rules and "is it due?" logic live here so they're
 * verifiable in isolation and shared (in spirit) with the backend, which keeps
 * an inline copy per the single-file deploy model.
 */

export const MIN_LEAD_MS = 60 * 1000; // must be at least ~1 minute out
export const MAX_SCHEDULE_DAYS = 365; // and no further than a year
const MAX_SCHEDULE_MS = MAX_SCHEDULE_DAYS * 24 * 60 * 60 * 1000;

/**
 * Validate a requested send time. Returns { ok: true, iso } with the normalized
 * ISO string, or { ok: false, error } with a human-readable reason.
 */
export function validateScheduleTime(sendAt, now = new Date()) {
  if (!sendAt) return { ok: false, error: "Choose a date and time to send." };
  const t = new Date(sendAt).getTime();
  if (Number.isNaN(t)) return { ok: false, error: "That date/time isn't valid." };
  const nowMs = now.getTime();
  if (t < nowMs + MIN_LEAD_MS) return { ok: false, error: "Pick a time at least a minute from now." };
  if (t > nowMs + MAX_SCHEDULE_MS) return { ok: false, error: `Pick a time within ${MAX_SCHEDULE_DAYS} days.` };
  return { ok: true, iso: new Date(t).toISOString() };
}

/** A row is due when it's still pending and its send time has arrived. */
export function isDue(row, now = new Date()) {
  if (!row || row.status !== "pending") return false;
  const t = new Date(row.send_at).getTime();
  if (Number.isNaN(t)) return false;
  return t <= now.getTime();
}

/** All rows that are due to send now (pending + send_at <= now). */
export function dueRows(rows, now = new Date()) {
  return (Array.isArray(rows) ? rows : []).filter((r) => isDue(r, now));
}

/** Upcoming (pending, not yet due) rows, soonest first. */
export function upcomingRows(rows, now = new Date()) {
  const nowMs = now.getTime();
  // Require a *valid future* send time. Using `!isDue` alone would let a row with
  // an unparseable send_at (isDue → false) leak into the upcoming list and then
  // sort by a NaN key, producing an unstable order and surfacing a broken row.
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => {
      if (!r || r.status !== "pending") return false;
      const t = new Date(r.send_at).getTime();
      return !Number.isNaN(t) && t > nowMs;
    })
    .sort((a, b) => new Date(a.send_at).getTime() - new Date(b.send_at).getTime());
}

/** Whether a pending row can still be canceled (only pending rows). */
export function canCancel(row) {
  return !!row && row.status === "pending";
}
