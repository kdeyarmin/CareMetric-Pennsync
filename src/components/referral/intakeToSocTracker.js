// Intake-to-SOC / Timely Initiation of Care tracker.
//
// Referral.status previously ended at `ready_for_admission` with no start-of-care
// timestamp, so admission timeliness could not be computed. This module (paired
// with the new Referral `soc_completed` state + `soc_date`) computes the
// referral→start-of-care turnaround, drives an aging-referral board, and rolls
// up the CMS "Timely Initiation of Care" QoPC process measure + an office KPI.
//
// CMS Timely Initiation of Care: the SOC/ROC occurred within 2 days of the
// referral date OR on/within 2 days of the physician-specified SOC date.
//
// Pure + offline (unit-tested with `node --test`).

export const TIMELY_INITIATION_DAYS = 2;

export const AGING_BUCKET = { ON_TRACK: "on_track", DUE_SOON: "due_soon", OVERDUE: "overdue" };
// Statuses that mean the intake→SOC clock is no longer running.
const CLOSED_STATUSES = new Set(["soc_completed", "declined"]);

// Parse a date-only ("YYYY-MM-DD") value as LOCAL midnight (matching
// src/lib/dateLocal.js); other values fall through to the platform parser. Kept
// inline so this module stays dependency-free and `node --test`-runnable.
function toLocalDate(v) {
  if (!v) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(v).trim());
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Whole calendar days between two dates, comparing LOCAL calendar components so a
// date-only referral_date (local midnight) isn't differenced against a wall-clock
// "now" — which could otherwise flip the aging bucket by a day for users behind UTC.
function calendarDaysBetween(a, b) {
  if (!a || !b) return null;
  const dayA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const dayB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((dayB - dayA) / (1000 * 60 * 60 * 24));
}

function agingBucket(ageDays) {
  if (ageDays == null) return null;
  if (ageDays < TIMELY_INITIATION_DAYS) return AGING_BUCKET.ON_TRACK;
  if (ageDays === TIMELY_INITIATION_DAYS) return AGING_BUCKET.DUE_SOON;
  return AGING_BUCKET.OVERDUE;
}

/**
 * Compute referral→SOC turnaround (or open aging) for one referral.
 *
 * @param {Object} referral  { referral_date, estimated_start_date, soc_date, first_visit_date, status }
 * @param {Object} [opts]
 * @param {(string|Date)} [opts.asOf]  reference "today"
 * @returns {{
 *   completed: boolean, open: boolean,
 *   turnaround_days: (number|null), ordered_soc_days: (number|null),
 *   timely: (boolean|null), status: string, age_days: (number|null),
 *   aging_bucket: (string|null),
 * }}
 */
export function computeTurnaround(referral = {}, opts = {}) {
  const asOf = opts.asOf ? toLocalDate(opts.asOf) : new Date();
  // CALENDAR-day parsing/differencing throughout (same as the aging path): the
  // raw-ms parser classified a calendar-day-2 SOC as late whenever a datetime
  // value carried a time-of-day (2.6 days rounds to 3).
  const referralDate = toLocalDate(referral.referral_date);
  const socDate = toLocalDate(referral.soc_date || referral.first_visit_date);
  const orderedSoc = toLocalDate(referral.estimated_start_date);

  if (socDate) {
    const turnaround = calendarDaysBetween(referralDate, socDate);
    const orderedDays = calendarDaysBetween(referralDate, orderedSoc);
    // Timely if within 2 days of referral, OR the SOC happened on/before the
    // physician-specified SOC date (+2-day grace).
    const withinReferralWindow = turnaround != null && turnaround <= TIMELY_INITIATION_DAYS;
    const daysPastOrdered = calendarDaysBetween(orderedSoc, socDate);
    const withinOrderedWindow = daysPastOrdered != null && daysPastOrdered <= TIMELY_INITIATION_DAYS;
    const timely = referralDate || orderedSoc ? withinReferralWindow || withinOrderedWindow : null;
    return {
      completed: true,
      open: false,
      turnaround_days: turnaround,
      ordered_soc_days: orderedDays,
      timely,
      // Three-way: an unknown (no dates to measure against) must not be
      // labeled "timely" in any UI that renders the status string.
      status: timely === false ? "late" : timely === true ? "timely" : "unknown",
      age_days: null,
      aging_bucket: null,
    };
  }

  // Still open — no SOC yet.
  const closed = CLOSED_STATUSES.has(String(referral.status || "").toLowerCase());
  const ageDays = calendarDaysBetween(toLocalDate(referral.referral_date), asOf);
  return {
    completed: false,
    open: !closed,
    turnaround_days: null,
    ordered_soc_days: calendarDaysBetween(referralDate, orderedSoc),
    timely: null,
    status: closed ? "closed" : "open",
    age_days: ageDays,
    aging_bucket: closed ? null : agingBucket(ageDays),
  };
}

/**
 * Build the aging-referral board from open referrals (those without a SOC yet).
 * Sorted oldest-first within each bucket.
 *
 * @param {Array} referrals
 * @param {Object} [opts] { asOf }
 * @returns {{ buckets: object, counts: object, total_open: number, oldest_age_days: (number|null) }}
 */
export function buildAgingBoard(referrals = [], opts = {}) {
  const buckets = { [AGING_BUCKET.ON_TRACK]: [], [AGING_BUCKET.DUE_SOON]: [], [AGING_BUCKET.OVERDUE]: [] };
  let oldest = null;

  for (const referral of referrals) {
    const t = computeTurnaround(referral, opts);
    if (!t.open) continue; // completed or closed — not on the aging board
    // Open but no referral_date → age can't be computed and there's no bucket to
    // file it under; skip rather than crash on buckets[null].push(...).
    if (!t.aging_bucket) continue;
    const entry = {
      id: referral.id,
      patient_name: referral.patient_name,
      referral_date: referral.referral_date,
      status: referral.status,
      age_days: t.age_days,
      aging_bucket: t.aging_bucket,
    };
    buckets[t.aging_bucket].push(entry);
    if (t.age_days != null && (oldest == null || t.age_days > oldest)) oldest = t.age_days;
  }

  for (const key of Object.keys(buckets)) {
    buckets[key].sort((a, b) => (b.age_days ?? -1) - (a.age_days ?? -1));
  }

  const counts = {
    [AGING_BUCKET.ON_TRACK]: buckets[AGING_BUCKET.ON_TRACK].length,
    [AGING_BUCKET.DUE_SOON]: buckets[AGING_BUCKET.DUE_SOON].length,
    [AGING_BUCKET.OVERDUE]: buckets[AGING_BUCKET.OVERDUE].length,
  };
  return {
    buckets,
    counts,
    total_open: counts.on_track + counts.due_soon + counts.overdue,
    oldest_age_days: oldest,
  };
}

/**
 * Roll up the Timely Initiation of Care measure across referrals that reached SOC.
 * @param {Array} referrals
 * @param {Object} [opts] { asOf }
 * @returns {{ numerator, denominator, rate, average_turnaround_days, timely, late }}
 */
export function rollupTimelyInitiation(referrals = [], opts = {}) {
  let numerator = 0;
  let denominator = 0;
  let turnaroundSum = 0;
  let turnaroundCount = 0;

  for (const referral of referrals) {
    const t = computeTurnaround(referral, opts);
    if (!t.completed || t.timely == null) continue;
    denominator += 1;
    if (t.timely) numerator += 1;
    if (t.turnaround_days != null) {
      turnaroundSum += t.turnaround_days;
      turnaroundCount += 1;
    }
  }

  const rate = denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;
  const avg = turnaroundCount > 0 ? Math.round((turnaroundSum / turnaroundCount) * 10) / 10 : null;
  return {
    numerator,
    denominator,
    rate,
    average_turnaround_days: avg,
    timely: numerator,
    late: denominator - numerator,
  };
}

/**
 * Two AgencyKPI payloads from a Timely Initiation rollup: the QoPC process
 * measure (quality) and the office turnaround KPI (operational).
 */
export function toTimelyInitiationKPIs(rollup, { periodStart, periodEnd, periodType = "monthly", agencyId } = {}) {
  const out = [];
  if (rollup.rate !== null) {
    out.push({
      ...(agencyId ? { agency_id: agencyId } : {}),
      metric_name: "Timely Initiation of Care",
      metric_category: "quality",
      period_type: periodType,
      period_start: periodStart,
      period_end: periodEnd,
      metric_value: rollup.rate,
      unit: "%",
      status: rollup.rate >= 90 ? "on_target" : rollup.rate >= 80 ? "warning" : "critical",
      contributing_factors: [`${rollup.numerator} of ${rollup.denominator} SOCs within the ${TIMELY_INITIATION_DAYS}-day window`],
    });
  }
  if (rollup.average_turnaround_days !== null) {
    out.push({
      ...(agencyId ? { agency_id: agencyId } : {}),
      metric_name: "Average Referral-to-SOC Turnaround",
      metric_category: "operational",
      period_type: periodType,
      period_start: periodStart,
      period_end: periodEnd,
      metric_value: rollup.average_turnaround_days,
      unit: "days",
      status: rollup.average_turnaround_days <= TIMELY_INITIATION_DAYS ? "on_target" : "warning",
      contributing_factors: [`Averaged across ${rollup.denominator} admitted referrals`],
    });
  }
  return out;
}

/**
 * Pure state transition to close the intake→SOC clock. Returns the Referral
 * update payload (does not perform I/O).
 */
export function markStartOfCareCompleted(referral, { socDate, firstVisitDate, by } = {}) {
  const soc = socDate || firstVisitDate;
  return {
    status: "soc_completed",
    ...(soc ? { soc_date: soc } : {}),
    ...(firstVisitDate ? { first_visit_date: firstVisitDate } : soc ? { first_visit_date: soc } : {}),
    ...(by ? { soc_completed_by: by } : {}),
  };
}
