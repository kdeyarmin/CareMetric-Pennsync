// Single source of truth for the Medicare-required elements of a visit note,
// keyed ONLY by service line and visit type (never by care plan or prior
// notes). Pure data + lookups — offline and unit-testable.
//
// Consolidates the requirement lists previously scattered across:
//   - SmartNoteAssistant.jsx  (visitSpecificMap + complianceFramework strings)
//   - compliance/VisitTypeComplianceChecker.jsx (CoP-referenced required_elements)
//   - smartNote/ComplianceChecklist.jsx (display checklists)
//
// Element shape:
//   {
//     id, label,
//     severity: 'critical' | 'required',   // critical => HARD-BLOCKS generation
//     copReference,                          // 42 CFR citation (audit trail)
//     keywords: string[],                    // deterministic presence detection
//     pattern?: RegExp,                      // optional stronger presence test
//     question,                              // asked when the element is missing
//     notDocumentedPhrase,                   // non-critical fallback line
//     standardNegative?: { prompt, phrase }  // confirm-only conventional negative
//   }

export const SERVICE_LINES = ["home_health", "hospice"];
export const VISIT_TYPES = ["routine_visit", "admission", "recertification", "discharge", "prn"];

// ── Element library (composed per visit type below) ────────────────────────
const E = {
  homebound: {
    label: "Homebound status",
    copReference: "42 CFR 484.55(c)",
    keywords: ["homebound", "unable to leave", "taxing effort", "confined to home", "leaving home requires", "considerable effort"],
    pattern: /homebound|unable to leave|taxing effort|confined to (?:home|residence)|leaving (?:the )?home requires/i,
    question: "Why is the patient homebound? What makes leaving home require a considerable and taxing effort?",
    notDocumentedPhrase: "Homebound status was not documented this visit.",
  },
  skilled_need: {
    label: "Skilled need / justification",
    copReference: "42 CFR 484.75",
    keywords: ["skilled", "wound care", "medication management", "teaching", "assessment of", "observation and assessment", "skilled observation"],
    pattern: /skilled (?:need|nursing|assessment|service|intervention|observation)|requires the skill|wound care|medication management|observation and assessment/i,
    question: "What skilled nursing service required your professional skill this visit?",
    notDocumentedPhrase: "Skilled need was not documented this visit.",
  },
  vitals: {
    label: "Vital signs",
    copReference: "42 CFR 484.75",
    keywords: ["bp", "blood pressure", "hr", "heart rate", "o2", "oxygen", "spo2", "temp", "temperature", "respiratory", "weight", "pulse"],
    pattern: /\bbp\b|blood pressure|\bhr\b|heart rate|\bo2\b|oxygen|spo2|\btemp\b|temperature|respir|\brr\b|weight|pulse/i,
    question: "What were the patient's vital signs this visit?",
    notDocumentedPhrase: "Vital signs were not documented this visit.",
  },
  patient_response: {
    label: "Patient response to care",
    copReference: "42 CFR 484.75",
    keywords: ["tolerated", "responded", "response to", "patient reports", "patient states", "verbalized", "no adverse"],
    pattern: /tolerated|responded|response to|patient (?:reports?|states?|verbali)|no adverse/i,
    question: "How did the patient respond to the interventions / care provided?",
    notDocumentedPhrase: "Patient response to care was not documented this visit.",
  },
  education: {
    label: "Patient/caregiver education",
    copReference: "42 CFR 484.60",
    keywords: ["educat", "taught", "instruct", "reviewed with", "reinforced", "teaching", "teach-back", "verbalized understanding"],
    pattern: /educat|taught|instruct|reinforced|teaching|teach[- ]?back|verbali[sz]ed understanding/i,
    question: "What patient/caregiver education did you provide, and how was understanding confirmed?",
    notDocumentedPhrase: "Patient/caregiver education was not documented this visit.",
  },
  care_plan_progress: {
    label: "Progress toward care-plan goals",
    copReference: "42 CFR 484.60",
    keywords: ["goal", "progress", "plan of care", "improving", "toward goal"],
    pattern: /goal|progress|plan of care|improving|toward/i,
    question: "What progress toward the plan-of-care goals did you observe?",
    notDocumentedPhrase: "Progress toward care-plan goals was not documented this visit.",
  },
  safety: {
    label: "Safety / fall-risk assessment",
    copReference: "42 CFR 484.75",
    keywords: ["fall", "safety", "hazard", "clutter", "throw rug", "grab bar", "environment"],
    pattern: /fall|safety|hazard|clutter|throw rug|grab bar|environment/i,
    question: "What safety / fall-risk assessment did you perform?",
    notDocumentedPhrase: "Safety / fall-risk assessment was not documented this visit.",
    standardNegative: {
      prompt: "No new safety hazards or falls since last visit?",
      phrase: "No new safety hazards were identified and the patient reports no falls since the last visit.",
    },
  },
  pain: {
    label: "Pain assessment",
    copReference: "42 CFR 484.75",
    keywords: ["pain", "discomfort", "ache", "tender", "/10"],
    pattern: /pain|discomfort|ache|tender|\d\/10/i,
    question: "What was the patient's pain assessment (location, scale, quality)?",
    notDocumentedPhrase: "Pain assessment was not documented this visit.",
    standardNegative: {
      prompt: "Patient denies pain this visit?",
      phrase: "Patient denies pain at this visit.",
    },
  },
  complaints: {
    label: "New complaints / change in condition",
    copReference: "42 CFR 484.75",
    keywords: ["complaint", "c/o", "reports", "denies", "new onset", "change in condition"],
    pattern: /complaint|c\/o|reports?|denies|new onset|change in condition/i,
    question: "Any new complaints or change in condition this visit?",
    notDocumentedPhrase: "New complaints / change in condition were not documented this visit.",
    standardNegative: {
      prompt: "No new complaints this visit?",
      phrase: "Patient reports no new complaints this visit.",
    },
  },
  medication: {
    label: "Medication review / management",
    copReference: "42 CFR 484.75",
    keywords: ["medication", "med list", "reconcil", "dose", "prescrib", "adherence"],
    pattern: /medication|med (?:list|reconcil)|dose|prescrib|adherence/i,
    question: "What medication review or management occurred this visit?",
    notDocumentedPhrase: "Medication review was not documented this visit.",
  },
  med_reconciliation: {
    label: "Medication reconciliation",
    copReference: "42 CFR 484.55",
    keywords: ["reconcil", "medication list", "all medications", "med rec"],
    pattern: /reconcil|medication list|med rec\b/i,
    question: "Was medication reconciliation completed (full list reviewed against orders)?",
    notDocumentedPhrase: "Medication reconciliation was not documented this visit.",
  },
  emergency_plan: {
    label: "Emergency preparedness plan",
    copReference: "42 CFR 484.102",
    keywords: ["emergency", "disaster", "evacuation", "emergency plan"],
    pattern: /emergency|disaster|evacuation/i,
    question: "Was the emergency preparedness plan established/reviewed?",
    notDocumentedPhrase: "Emergency preparedness plan was not documented this visit.",
  },
  physician_orders: {
    label: "Physician orders",
    copReference: "42 CFR 484.60",
    keywords: ["physician order", "order obtained", "md order", "provider order", "plan of care signed"],
    pattern: /physician order|order(?:s)? obtained|md order|provider order/i,
    question: "What physician orders were obtained / verified?",
    notDocumentedPhrase: "Physician orders were not documented this visit.",
  },
  diagnoses: {
    label: "Primary and secondary diagnoses",
    copReference: "42 CFR 484.60",
    keywords: ["diagnosis", "dx", "primary diagnosis", "secondary"],
    pattern: /diagnos|^dx\b|\bdx:/i,
    question: "What are the primary and secondary diagnoses for this episode?",
    notDocumentedPhrase: "Diagnoses were not documented this visit.",
  },
  functional_baseline: {
    label: "Functional baseline",
    copReference: "42 CFR 484.55",
    keywords: ["functional", "adl", "ambulation", "transfer", "baseline", "mobility"],
    pattern: /functional|adl|ambulat|transfer|baseline|mobility/i,
    question: "What is the patient's functional baseline (ADLs, ambulation, transfers)?",
    notDocumentedPhrase: "Functional baseline was not documented this visit.",
  },
  allergies: {
    label: "Allergies",
    copReference: "42 CFR 484.55",
    keywords: ["allerg", "nkda", "no known"],
    pattern: /allerg|nkda|no known drug/i,
    question: "What are the patient's allergies?",
    notDocumentedPhrase: "Allergies were not documented this visit.",
    standardNegative: {
      prompt: "No known drug allergies?",
      phrase: "No known drug allergies (NKDA).",
    },
  },
  discharge_reason: {
    label: "Reason for discharge",
    copReference: "42 CFR 484.50",
    keywords: ["discharge", "goals met", "transfer", "no longer", "reason for discharge"],
    pattern: /discharge|goals met|transfer|no longer (?:homebound|skilled)/i,
    question: "What is the reason for discharge (goals met, transfer, no longer eligible)?",
    notDocumentedPhrase: "Reason for discharge was not documented this visit.",
  },
  goals_met: {
    label: "Goals met / unmet",
    copReference: "42 CFR 484.50",
    keywords: ["goals met", "goals not met", "outcome", "achieved"],
    pattern: /goals? (?:met|not met|partially)|outcome|achieved/i,
    question: "Which care-plan goals were met or unmet at discharge?",
    notDocumentedPhrase: "Goals met/unmet were not documented at discharge.",
  },
  discharge_instructions: {
    label: "Discharge instructions",
    copReference: "42 CFR 484.50",
    keywords: ["instruction", "discharge teaching", "provided to patient", "written instructions"],
    pattern: /instruction|discharge teaching|provided to (?:patient|caregiver)/i,
    question: "What discharge instructions were given to the patient/caregiver?",
    notDocumentedPhrase: "Discharge instructions were not documented this visit.",
  },
  followup_plan: {
    label: "Follow-up plan",
    copReference: "42 CFR 484.60",
    keywords: ["follow-up", "follow up", "next visit", "return", "referral", "schedule"],
    pattern: /follow[- ]?up|next visit|return to|referral|scheduled/i,
    question: "What is the follow-up plan after this visit?",
    notDocumentedPhrase: "Follow-up plan was not documented this visit.",
  },
  visit_reason: {
    label: "Reason for unscheduled visit",
    copReference: "42 CFR 484.75",
    keywords: ["reason for visit", "called", "complaint of", "prn", "unscheduled"],
    pattern: /reason for (?:the )?visit|called|prn|unscheduled/i,
    question: "What was the reason for this unscheduled / PRN visit?",
    notDocumentedPhrase: "Reason for the unscheduled visit was not documented.",
  },
  physician_notification: {
    label: "Physician notification",
    copReference: "42 CFR 484.60",
    keywords: ["notified physician", "md notified", "called provider", "physician aware", "new order"],
    pattern: /notif(?:ied|y) (?:physician|md|provider)|provider notified|physician aware|new order/i,
    question: "Was the physician notified, and what was the response/order?",
    notDocumentedPhrase: "Physician notification was not documented this visit.",
  },
  // ── Hospice-specific ──
  terminal_prognosis: {
    label: "Terminal prognosis (≤6 months)",
    copReference: "42 CFR 418.22",
    keywords: ["terminal", "prognosis", "six months", "6 months", "life expectancy", "decline", "end of life"],
    pattern: /terminal|prognosis|(?:six|6) months|life expectancy|end[- ]of[- ]life/i,
    question: "What supports the continued terminal prognosis of six months or less?",
    notDocumentedPhrase: "Terminal prognosis was not documented this visit.",
  },
  comfort_skilled_need: {
    label: "Comfort-focused skilled need",
    copReference: "42 CFR 418.76",
    keywords: ["comfort", "symptom management", "pain", "dyspnea", "nausea", "palliative"],
    pattern: /comfort|symptom management|dyspnea|nausea|palliat/i,
    question: "What comfort-focused skilled need did this visit address?",
    notDocumentedPhrase: "Comfort-focused skilled need was not documented this visit.",
  },
  symptom_management: {
    label: "Symptom management",
    copReference: "42 CFR 418.56",
    keywords: ["pain", "dyspnea", "nausea", "symptom", "agitation", "secretions"],
    pattern: /pain|dyspnea|nausea|symptom|agitation|secretions/i,
    question: "What symptoms were assessed and managed (pain, dyspnea, nausea)?",
    notDocumentedPhrase: "Symptom management was not documented this visit.",
  },
  comfort_measures: {
    label: "Comfort measures provided",
    copReference: "42 CFR 418.56",
    keywords: ["comfort measure", "repositioning", "mouth care", "positioning", "comfort"],
    pattern: /comfort measure|repositioning|mouth care|positioning|comfort care/i,
    question: "What comfort measures did you provide?",
    notDocumentedPhrase: "Comfort measures were not documented this visit.",
  },
  family_support: {
    label: "Patient/family psychosocial support",
    copReference: "42 CFR 418.56",
    keywords: ["family", "emotional support", "psychosocial", "caregiver", "coping"],
    pattern: /family|emotional support|psychosocial|caregiver|coping/i,
    question: "What patient/family emotional or psychosocial support was provided?",
    notDocumentedPhrase: "Patient/family psychosocial support was not documented this visit.",
  },
  idg_coordination: {
    label: "IDG/IDT coordination",
    copReference: "42 CFR 418.56",
    keywords: ["idg", "idt", "interdisciplinary", "team", "chaplain", "social work"],
    pattern: /\bidg\b|\bidt\b|interdisciplinary|care team|chaplain|social work/i,
    question: "What interdisciplinary (IDG/IDT) coordination occurred?",
    notDocumentedPhrase: "IDG/IDT coordination was not documented this visit.",
  },
  advance_directives: {
    label: "Advance directives",
    copReference: "42 CFR 418.52",
    keywords: ["advance directive", "dnr", "polst", "code status", "molst"],
    pattern: /advance directive|\bdnr\b|polst|code status|molst/i,
    question: "Were advance directives / code status reviewed?",
    notDocumentedPhrase: "Advance directives were not documented this visit.",
  },
  bereavement: {
    label: "Bereavement plan/referral",
    copReference: "42 CFR 418.64(d)",
    keywords: ["bereavement", "grief", "bereavement referral"],
    pattern: /bereavement|grief/i,
    question: "What bereavement support or referral was addressed?",
    notDocumentedPhrase: "Bereavement support was not documented this visit.",
  },
  benefit_period: {
    label: "Benefit period continuation",
    copReference: "42 CFR 418.21",
    keywords: ["benefit period", "recertification", "certification period"],
    pattern: /benefit period|recertif|certification period/i,
    question: "What supports continuation into the next hospice benefit period?",
    notDocumentedPhrase: "Benefit period continuation was not documented this visit.",
  },
};

// Stable / administrative elements that may be PRE-FILLED from a prior note for
// the nurse to confirm. Visit-specific clinical findings (vitals, pain, wounds,
// today's interventions, patient response) are intentionally excluded so the
// tool never auto-carries-forward assessments — that would be note "cloning",
// which Medicare auditors treat as fraudulent.
const CARRY_FORWARD = new Set([
  "homebound", "diagnoses", "allergies", "emergency_plan",
  "advance_directives", "terminal_prognosis", "benefit_period",
]);

/** Build an element instance with a chosen severity. */
function el(id, severity = "required", extra = {}) {
  const base = E[id];
  if (!base) throw new Error(`Unknown required element: ${id}`);
  return { id, severity, carryForward: CARRY_FORWARD.has(id), ...base, ...extra };
}

// ── Composition per service line × visit type ──────────────────────────────
export const REQUIRED_ELEMENTS = {
  home_health: {
    routine_visit: [
      el("homebound", "critical"),
      el("skilled_need", "critical"),
      el("vitals"),
      el("patient_response"),
      el("education"),
      el("care_plan_progress"),
      el("safety"),
      el("pain"),
      el("complaints"),
      el("medication"),
    ],
    admission: [
      el("homebound", "critical"),
      el("skilled_need", "critical"),
      el("diagnoses"),
      el("med_reconciliation"),
      el("physician_orders"),
      el("emergency_plan"),
      el("functional_baseline"),
      el("allergies"),
      el("vitals"),
      el("safety"),
    ],
    recertification: [
      el("homebound", "critical"),
      el("skilled_need", "critical"),
      el("care_plan_progress"),
      el("patient_response"),
      el("medication"),
      el("functional_baseline"),
      el("followup_plan"),
    ],
    discharge: [
      el("discharge_reason", "critical"),
      el("goals_met"),
      el("discharge_instructions"),
      el("followup_plan"),
      el("physician_notification"),
    ],
    prn: [
      el("visit_reason", "critical"),
      el("patient_response"),
      el("vitals"),
      el("physician_notification"),
      el("pain"),
    ],
  },
  hospice: {
    routine_visit: [
      el("comfort_skilled_need", "critical"),
      el("symptom_management"),
      el("comfort_measures"),
      el("family_support"),
      el("medication"),
      el("idg_coordination"),
      el("pain"),
    ],
    admission: [
      el("terminal_prognosis", "critical"),
      el("comfort_skilled_need", "critical"),
      el("symptom_management"),
      el("advance_directives"),
      el("idg_coordination"),
      el("family_support"),
      el("medication"),
    ],
    recertification: [
      el("terminal_prognosis", "critical"),
      el("benefit_period"),
      el("idg_coordination"),
      el("symptom_management"),
      el("care_plan_progress"),
    ],
    discharge: [
      el("discharge_reason", "critical"),
      el("symptom_management"),
      el("family_support"),
      el("bereavement"),
      el("followup_plan"),
    ],
    prn: [
      el("visit_reason", "critical"),
      el("symptom_management"),
      el("comfort_measures"),
      el("physician_notification"),
      el("patient_response"),
    ],
  },
};

/**
 * Required elements for a service line + visit type. Unknown visit types fall
 * back to routine_visit. `overrides` (optional) lets an agency layer replace
 * the static set later without breaking the offline default.
 * @returns {Array} required-element objects
 */
export function getRequiredElements(serviceLine, visitType, overrides) {
  if (overrides && overrides[serviceLine] && overrides[serviceLine][visitType]) {
    return overrides[serviceLine][visitType];
  }
  const line = REQUIRED_ELEMENTS[serviceLine] || REQUIRED_ELEMENTS.home_health;
  return line[visitType] || line.routine_visit;
}

/** Critical (gating) elements for a service line + visit type. */
export function getCriticalElements(serviceLine, visitType, overrides) {
  return getRequiredElements(serviceLine, visitType, overrides).filter((e) => e.severity === "critical");
}
