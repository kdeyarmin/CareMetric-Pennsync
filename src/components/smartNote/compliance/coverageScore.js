// Deterministic, reproducible compliance scoring + persistence mapping.
// Replaces the previous LLM-invented 0-100 scores and the fabricated
// "compliance_improvement: 20" constant with a real coverage measure:
//   coverage = round(100 * present-or-confirmed / required)
// Pure + offline; safe to unit test.
import { CLUSTER, GUARD_STATUS } from "../../compliance/denialGuardrailEngine.js";

/** Was a required element satisfied (documented in the draft, answered, or a confirmed negative)? */
function isCovered(id, presentIds, answeredIds, confirmedNegativeIds) {
  return presentIds.includes(id) || answeredIds.includes(id) || confirmedNegativeIds.includes(id);
}

/**
 * @param {{ requiredElements: Array, presenceResults: Array, answeredIds?: string[], confirmedNegativeIds?: string[] }} input
 * @returns {number} 0-100
 */
export function computeCoverageScore({ requiredElements, presenceResults, answeredIds = [], confirmedNegativeIds = [] }) {
  const total = requiredElements.length;
  if (!total) return 100;
  const presentIds = presenceResults.filter((r) => r.present).map((r) => r.id);
  const covered = requiredElements.filter((e) =>
    isCovered(e.id, presentIds, answeredIds, confirmedNegativeIds)
  ).length;
  return Math.round((100 * covered) / total);
}

/** Coverage of the raw draft alone (the real "before" number). */
export function computeDraftPresenceScore({ requiredElements, presenceResults }) {
  return computeCoverageScore({ requiredElements, presenceResults });
}

/**
 * Map computed scores onto the stable NoteConversion field names (~15
 * consumers read these — names must not change, only the values become real).
 */
export function toNoteConversionFields({
  coverageScore,
  draftPresenceScore,
  roughLen,
  enhancedLen,
  visitType,
  diagnosis,
  nurseEmail,
  patientId,
}) {
  return {
    nurse_email: nurseEmail,
    patient_id: patientId || "",
    visit_type: visitType,
    diagnosis: diagnosis || "",
    rough_note_length: roughLen,
    enhanced_note_length: enhancedLen,
    quality_score: coverageScore,
    compliance_score: coverageScore,
    rough_note_compliance: draftPresenceScore,
    enhanced_note_compliance: coverageScore,
    compliance_improvement: Math.max(0, coverageScore - draftPresenceScore),
    draft_presence_score: draftPresenceScore,
    rough_len: roughLen,
    enhanced_len: enhancedLen,
  };
}

/**
 * Derive the structured Visit compliance fields (previously never populated).
 *
 * `denialFindings` (the deterministic denial-guardrail result for the text being
 * saved) makes these fields QUALITY-aware, not merely presence-aware. Coverage
 * asks "is the topic addressed at all?"; these two booleans are read by the
 * compliance dashboards as an assertion that the eligibility requirement is
 * actually MET. A conclusory "patient is homebound" satisfies coverage but fails
 * an audit, and persisting `homebound_status_verified: true` for it told the
 * dashboards the note was defensible when the guardrail had already judged the
 * narrative a critical denial risk. A failing cluster now withholds the claim.
 * Guardrail findings can only WITHHOLD it — never grant one coverage didn't.
 * Omitting `denialFindings` preserves the original presence-only behavior.
 *
 * @param {Array} presenceResults
 * @param {{ answeredIds?: string[], confirmedNegativeIds?: string[], textById?: Record<string,string>, denialFindings?: Array }} ctx
 */
export function deriveStructuredVisitFields(presenceResults, ctx = {}) {
  const { answeredIds = [], confirmedNegativeIds = [], textById = {}, denialFindings = [] } = ctx;
  // A cluster the guardrail explicitly FAILED withholds the corresponding claim.
  // Any other state (pass, not-applicable, cluster absent, no findings at all)
  // leaves the coverage answer untouched.
  const clusterFailed = (cluster) =>
    (Array.isArray(denialFindings) ? denialFindings : []).some(
      (f) => f && f.cluster === cluster && f.status === GUARD_STATUS.FAIL,
    );
  const presentIds = presenceResults.filter((r) => r.present).map((r) => r.id);
  const inRequiredSet = (id) => presenceResults.some((r) => r.id === id);
  const evidenceFor = (id) => {
    const r = presenceResults.find((x) => x.id === id);
    return textById[id] || (r && r.evidence) || "";
  };
  // The required set differs by service line / visit type: hospice uses
  // comfort_skilled_need (and has no homebound element), and the home-health
  // discharge/prn sets carry neither id. An element that isn't in THIS visit's
  // required set can't be "not documented" — hardcoding false for it made every
  // hospice visit persist skilled_intervention_documented:false, which the
  // data-quality and completeness backends then flagged on compliant notes.
  const skilledIds = ["skilled_need", "comfort_skilled_need"].filter(inRequiredSet);
  return {
    homebound_status_verified: inRequiredSet("homebound")
      ? isCovered("homebound", presentIds, answeredIds, confirmedNegativeIds)
        && !clusterFailed(CLUSTER.HOMEBOUND)
      : true,
    skilled_intervention_documented: skilledIds.length
      ? skilledIds.some((id) => isCovered(id, presentIds, answeredIds, confirmedNegativeIds))
        && !clusterFailed(CLUSTER.SKILLED_NEED)
      : true,
    homebound_justification: evidenceFor("homebound"),
  };
}
