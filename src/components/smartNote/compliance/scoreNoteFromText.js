// Deterministic, offline compliance scoring for an already-finalized note.
//
// Smart Notes scores a note interactively inside <ConstrainedNoteReviewer>,
// where the nurse's Q&A answers feed computeCoverageScore. Other surfaces
// (e.g. Document Visit) arrive with a finished free-text narrative and no Q&A
// step — they just need the same engine applied to the text as written.
//
// This wraps the exact pipeline the reviewer runs (ConstrainedNoteReviewer.jsx
// analysis memo) into one call, so a note finalized anywhere is scored the same
// way. Pure + offline; no LLM; safe to unit test.
import { normalizeDraft } from "./normalize.js";
import { getRequiredElements } from "./requiredElements.js";
import { detectPresence } from "./presenceDetection.js";
import { computeCoverageScore, deriveStructuredVisitFields } from "./coverageScore.js";

/**
 * @param {{ text: string, serviceLine?: "home_health"|"hospice", visitType?: string }} input
 * @returns {{ coverageScore: number, draftScore: number, presence: Array, required: Array, structured: object }}
 */
export function scoreNoteFromText({ text, serviceLine = "home_health", visitType = "routine_visit" }) {
  const normalized = normalizeDraft(text || "");
  const required = getRequiredElements(serviceLine, visitType);
  const presence = detectPresence(normalized, required);
  // No interactive Q&A on this path, so coverage is presence-only and the
  // "draft" and final scores are identical (no measurable AI improvement).
  const coverageScore = computeCoverageScore({ requiredElements: required, presenceResults: presence });
  const structured = deriveStructuredVisitFields(presence, {});
  return { coverageScore, draftScore: coverageScore, presence, required, structured };
}
