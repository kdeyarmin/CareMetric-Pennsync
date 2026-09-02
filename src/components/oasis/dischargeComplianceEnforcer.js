// Discharge-OASIS completion enforcer.
//
// A Discharge OASIS can pair with SOC/ROC for PennSync's unadjusted internal
// improvement proxies (see outcomeMeasureEngine.js). Those proxies are neither
// official CMS rates nor star inputs. This module flags an in-app documentation
// gap only; companion-mode callers must not treat missing EMR data as absence.
//
// Pure and dependency-free (no Base44/Deno APIs) so it is unit-tested with
// `node --test` and inlined by the monitorComplianceRisks cron.

import {
  INTERNAL_SAMPLE_MIN_PAIRS,
  INTERNAL_SAMPLE_MEASURE_TARGET,
} from "./outcomeMeasureEngine.js";

// A Discharge OASIS only "counts" as done once it is completed/submitted; a draft
// left open is functionally missing for quality reporting. Status and visit-type
// values are compared case-insensitively — "Completed" vs "completed" drift in
// stored records must not create false "missing discharge" alarms.
const COMPLETE_STATUSES = new Set(["completed", "submitted"]);
const START_VISIT_TYPES = new Set(["start of care", "resumption of care"]);
const lower = (v) => String(v || "").trim().toLowerCase();

// Parse a date-only ("YYYY-MM-DD") value as LOCAL midnight (matching
// src/lib/dateLocal.js and the intake-to-SOC tracker); other values fall
// through to the platform parser. Kept inline so this module stays
// dependency-free and node --test-runnable.
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

// Whole CALENDAR days between two dates (compared by local date components),
// not a raw-millisecond floor. A raw-ms floor UNDERcounts by a day whenever the
// later timestamp carries a smaller time-of-day than the earlier one (e.g. a
// morning "as of" vs. an evening last visit) — which could let a 14-day-stale
// episode read as 13 and silently skip the missing-Discharge-OASIS alert. This
// mirrors calendarDaysBetween in intakeToSocTracker.js.
function daysBetween(a, b) {
  const da = toLocalDate(a);
  const db = toLocalDate(b);
  if (!da || !db) return null;
  const dayA = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate());
  const dayB = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate());
  return Math.round((dayB - dayA) / (1000 * 60 * 60 * 24));
}

/**
 * Detect whether a patient's episode has ended without a completed Discharge
 * OASIS. Pure: caller supplies the already-fetched context.
 *
 * @param {Object} ctx
 * @param {Object} ctx.patient        { id, first_name, last_name, status, admission_date }
 * @param {Array}  ctx.oasisAssessments [{ visit_type, assessment_date, status }]
 * @param {Array}  ctx.visits         [{ visit_date }] (any order)
 * @param {Object} [opts]
 * @param {(string|Date)} [opts.asOf]  reference "today" (defaults required for determinism in tests)
 * @param {number} [opts.staleDays=14] days since last visit before an ACTIVE episode is treated as ended
 * @returns {(null|{reason:string, severity:string, alert:object})}
 */
export function detectMissingDischargeOASIS(ctx, opts = {}) {
  const { patient, oasisAssessments = [], visits = [] } = ctx || {};
  if (!patient || !patient.id) return null;

  // Pass asOf through as a string/Date value — do NOT pre-parse date-only
  // strings with `new Date("YYYY-MM-DD")` (UTC midnight), or daysBetween's
  // local-calendar path never runs and US zones undercount the stale window.
  const asOf = opts.asOf || new Date();
  const staleDays = opts.staleDays ?? 14;

  const dischargeAssessments = oasisAssessments.filter((a) => lower(a?.visit_type) === "discharge");
  const hasCompletedDischarge = dischargeAssessments.some((a) => COMPLETE_STATUSES.has(lower(a?.status)));
  const hasDraftDischarge = dischargeAssessments.length > 0 && !hasCompletedDischarge;
  const hasBaseline = oasisAssessments.some((a) => START_VISIT_TYPES.has(lower(a?.visit_type)));

  // Already have a completed discharge assessment → nothing to enforce.
  if (hasCompletedDischarge) return null;

  const status = String(patient.status || "").toLowerCase();
  const isDischargedPatient = status === "discharged" || status === "deceased";

  // Days since the most recent visit (episode-ended heuristic for active patients).
  let daysSinceLastVisit = null;
  if (visits.length) {
    const lastVisitDate = visits
      .map((v) => v?.visit_date)
      .filter(Boolean)
      .sort((a, b) => new Date(b) - new Date(a))[0];
    if (lastVisitDate) daysSinceLastVisit = daysBetween(lastVisitDate, asOf);
  }

  const episodeLikelyEnded =
    isDischargedPatient || (daysSinceLastVisit !== null && daysSinceLastVisit >= staleDays);

  if (!episodeLikelyEnded) return null;

  // Deceased episodes are excluded from the internal improvement proxies, so a
  // missing discharge row there should not produce this documentation signal.
  if (status === "deceased") return null;

  const severity = isDischargedPatient ? "critical" : "high";
  const reason = hasDraftDischarge
    ? "discharge_oasis_incomplete"
    : isDischargedPatient
    ? "discharged_without_discharge_oasis"
    : "episode_stale_without_discharge_oasis";

  const name = `${patient.first_name || ""} ${patient.last_name || ""}`.trim() || "Patient";
  const factors = [];
  if (isDischargedPatient) {
    factors.push("Patient is discharged but has no completed Discharge OASIS on file");
  } else {
    factors.push(`No visit in ${daysSinceLastVisit} days — episode appears to have ended`);
  }
  if (hasDraftDischarge) factors.push("A Discharge OASIS exists but is still in draft/in-progress");
  if (!hasBaseline) factors.push("No SOC/ROC assessment on file to pair for a change score");
  factors.push(
    "Without a completed in-app Discharge OASIS, PennSync cannot calculate its internal episode proxy",
    `Internal sample context uses ${INTERNAL_SAMPLE_MIN_PAIRS} pairs per measure and a ${INTERNAL_SAMPLE_MEASURE_TARGET}-measure marker; neither is official CMS eligibility`,
  );

  const alert = {
    patient_id: patient.id,
    alert_type: "documentation_risk",
    severity,
    title: hasDraftDischarge
      ? "Discharge OASIS Not Completed"
      : "Missing Discharge OASIS Assessment",
    message: hasDraftDischarge
      ? `${name}'s Discharge OASIS is started but not completed — finalize it to capture outcome improvement.`
      : `${name}'s episode has ended without a Discharge OASIS — demonstrated improvement will be lost.`,
    contributing_factors: factors,
    recommended_actions: [
      hasDraftDischarge
        ? "Complete and submit the in-progress Discharge OASIS"
        : "Complete a Discharge OASIS assessment for this episode",
      "When the tenant-authorized outcome broker is available, pair it with SOC/ROC for the internal unadjusted proxy",
      "Verify functional items (M1860, M1850, M1830, M1400, M2020) are scored",
    ],
    risk_score: isDischargedPatient ? 88 : 72,
    data_sources: {
      patient_status: patient.status,
      days_since_last_visit: daysSinceLastVisit,
      has_baseline_oasis: hasBaseline,
      has_draft_discharge: hasDraftDischarge,
    },
  };

  return { reason, severity, alert };
}

/**
 * Compute an INTERNAL sample-context gap from an outcome rollup. This is only a
 * local readiness marker for reviewing PennSync's unadjusted proxy; it is not a
 * CMS reporting eligibility or star-rating calculation.
 *
 * @param {{measures: Array}} rollup
 * @returns {{
 *   at_risk: boolean,
 *   measures_eligible: number,
 *   measures_needed: number,
 *   measures_short: Array<{key,label,denominator,episodes_needed}>,
 * }}
 */
export function computeInternalSampleGap(rollup) {
  const measures = rollup?.measures || [];
  const ready = measures.filter((m) => m.denominator >= INTERNAL_SAMPLE_MIN_PAIRS);
  const short = measures
    .filter((m) => m.denominator < INTERNAL_SAMPLE_MIN_PAIRS)
    .map((m) => ({
      key: m.key,
      label: m.label,
      denominator: m.denominator,
      episodes_needed: INTERNAL_SAMPLE_MIN_PAIRS - m.denominator,
    }));
  return {
    below_internal_marker: ready.length < INTERNAL_SAMPLE_MEASURE_TARGET,
    measures_sample_ready: ready.length,
    measures_needed: Math.max(0, INTERNAL_SAMPLE_MEASURE_TARGET - ready.length),
    measures_short: short,
  };
}
