// The single deterministic "what does this draft document?" scan, shared by the
// Step 1 readiness bar and the Step 2 reviewer. Pure + offline.
//
// Both surfaces run this one composition so the DETERMINISTIC layer cannot drift:
// a nurse told "2 required elements still missing" while writing, who then sees a
// different set on the review screen, stops trusting the number. Previously only
// the reviewer ran it, so a Step 1 preview would have had to re-derive it — the
// classic way two screens drift apart.
//
// This is not the whole picture, and callers should not present it as final:
// Step 2 additionally runs the ONLINE completeness critic, which can demote an
// element this keyword scan counted as present, so the reviewer's score can be
// lower than a Step 1 preview built from this scan. What is guaranteed is that
// neither screen can disagree about the deterministic result.
import { normalizeDraft } from "./normalize.js";
import { getRequiredElements } from "./requiredElements.js";
import { buildOverrides } from "./ruleLibrary.js";
import { detectPresence, computeGaps, computeCriticalGaps } from "./presenceDetection.js";
import { formatVitalsSentence } from "./factExtraction.js";
import { computeDraftPresenceScore } from "./coverageScore.js";
import { describePlaceholders, countPlaceholders } from "./placeholderGuard.js";

/** A draft shorter than this isn't worth scanning (matches the reviewer's gate). */
export const MIN_DRAFT_LENGTH = 20;

/**
 * The whole argument is optional (the signature defaults it to `{}`) and a
 * too-short / absent draft simply returns null, so checkJs must see both the
 * object and `roughNote` as optional.
 *
 * @param {Object} [input]
 * @param {string} [input.roughNote]
 * @param {string} [input.serviceLine="home_health"]
 * @param {string} [input.visitType="routine_visit"]
 * @param {Object|null} [input.vitals] canonical structured vital_signs, if captured on the form
 * @param {Array} [input.complianceRules] agency MedicareComplianceRule records
 * @returns {null | {
 *   normalized: string, vitalsSentence: string, required: Array,
 *   presence: Array, gaps: Array, criticalGaps: Array,
 *   draftScore: number, appliedRules: Array,
 *   placeholders: Array, placeholderCount: number,
 * }} null when the draft is too short to scan.
 */
export function scanDraft({
  roughNote,
  serviceLine = "home_health",
  visitType = "routine_visit",
  vitals = null,
  complianceRules = [],
} = {}) {
  if (!roughNote || roughNote.trim().length < MIN_DRAFT_LENGTH) return null;

  const normalized = normalizeDraft(roughNote);
  const vitalsSentence = formatVitalsSentence(vitals);
  // Fold any agency-configured MedicareComplianceRule records over the static
  // defaults. `overrides` is null when nothing applies, so getRequiredElements
  // falls back to the offline static set. `appliedRules` is stamped into the
  // saved compliance audit so each note records which rule version judged it.
  const { overrides, applied: appliedRules } = buildOverrides(complianceRules, { serviceLine, visitType });
  const required = getRequiredElements(serviceLine, visitType, overrides);
  // Presence/coverage must see structured vitals captured on the form, even when
  // the nurse didn't retype them into the draft — otherwise vitals are falsely
  // scored as "not documented this visit". The draft sentences fed to the scribe
  // stay roughNote-only (vitals are appended verbatim, never re-voiced), so this
  // only affects gap detection and the coverage score.
  const presenceText = vitalsSentence ? normalizeDraft(`${roughNote} ${vitalsSentence}`) : normalized;
  const presence = detectPresence(presenceText, required);

  return {
    normalized,
    vitalsSentence,
    required,
    presence,
    gaps: computeGaps(presence, required),
    criticalGaps: computeCriticalGaps(presence, required),
    draftScore: computeDraftPresenceScore({ requiredElements: required, presenceResults: presence }),
    appliedRules,
    // Unfilled template scaffolding still in the draft. Surfaced here so Step 1
    // can flag it in place, where the nurse can actually fix it.
    //
    // TWO fields on purpose. `placeholders` is a DISPLAY list: one row per line,
    // deduped and capped, for rendering. `placeholderCount` is the true total
    // number of blanks. Counting the display rows conflates "lines" with
    // "blanks" AND silently saturates at the cap, so a draft with 30 blanks
    // across 10 lines reported "6 unfilled blanks" — an undercount the nurse
    // would act on. Render counts from `placeholderCount`, lists from
    // `placeholders`.
    placeholders: describePlaceholders(roughNote),
    placeholderCount: countPlaceholders(roughNote),
  };
}
