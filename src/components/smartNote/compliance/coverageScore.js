// Deterministic, reproducible compliance scoring + persistence mapping.
// Replaces the previous LLM-invented 0-100 scores and the fabricated
// "compliance_improvement: 20" constant with a real coverage measure:
//   coverage = round(100 * present-or-confirmed / required)
// Pure + offline; safe to unit test.

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
 * @param {Array} presenceResults
 * @param {{ answeredIds?: string[], confirmedNegativeIds?: string[], textById?: Record<string,string> }} ctx
 */
export function deriveStructuredVisitFields(presenceResults, ctx = {}) {
  const { answeredIds = [], confirmedNegativeIds = [], textById = {} } = ctx;
  const presentIds = presenceResults.filter((r) => r.present).map((r) => r.id);
  const evidenceFor = (id) => {
    const r = presenceResults.find((x) => x.id === id);
    return textById[id] || (r && r.evidence) || "";
  };
  return {
    homebound_status_verified: isCovered("homebound", presentIds, answeredIds, confirmedNegativeIds),
    skilled_intervention_documented: isCovered("skilled_need", presentIds, answeredIds, confirmedNegativeIds),
    homebound_justification: evidenceFor("homebound"),
  };
}
