// Offline compliance scan for the offline visit-note capture.
//
// OfflineVisitNoteCapture was plain free text that bypassed the required-element
// scan, gap questions, grounding, and chart cross-check — exactly when nurses in
// WiFi-dead homes need it most. This runs the PURE/offline compliance modules
// (requiredElements + presenceDetection + coverageScore + chartCrossCheck) before
// the note is queued, and flags that live AI grounding must re-run on reconnect
// (the note is held pending_review until then).
//
// Pure composition of already-tested modules — dependency-free, unit-tested with
// `node --test`.

import { getRequiredElements } from "../smartNote/compliance/requiredElements.js";
import { detectPresence, computeGaps, computeCriticalGaps } from "../smartNote/compliance/presenceDetection.js";
import { computeCoverageScore } from "../smartNote/compliance/coverageScore.js";
import { crossCheckChart } from "../smartNote/compliance/chartCrossCheck.js";

// Offline-capture visit-type labels → smart-note visit-type keys used by the
// required-element library. The offline form only offers discipline labels, so
// they all map to routine_visit (no admission/recert path there).
const VISIT_TYPE_TO_KEY = {
  "Skilled Nursing": "routine_visit",
  "Physical Therapy": "routine_visit",
  "Occupational Therapy": "routine_visit",
  "Speech Therapy": "routine_visit",
  "Home Health Aide": "routine_visit",
  "Social Work": "routine_visit",
};

/** Map an offline-form visit-type label to a compliance visit-type key. */
export function visitTypeKey(label) {
  return VISIT_TYPE_TO_KEY[label] || "routine_visit";
}

/**
 * Run the offline compliance scan over an assembled visit note.
 *
 * @param {Object} input
 * @param {string} input.noteText       assembled clinical narrative
 * @param {string} [input.serviceLine="home_health"]
 * @param {string} [input.visitType="routine_visit"]  compliance visit-type key
 * @param {Object} [input.patient]      patient chart record (for chart cross-check)
 * @returns {{
 *   coverage: number,
 *   presence: Array,
 *   gaps: Array, critical_gaps: Array,
 *   chart_conflicts: Array, critical_conflicts: Array,
 *   has_blocking_issues: boolean,
 *   grounding_pending: boolean,
 * }}
 */
export function scanOfflineNote({ noteText, serviceLine = "home_health", visitType = "routine_visit", patient } = {}) {
  const text = String(noteText || "");
  const requiredElements = getRequiredElements(serviceLine, visitType);
  const presence = detectPresence(text, requiredElements);
  const gaps = computeGaps(presence, requiredElements);
  const criticalGaps = computeCriticalGaps(presence, requiredElements);
  const coverage = computeCoverageScore({ requiredElements, presenceResults: presence });

  const chartConflicts = patient ? crossCheckChart(text, patient) : [];
  const criticalConflicts = chartConflicts.filter((c) => c.severity === "critical");

  const shape = (e) => ({ id: e.id, label: e.label, severity: e.severity, question: e.question });

  return {
    coverage,
    presence,
    gaps: gaps.map(shape),
    critical_gaps: criticalGaps.map(shape),
    chart_conflicts: chartConflicts,
    critical_conflicts: criticalConflicts,
    has_blocking_issues: criticalGaps.length > 0 || criticalConflicts.length > 0,
    // Live AI grounding (an LLM call) can't run offline — defer it to reconnect.
    grounding_pending: true,
  };
}
