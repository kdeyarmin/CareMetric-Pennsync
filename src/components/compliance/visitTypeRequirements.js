// Visit-type documentation requirement sets for the Visit-Type Compliance
// Review (VisitTypeComplianceChecker).
//
// Two care-type frames: home health is surveyed under 42 CFR 484 and expects
// OASIS; hospice is surveyed under 42 CFR 418 and does NOT use OASIS (hospice
// uses the HIS/HOPE instruments, election statements, and terminal-prognosis
// certification). Grading a hospice note against 484/OASIS produces false
// "missing OASIS" findings and wrong citations — the frame must follow the
// patient's care type.
//
// Pure + offline (unit-tested with `node --test`).

export const HOME_HEALTH_REQUIREMENTS = {
  admission: {
    display: "Start of Care/Admission",
    cms_reference: "42 CFR 484.55(c)",
    required_elements: [
      "Complete patient assessment within 5 days of SOC",
      "Physician orders obtained and documented",
      "Patient/caregiver rights and responsibilities reviewed",
      "Emergency preparedness plan established",
      "Comprehensive care plan developed",
      "OASIS-E assessment completed",
      "Initial skilled nursing assessment",
      "Patient's understanding of plan of care documented",
      "Medication reconciliation completed",
      "Safety assessment of home environment",
      "Infection control procedures reviewed",
    ],
  },
  recertification: {
    display: "Recertification",
    cms_reference: "42 CFR 484.60",
    required_elements: [
      "Updated physician orders for continuing care",
      "Progress toward care plan goals documented",
      "Comprehensive reassessment completed",
      "OASIS-E recertification assessment",
      "Justification for continuing skilled services",
      "Patient's current functional status compared to baseline",
      "Medication review and reconciliation",
      "Evidence of ongoing skilled need",
      "Plan of care updates based on current condition",
      "Physician communication documented",
    ],
  },
  discharge: {
    display: "Discharge/Transfer",
    cms_reference: "42 CFR 484.50",
    required_elements: [
      "Reason for discharge clearly stated",
      "OASIS-E discharge assessment completed",
      "Final visit comprehensive assessment",
      "Summary of care provided and outcomes achieved",
      "Patient's discharge condition and functional status",
      "Discharge instructions provided to patient/caregiver",
      "Post-discharge plan documented",
      "Community resources/referrals provided",
      "Physician notification of discharge",
      "Equipment needs for post-discharge period",
      "Follow-up appointments scheduled/recommended",
    ],
  },
  skilled_nursing: {
    display: "Skilled Nursing Visit",
    cms_reference: "42 CFR 484.75",
    required_elements: [
      "Skilled assessment of patient's condition",
      "Comparison to previous visit findings",
      "Intervention(s) requiring nursing skill",
      "Patient response to treatment/interventions",
      "Progress toward care plan goals",
      "Patient/caregiver education provided",
      "Vital signs and clinical observations",
      "Medication management/teaching",
      "Safety and environmental assessment",
    ],
  },
  routine_visit: {
    display: "Routine Visit",
    cms_reference: "42 CFR 484.75",
    required_elements: [
      "Assessment of patient's current condition",
      "Skilled interventions performed",
      "Patient response to care",
      "Progress notes related to care plan goals",
      "Vital signs documentation",
      "Patient/caregiver teaching as appropriate",
      "Changes in condition reported",
    ],
  },
};

export const HOSPICE_REQUIREMENTS = {
  admission: {
    display: "Hospice Admission",
    cms_reference: "42 CFR 418.52–418.56",
    required_elements: [
      "Signed hospice election statement on file",
      "Certification of terminal illness (prognosis of 6 months or less) by the medical director and attending physician",
      "Initial assessment completed within 48 hours of election",
      "Comprehensive assessment completed within 5 calendar days of election",
      "Interdisciplinary group (IDG) plan of care established",
      "Terminal diagnosis and related conditions documented",
      "Medication reconciliation completed",
      "Level of care and DME/supply needs documented",
      "Patient/family rights and responsibilities reviewed",
      "Patient/family understanding of the hospice philosophy of care documented",
    ],
  },
  recertification: {
    display: "Hospice Recertification",
    cms_reference: "42 CFR 418.22 / 418.21",
    required_elements: [
      "Physician recertification of the 6-month-or-less terminal prognosis for the benefit period",
      "Physician narrative supporting the terminal prognosis",
      "Face-to-face encounter documented when required (third benefit period and later)",
      "Documentation of clinical decline or continued hospice eligibility",
      "Comprehensive assessment updated (no less often than every 15 days)",
      "IDG review and update of the plan of care",
      "Medication review and reconciliation",
      "Level of care remains appropriate and documented",
    ],
  },
  discharge: {
    display: "Hospice Discharge/Transfer/Revocation",
    cms_reference: "42 CFR 418.26",
    required_elements: [
      "Reason for discharge documented (no longer terminally ill, moved out of service area, transfer, revocation, or discharge for cause)",
      "Physician discharge order obtained (when agency-initiated)",
      "Signed revocation statement on file (when patient-initiated)",
      "Discharge planning and post-hospice care needs documented",
      "Patient's condition at discharge documented",
      "Discharge summary provided to the attending physician",
      "Patient/family notified and education provided",
      "Medications and DME disposition documented",
    ],
  },
  skilled_nursing: {
    display: "Hospice Nursing Visit",
    cms_reference: "42 CFR 418.56",
    required_elements: [
      "Symptom assessment (pain, dyspnea, and other distressing symptoms)",
      "Interventions provided per the IDG plan of care",
      "Patient response to interventions",
      "Documentation supporting continued terminal prognosis (decline or continued eligibility)",
      "Medication management and effectiveness review",
      "Patient/family education and psychosocial support provided",
      "Changes in condition communicated to the IDG/physician",
    ],
  },
  routine_visit: {
    display: "Hospice Routine Visit",
    cms_reference: "42 CFR 418.56",
    required_elements: [
      "Symptom assessment (pain, dyspnea, and other distressing symptoms)",
      "Interventions provided per the IDG plan of care",
      "Patient response to care",
      "Documentation supporting continued terminal prognosis",
      "Patient/family education and support provided",
      "Changes in condition communicated to the IDG/physician",
    ],
  },
};

// Raw assessment/visit type → requirement-set key. The OASIS extractor emits
// values like "SOC", "ROC", "Recert", "Follow-up", "Transfer", "Discharge";
// an exact-key lookup matched NONE of them, silently grading every note
// against the weakest routine-visit checklist.
const KEY_PATTERNS = [
  { re: /recert/, key: "recertification" },
  { re: /resumption|\broc\b/, key: "recertification" },
  { re: /discharge|transfer|revocation/, key: "discharge" },
  // \bsoc\b, not bare /soc/: an unanchored "soc" matches inside
  // "psychosocial"/"social work", grading an MSW visit against the full
  // admission checklist (mirrors the \broc\b anchoring above).
  { re: /\bsoc\b|start.?of.?care|admission|admit|initial/, key: "admission" },
  { re: /skilled/, key: "skilled_nursing" },
  { re: /routine|follow.?up|supervis/, key: "routine_visit" },
];

/**
 * Normalize a raw visit/assessment type onto a requirement-set key.
 * @returns {{ key: string, recognized: boolean }}
 */
export function normalizeVisitTypeKey(rawVisitType) {
  const raw = String(rawVisitType || "").trim().toLowerCase();
  if (!raw) return { key: "routine_visit", recognized: false };
  if (HOME_HEALTH_REQUIREMENTS[raw]) return { key: raw, recognized: true };
  for (const { re, key } of KEY_PATTERNS) {
    if (re.test(raw)) return { key, recognized: true };
  }
  return { key: "routine_visit", recognized: false };
}

/**
 * Pick the requirement set for a visit, framed by the patient's care type.
 * @param {string} rawVisitType e.g. "SOC", "Recert", "discharge"
 * @param {string} careType     "hospice" | "home_health" (default)
 * @returns {{ display, cms_reference, required_elements, key, recognized }}
 */
export function requirementsFor(rawVisitType, careType) {
  const table = String(careType || "").toLowerCase() === "hospice"
    ? HOSPICE_REQUIREMENTS
    : HOME_HEALTH_REQUIREMENTS;
  const { key, recognized } = normalizeVisitTypeKey(rawVisitType);
  return { ...table[key], key, recognized };
}
