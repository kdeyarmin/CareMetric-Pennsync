// Default MedicareComplianceRule seed set for home health & hospice.
//
// The Smart Note's ruleLibrary.js folds these over the static required-element
// defaults: each rule's `category` maps to a required-element id, enriching it
// with keywords/examples/remediation (or adding a new element, e.g.
// infection_control). Until an agency seeds rules, the smart note runs on the
// static defaults alone — these give it a richer, editable starting point
// (incl. a few Pennsylvania-specific rules) that an admin can load in one click
// and then tailor.
//
// Categories MUST be members of the MedicareComplianceRule.category enum
// (homebound_status, skilled_need, patient_response, coordination_of_care,
// safety_assessment, functional_status, patient_education, plan_of_care,
// physician_orders, infection_control). Severity MUST be critical|high|medium.
// Visit types use the smart-note keys (routine_visit, admission, recertification,
// discharge, prn); an empty/omitted list means "all visit types".
// service_line scopes a rule to "home_health" or "hospice" (omitted = both).
// Every rule below is a home-health (42 CFR 484 / PA home-health) rule —
// without the scope, seeding injected homebound/skilled-need CRITICALS into
// hospice notes, hard-blocking them on requirements hospice does not have.
//
// Pure data + a pure idempotent seed helper — unit-testable offline.

// Fixed effective date (Date.now is unavailable in some test/build contexts and
// would make the data non-deterministic). Agencies can edit per-rule after load.
const EFFECTIVE = "2024-01-01";

/** @type {Array<object>} */
/** @type {Array<Record<string, any>>} */
export const DEFAULT_MEDICARE_RULES = [
  {
    rule_name: "Homebound Status Documentation",
    // Confined-to-home ELIGIBILITY lives in 42 CFR 409.42(a) (484.55(c) is the
    // comprehensive-assessment content list and does not contain homebound).
    cop_reference: "42 CFR 409.42(a)",
    category: "homebound_status",
    description:
      "Each visit must document that the patient is confined to the home: a normal inability to leave home, and that leaving requires a considerable and taxing effort.",
    required_elements: ["medical reason for confinement", "what makes leaving home a taxing effort", "assistance or device needed to leave"],
    applies_to_visit_types: ["routine_visit", "admission", "recertification"],
    severity: "critical",
    validation_criteria: ["Names a medical reason", "Describes the taxing effort or assistance needed to leave"],
    examples_compliant: [
      "Patient homebound due to severe exertional dyspnea; requires a rolling walker and one-person assist and tolerates only a few steps before resting.",
    ],
    examples_non_compliant: ["Patient is homebound.", "Homebound this visit."],
    keywords: ["homebound", "confined to home", "taxing effort", "assist to leave"],
    remediation_guidance: "Add the medical reason for confinement and what makes leaving home require considerable and taxing effort.",
    service_line: "home_health",
    pennsylvania_specific: false,
    is_active: true,
    effective_date: EFFECTIVE,
  },
  {
    rule_name: "Skilled Need Justification",
    cop_reference: "42 CFR 484.75",
    category: "skilled_need",
    description:
      "Document the skilled nursing service that required the professional skill of a nurse this visit (assessment/observation of an unstable patient, wound care, medication management, skilled teaching).",
    required_elements: ["specific skilled service", "why a nurse's skill was required"],
    applies_to_visit_types: ["routine_visit", "admission", "recertification"],
    severity: "critical",
    validation_criteria: ["Identifies a skilled service", "Distinguishes from custodial/aide-level care"],
    examples_compliant: [
      "Skilled observation and assessment of an unstable CHF patient with lung auscultation and edema check; sterile wound care to the stage 3 sacral ulcer.",
    ],
    examples_non_compliant: ["Provided nursing care.", "Routine visit completed."],
    keywords: ["skilled", "observation and assessment", "wound care", "medication management", "teaching"],
    remediation_guidance: "Name the specific skilled service and why it required a nurse's professional judgment.",
    service_line: "home_health",
    pennsylvania_specific: false,
    is_active: true,
    effective_date: EFFECTIVE,
  },
  {
    rule_name: "Patient Response to Care",
    cop_reference: "42 CFR 484.75",
    category: "patient_response",
    description: "Document how the patient responded to the interventions provided this visit, including tolerance and any adverse reaction.",
    required_elements: ["patient response", "tolerance of interventions"],
    applies_to_visit_types: ["routine_visit", "recertification", "prn"],
    severity: "high",
    validation_criteria: ["States how the patient responded to care"],
    examples_compliant: ["Patient tolerated the dressing change without incident and reported reduced pain afterward."],
    examples_non_compliant: ["Patient seen.", "No issues."],
    keywords: ["tolerated", "responded", "patient reports", "no adverse"],
    remediation_guidance: "Describe how the patient responded to and tolerated the interventions.",
    service_line: "home_health",
    pennsylvania_specific: false,
    is_active: true,
    effective_date: EFFECTIVE,
  },
  {
    rule_name: "Patient/Caregiver Education with Teach-Back",
    cop_reference: "42 CFR 484.60(d)",
    category: "patient_education",
    description: "Document education provided and how understanding was confirmed (teach-back, return demonstration, verbalized understanding).",
    required_elements: ["topic taught", "method of confirming understanding"],
    applies_to_visit_types: ["routine_visit", "admission", "recertification", "discharge"],
    severity: "high",
    validation_criteria: ["Names the topic", "Confirms understanding"],
    examples_compliant: ["Educated patient on low-sodium diet and daily weights; patient verbalized understanding via teach-back."],
    examples_non_compliant: ["Educated patient.", "Provided teaching."],
    keywords: ["education", "taught", "teach-back", "verbalized understanding", "return demonstration"],
    remediation_guidance: "Add the topic taught and how you confirmed the patient/caregiver understood.",
    service_line: "home_health",
    pennsylvania_specific: false,
    is_active: true,
    effective_date: EFFECTIVE,
  },
  {
    rule_name: "Plan of Care Adherence and Progress",
    cop_reference: "42 CFR 484.60",
    category: "plan_of_care",
    description: "Document care delivered consistent with the physician-ordered plan of care and the patient's progress toward goals.",
    required_elements: ["alignment with plan of care", "progress toward goals"],
    applies_to_visit_types: ["routine_visit", "recertification"],
    severity: "high",
    validation_criteria: ["References plan-of-care goals or progress"],
    examples_compliant: ["Care delivered per POC; wound shows pink granulation, progressing toward the healing goal."],
    examples_non_compliant: ["Followed plan.", "No change."],
    keywords: ["plan of care", "goal", "progress", "toward goal"],
    remediation_guidance: "Tie the visit to the plan-of-care goals and note measurable progress.",
    service_line: "home_health",
    pennsylvania_specific: false,
    is_active: true,
    effective_date: EFFECTIVE,
  },
  {
    rule_name: "Physician Orders and Plan-of-Care Authentication",
    cop_reference: "42 CFR 484.60(b)",
    category: "physician_orders",
    description: "Document that care is furnished under physician (or allowed practitioner) orders and that verbal orders were obtained and authenticated.",
    required_elements: ["physician orders obtained", "authentication of orders"],
    applies_to_visit_types: ["admission", "recertification"],
    severity: "critical",
    validation_criteria: ["References the ordering practitioner or signed orders"],
    examples_compliant: ["Care furnished per signed plan of care; new wound-care order obtained from Dr. Lee and read back for verification."],
    examples_non_compliant: ["Orders on file."],
    keywords: ["physician order", "order obtained", "plan of care signed", "provider order"],
    remediation_guidance: "Document the ordering practitioner and that orders were obtained/authenticated.",
    service_line: "home_health",
    pennsylvania_specific: false,
    is_active: true,
    effective_date: EFFECTIVE,
  },
  {
    rule_name: "Coordination of Care",
    cop_reference: "42 CFR 484.60(d)",
    category: "coordination_of_care",
    description: "Document coordination among disciplines and communication with the physician and other providers involved in the patient's care.",
    required_elements: ["coordination with team/physician", "communication of changes"],
    applies_to_visit_types: ["routine_visit", "admission", "recertification", "discharge"],
    severity: "medium",
    validation_criteria: ["Notes interdisciplinary or physician communication"],
    examples_compliant: ["Coordinated with PT on transfer training and notified the physician of the new pressure ulcer."],
    examples_non_compliant: ["Team aware."],
    keywords: ["coordination", "interdisciplinary", "notified physician", "care team", "communicated"],
    remediation_guidance: "Document who you coordinated with and what was communicated.",
    service_line: "home_health",
    pennsylvania_specific: false,
    is_active: true,
    effective_date: EFFECTIVE,
  },
  {
    rule_name: "Safety and Fall-Risk Assessment",
    cop_reference: "42 CFR 484.75",
    category: "safety_assessment",
    description: "Document a home-safety and fall-risk assessment and any hazards or interventions identified.",
    required_elements: ["safety/fall-risk assessment", "hazards or interventions"],
    applies_to_visit_types: ["routine_visit", "admission", "recertification"],
    severity: "high",
    validation_criteria: ["Documents a safety or fall-risk assessment"],
    examples_compliant: ["Home-safety check completed; removed throw rug and recommended a grab bar. No falls since last visit."],
    examples_non_compliant: ["Home safe.", "No fall."],
    keywords: ["safety", "fall risk", "hazard", "grab bar", "environment"],
    remediation_guidance: "Document the safety/fall-risk assessment and any hazards or interventions.",
    service_line: "home_health",
    pennsylvania_specific: false,
    is_active: true,
    effective_date: EFFECTIVE,
  },
  {
    rule_name: "Functional Status Assessment",
    // 484.55(c)(1) covers current health/psychosocial/functional/cognitive status;
    // (c)(5) is the medication-review item.
    cop_reference: "42 CFR 484.55(c)(1)",
    category: "functional_status",
    description: "Document the patient's functional status (ADLs, ambulation, transfers) as part of the comprehensive assessment.",
    required_elements: ["ADL status", "ambulation/transfer ability"],
    applies_to_visit_types: ["admission", "recertification"],
    severity: "high",
    validation_criteria: ["Documents ADLs or mobility"],
    examples_compliant: ["Requires moderate assist for bathing and dressing; ambulates 20 ft with a walker and contact-guard assist."],
    examples_non_compliant: ["ADLs WNL."],
    keywords: ["functional", "adl", "ambulation", "transfer", "mobility"],
    remediation_guidance: "Document ADL independence and ambulation/transfer ability.",
    service_line: "home_health",
    pennsylvania_specific: false,
    is_active: true,
    effective_date: EFFECTIVE,
  },
  {
    rule_name: "Infection Prevention and Control",
    cop_reference: "42 CFR 484.70",
    category: "infection_control",
    description: "Document infection-prevention practices and assessment for signs and symptoms of infection per the agency's infection-control program.",
    required_elements: ["infection assessment", "infection-control measures"],
    applies_to_visit_types: ["routine_visit", "admission"],
    severity: "medium",
    validation_criteria: ["Notes infection assessment or prevention measures"],
    examples_compliant: ["No signs of wound infection (no increased redness, warmth, drainage, or odor); used aseptic technique and hand hygiene."],
    examples_non_compliant: ["No infection."],
    keywords: ["infection", "aseptic", "hand hygiene", "signs of infection"],
    remediation_guidance: "Document assessment for infection and the infection-control measures used.",
    service_line: "home_health",
    pennsylvania_specific: false,
    is_active: true,
    effective_date: EFFECTIVE,
  },
  {
    rule_name: "PA Home Health Aide Supervision",
    // 28 Pa. Code § 601.35 is "Home health aide services" (601.31 is acceptance
    // of patients / plan of treatment).
    cop_reference: "28 Pa. Code § 601.35",
    category: "coordination_of_care",
    description: "Pennsylvania requires periodic on-site supervision of the home health aide by a registered nurse; document the supervisory assessment when due.",
    required_elements: ["aide supervision performed", "aide competency/plan adherence"],
    applies_to_visit_types: ["routine_visit", "recertification"],
    severity: "medium",
    validation_criteria: ["Documents the RN supervisory visit when applicable"],
    examples_compliant: ["RN supervisory visit completed; aide following the assignment sheet and using correct transfer technique."],
    examples_non_compliant: ["Aide fine."],
    keywords: ["aide supervision", "supervisory visit", "home health aide"],
    remediation_guidance: "When an aide is on the case, document the RN supervisory assessment and aide competency per PA requirements.",
    service_line: "home_health",
    pennsylvania_specific: true,
    is_active: true,
    effective_date: EFFECTIVE,
  },
  {
    rule_name: "PA Plan of Treatment Review",
    // Periodic plan-of-treatment review (at least every 60 days) is
    // 28 Pa. Code § 601.31(c); 601.32 is "Skilled nursing service".
    cop_reference: "28 Pa. Code § 601.31(c)",
    category: "plan_of_care",
    description: "Pennsylvania requires the plan of treatment to be reviewed by the physician at the required intervals; document the review at recertification.",
    required_elements: ["plan of treatment reviewed", "physician review interval met"],
    applies_to_visit_types: ["recertification"],
    severity: "high",
    validation_criteria: ["Documents the periodic plan-of-treatment review"],
    examples_compliant: ["Plan of treatment reviewed with Dr. Patel for the recertification period; orders remain appropriate."],
    examples_non_compliant: ["POC reviewed."],
    keywords: ["plan of treatment", "review", "recertification", "physician review"],
    remediation_guidance: "Document the physician's periodic review of the plan of treatment per PA requirements.",
    service_line: "home_health",
    pennsylvania_specific: true,
    is_active: true,
    effective_date: EFFECTIVE,
  },
];

/** Normalize a rule name for idempotent comparison. */
function nameKey(name) {
  return String(name || "").trim().toLowerCase();
}

/**
 * Idempotent seed helper: the default rules not already present (by rule_name)
 * in `existingRules`. Safe to run repeatedly — a second run returns [].
 * @param {Array<{rule_name?: string}>} existingRules
 * @returns {Array<Record<string, any>>}
 */
export function rulesToSeed(existingRules = []) {
  const have = new Set((Array.isArray(existingRules) ? existingRules : []).map((r) => nameKey(r?.rule_name)));
  return DEFAULT_MEDICARE_RULES.filter((r) => !have.has(nameKey(r.rule_name)));
}
