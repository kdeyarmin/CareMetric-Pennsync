// Discharge-OASIS completion enforcer.
//
// A Discharge OASIS is what pairs with the SOC/ROC to produce a CMS change score
// (see outcomeMeasureEngine.js). If an episode ends without one, the agency
// SILENTLY loses that patient's demonstrated improvement and drifts below the
// star-rating eligibility floors (>= 20 eligible episodes per measure, and >= 5
// of the reported measures). This module flags those gaps.
//
// Pure and dependency-free (no Base44/Deno APIs) so it is unit-tested with
// `node --test` and inlined by the monitorComplianceRisks cron.

import { STAR_MIN_EPISODES, STAR_MIN_MEASURES } from "./outcomeMeasureEngine.js";

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

  // Deceased episodes are excluded from improvement measures anyway, so a missing
  // discharge OASIS there is not a star-eligibility loss — skip (no false alarm).
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
    "Without a completed Discharge OASIS this episode contributes no demonstrated improvement",
    `Missing episodes erode the ${STAR_MIN_EPISODES}-episode / ${STAR_MIN_MEASURES}-measure star eligibility floor`,
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
      "Pair it with the SOC/ROC to compute the CMS change score",
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
 * Compute the agency-level star-eligibility gap from an outcome rollup
 * (rollupMeasures result). Surfaces which measures are short of the 20-episode
 * floor and how many more eligible episodes each needs, plus whether the agency
 * clears the minimum-measure bar. (CMS requires >= 5 of its 7 rated measures;
 * this app tracks the 5 OASIS-based ones, so every tracked measure must clear
 * the episode floor.)
 *
 * @param {{measures: Array}} rollup
 * @returns {{
 *   at_risk: boolean,
 *   measures_eligible: number,
 *   measures_needed: number,
 *   measures_short: Array<{key,label,denominator,episodes_needed}>,
 * }}
 */
export function computeStarEligibilityGap(rollup) {
  const measures = rollup?.measures || [];
  const eligible = measures.filter((m) => m.denominator >= STAR_MIN_EPISODES);
  const short = measures
    .filter((m) => m.denominator < STAR_MIN_EPISODES)
    .map((m) => ({
      key: m.key,
      label: m.label,
      denominator: m.denominator,
      episodes_needed: STAR_MIN_EPISODES - m.denominator,
    }));
  return {
    at_risk: eligible.length < STAR_MIN_MEASURES,
    measures_eligible: eligible.length,
    measures_needed: Math.max(0, STAR_MIN_MEASURES - eligible.length),
    measures_short: short,
  };
}
