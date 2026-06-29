// Deterministic "did the nurse just document a life-threatening vital?" check.
// It maps the vitals extracted from the note text onto the shared critical-vital
// rules (the same thresholds the visit form escalates on), so a hypertensive
// crisis / severe hypoxia / 10-of-10 pain written into the note surfaces an
// escalation prompt at documentation time. Advisory only — it NEVER blocks
// saving a genuine abnormal-but-real reading. Pure + offline, so it is
// unit-testable under `node --test`.
//
// IMPORTANT: loaded by the node test runner, so it may only import other plain
// `.js` modules with explicit extensions (never `.jsx`).
import { extractVitals } from "./factExtraction.js";
import { extractPain } from "./visitComparison.js";
import { detectCriticalVitals } from "../../visit/vitalEscalation.js";

/**
 * @param {string} noteText the note being written (rough draft or final)
 * @returns {{ id: string, label: string, severity: string, detail: string }[]}
 *   the breached critical-vital rules, or [] when nothing documented is critical.
 */
export function detectNoteCriticalVitals(noteText) {
  if (!noteText) return [];
  const v = extractVitals(noteText);
  const vitals = {};
  if (v.bp_sys != null && v.bp_dia != null) vitals.bp = `${v.bp_sys}/${v.bp_dia}`;
  if (v.o2 != null) vitals.o2 = v.o2;
  const pain = extractPain(noteText);
  if (pain != null) vitals.pain = pain;
  return detectCriticalVitals(vitals);
}
