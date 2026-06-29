/**
 * dutyUtils — shared on/off-duty logic for the Twilio phone integration.
 *
 * A nurse is "off duty" either because they flipped the manual switch, or
 * because a scheduled time-off window (e.g. the weekend) is active right now.
 * The inbound call/SMS webhooks read this live at call time, so a schedule
 * needs no cron job — it simply takes effect and expires on its own.
 *
 * These helpers are mirrored inline in the Deno backend functions (single-file
 * deploy model); this unit-tested copy is the source of truth.
 */

/** Parse a date-ish value to epoch ms, or null if missing/invalid. */
function toTime(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * True when `now` falls inside a valid scheduled time-off window. The window is
 * only honored when both ends parse and end is strictly after start.
 *
 * When `recurring` is set, the window repeats every week on the same day/time
 * as the anchor (e.g. a Sat→Mon window becomes "every weekend"). Recurrence is
 * anchored at the first occurrence, so it never activates before `start`.
 * (Fixed 7-day arithmetic; a DST change can shift the local boundary by an hour.)
 */
export function isScheduledOffActive(start, end, now = new Date(), recurring = false) {
  const s = toTime(start);
  const e = toTime(end);
  if (s === null || e === null || e <= s) return false;
  const t = now.getTime();
  // Recurrence only makes sense for a window shorter than its weekly period; a
  // window >= 1 week would cover every instant, so fall back to one-off
  // semantics (which expires) rather than trapping the nurse off duty forever.
  if (recurring && e - s < WEEK_MS) {
    if (t < s) return false;
    const delta = ((t - s) % WEEK_MS + WEEK_MS) % WEEK_MS;
    return delta <= e - s;
  }
  return t >= s && t <= e;
}

// Default end-of-day cutoff: a nurse is auto-ended at 5pm local time even if
// they forgot to flip the switch ("toggle off ... or at 5pm, whichever first").
export const DEFAULT_AUTO_OFF_HOUR = 17;
// The agency office is in the 724 (Pennsylvania / Eastern) area, so default the
// duty clock to Eastern when no timezone is configured.
export const DEFAULT_DUTY_TIMEZONE = "America/New_York";

/** Hour (0–23) at `now` in `timeZone`, or null when it can't be computed. */
export function hourInZone(date, timeZone) {
  try {
    const h = new Intl.DateTimeFormat("en-US", { timeZone: timeZone || undefined, hour12: false, hour: "2-digit" }).format(date);
    let n = parseInt(h, 10);
    if (n === 24) n = 0;
    return Number.isNaN(n) ? null : n;
  } catch {
    return null;
  }
}

/**
 * True when `now` is at/after the agency's auto-off-duty hour (default 5pm) in
 * the duty timezone. After this, a nurse is treated as off duty regardless of
 * their toggle. Disabled when `auto_off_duty_enabled` is explicitly false. An
 * unknown timezone returns false (don't force everyone off on a misconfig).
 */
export function isPastAutoOffHour(settings, now = new Date()) {
  const s = settings || {};
  if (s.auto_off_duty_enabled === false) return false;
  const hour = Number.isFinite(Number(s.auto_off_duty_hour)) ? Number(s.auto_off_duty_hour) : DEFAULT_AUTO_OFF_HOUR;
  const tz = s.duty_timezone || s.business_hours_timezone || DEFAULT_DUTY_TIMEZONE;
  const h = hourInZone(now, tz);
  if (h == null) return false;
  return h >= hour;
}

/** Calendar date key (YYYY-MM-DD) for `date` in `timeZone`, or null when it
 *  can't be computed (e.g. an invalid/garbage date). */
export function dateKeyInZone(date, timeZone) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || undefined, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  }
}

/**
 * True when the nurse should be treated as off duty at `now`. A nurse is on duty
 * ONLY while explicitly toggled on (`duty_status === 'on_duty'`), before the
 * agency's auto-off hour, with no active scheduled time-off window, AND only on
 * the same calendar day they toggled on. That last rule makes the toggle expire
 * by itself overnight (no cron required): a nurse who forgets to toggle off is
 * automatically off the next morning until they explicitly toggle on again.
 * Anything else — a fresh account, a forgotten toggle, after 5pm, yesterday's
 * toggle, or a scheduled window — routes calls/texts to the office.
 *
 * `settings` is optional (backward compatible); pass the AgencySettings row to
 * enable the 5pm auto-off cutoff and the duty timezone for the nightly reset.
 */
export function isOffDutyNow(user, now = new Date(), settings = null) {
  if (!user) return false;
  if (isScheduledOffActive(
    user.scheduled_off_duty_start,
    user.scheduled_off_duty_end,
    now,
    !!user.scheduled_off_duty_recurring,
  )) return true;
  if (settings && isPastAutoOffHour(settings, now)) return true;
  if (user.duty_status !== "on_duty") return true;
  // Toggled on, but the activation expires nightly: if it was set on an earlier
  // calendar day, treat as off until they toggle on again today. (Legacy rows
  // without duty_on_since stay on, falling back to the prior behavior.)
  if (user.duty_on_since) {
    const tz = (settings && (settings.duty_timezone || settings.business_hours_timezone)) || DEFAULT_DUTY_TIMEZONE;
    if (dateKeyInZone(new Date(user.duty_on_since), tz) !== dateKeyInZone(now, tz)) return true;
  }
  return false;
}

/**
 * Status of a scheduled window relative to `now`, for the UI:
 * one-off → "none" | "active" | "upcoming" | "expired";
 * recurring → "none" | "active" | "recurring" (scheduled but not in-window now).
 */
export function scheduleState(start, end, now = new Date(), recurring = false) {
  const s = toTime(start);
  const e = toTime(end);
  if (s === null || e === null || e <= s) return "none";
  if (recurring) return isScheduledOffActive(start, end, now, true) ? "active" : "recurring";
  const t = now.getTime();
  if (t < s) return "upcoming";
  if (t > e) return "expired";
  return "active";
}

/**
 * The upcoming weekend as a { start, end } pair of local-time Dates: Saturday
 * 00:00 through Monday 00:00. If it's already the weekend, the window starts
 * now so toggling it on mid-weekend still covers the rest of it.
 */
export function getUpcomingWeekend(now = new Date()) {
  const day = now.getDay(); // 0 Sun ... 6 Sat
  const start = new Date(now);
  if (day !== 6 && day !== 0) {
    start.setDate(start.getDate() + (6 - day)); // advance to Saturday
    start.setHours(0, 0, 0, 0);
  }
  // End at the next Monday 00:00 at or after the window's date.
  const end = new Date(start);
  end.setHours(0, 0, 0, 0);
  do {
    end.setDate(end.getDate() + 1);
  } while (end.getDay() !== 1); // 1 = Monday
  return { start, end };
}
