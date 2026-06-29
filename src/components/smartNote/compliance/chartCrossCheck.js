// Deterministic "check the note against the rest of the patient's chart" pass.
// Pure + offline (no LLM, no network), so it is unit-testable under `node --test`
// and can never invent a discrepancy. It compares what the nurse documented this
// visit against the standing chart — allergies, the medication list, and fall
// risk — and surfaces advisory findings for the nurse to reconcile. It is purely
// informational: it never edits the note or feeds the value-guard.
//
// IMPORTANT: loaded by the node test runner, so it may only import other plain
// `.js` modules with explicit extensions (never `.jsx`).
import { extractMedications, CLINICAL_PATTERNS } from "./factExtraction.js";

const NO_ALLERGY = /\b(nkda|nka|none|no known)\b/i;

/**
 * @param {string} noteText the note being written (rough draft or final)
 * @param {object} patient the full patient chart record
 * @returns {{ id: string, severity: "critical"|"warning"|"info", category: string, message: string, recommendation: string }[]}
 */
export function crossCheckChart(noteText, patient) {
  if (!noteText || !patient) return [];
  /** @type {{ id: string, severity: "critical"|"warning"|"info", category: string, message: string, recommendation: string }[]} */
  const findings = [];
  const notedMeds = extractMedications(noteText);

  // 1) Allergy conflict (highest severity). A medication named in the note that
  //    also appears in the patient's documented allergies is a safety flag.
  const allergies = (patient.allergies || "").trim();
  if (allergies && !NO_ALLERGY.test(allergies)) {
    const allergyLower = allergies.toLowerCase();
    for (const med of notedMeds) {
      if (allergyLower.includes(med.toLowerCase())) {
        findings.push({
          id: `allergy_${med.toLowerCase()}`,
          severity: "critical",
          category: "Allergy",
          message: `The note references ${med}, which appears in this patient's documented allergies (“${allergies}”). Confirm this is intentional before finalizing.`,
          recommendation: `Verify the allergy and the order before administering ${med}; document the clinical rationale or correct the note.`,
        });
      }
    }
  }

  // 2) Medication reconciliation. A medication documented in the note that is not
  //    on the chart medication list is flagged so the nurse can confirm it's a
  //    new order or reconcile the chart.
  const chartMeds = Array.isArray(patient.current_medications)
    ? patient.current_medications.map((m) => (m?.name || "").toLowerCase().trim()).filter(Boolean)
    : [];
  if (chartMeds.length) {
    for (const med of notedMeds) {
      const m = med.toLowerCase();
      const onChart = chartMeds.some((cm) => cm.includes(m) || m.includes(cm));
      if (!onChart) {
        findings.push({
          id: `med_recon_${m}`,
          severity: "info",
          category: "Medication",
          message: `${med} is documented in this note but is not on the chart medication list. Confirm it is a new order or reconcile the chart.`,
          recommendation: `Confirm ${med} is a new order and reconcile the chart medication list.`,
        });
      }
    }
  }

  // 3) High fall risk not addressed. If the chart flags HIGH fall risk but the
  //    note never mentions fall precautions / safety, prompt the nurse to document it.
  const fallRisk = patient.functional_status?.fall_risk;
  if (fallRisk === "high" && !CLINICAL_PATTERNS.safety.test(noteText)) {
    findings.push({
      id: "fall_risk",
      severity: "warning",
      category: "Safety",
      message: "The chart lists this patient as HIGH fall risk, but this note doesn't mention fall precautions or safety. Document the fall-safety assessment.",
      recommendation: "Document the fall-safety assessment and the precautions taken this visit.",
    });
  }

  return findings;
}
