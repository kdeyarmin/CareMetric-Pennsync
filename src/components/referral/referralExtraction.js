/**
 * Single source of truth for referral document extraction.
 *
 * The app extracts referral data in two passes that previously duplicated their
 * prompts/schemas inline at the call sites:
 *   1. A quick categorization scan at upload time (ReferralIntake) for instant
 *      form pre-population, urgency triage, and suggested tasks.
 *   2. The full, OASIS-grade clinical extraction at processing time
 *      (ReferralPDFSummarizer).
 *
 * Both are defined here as plain data (prompt builders + JSON schemas, no React
 * and no Base44 SDK) so they can be unit-tested in isolation. The LLM call itself
 * is injected: callers pass the app's standardized `invokeLLM` helper
 * (src/lib/invokeLLM.js), which applies the shared timeout/retry policy, so a
 * transient failure no longer discards an extraction. Injection also keeps this
 * module free of `@/` imports so the colocated Node test resolves without Vite.
 */

// ---------------------------------------------------------------------------
// Full clinical extraction (ReferralPDFSummarizer)
// ---------------------------------------------------------------------------

/** Build the rich extraction prompt, tailored to scanned-image vs PDF input. */
export function buildReferralExtractionPrompt(fileType = "application/pdf") {
  const fileTypeContext = fileType && fileType.includes("image")
    ? "This is a scanned/faxed document image. Extract text carefully, accounting for potential OCR errors or handwriting."
    : "This is a PDF document.";

  return `You are an expert home health intake coordinator with advanced document reading capabilities. ${fileTypeContext}

CRITICAL DOCUMENT READING INSTRUCTIONS:
- This document may contain BOTH typed text and HANDWRITTEN notes
- Read ALL text carefully, including handwritten annotations, checkboxes, signatures, and margin notes
- For handwritten content: interpret cursive, print, or mixed writing styles
- If handwriting is unclear, provide your best interpretation and flag with "[unclear handwriting]"
- Extract information from checkboxes, form fields, AND any written notes in margins or blank spaces
- Look for physician signatures, date stamps, and hand-marked priority indicators
- Pay special attention to:
  * Handwritten vital signs or assessment notes
  * Physician's handwritten orders or special instructions
  * Care notes written by hospital staff or case managers
  * Date/time stamps that may be handwritten
  * Contact information that may be partially handwritten

When you encounter handwritten text:
1. Transcribe it as accurately as possible
2. Include context about WHERE it appeared (e.g., "handwritten in margins", "noted in physician section")
3. If uncertain about legibility, include "[possibly X or Y]" notation

NON-NEGOTIABLE GROUNDING RULES (apply to every field):
- Extract ONLY what this document states. Never invent, infer, or "complete" identifiers, dates, ICD-10 codes, medication names/doses, vital signs, lab values, wound measurements, or scores.
- ICD-10 codes: record a code ONLY when it appears in the document. If a diagnosis is documented without a code, record the diagnosis text and leave the code field empty — the agency's coder assigns codes; you never do.
- If a value is absent, use "Not documented in referral" (or omit the array item) instead of a plausible guess.
- OASIS/GG drafts: score an item only when the document gives an explicit basis, and cite that basis; otherwise omit the item and add it to items_needing_verification.
- Uncertain handwriting stays flagged ("[unclear handwriting]", "[possibly X or Y]") — never silently resolved into a definite value.

Analyze this patient referral document and extract ALL relevant information needed for:
1. **OASIS-E assessment drafting** (draft every OASIS item the document gives a basis for, with confidence scores — skip items with no documented basis)
2. Admission nursing assessment
3. Care planning
4. **PDGM-complete diagnosis capture**

**YOUR PRIMARY GOAL: Draft a Medicare-compliant OASIS assessment from what the referral actually documents. For each OASIS item you draft, use the exact scoring scales and provide your confidence level (high/medium/low) and reasoning. Never fill an item just to complete the form.**

**CRITICAL - PDGM DIAGNOSIS CAPTURE (documentation, not selection):**
The app sequences the documented diagnosis codes deterministically against the agency's own PDGM tables — you do NOT pick codes or re-rank diagnoses for reimbursement, and you NEVER invent an ICD-10 code. Your job:
- Capture the primary diagnosis EXACTLY as the referral states it (the condition driving the home health referral), with its ICD-10 code only if printed in the document.
- Capture EVERY documented secondary diagnosis and comorbidity — complete capture of what is documented is what supports the case-mix adjustment.
- In pdgm_optimization_notes, flag documentation gaps a physician/coder query could close: documented conditions carrying no code, unspecified laterality/stage/type, symptom codes where the document names a definitive diagnosis, and any ambiguity about which documented condition is primary.
- If the document itself names a PDGM clinical group, record it; otherwise you may note the most likely group for the documented primary as advisory context — the app derives the authoritative group from the coded diagnosis.

Extract comprehensive details organized by category. Be thorough and specific about what IS documented; be explicit about what is not.

CRITICAL EXTRACTION REQUIREMENTS:

DEMOGRAPHICS:
- Full name, DOB, age, gender
- Address, phone numbers
- Emergency contacts with relationships
- Insurance information (primary, secondary, policy numbers)
- Referring physician and contact info
- Primary care physician if different

ADMISSION DETAILS:
- Admission source (hospital, SNF, home, etc.)
- Admission date or requested start date
- Referral date and reason for referral
- Prior living situation
- Current living situation and support system

DIAGNOSES & COMPREHENSIVE MEDICAL HISTORY:
- Primary diagnosis (ICD-10 if available)
- All secondary diagnoses with ICD-10 codes
- **Detailed Past Medical History:**
  * Chronic conditions with onset dates and management
  * Past surgeries with dates, procedures, and complications
  * History of hospitalizations (dates, reasons, length of stay, outcomes)
  * Previous injuries or trauma
  * History of infections or communicable diseases
- **Family Medical History:**
  * Hereditary conditions (diabetes, heart disease, cancer, etc.)
  * Genetic predispositions
  * Family history of mental health conditions
- Allergies and reactions (medications, foods, environmental)

MEDICATIONS:
- Complete medication list with:
  * Medication name
  * Dosage and frequency
  * Route
  * Prescribing physician
  * Start date if available
- Recent medication changes
- High-risk medications noted

FUNCTIONAL STATUS & DETAILED OASIS ASSESSMENT:

**CRITICAL: For each functional area, provide OASIS-compliant scoring (0-6 scale where applicable):**

**Vision (M1200):**
- 0 = Normal
- 1 = Partially impaired
- 2 = Severely impaired

**ADL/IADL Assessment (M1800-M1870) - Use this scale:**
- 0 = Able to perform independently
- 1 = With use of assistive device
- 2 = With minimal assistance from person
- 3 = With moderate assistance from person
- 4 = With substantial/maximal assistance from person
- 5 = Dependent, does not participate
- 6 = Unable to perform

Assess each ADL:
- M1800: Grooming (hair, nails, teeth)
- M1810: Dressing upper body
- M1820: Dressing lower body
- M1830: Bathing
- M1840: Toilet transferring
- M1845: Toilet hygiene
- M1850: Transferring (bed, chair, wheelchair)
- M1860: Ambulation/locomotion
- M1870: Feeding/eating

**Section GG (OASIS-E) — Self-Care GG0130 and Mobility GG0170:**
Score each supported item on the 6-point scale:
- 06 = Independent
- 05 = Setup or clean-up assistance
- 04 = Supervision or touching assistance
- 03 = Partial/moderate assistance
- 02 = Substantial/maximal assistance
- 01 = Dependent
If the activity was not attempted: 07 = patient refused, 09 = not applicable, 10 = not attempted (environmental limitation), 88 = not attempted (medical condition or safety).
Score GG0130 self-care (eating, oral hygiene, toileting hygiene, shower/bathe, upper-body dressing, lower-body dressing, footwear) and GG0170 mobility (roll left/right, sit to lying, lying to sitting, sit to stand, chair/bed transfer, toilet transfer, walk 10 ft, walk 50 ft with two turns, walk 150 ft) from the documented functional status. Format each as "<code> - <short basis>", and OMIT items the referral gives no basis for — never guess a GG code.

**Cognitive Function (M1700):**
- 0 = Alert/oriented, processes info
- 1 = Memory deficit, decisions okay
- 2 = Difficulty some decisions
- 3 = Difficulty all decisions
- 4 = Never/rarely makes decisions

**Pain (M1242):**
- 0 = No pain
- 1 = Less often than daily
- 2 = Daily, not constantly
- 3 = All the time

**Continence:**
- Urinary (M1610): 0=continent to 5=catheter
- Bowel (M1620): 0=continent to 5=incontinent

**Wounds & Pressure Ulcers (Detailed Characteristics):**
- **Pressure Ulcers:**
  * Location (anatomical site - sacrum, heel, etc.)
  * Stage (Stage 1-4, unstageable, deep tissue injury)
  * Size (length x width x depth in cm)
  * Exudate (type: serous, serosanguineous, purulent; amount: minimal, moderate, large)
  * Wound bed appearance (granulation, slough, eschar percentage)
  * Surrounding skin condition (intact, macerated, erythema, induration)
  * Odor present (yes/no, character)
  * Pain level associated with wound
  * Current treatment/dressings
  * Undermining or tunneling measurements
- **Stasis Ulcers:**
  * Location and laterality
  * Size and depth measurements
  * Edema presence and severity
  * Skin changes (hemosiderin staining, lipodermatosclerosis)
- **Surgical Wounds:**
  * Incision location and length
  * Healing status (primary intention, dehiscence, infection)
  * Closure type (sutures, staples, steri-strips)
- **Other Wounds:**
  * Diabetic ulcers, arterial ulcers, traumatic wounds
  * Detailed characteristics using same assessment criteria

CLINICAL INFORMATION:
- Recent vital signs (BP, HR, RR, Temp, O2 sat, pain level)
- **Nutritional Status & Assessment:**
  * Current weight and height
  * Recent weight changes (amount and timeframe)
  * BMI if calculable
  * Dietary restrictions (diabetic, cardiac, renal, texture modified)
  * Swallowing difficulties or dysphagia
  * Need for feeding tube or special nutrition support
  * Appetite changes or anorexia
  * Nausea/vomiting issues
  * Dentition status affecting nutrition
  * Food allergies or intolerances
  * Nutritional risk factors (poor intake, malabsorption, increased needs)
- Laboratory values mentioned (CBC, BMP, glucose, HgbA1c, etc.)
- Diagnostic test results (imaging, cardiac tests, etc.)
- Procedures performed recently
- Infection status or communicable disease screening

SKILLED NEEDS & SERVICES:
- What skilled services are ordered (SN, PT, OT, ST, MSW)
- Frequency and duration ordered
- Specific interventions needed
- DME/supplies needed
- Goals of care

PSYCHOSOCIAL & SOCIAL DETERMINANTS OF HEALTH:
- **Mental Health & Behavioral Assessment:**
  * Specific psychiatric diagnoses (depression, anxiety, PTSD, etc.)
  * Current symptoms and severity
  * Coping mechanisms and support strategies
  * Medication compliance and mental health treatment history
  * Cognitive impairments or dementia-related behaviors
  * Substance use history (alcohol, tobacco, drugs)
- **Social Determinants of Health:**
  * Living situation (alone, with family, assisted living, home condition)
  * Caregiver availability, capability, and signs of burnout
  * Financial concerns or barriers to care
  * Transportation barriers and access to medical appointments
  * Food insecurity or dietary limitations
  * Social isolation or lack of support system
  * Employment status and work-related stress
  * Health literacy level
  * Housing stability and environmental safety
- Language barriers and preferred language
- Cultural or religious considerations affecting care
- Advance directives status (living will, DNR, healthcare proxy)

ORDERS & TREATMENTS:
- Physician orders for home health
- Specific treatments ordered
- Monitoring parameters
- Diet orders
- Activity restrictions

SAFETY CONCERNS:
- Environmental hazards mentioned
- Safety equipment needed
- High-risk conditions requiring monitoring

Extract everything mentioned, even if partial. If information is missing, note it as "Not documented in referral."

HANDWRITTEN NOTES HANDLING:
- If you find handwritten notes, include them in the appropriate section with context
- Create a special "handwritten_notes" field to capture any additional handwritten information that doesn't fit standard categories
- For illegible handwriting, note "[illegible handwriting - appears to be about X]"
- Cross-reference handwritten information with typed data to resolve conflicts or fill gaps

CONFIDENCE SCORING (REQUIRED):
- Populate "extraction_confidence" with an honest 0-100 score for EACH section.
- Base the score on how clearly the source supported it: clearly typed and explicit = high (85-100); partially documented or requiring inference = medium (60-84); handwritten, illegible, ambiguous, or largely absent = low (<60).
- Do NOT default everything to high. Calibrate so a reviewer can trust the numbers to triage what needs verification.
- List the specific fields you are least sure about in "extraction_confidence.low_confidence_fields".`;
}

/** Rich response schema for the full clinical extraction. */
export const REFERRAL_EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    demographics: {
      type: "object",
      properties: {
        full_name: { type: "string" },
        date_of_birth: { type: "string" },
        age: { type: "string" },
        gender: { type: "string" },
        address: { type: "string" },
        phone: { type: "string" },
        emergency_contact: { type: "string" },
        emergency_phone: { type: "string" },
        emergency_relationship: { type: "string" },
        insurance_primary: { type: "string" },
        insurance_secondary: { type: "string" },
        policy_numbers: { type: "string" },
        referring_physician: { type: "string" },
        referring_physician_contact: { type: "string" },
        primary_care_physician: { type: "string" },
        pcp_contact: { type: "string" }
      }
    },
    admission_details: {
      type: "object",
      properties: {
        admission_source: { type: "string" },
        admission_date: { type: "string" },
        referral_date: { type: "string" },
        referral_reason: { type: "string" },
        prior_living_situation: { type: "string" },
        current_living_situation: { type: "string" },
        support_system: { type: "string" }
      }
    },
    diagnoses: {
      type: "object",
      properties: {
        primary_diagnosis: {
          type: "string",
          description: "Primary diagnosis EXACTLY as documented in the referral (the condition driving the home health referral) — never re-selected for reimbursement"
        },
        primary_icd10: {
          type: "string",
          description: "ICD-10 code ONLY as printed in the document; empty when the referral does not code the diagnosis"
        },
        pdgm_clinical_group: {
          type: "string",
          description: "PDGM clinical group if stated in the document, else the most likely group for the documented primary (advisory only — the app derives the authoritative group from the coded diagnosis)"
        },
        pdgm_optimization_notes: {
          type: "string",
          description: "Documentation gaps a physician/coder query could close (uncoded documented conditions, unspecified laterality/stage, primary-diagnosis ambiguity) — never invented codes or diagnoses"
        },
        secondary_diagnoses: {
          type: "array",
          items: { type: "string" },
          description: "Every secondary diagnosis documented in the referral, exactly as stated"
        },
        comorbidity_adjustments: {
          type: "array",
          items: { type: "string" },
          description: "Documented comorbidities relevant to the PDGM comorbidity adjustment — from the document only, never inferred"
        },
        past_medical_history: {
          type: "array",
          items: {
            type: "object",
            properties: {
              condition: { type: "string" },
              onset_date: { type: "string" },
              current_status: { type: "string" },
              management: { type: "string" }
            }
          }
        },
        surgical_history: {
          type: "array",
          items: {
            type: "object",
            properties: {
              procedure: { type: "string" },
              date: { type: "string" },
              complications: { type: "string" },
              surgeon: { type: "string" }
            }
          }
        },
        recent_hospitalizations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              date: { type: "string" },
              reason: { type: "string" },
              hospital: { type: "string" },
              length_of_stay: { type: "string" },
              outcome: { type: "string" }
            }
          }
        },
        family_medical_history: {
          type: "object",
          properties: {
            hereditary_conditions: { type: "array", items: { type: "string" } },
            genetic_predispositions: { type: "string" },
            family_mental_health: { type: "string" }
          }
        },
        allergies: { type: "string" }
      }
    },
    medications: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          dosage: { type: "string" },
          frequency: { type: "string" },
          route: { type: "string" },
          prescriber: { type: "string" },
          notes: { type: "string" }
        }
      }
    },
    functional_status: {
      type: "object",
      properties: {
        ambulation: { type: "string" },
        adl_status: { type: "string" },
        fall_risk: { type: "string" },
        cognitive_status: { type: "string" },
        vision: { type: "string" },
        hearing: { type: "string" },
        skin_integrity: { type: "string" },
        wounds: { type: "string" },
        pain: { type: "string" },
        continence: { type: "string" }
      }
    },
    clinical_info: {
      type: "object",
      properties: {
        vital_signs: { type: "string" },
        lab_values: { type: "string" },
        diagnostic_results: { type: "string" },
        procedures: { type: "string" },
        infection_status: { type: "string" }
      }
    },
    skilled_needs: {
      type: "object",
      properties: {
        services_ordered: { type: "array", items: { type: "string" } },
        frequency_duration: { type: "string" },
        specific_interventions: { type: "array", items: { type: "string" } },
        dme_supplies: { type: "array", items: { type: "string" } },
        goals_of_care: { type: "string" }
      }
    },
    psychosocial: {
      type: "object",
      properties: {
        mental_health_assessment: {
          type: "object",
          properties: {
            psychiatric_diagnoses: { type: "array", items: { type: "string" } },
            current_symptoms: { type: "string" },
            symptom_severity: { type: "string" },
            coping_mechanisms: { type: "string" },
            medication_compliance: { type: "string" },
            treatment_history: { type: "string" },
            substance_use_history: { type: "string" }
          }
        },
        social_determinants: {
          type: "object",
          properties: {
            living_situation: { type: "string" },
            home_condition: { type: "string" },
            caregiver_availability: { type: "string" },
            caregiver_capability: { type: "string" },
            caregiver_burnout_signs: { type: "string" },
            financial_concerns: { type: "string" },
            transportation_barriers: { type: "string" },
            food_insecurity: { type: "string" },
            social_isolation: { type: "string" },
            employment_status: { type: "string" },
            health_literacy: { type: "string" },
            housing_stability: { type: "string" }
          }
        },
        language: { type: "string" },
        cultural_needs: { type: "string" },
        advance_directives: { type: "string" }
      }
    },
    nutritional_status: {
      type: "object",
      properties: {
        current_weight: { type: "string" },
        height: { type: "string" },
        bmi: { type: "string" },
        recent_weight_changes: { type: "string" },
        dietary_restrictions: { type: "array", items: { type: "string" } },
        swallowing_difficulties: { type: "string" },
        dysphagia_level: { type: "string" },
        feeding_tube_present: { type: "boolean" },
        tube_type: { type: "string" },
        appetite_changes: { type: "string" },
        nausea_vomiting: { type: "string" },
        dentition_issues: { type: "string" },
        food_allergies: { type: "array", items: { type: "string" } },
        nutritional_risk_factors: { type: "array", items: { type: "string" } },
        special_nutrition_needs: { type: "string" }
      }
    },
    wound_details: {
      type: "array",
      items: {
        type: "object",
        properties: {
          wound_type: { type: "string" },
          location: { type: "string" },
          stage: { type: "string" },
          size_length_cm: { type: "string" },
          size_width_cm: { type: "string" },
          size_depth_cm: { type: "string" },
          exudate_type: { type: "string" },
          exudate_amount: { type: "string" },
          wound_bed_appearance: { type: "string" },
          surrounding_skin: { type: "string" },
          odor_present: { type: "boolean" },
          odor_character: { type: "string" },
          pain_level: { type: "string" },
          current_treatment: { type: "string" },
          undermining_cm: { type: "string" },
          tunneling_cm: { type: "string" },
          healing_status: { type: "string" }
        }
      }
    },
    orders_treatments: {
      type: "object",
      properties: {
        physician_orders: { type: "array", items: { type: "string" } },
        treatments: { type: "array", items: { type: "string" } },
        monitoring_parameters: { type: "array", items: { type: "string" } },
        diet: { type: "string" },
        activity_restrictions: { type: "string" }
      }
    },
    safety_concerns: {
      type: "object",
      properties: {
        environmental_hazards: { type: "string" },
        safety_equipment_needed: { type: "array", items: { type: "string" } },
        high_risk_conditions: { type: "array", items: { type: "string" } }
      }
    },
    face_to_face: {
      // Physician Face-to-Face (F2F) encounter documentation for the home-health
      // certification requirement (42 CFR 424.22). Validated deterministically at
      // referral intake by faceToFaceValidator.js — NOT surfaced in the chart.
      type: "object",
      properties: {
        encounter_date: { type: "string", description: "Date of the face-to-face encounter (YYYY-MM-DD if determinable)" },
        practitioner_name: { type: "string", description: "Name of the practitioner who performed the F2F encounter" },
        practitioner_type: { type: "string", description: "Practitioner credential/type (e.g. MD, DO, NP, PA, CNS)" },
        clinical_reason: { type: "string", description: "Documented clinical reason for the encounter" },
        documented_conditions: { type: "array", items: { type: "string" }, description: "Conditions documented at the encounter" },
        practitioner_signature_present: { type: "boolean", description: "True ONLY when the F2F documentation visibly carries the practitioner's signature (wet, electronic attestation, or signature stamp with date). False when the note is clearly unsigned. Omit when signature presence cannot be determined from the document." },
        signed_date: { type: "string", description: "Date next to the practitioner's signature on the F2F note, if visible (YYYY-MM-DD if determinable)" }
      }
    },
    oasis_assessment: {
      type: "object",
      properties: {
        m1021_primary_diagnosis: { type: "string" },
        m1023_other_diagnoses: { type: "array", items: { type: "string" } },
        m1033_risk_hospitalization: { type: "string" },
        m1200_vision: { type: "string" },
        m1242_pain_frequency: { type: "string" },
        m1306_pressure_ulcer_risk: { type: "string" },
        m1307_oldest_stage2: { type: "string" },
        m1311_current_pressure_ulcers: { type: "object" },
        m1322_current_stasis_ulcers: { type: "string" },
        m1324_surgical_wounds: { type: "string" },
        m1610_urinary_incontinence: { type: "string" },
        m1620_bowel_incontinence: { type: "string" },
        m1700_cognitive_functioning: { type: "string" },
        m1710_confusion_frequency: { type: "string" },
        m1720_anxiety_frequency: { type: "string" },
        m1730_depression_screening: { type: "string" },
        m1740_cognitive_behavioral: { type: "string" },
        m1800_grooming: { type: "string" },
        m1810_dress_upper: { type: "string" },
        m1820_dress_lower: { type: "string" },
        m1830_bathing: { type: "string" },
        m1840_toilet_transfer: { type: "string" },
        m1845_toilet_hygiene: { type: "string" },
        m1850_transferring: { type: "string" },
        m1860_ambulation: { type: "string" },
        m1870_feeding: { type: "string" },
        m2001_drug_regimen_review: { type: "string" },
        m2003_medication_followup: { type: "string" },
        m2010_high_risk_drugs: { type: "array", items: { type: "string" } },
        m2020_management_oral_meds: { type: "string" },
        m2030_management_injectable_meds: { type: "string" },
        gg0130_self_care: {
          type: "object",
          description: "OASIS-E Section GG self-care (GG0130): '<code> - <short basis>' per item on the 06-01 scale (07/09/10/88 when not attempted). Omit items the referral gives no basis for — never guess.",
          properties: {
            a_eating: { type: "string" },
            b_oral_hygiene: { type: "string" },
            c_toileting_hygiene: { type: "string" },
            e_shower_bathe_self: { type: "string" },
            f_upper_body_dressing: { type: "string" },
            g_lower_body_dressing: { type: "string" },
            h_putting_on_taking_off_footwear: { type: "string" }
          }
        },
        gg0170_mobility: {
          type: "object",
          description: "OASIS-E Section GG mobility (GG0170): same scale and format as GG0130; omit unsupported items.",
          properties: {
            a_roll_left_and_right: { type: "string" },
            b_sit_to_lying: { type: "string" },
            c_lying_to_sitting_on_side_of_bed: { type: "string" },
            d_sit_to_stand: { type: "string" },
            e_chair_bed_to_chair_transfer: { type: "string" },
            f_toilet_transfer: { type: "string" },
            i_walk_10_feet: { type: "string" },
            j_walk_50_feet_with_two_turns: { type: "string" },
            k_walk_150_feet: { type: "string" }
          }
        },
        confidence_notes: { type: "string" },
        items_needing_verification: { type: "array", items: { type: "string" } }
      }
    },
    oasis_relevant_notes: {
      type: "string"
    },
    admission_note_template: {
      type: "string"
    },
    handwritten_notes: {
      type: "object",
      properties: {
        clinical_notes: { type: "string" },
        physician_instructions: { type: "string" },
        margin_annotations: { type: "string" },
        priority_indicators: { type: "string" },
        other_handwritten: { type: "string" }
      }
    },
    document_quality_notes: {
      type: "object",
      properties: {
        legibility_assessment: { type: "string" },
        unclear_sections: { type: "array", items: { type: "string" } },
        mixed_content_noted: { type: "boolean" }
      }
    },
    extraction_confidence: {
      type: "object",
      description: "Honest self-assessed confidence (0-100) for each extracted section, based on document legibility, completeness, and how much had to be inferred. Use lower scores for handwritten, illegible, or inferred content.",
      properties: {
        demographics: { type: "number" },
        admission_details: { type: "number" },
        diagnoses: { type: "number" },
        medications: { type: "number" },
        functional_status: { type: "number" },
        clinical_info: { type: "number" },
        nutritional_status: { type: "number" },
        wound_details: { type: "number" },
        psychosocial: { type: "number" },
        skilled_needs: { type: "number" },
        oasis_assessment: { type: "number" },
        overall: { type: "number" },
        low_confidence_fields: {
          type: "array",
          items: { type: "string" },
          description: "Specific fields/values you are least certain about and that a clinician should verify."
        }
      }
    }
  }
};

/**
 * Run the full clinical extraction on a referral document.
 * @param {(params: object, options?: object) => Promise<object>} invoke - the
 *   standardized invokeLLM helper (applies the shared timeout/retry policy)
 * @param {{ fileUrl: string, fileType?: string }} params
 */
export function runReferralExtraction(invoke, { fileUrl, fileType = "application/pdf" }) {
  return invoke(
    {
      model: "automatic",
      prompt: buildReferralExtractionPrompt(fileType),
      file_urls: [fileUrl],
      response_json_schema: REFERRAL_EXTRACTION_SCHEMA,
    },
    // Document extraction is a long, heavy call; give it room and retry
    // transient network/timeout/5xx failures with backoff.
    { retries: 2, timeoutMs: 120000, backoffMs: 800 }
  );
}

// ---------------------------------------------------------------------------
// Quick categorization scan (ReferralIntake upload)
// ---------------------------------------------------------------------------

/** Lightweight prompt for fast form pre-population + urgency triage at upload. */
export function buildReferralQuickScanPrompt() {
  return `Analyze this referral document and extract key information with automatic categorization.

GROUNDING: Extract only what this document states — leave any field empty/omitted when it is not documented. ICD-10 codes only as printed in the document, never inferred from a diagnosis name. Urgency ratings and suggested tasks must be justified by documented findings, not assumptions.

Extract and categorize:

1. PATIENT INFORMATION:
- Patient full name
- Date of birth
- Contact information
- Address

2. REFERRAL DETAILS:
- Referral source (hospital, physician, facility name)
- Referral date
- Referring physician name and contact

3. CLINICAL CATEGORIZATION:
- Primary diagnosis
- Secondary diagnoses
- Category classification (cardiac, respiratory, wound_care, orthopedic, neurological, diabetes, post_surgical, general_medical, hospice, palliative)
- ICD-10 codes if mentioned
- Medical history highlights

4. URGENCY ASSESSMENT:
- Urgency indicators (urgent, high priority, stat, emergency, routine)
- Clinical urgency factors (recent hospitalization, unstable vitals, critical condition)
- Administrative urgency (insurance requirements, requested start date)
- Recommended priority level

5. INITIAL CARE NEEDS:
- Skilled nursing needs
- Therapy requirements (PT, OT, ST)
- Medical equipment needs (DME)
- Medication management requirements
- Wound care needs
- IV therapy requirements

6. SUGGESTED INITIAL TASKS:
- Critical actions needed immediately (within 24 hours)
- High priority actions (within 48-72 hours)
- Important follow-ups (within first week)

Return comprehensive structured data for intelligent form pre-population and care planning.`;
}

/** Response schema for the quick categorization scan. */
export const REFERRAL_QUICKSCAN_SCHEMA = {
  type: "object",
  properties: {
    patient_name: { type: "string" },
    patient_dob: { type: "string" },
    patient_phone: { type: "string" },
    patient_address: { type: "string" },
    referral_source: { type: "string" },
    referral_date: { type: "string" },
    referring_physician: { type: "string" },
    physician_contact: { type: "string" },
    primary_diagnosis: { type: "string" },
    secondary_diagnoses: { type: "array", items: { type: "string" } },
    category: {
      type: "string",
      enum: ["cardiac", "respiratory", "wound_care", "orthopedic", "neurological", "diabetes", "post_surgical", "general_medical", "hospice", "palliative"]
    },
    icd10_codes: { type: "array", items: { type: "string" } },
    urgency_level: {
      type: "string",
      enum: ["urgent", "high", "normal", "low"]
    },
    urgency_factors: { type: "array", items: { type: "string" } },
    clinical_urgency_score: { type: "number" },
    administrative_urgency_score: { type: "number" },
    skilled_nursing_needs: { type: "array", items: { type: "string" } },
    therapy_requirements: { type: "array", items: { type: "string" } },
    dme_needs: { type: "array", items: { type: "string" } },
    medication_management: { type: "boolean" },
    wound_care_needed: { type: "boolean" },
    iv_therapy_needed: { type: "boolean" },
    suggested_initial_tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          task: { type: "string" },
          priority: { type: "string" },
          timeframe: { type: "string" },
          reason: { type: "string" }
        }
      }
    },
    suggested_care_plans: {
      type: "array",
      items: {
        type: "object",
        properties: {
          problem: { type: "string" },
          goal: { type: "string" },
          interventions: { type: "array", items: { type: "string" } },
          rationale: { type: "string" }
        }
      }
    },
    confidence_score: { type: "number" }
  }
};

/**
 * Run the quick categorization scan on a referral document.
 * @param {(params: object, options?: object) => Promise<object>} invoke - the
 *   standardized invokeLLM helper (applies the shared timeout/retry policy)
 * @param {{ fileUrl: string }} params
 */
export function runReferralQuickScan(invoke, { fileUrl }) {
  return invoke(
    {
      model: "automatic",
      prompt: buildReferralQuickScanPrompt(),
      file_urls: [fileUrl],
      response_json_schema: REFERRAL_QUICKSCAN_SCHEMA,
    },
    { retries: 1, timeoutMs: 60000, backoffMs: 600 }
  );
}
