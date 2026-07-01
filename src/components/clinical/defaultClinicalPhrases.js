// Bundled starter set of agency-wide quick phrases so a new agency has something
// to trigger from the note editor on day one. These are GENERIC, Medicare-oriented
// documentation blocks in general language — they assert no patient-specific values,
// so when inserted into the draft they pass the Smart Note value-guard/grounding
// check as ordinary nurse-authored input the nurse then personalizes.
//
// Seeding is idempotent (keyed by phrase text), so shipping more defaults later and
// re-seeding only adds the new ones.

export const DEFAULT_CLINICAL_PHRASES = [
  {
    phrase: "diabetic education",
    category: "education",
    template_type: "generic",
    is_agency_wide: true,
    expanded_text:
      "Diabetic self-management education provided this visit. Reviewed blood glucose monitoring technique and target range, signs and symptoms of hyperglycemia and hypoglycemia and the appropriate response to each, medication/insulin administration and timing, diet and carbohydrate awareness, foot care with daily skin inspection, and sick-day management. Patient/caregiver participated, demonstrated understanding via teach-back, and was instructed on when to notify the physician or seek emergency care.",
  },
  {
    phrase: "fall risk assessment",
    category: "safety",
    template_type: "generic",
    is_agency_wide: true,
    expanded_text:
      "Fall risk assessed this visit. Reviewed intrinsic and environmental risk factors including gait and balance, lower-extremity strength, orthostatic symptoms, vision, cognition, medication side effects, and home hazards (lighting, clutter, loose rugs, absence of grab bars). Fall-prevention interventions reinforced with patient and caregiver, including safe transfer and ambulation technique, use of the prescribed assistive device, appropriate footwear, and a call-for-help plan. Patient/caregiver verbalized understanding of the fall-prevention plan.",
  },
  {
    phrase: "homebound status",
    category: "assessment",
    template_type: "generic",
    is_agency_wide: true,
    expanded_text:
      "Homebound status confirmed this visit. The patient has a normal inability to leave the home, and leaving requires a considerable and taxing effort. Absences from the home are infrequent, of short duration, or to receive medical care. Leaving home is medically contraindicated or requires the assistance of another person and/or a supportive device due to the patient's condition.",
  },
  {
    phrase: "medication reconciliation",
    category: "medication",
    template_type: "generic",
    is_agency_wide: true,
    expanded_text:
      "Medication reconciliation completed this visit. Reviewed the current medication regimen against the physician's orders, including prescriptions, over-the-counter medications, and supplements. Assessed for adherence, side effects, duplications, and potential interactions. Reinforced dose, route, frequency, indication, and safe storage. Discrepancies, if any, were clarified and communicated to the physician. Patient/caregiver verbalized understanding of the medication regimen.",
  },
  {
    phrase: "wound care provided",
    category: "wound_care",
    template_type: "generic",
    is_agency_wide: true,
    expanded_text:
      "Wound care provided this visit per physician orders. Assessed the wound for location, size, tissue type, exudate amount and character, periwound skin condition, and signs or symptoms of infection. Cleansed and dressed the wound using aseptic technique with the ordered products. Patient tolerated the procedure. Reinforced wound-care instructions, the dressing-change schedule, activity precautions, and the signs and symptoms to report to the agency or physician.",
  },
  {
    phrase: "pain assessment",
    category: "assessment",
    template_type: "generic",
    is_agency_wide: true,
    expanded_text:
      "Pain assessed this visit using an appropriate pain scale. Evaluated location, quality, intensity, onset and duration, aggravating and relieving factors, and the impact of pain on function, sleep, and quality of life. Reviewed the effectiveness and side effects of the current pain-management regimen and reinforced pharmacologic and non-pharmacologic strategies. Patient/caregiver educated on the pain plan and when to notify the physician for uncontrolled pain.",
  },
];

const phraseKey = (p) => String(p == null ? "" : p).toLowerCase().trim();

/**
 * Return the default phrases that are NOT already present in the library
 * (compared by phrase text, case-insensitively). Safe to call repeatedly.
 * @param {any[]} [existing]
 */
export function phrasesToSeed(existing = []) {
  const have = new Set((Array.isArray(existing) ? existing : []).map((t) => phraseKey(t && t.phrase)));
  return DEFAULT_CLINICAL_PHRASES.filter((p) => !have.has(phraseKey(p.phrase)));
}
