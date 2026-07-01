/**
 * Canonical visit-type option lists for note/scribe visit-type pickers.
 *
 * Previously duplicated in AudioVisitCapture and SmartNoteAssistant, where the
 * hospice "recertification" label had drifted ("Recertification" vs
 * "Recertification (Benefit Period)"); reconciled here to the more precise
 * benefit-period wording, which is the hospice-accurate term.
 */
export const HOME_HEALTH_VISIT_TYPES = [
  { value: "routine_visit", label: "Routine SN Visit" },
  { value: "admission", label: "Start of Care (SOC)" },
  { value: "recertification", label: "Recertification" },
  { value: "discharge", label: "Discharge" },
  { value: "prn", label: "PRN Visit" },
];

export const HOSPICE_VISIT_TYPES = [
  { value: "routine_visit", label: "Routine Hospice Visit" },
  { value: "admission", label: "Hospice Admission" },
  { value: "recertification", label: "Recertification (Benefit Period)" },
  { value: "discharge", label: "Discharge / Revocation" },
  { value: "prn", label: "After-Hours / Crisis Visit" },
];
