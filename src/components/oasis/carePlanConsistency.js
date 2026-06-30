// Consistency guard for the OASIS → care-plan write path. Pure + offline.
//
// SmartOASISAssessment turns OASIS-derived intervention suggestions into CarePlan
// records. A care-plan goal that contradicts the patient's documented OASIS
// functional findings is a real Medicare/clinical risk — the canonical example
// (docs/CLINICAL_P0_VERIFICATION_2026-06-30.md #9) is a *bedfast* patient receiving
// an "ambulate independently" goal. This module flags those contradictions so the
// nurse reviews them before the goal reaches the chart.
//
// It is advisory: it returns findings; the caller surfaces them and lets the nurse
// add anyway with an explicit override. Thresholds are deliberately conservative
// (only the clearly-documented extremes) to avoid false positives that would train
// nurses to ignore the warning.

// OASIS answers arrive as strings or numbers; coerce safely (matches
// oasisScoringEngine.computeCareScope). Missing/blank → 0, which never conflicts.
const num = (v) => Number(v) || 0;

// M1860 (ambulation): 4 = requires wheelchair, 5 = unable to ambulate / bedfast.
// M1850 (transferring): 4 = bedfast, unable to transfer.
const isNonAmbulatory = (a) => num(a.m1860) >= 4 || num(a.m1850) >= 4;
// M1700 (cognitive functioning): 3 = requires considerable assistance / very short
// attention span, 4 = totally dependent. At/above 3, patient-directed self-care
// teaching is questionable without a caregiver.
const isSeverelyImpairedCognition = (a) => num(a.m1700) >= 3;

// Intervention id → the OASIS finding that makes it inconsistent, and the message.
const CONFLICT_RULES = {
  "fp-3": { conflictWhen: isNonAmbulatory, oasisItem: "M1860/M1850", message: "Patient is documented as non-ambulatory or bedfast — an ambulation-teaching goal may be inconsistent. Confirm, or set a transfer/positioning goal instead." },
  "fp-4": { conflictWhen: isNonAmbulatory, oasisItem: "M1860/M1850", message: "Patient is documented as non-ambulatory or bedfast — a standing balance/exercise goal may be inconsistent. Confirm, or set a bed-mobility/positioning goal instead." },
  "pe-3": { conflictWhen: isNonAmbulatory, oasisItem: "M1860/M1850", message: "Patient is documented as non-ambulatory or bedfast — an activity/exercise goal may be inconsistent with current mobility. Confirm the intent." },
  "mm-2": { conflictWhen: isSeverelyImpairedCognition, oasisItem: "M1700", message: "Cognition is documented as significantly impaired — patient self-directed teach-back may be inconsistent. Consider caregiver-directed teaching." },
  "mm-3": { conflictWhen: isSeverelyImpairedCognition, oasisItem: "M1700", message: "Cognition is documented as significantly impaired — teaching the patient self-injection may be inconsistent. Consider caregiver-directed teaching." },
};

/**
 * Flag interventions whose premise contradicts the documented OASIS findings.
 * @param {Record<string, number|string>} answers OASIS answers map (questionId -> value)
 * @param {Array<{id: string, name?: string}>} items intervention items being added
 * @returns {Array<{ interventionId: string, interventionName: string, oasisItem: string, severity: string, message: string }>}
 */
export function checkCarePlanConsistency(answers = {}, items = []) {
  const a = answers || {};
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    const rule = CONFLICT_RULES[item?.id];
    if (rule && rule.conflictWhen(a)) {
      out.push({
        interventionId: item.id,
        interventionName: item.name || item.id,
        oasisItem: rule.oasisItem,
        severity: "warning",
        message: rule.message,
      });
    }
  }
  return out;
}

/** Which intervention ids carry a consistency rule (handy for tests / callers). */
export function interventionsWithConsistencyRules() {
  return Object.keys(CONFLICT_RULES);
}
