/**
 * businessHours — global "calling & texting hours" for the Twilio integration.
 *
 * Per-nurse duty (dutyUtils) answers "is THIS nurse reachable right now?".
 * This module answers the agency-wide question "is the practice OPEN right
 * now?" — a single weekly schedule in one timezone that gates patient
 * communication. When the practice is closed:
 *   - inbound calls auto-transfer to the after-hours number (or voicemail/hangup),
 *   - inbound texts get an automatic after-hours reply,
 *   - nurse-initiated outbound sends show an "after hours" heads-up (warn-but-allow).
 *
 * Pure + unit-tested; the single-file Deno backend handlers keep an inline copy
 * of this logic (the Base44 deploy model forbids cross-file imports).
 */

/** Day-of-week index (0=Sun … 6=Sat) → the key used in a schedule object. */
export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Parse "HH:MM" (24h) to minutes-since-midnight, or null if malformed. */
export function parseHHMM(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Wall-clock weekday + minutes-since-midnight for `date` in an IANA `timeZone`
 * (e.g. "America/New_York"), using Intl so there's no tz database dependency.
 * Throws RangeError on an invalid timezone (callers fall back to local time).
 */
export function wallClockInTimeZone(date, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone || undefined,
    hour12: false,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = {};
  for (const p of dtf.formatToParts(date)) parts[p.type] = p.value;
  let hour = parseInt(parts.hour, 10);
  if (hour === 24) hour = 0; // some runtimes emit "24" for midnight
  const minute = parseInt(parts.minute, 10);
  const weekday = WEEKDAY_INDEX[parts.weekday];
  return { weekday: weekday ?? null, minutes: hour * 60 + minute };
}

/** Calendar date as "YYYY-MM-DD" in an IANA timezone (for holiday matching). */
export function dateKeyInTimeZone(date, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || undefined,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // en-CA formats as YYYY-MM-DD.
  return dtf.format(date);
}

/**
 * A sensible default weekly schedule: Mon–Fri 08:00–17:00 open, weekend closed.
 * Used to seed the admin UI so the schedule is never blank.
 */
export function defaultBusinessHours() {
  const week = {};
  for (const key of DAY_KEYS) {
    const weekday = key !== "sun" && key !== "sat";
    week[key] = { enabled: weekday, open: "08:00", close: "17:00" };
  }
  return week;
}

/**
 * Map the flat AgencySettings fields to the normalized config this module
 * consumes. Keeping the mapping here means the UI and the (mirrored) backend
 * read the schedule identically.
 */
export function agencyHoursConfig(settings) {
  const s = settings || {};
  return {
    enabled: s.business_hours_enabled === true,
    timeZone: s.business_hours_timezone || undefined,
    days: s.business_hours && typeof s.business_hours === "object" ? s.business_hours : {},
    holidays: Array.isArray(s.business_hours_holidays) ? s.business_hours_holidays : [],
  };
}

/**
 * Evaluate whether the practice is open at `now` for a normalized config
 * `{ enabled, timeZone, days }`.
 *
 * Returns { open, reason, day, minutes, opensAt?, closesAt? }. When the feature
 * is disabled it returns `{ open: true, reason: 'not_enforced' }` — i.e. no
 * gating at all, so existing behavior is unchanged until an admin turns it on.
 * A day whose close time is <= its open time is treated as an overnight window
 * (e.g. 22:00–06:00) so 24/7-ish and late-shift schedules work.
 */
export function isWithinBusinessHours(now = new Date(), config) {
  const cfg = config || {};
  if (!cfg.enabled) return { open: true, reason: "not_enforced" };

  let wc;
  let dateKey;
  try {
    wc = wallClockInTimeZone(now, cfg.timeZone);
    dateKey = dateKeyInTimeZone(now, cfg.timeZone);
  } catch {
    // Invalid/unsupported timezone → fall back to the host's local time rather
    // than crashing the webhook.
    wc = wallClockInTimeZone(now, undefined);
    dateKey = dateKeyInTimeZone(now, undefined);
  }

  // A holiday closes the practice all day, regardless of the weekday schedule.
  if (Array.isArray(cfg.holidays) && cfg.holidays.includes(dateKey)) {
    return { open: false, reason: "holiday", date: dateKey, minutes: wc.minutes };
  }

  const key = DAY_KEYS[wc.weekday];
  const day = (cfg.days || {})[key];
  if (!day || day.enabled === false) {
    return { open: false, reason: "closed_day", day: key, minutes: wc.minutes };
  }

  const open = parseHHMM(day.open);
  const close = parseHHMM(day.close);
  if (open == null || close == null) {
    return { open: false, reason: "no_hours_set", day: key, minutes: wc.minutes };
  }

  const m = wc.minutes;
  // Use strict `<` so an equal open/close (e.g. 00:00-00:00, the admin "open all
  // day" intent documented above) falls into the overnight/always-open branch
  // instead of the normal branch, where `m >= open && m < open` is always false
  // and would report the practice closed 24h.
  const within = open < close ? m >= open && m < close : m >= open || m < close;
  return {
    open: within,
    reason: within ? "open" : "after_hours",
    day: key,
    minutes: m,
    opensAt: day.open,
    closesAt: day.close,
  };
}

/** Convenience: is the agency open now, straight from AgencySettings? */
export function isAgencyOpen(settings, now = new Date()) {
  return isWithinBusinessHours(now, agencyHoursConfig(settings)).open;
}

/**
 * One-line human summary of a schedule for the admin UI, e.g.
 * "Mon–Fri 08:00–17:00" or "Custom hours" / "No open days".
 */
export function summarizeSchedule(days) {
  const d = days || {};
  // A day only counts as "open" when BOTH ends parse — same rule
  // isWithinBusinessHours uses — so the summary never disagrees with reality or
  // renders a half-open "08:00–undefined" window.
  const openDays = DAY_KEYS.filter(
    (k) => d[k] && d[k].enabled !== false && parseHHMM(d[k].open) != null && parseHHMM(d[k].close) != null,
  );
  if (openDays.length === 0) return "No open days set";
  const sameWindow = openDays.every(
    (k) => d[k].open === d[openDays[0]].open && d[k].close === d[openDays[0]].close,
  );
  const label = openDays.map((k) => k[0].toUpperCase() + k.slice(1)).join(", ");
  if (sameWindow) return `${label}: ${d[openDays[0]].open}–${d[openDays[0]].close}`;
  return `${openDays.length} day${openDays.length > 1 ? "s" : ""} with custom hours`;
}
