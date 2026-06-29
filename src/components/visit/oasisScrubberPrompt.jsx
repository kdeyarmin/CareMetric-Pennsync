// OASIS Scrubber AI prompt + response-schema builder.
// Pure string/object assembly extracted from OASISScrubber.jsx so the component
// stays focused on UI/state. No React, no side effects.
import { formatExtractedOasisForPrompt } from "./oasisPromptFormat";

// Visit-type-specific mandatory section appended to the prompt body.
function visitTypeRequirements(visitType) {
  if (visitType === 'admission') {
    return `
SOC/ROC MANDATORY:
- ALL GG items with admission AND discharge goal scores
- Complete medication reconciliation with HIGH-RISK drug identification
- Baseline functional scores (M1800-M1860) - DOCUMENT WORST ABILITY
- BIMS or CAM for cognitive screening
- PHQ-2/PHQ-9 depression screening
- Fall risk assessment with interventions
- Homebound status with 2+ criteria documented
- Primary caregiver capability assessment
- 60-day prognosis statement
`;
  }
  if (visitType === 'recertification') {
    return `
RECERTIFICATION MANDATORY:
- Functional status COMPARISON to prior assessment (improved/same/declined)
- Updated GG scores with goal progress
- Continued homebound justification (re-document criteria)
- Skilled need justification (why services still needed)
- Updated medication list with reconciliation
- Wound healing progress (if applicable)
- Fall risk re-assessment
- Care plan goal achievement status
`;
  }
  if (visitType === 'discharge') {
    return `
DISCHARGE MANDATORY:
- M2410: Discharge disposition (specific destination)
- Final GG scores (actual vs goal comparison)
- M2301: Emergent care since last assessment
- Outcome summary for each care plan goal
- Final functional status M1800-M1860
- Discharge medication list
- Patient/caregiver education completed
- Follow-up appointments scheduled
`;
  }
  return '';
}

export function buildOASISScrubberPrompt({
  visitTypeLabel,
  visitTypeRaw,
  patient,
  visit,
  clinicalGroupAnalysis,
  comorbidityAnalysis,
  clinicalIndicators,
  functionalPhrases,
  vitalSigns,
  narrativeText,
  extractedOasisData,
}) {
  const ci = clinicalIndicators;
  const fp = functionalPhrases;

  let prompt = `You are a CMS-certified OASIS-E compliance auditor with 15+ years expertise in 2024 Medicare home health CoP regulations and PDGM optimization. Perform RIGOROUS, EVIDENCE-BASED completeness and accuracy check for ${visitTypeLabel}.

CRITICAL INSTRUCTIONS FOR ACCURACY:
1. ONLY score based on EXPLICIT documentation - do not infer or assume
2. When documentation is vague, flag as "insufficient documentation" not as a specific score
3. Compare narrative descriptions against OASIS scoring definitions EXACTLY
4. Identify CONTRADICTIONS between different parts of documentation
5. Calculate functional points using CMS methodology precisely

PATIENT CONTEXT:
- Visit Type: ${visitTypeLabel}
- Primary Diagnosis: ${patient.primary_diagnosis || 'Not specified'}
- Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None documented'}
- Visit Date: ${visit.visit_date}

=== PRE-ANALYZED PDGM CLINICAL GROUP ===
**Determined Clinical Group:** ${clinicalGroupAnalysis.group} - ${clinicalGroupAnalysis.name}
**Confidence Level:** ${clinicalGroupAnalysis.confidence.toUpperCase()}
**Matched Patterns:** ${clinicalGroupAnalysis.matchedPatterns.join(', ') || 'Default assignment'}

=== PRE-ANALYZED COMORBIDITIES ===
**Total Qualifying Comorbidities Found:** ${comorbidityAnalysis.count}
**Recommended Adjustment Level:** ${comorbidityAnalysis.adjustment.toUpperCase()}

**High-Impact Comorbidities (1 needed for HIGH adjustment):**
${comorbidityAnalysis.high.length > 0 ? comorbidityAnalysis.high.map(c => `- ${c.name} (ICD-10: ${c.icd10_codes.join(', ')})`).join('\n') : '- None identified'}

**Low-Impact Comorbidities (2+ needed for LOW adjustment):**
${comorbidityAnalysis.low.length > 0 ? comorbidityAnalysis.low.map(c => `- ${c.name} (ICD-10: ${c.icd10_codes.join(', ')})`).join('\n') : '- None identified'}

IMPORTANT: Use the above pre-analyzed clinical group and comorbidities as your baseline. Validate against the narrative and adjust confidence/findings if narrative contradicts or supports differently.

=== CLINICAL INDICATORS EXTRACTED FROM NARRATIVE ===

**ASSISTIVE DEVICES:**
- Detected: ${ci.assistDevices.detected ? 'YES' : 'No'}
${ci.assistDevices.detected ? `- Walker mentions: ${ci.assistDevices.walkers.join(' | ') || 'None'}
- Cane mentions: ${ci.assistDevices.canes.join(' | ') || 'None'}
- Wheelchair mentions: ${ci.assistDevices.wheelchairs.join(' | ') || 'None'}
- Bathroom equipment: ${ci.assistDevices.bathroom.join(' | ') || 'None'}
- Transfer equipment: ${ci.assistDevices.transfers.join(' | ') || 'None'}
- Context sentences: ${ci.assistDevices.sentences.join(' | ') || 'None'}` : ''}

**OXYGEN USE:**
- Detected: ${ci.oxygenUse.detected ? 'YES' : 'No'}
${ci.oxygenUse.detected ? `- Flow rate: ${ci.oxygenUse.flowRate.join(' | ') || 'Not specified'}
- Delivery method: ${ci.oxygenUse.deliveryMethod.join(' | ') || 'Not specified'}
- Frequency: ${ci.oxygenUse.frequency.join(' | ') || 'Not specified'}
- Saturation readings: ${ci.oxygenUse.saturation.join(' | ') || 'Not documented'}
- Context sentences: ${ci.oxygenUse.sentences.join(' | ') || 'None'}` : ''}

**WOUND PRESENCE:**
- Detected: ${ci.woundPresent.detected ? 'YES' : 'No'}
${ci.woundPresent.detected ? `- Pressure ulcers: ${ci.woundPresent.pressureUlcers.join(' | ') || 'None'}
- Surgical wounds: ${ci.woundPresent.surgicalWounds.join(' | ') || 'None'}
- Venous/stasis ulcers: ${ci.woundPresent.venousUlcers.join(' | ') || 'None'}
- Diabetic wounds: ${ci.woundPresent.diabeticWounds.join(' | ') || 'None'}
- Skin tears: ${ci.woundPresent.skinTears.join(' | ') || 'None'}
- Wound characteristics: ${ci.woundPresent.woundCharacteristics.join(' | ') || 'None'}
- Dressing types: ${ci.woundPresent.dressingTypes.join(' | ') || 'None'}
- Measurements: ${ci.woundPresent.measurements.join(' | ') || 'None'}
- Context sentences: ${ci.woundPresent.sentences.join(' | ') || 'None'}` : ''}

**FALL RISK:**
- Detected: ${ci.fallRisk.detected ? 'YES' : 'No'}
${ci.fallRisk.detected ? `- Fall history: ${ci.fallRisk.history.join(' | ') || 'None documented'}
- Balance issues: ${ci.fallRisk.balanceIssues.join(' | ') || 'None'}
- Gait problems: ${ci.fallRisk.gaitProblems.join(' | ') || 'None'}
- Weakness: ${ci.fallRisk.weakness.join(' | ') || 'None'}
- Dizziness/vertigo: ${ci.fallRisk.dizziness.join(' | ') || 'None'}
- Environmental hazards: ${ci.fallRisk.environmental.join(' | ') || 'None'}
- Context sentences: ${ci.fallRisk.sentences.join(' | ') || 'None'}` : ''}

**PAIN:**
- Detected: ${ci.painMentioned.detected ? 'YES' : 'No'}
${ci.painMentioned.detected ? `- Location: ${ci.painMentioned.location.join(' | ') || 'Not specified'}
- Intensity: ${ci.painMentioned.intensity.join(' | ') || 'Not specified'}
- Quality: ${ci.painMentioned.quality.join(' | ') || 'Not specified'}
- Triggers: ${ci.painMentioned.triggers.join(' | ') || 'Not specified'}
- Management: ${ci.painMentioned.management.join(' | ') || 'Not specified'}
- Context sentences: ${ci.painMentioned.sentences.join(' | ') || 'None'}` : ''}

**COGNITIVE STATUS:**
- Detected: ${ci.cognitiveIssues.detected ? 'YES' : 'No'}
${ci.cognitiveIssues.detected ? `- Orientation: ${ci.cognitiveIssues.orientation.join(' | ') || 'Not documented'}
- Memory issues: ${ci.cognitiveIssues.memoryIssues.join(' | ') || 'None'}
- Diagnoses: ${ci.cognitiveIssues.diagnosis.join(' | ') || 'None'}
- Judgment: ${ci.cognitiveIssues.judgment.join(' | ') || 'Not assessed'}
- Screening scores: ${ci.cognitiveIssues.screening.join(' | ') || 'None'}
- Behaviors: ${ci.cognitiveIssues.behaviors.join(' | ') || 'None'}
- Context sentences: ${ci.cognitiveIssues.sentences.join(' | ') || 'None'}` : ''}

**DIABETIC MANAGEMENT:**
- Detected: ${ci.diabetic.detected ? 'YES' : 'No'}
${ci.diabetic.detected ? `- Type: ${ci.diabetic.type.join(' | ') || 'Not specified'}
- Medications: ${ci.diabetic.medications.join(' | ') || 'None listed'}
- Glucose readings: ${ci.diabetic.glucoseReadings.join(' | ') || 'None'}
- A1C: ${ci.diabetic.a1c.join(' | ') || 'Not documented'}
- Hypoglycemia: ${ci.diabetic.hypoglycemia.join(' | ') || 'None'}
- Complications: ${ci.diabetic.complications.join(' | ') || 'None'}
- Management: ${ci.diabetic.management.join(' | ') || 'Not specified'}
- Context sentences: ${ci.diabetic.sentences.join(' | ') || 'None'}` : ''}

**CARDIAC STATUS:**
- Detected: ${ci.cardiacIssues.detected ? 'YES' : 'No'}
${ci.cardiacIssues.detected ? `- Heart failure: ${ci.cardiacIssues.heartFailure.join(' | ') || 'None'}
- Arrhythmias: ${ci.cardiacIssues.arrhythmias.join(' | ') || 'None'}
- Edema: ${ci.cardiacIssues.edema.join(' | ') || 'None'}
- Dyspnea/SOB: ${ci.cardiacIssues.dyspnea.join(' | ') || 'None'}
- Chest pain: ${ci.cardiacIssues.chestPain.join(' | ') || 'None'}
- Cardiac devices: ${ci.cardiacIssues.devices.join(' | ') || 'None'}
- Context sentences: ${ci.cardiacIssues.sentences.join(' | ') || 'None'}` : ''}

**ASSISTANCE LEVELS:**
- Assistance mentioned: ${ci.assistanceNeeded.detected ? 'YES' : 'No'}
${ci.assistanceNeeded.detected ? `- Levels of assist: ${ci.assistanceNeeded.levelOfAssist.join(' | ') || 'Not specified'}
- Dependencies: ${ci.assistanceNeeded.dependency.join(' | ') || 'None'}` : ''}
- Independence mentioned: ${ci.independentMentioned.detected ? 'YES' : 'No'}
${ci.independentMentioned.detected ? `- Independent activities: ${ci.independentMentioned.activities.join(' | ') || 'None'}` : ''}

=== ADL/IADL FUNCTIONAL PHRASES EXTRACTED ===

**BATHING (M1830, GG0130E):**
- All phrases: ${fp.bathing.allPhrases.join(' | ') || 'None found'}
- Assist levels: ${fp.bathing.assistLevel.join(' | ') || 'Not specified'}
- Equipment: ${fp.bathing.equipment.join(' | ') || 'None'}
- Limitations: ${fp.bathing.limitations.join(' | ') || 'None'}

**DRESSING (M1810/M1820, GG0130F/G):**
- All phrases: ${fp.dressing.allPhrases.join(' | ') || 'None found'}
- Upper body: ${fp.dressing.upperBody.join(' | ') || 'Not specified'}
- Lower body: ${fp.dressing.lowerBody.join(' | ') || 'Not specified'}
- Assist levels: ${fp.dressing.assistLevel.join(' | ') || 'Not specified'}
- Limitations: ${fp.dressing.limitations.join(' | ') || 'None'}

**AMBULATION/MOBILITY (M1860, GG0170):**
- All phrases: ${fp.ambulation.allPhrases.join(' | ') || 'None found'}
- Distance: ${fp.ambulation.distance.join(' | ') || 'Not specified'}
- Devices: ${fp.ambulation.assistDevice.join(' | ') || 'None'}
- Assist levels: ${fp.ambulation.assistLevel.join(' | ') || 'Not specified'}
- Weight bearing: ${fp.ambulation.weightBearing.join(' | ') || 'Not specified'}
- Stairs: ${fp.ambulation.stairs.join(' | ') || 'Not documented'}
- Surfaces: ${fp.ambulation.surfaces.join(' | ') || 'Not specified'}

**TRANSFERS (M1850, GG0170):**
- All phrases: ${fp.transfer.allPhrases.join(' | ') || 'None found'}
- Transfer types: ${fp.transfer.types.join(' | ') || 'Not specified'}
- Assist levels: ${fp.transfer.assistLevel.join(' | ') || 'Not specified'}
- Equipment: ${fp.transfer.equipment.join(' | ') || 'None'}
- Weight bearing: ${fp.transfer.weightBearing.join(' | ') || 'Not specified'}

**TOILETING (M1840, GG0130C, GG0170F):**
- All phrases: ${fp.toileting.allPhrases.join(' | ') || 'None found'}
- Transfers: ${fp.toileting.transfers.join(' | ') || 'Not specified'}
- Hygiene: ${fp.toileting.hygiene.join(' | ') || 'Not specified'}
- Continence: ${fp.toileting.continence.join(' | ') || 'Not assessed'}
- Equipment: ${fp.toileting.equipment.join(' | ') || 'None'}
- Assist levels: ${fp.toileting.assistLevel.join(' | ') || 'Not specified'}

**GROOMING (M1800, GG0130B):**
- All phrases: ${fp.grooming.allPhrases.join(' | ') || 'None found'}
- Oral care: ${fp.grooming.oralCare.join(' | ') || 'Not specified'}
- Hair care: ${fp.grooming.hairCare.join(' | ') || 'Not specified'}
- Shaving: ${fp.grooming.shaving.join(' | ') || 'Not specified'}
- Nail care: ${fp.grooming.nailCare.join(' | ') || 'Not specified'}
- Assist levels: ${fp.grooming.assistLevel.join(' | ') || 'Not specified'}

**EATING (GG0130A):**
- All phrases: ${fp.eating.allPhrases.join(' | ') || 'None found'}
- Self-feeding: ${fp.eating.selfFeeding.join(' | ') || 'Not specified'}
- Assist levels: ${fp.eating.assistLevel.join(' | ') || 'Not specified'}
- Swallowing: ${fp.eating.swallowing.join(' | ') || 'Not assessed'}
- Diet: ${fp.eating.diet.join(' | ') || 'Not specified'}

**MEDICATION MANAGEMENT (M2020, M2030):**
- All phrases: ${fp.medications.allPhrases.join(' | ') || 'None found'}
- Oral meds: ${fp.medications.oralMeds.join(' | ') || 'Not specified'}
- Injectables: ${fp.medications.injectables.join(' | ') || 'Not specified'}
- Management: ${fp.medications.management.join(' | ') || 'Not specified'}
- Compliance: ${fp.medications.compliance.join(' | ') || 'Not assessed'}

VITAL SIGNS:
${Object.keys(vitalSigns).length > 0 ? JSON.stringify(vitalSigns, null, 2) : 'None documented'}

FULL CLINICAL DOCUMENTATION:
${narrativeText || '[No documentation provided]'}

${extractedOasisData ? formatExtractedOasisForPrompt(extractedOasisData) : ''}

---

OASIS-E 2024 REQUIRED ELEMENTS (${visitTypeLabel}):

**SECTION GG: FUNCTIONAL ABILITIES (PDGM CRITICAL - affects payment)**
GG0130: Self-Care
- A. Eating (01-06, 07=refused, 09=NA, 10=not attempted, 88=prior)
- B. Oral hygiene (01-06)
- C. Toileting hygiene (01-06)
- E. Shower/bathe self (01-06)
- F. Upper body dressing (01-06)
- G. Lower body dressing (01-06)
- H. Putting on/taking off footwear (01-06)

GG0170: Mobility
- B. Sit to lying (01-06)
- C. Lying to sitting (01-06)
- D. Sit to stand (01-06)
- E. Chair/bed-to-chair transfer (01-06)
- F. Toilet transfer (01-06)
- I. Walk 10 feet (01-06)
- J. Walk 50 feet with 2 turns (01-06)
- K. Walk 150 feet (01-06)
- L. Walk 10 feet uneven (01-06)
- M. 1 step curb (01-06)
- N. 4 steps (01-06)
- O. 12 steps (01-06)
- P. Picking up object (01-06)
- R. Wheel 50 feet (01-06)
- RR. Wheel 150 feet (01-06)

**GG SCORING SCALE** (use exact codes):
06=Independent, 05=Setup/cleanup, 04=Supervision/touching, 03=Partial/moderate, 02=Substantial/maximal, 01=Dependent

**M1800-M1860 FUNCTIONAL STATUS (Legacy - still required)**
- M1800 Grooming (0-3): 0=Indep, 1=Setup, 2=Assist, 3=Dependent
- M1810 Dress Upper (0-3)
- M1820 Dress Lower (0-3)
- M1830 Bathing (0-6): Higher=more impaired
- M1840 Toilet Transfer (0-4)
- M1850 Transferring (0-5)
- M1860 Ambulation (0-6)

**CLINICAL ITEMS (ICD-10 Required)**
- M1021: Primary Dx (must be valid ICD-10, symptom-level)
- M1023: Secondary Dx (up to 24, affects comorbidity adjustment)
- M1028: Active Dx list
- M1030: Therapy need at SOC/ROC
- M1033: Risk for hospitalization (LACE score factors)

**INTEGUMENTARY (Wound documentation)**
- M1306: Unhealed pressure ulcers (Yes/No)
- M1311: Current number of stage 2-4 PU
- M1322: Stage of most problematic PU
- M1324: Stage 2 PU that was present at SOC/ROC
- M1330: Stasis ulcer present
- M1340: Surgical wound present
- M1342: Surgical wound status

**MEDICATIONS (High-risk drug review)**
- M2001: Drug regimen review conducted
- M2003: Medication follow-up (if issues found)
- M2005: Medication intervention (education provided)
- M2010: Patient receiving HIGH-RISK drugs
- M2020: Management of oral meds
- M2030: Management of injectable meds

---

**${visitTypeLabel} SPECIFIC REQUIREMENTS:**
`;

  prompt += visitTypeRequirements(visitTypeRaw);

  prompt += `

---

**ACCURACY VALIDATION RULES (APPLY RIGOROUSLY):**

FUNCTIONAL SCORING ACCURACY:
1. M1800 Grooming (0-3): 
   - 0=Independently grooms; 1=Grooms with setup only; 2=Someone must assist; 3=Dependent
   - "Needs reminders" = 1 (setup); "Assistance with shaving" = 2; "Unable to groom" = 3
   
2. M1810/M1820 Dressing (0-3):
   - 0=Independent; 1=Setup/retrieval only; 2=Physical assistance needed; 3=Dependent
   - "Difficulty with buttons" = 2; "Cannot reach feet" = 2-3 for lower
   
3. M1830 Bathing (0-6):
   - 0=Independent shower/tub; 1=With devices only; 2=Intermittent assistance; 
   - 3=Assistance throughout; 4=Transferred in/out only; 5=Assistance throughout + transfer; 6=Unable
   - Shower chair use without human help = 1; CNA helps with back = 2-3
   
4. M1840 Toilet Transfer (0-4):
   - 0=Independent; 1=Device only; 2=Human standby; 3=Assistance needed; 4=Unable
   
5. M1850 Transferring (0-5):
   - 0=Independent; 1=Device; 2=Supervision; 3=Assistance; 4=Bears no weight; 5=Bedfast
   
6. M1860 Ambulation (0-6):
   - 0=Independent any surface; 1=Device on all surfaces; 2=Assist on stairs only;
   - 3=Assist on all surfaces; 4=Wheelchair; 5=Bedfast; 6=N/A

=== MANDATORY CROSS-VALIDATION RULES (FLAG ALL VIOLATIONS) ===

**FUNCTIONAL ITEM CROSS-VALIDATION:**
1. M1860 Ambulation ↔ M1850 Transferring:
   - If M1860 ≥ 4 (wheelchair/bedfast), then M1850 must be ≥ 3 (needs assist or bears no weight)
   - If M1850 = 5 (bedfast), then M1860 must = 5 or 6
   - If patient "walks with walker independently" (M1860=1), M1850 should be ≤ 2

2. M1850 Transferring ↔ M1840 Toilet Transfer:
   - M1840 cannot be lower than M1850 (toilet transfer is more demanding)
   - If M1850 = 4-5, M1840 must be ≥ 3

3. M1830 Bathing ↔ M1850 Transferring:
   - If M1830 ≥ 4 (needs transfer assist for bathing), M1850 must be ≥ 2
   - If patient "independent with shower chair" (M1830=1), transfers likely ≤ 2

4. M1800-M1820 Grooming/Dressing ↔ Cognitive Status:
   - If M1700 cognitive ≥ 2 (impaired), grooming/dressing typically ≥ 1
   - "Needs cueing" indicates cognitive issue AND grooming assistance

5. M1860 ↔ M1033 Hospitalization Risk:
   - High fall risk + impaired ambulation = higher hospitalization risk
   - Non-ambulatory patients have inherently higher M1033 risk

**CLINICAL CROSS-VALIDATION:**
6. Oxygen Use ↔ M1400 Dyspnea:
   - If oxygen documented, M1400 MUST show dyspnea level (cannot be 0)
   - Continuous O2 = M1400 should be ≥ 2

7. Wounds ↔ M1306-M1342:
   - ANY wound mention requires complete wound section documentation
   - Pressure ulcer stage must match narrative description
   - "Healed" wounds still need M1340/M1342 documentation

8. High-Risk Medications ↔ M2010:
   - Anticoagulants (warfarin, eliquis, etc.) = M2010 YES
   - Insulin = M2010 YES  
   - Opioids (scheduled) = M2010 YES
   - If ANY high-risk med in narrative, M2010 must be checked

9. Diabetes ↔ Related Items:
   - Diabetic patient with neuropathy should affect M1860 ambulation
   - Diabetic foot ulcer requires wound section completion
   - Insulin use requires M2030 injectable med management

10. Cognitive Diagnosis ↔ M1700-M1740:
    - Dementia/Alzheimer diagnosis requires impaired M1700
    - Memory complaints should align with M1710-M1720
    - BIMS score must match cognitive function rating

**GG ↔ M-ITEM CROSS-VALIDATION:**
11. GG0130 Self-Care ↔ M1800-M1830:
    - GG0130E (shower/bathe) should align with M1830
    - GG0130F/G (dressing) should align with M1810/M1820
    - Scores cannot contradict (e.g., GG=06 independent but M1830=4)

12. GG0170 Mobility ↔ M1850/M1860:
    - GG0170E (bed-chair transfer) aligns with M1850
    - GG0170I-K (walking distances) align with M1860
    - GG0170F (toilet transfer) aligns with M1840

PDGM FUNCTIONAL POINTS CALCULATION:
- M1800 + M1810 + M1820 + M1830 + M1840 + M1850 + M1860 = Total Points
- Low: 0-5 points (lowest reimbursement)
- Medium: 6-11 points
- High: 12+ points (highest reimbursement)
- Each point increase can add $50-150 to episode payment

UPLOADED OASIS VALIDATION (if OASIS data was uploaded):
- Compare uploaded OASIS scores against clinical narrative for consistency
- Flag any M-item scores that DON'T match the narrative description
- Identify GG scores that conflict with M1800-M1860 scores
- Check if diagnosis codes support the documented functional limitations
- Validate that discharge goals are realistic based on current status

=== ANALYSIS CATEGORIES ===

Analyze for these 7 categories:
1. MISSING required items - Be specific about M-number and visit type requirement
2. INCONSISTENCIES - Quote exact conflicting phrases from documentation AND compare against uploaded OASIS if available
3. CROSS-VALIDATION FAILURES - Identify specific rule violations from the list above
4. UNDERSCORING - Where documentation CLEARLY supports higher impairment; include CMS scoring reference
5. OVERSCORING - Where claimed scores exceed narrative support; include audit vulnerability and recommended adjustment
6. VAGUE DOCUMENTATION - Items where language is not specific enough for defensible scoring; provide improved language examples
7. OASIS-NARRATIVE MISMATCHES - Where uploaded OASIS scores don't align with clinical narrative

Return JSON:

{
  "overall_score": 0-100,
  "completeness_percentage": 0-100,
  "ready_for_submission": true|false,
  "reimbursement_risk_level": "low|medium|high|critical",
  "documentation_quality": {
    "specificity_score": 0-100,
    "defensibility_score": 0-100,
    "key_weaknesses": ["list of documentation gaps that reduce defensibility"]
  },
  "pdgm_analysis": {
            "clinical_group": "${clinicalGroupAnalysis.group} - ${clinicalGroupAnalysis.name}",
            "clinical_group_confidence": "${clinicalGroupAnalysis.confidence}",
            "clinical_group_rationale": "explanation of why this clinical group was assigned based on primary diagnosis",
            "primary_dx_icd10_suggested": "ICD-10 code that best matches the primary diagnosis for this clinical group",
            "alternative_clinical_groups": ["list other possible clinical groups if diagnosis is ambiguous"],
            "functional_level": "low|medium|high",
            "functional_points_calculated": "exact number 0-30",
            "functional_points_breakdown": {
              "m1800": "0-3",
              "m1810": "0-3", 
              "m1820": "0-3",
              "m1830": "0-6",
              "m1840": "0-4",
              "m1850": "0-5",
              "m1860": "0-6"
            },
            "comorbidity_adjustment": "${comorbidityAnalysis.adjustment}",
            "comorbidity_count": ${comorbidityAnalysis.count},
            "qualifying_comorbidities": {
              "high_impact": [${comorbidityAnalysis.high.map(c => `"${c.name}"`).join(', ')}],
              "low_impact": [${comorbidityAnalysis.low.map(c => `"${c.name}"`).join(', ')}],
              "missing_documentation": ["list comorbidities mentioned but not properly coded"],
              "potential_additions": ["list conditions in narrative that could qualify if properly documented"]
            },
            "estimated_case_mix_weight": "X.XXXX",
            "case_mix_weight_breakdown": {
              "clinical_component": "X.XX",
              "functional_component": "X.XX", 
              "comorbidity_component": "X.XX"
            },
            "optimization_potential": "$XXX-$XXX per episode",
            "optimization_strategies": ["specific actions to improve case-mix weight"],
            "calculation_notes": "detailed explanation of PDGM calculation methodology"
          },
  "functional_score_analysis": {
    "m1800_grooming": {
      "documented_value": "0-3 or null if not documented",
      "supported_by": "exact quote from documentation",
      "accuracy": "accurate|underscored|overscored|insufficient_documentation",
      "recommended_value": "what score the documentation actually supports",
      "scoring_rationale": "why this score based on CMS definitions"
    },
    "m1810_dress_upper": {
      "documented_value": "0-3 or null",
      "supported_by": "exact quote",
      "accuracy": "accurate|underscored|overscored|insufficient_documentation",
      "recommended_value": "supported score",
      "scoring_rationale": "rationale"
    },
    "m1820_dress_lower": {
      "documented_value": "0-3 or null",
      "supported_by": "exact quote",
      "accuracy": "accurate|underscored|overscored|insufficient_documentation",
      "recommended_value": "supported score",
      "scoring_rationale": "rationale"
    },
    "m1830_bathing": {
      "documented_value": "0-6 or null",
      "supported_by": "exact quote",
      "accuracy": "accurate|underscored|overscored|insufficient_documentation",
      "recommended_value": "supported score",
      "scoring_rationale": "rationale"
    },
    "m1840_toilet_transfer": {
      "documented_value": "0-4 or null",
      "supported_by": "exact quote",
      "accuracy": "accurate|underscored|overscored|insufficient_documentation",
      "recommended_value": "supported score",
      "scoring_rationale": "rationale"
    },
    "m1850_transferring": {
      "documented_value": "0-5 or null",
      "supported_by": "exact quote",
      "accuracy": "accurate|underscored|overscored|insufficient_documentation",
      "recommended_value": "supported score",
      "scoring_rationale": "rationale"
    },
    "m1860_ambulation": {
      "documented_value": "0-6 or null",
      "supported_by": "exact quote",
      "accuracy": "accurate|underscored|overscored|insufficient_documentation",
      "recommended_value": "supported score",
      "scoring_rationale": "rationale"
    },
    "total_functional_points": "calculated sum 0-30",
    "functional_level_result": "low|medium|high",
    "cross_validation_issues": ["any logical inconsistencies between functional items"]
  },
  "critical_missing": [
    {
      "oasis_item": "M-number: Full Name",
      "category": "Functional|Clinical|Medications|Wounds|GG|Cognitive|Safety",
      "pdgm_impact": "Specific impact: Affects clinical group|functional level|comorbidity adjustment",
      "why_critical": "CMS requirement citation and audit risk",
      "documentation_guidance": "Exact language and elements needed",
      "example": "Patient requires moderate assistance (1 person) for shower transfers due to lower extremity weakness (R/T CVA residual) and balance impairment. Uses shower chair and grab bars.",
      "reimbursement_impact": "high|medium|low",
      "estimated_revenue_impact": "$XXX per episode"
    }
  ],
  "cross_validation_failures": [
    {
      "rule_violated": "specific cross-validation rule number and name from list",
      "items_involved": ["M-numbers involved in the conflict"],
      "current_values": "current documented/implied values for each item",
      "expected_relationship": "what the relationship should be per CMS guidelines",
      "narrative_evidence": "exact quotes showing the conflict",
      "resolution": "specific fix - either adjust scores or add documentation",
      "pdgm_impact": "how this affects functional level/reimbursement",
      "audit_risk": "high|medium|low"
    }
  ],
  "underscoring_opportunities": [
    {
      "oasis_item": "M-number: Full Name",
      "current_implied_score": "what current documentation suggests (numeric)",
      "supported_score": "higher value supported by narrative (numeric)",
      "score_difference": "+X points",
      "narrative_evidence": "EXACT QUOTE from documentation that supports higher score",
      "cms_scoring_definition": "CMS OASIS-E 2024 definition for the supported score level",
      "cms_reference": "Specific CMS guidance manual chapter/section",
      "why_higher_score_applies": "detailed explanation matching narrative to CMS definition",
      "revenue_impact": "$XXX-XXX per episode difference",
      "functional_level_change": "whether this changes low→medium or medium→high",
      "documentation_enhancement": "specific wording to add to strengthen the score justification",
      "example_compliant_language": "model documentation that fully supports the higher score"
    }
  ],
  "overscoring_risks": [
    {
      "oasis_item": "M-number: Full Name",
      "claimed_score": "implied/documented value (numeric)",
      "supported_score": "lower value actually supported by evidence (numeric)",
      "score_difference": "-X points",
      "narrative_evidence": "EXACT QUOTE that contradicts higher score",
      "cms_scoring_definition": "CMS definition showing why lower score applies",
      "audit_vulnerability": {
        "type": "ADR|TPE|SMRC|RAC",
        "specific_risk": "detailed description of what auditors would flag",
        "potential_recoupment": "$XXX estimated if audited",
        "documentation_that_contradicts": "specific phrases auditors would cite"
      },
      "audit_risk": "high|medium",
      "recommended_action": "EITHER add documentation: [specific text] OR adjust score to X",
      "if_keeping_score": "documentation needed to defend current score",
      "if_lowering_score": "how to properly document the lower functional level"
    }
  ],
  "inconsistencies": [
    {
      "issue": "Clear description of conflict",
      "inconsistency_type": "internal_narrative|narrative_vs_oasis|cross_item|diagnosis_vs_function",
      "location_1": "exact quote 1 with context",
      "location_2": "exact quote 2 that conflicts",
      "oasis_items_affected": ["M-numbers affected"],
      "why_problematic": "specific audit/compliance concern",
      "resolution": "specific documentation change to resolve",
      "audit_risk": "high|medium|low"
    }
  ],
  "vague_documentation": [
    {
      "oasis_item": "M-number: Full Name",
      "current_language": "exact vague phrase from documentation",
      "problem": "why this is not defensible - what's missing",
      "cms_requirement": "what CMS requires for defensible scoring",
      "defensibility_issue": "how an auditor would challenge this",
      "score_range_ambiguity": "which scores this vague language could support (e.g., could be 1, 2, or 3)",
      "improved_language": "specific wording that would be defensible",
      "key_elements_to_add": ["list of specific elements missing"],
      "example_for_score_X": "if intending score X, document: [specific text]",
      "example_for_score_Y": "if intending score Y, document: [specific text]"
    }
  ],
  "compliant_items": [
    {
      "oasis_item": "M-number: Name",
      "category": "category",
      "evidence": "exact supporting quote",
      "score_supported": "specific score this documentation supports"
    }
  ],
  "recommendations": ["Top 5-7 actionable items ranked by revenue impact with specific actions"],
  "quality_measures_impact": ["Specific HH-CAHPS and HHQI measures affected with explanation"],
  "audit_defense_summary": {
    "strongest_documentation": ["well-documented areas"],
    "weakest_documentation": ["areas most vulnerable to audit"],
    "recommended_priority_fixes": ["top 3 items to fix before submission"]
  },
  "oasis_narrative_mismatches": [
    {
      "oasis_item": "M-number",
      "uploaded_score": "score from uploaded OASIS",
      "narrative_suggests": "what the narrative documentation actually supports",
      "discrepancy": "explanation of the mismatch",
      "recommendation": "specific action to resolve",
      "audit_risk": "high|medium|low"
    }
  ],
  "gg_section_analysis": {
    "gg0130_self_care_summary": "overview of self-care scores and any issues",
    "gg0170_mobility_summary": "overview of mobility scores and any issues",
    "goal_appropriateness": "whether DC goals are realistic",
    "functional_improvement_potential": "assessment of improvement potential"
  }
}`;

  return prompt;
}

// Response schema for the scrubber LLM call (extracted verbatim).
export const oasisScrubberResponseSchema = {
  type: "object",
  properties: {
    overall_score: { type: "number" },
    completeness_percentage: { type: "number" },
    ready_for_submission: { type: "boolean" },
    reimbursement_risk_level: { type: "string" },
    pdgm_analysis: {
      type: "object",
      properties: {
        clinical_group: { type: "string" },
        functional_level: { type: "string" },
        comorbidity_adjustment: { type: "string" },
        estimated_case_mix_weight: { type: "string" },
        optimization_potential: { type: "string" }
      }
    },
    documentation_quality: {
      type: "object",
      properties: {
        specificity_score: { type: "number" },
        defensibility_score: { type: "number" },
        key_weaknesses: { type: "array", items: { type: "string" } }
      }
    },
    functional_score_analysis: {
      type: "object",
      properties: {
        m1800_grooming: { type: "object" },
        m1810_dress_upper: { type: "object" },
        m1820_dress_lower: { type: "object" },
        m1830_bathing: { type: "object" },
        m1840_toilet_transfer: { type: "object" },
        m1850_transferring: { type: "object" },
        m1860_ambulation: { type: "object" },
        total_functional_points: { type: "number" },
        functional_level_result: { type: "string" },
        cross_validation_issues: { type: "array", items: { type: "string" } }
      }
    },
    critical_missing: {
      type: "array",
      items: {
        type: "object",
        properties: {
          oasis_item: { type: "string" },
          category: { type: "string" },
          pdgm_impact: { type: "string" },
          why_critical: { type: "string" },
          documentation_guidance: { type: "string" },
          example: { type: "string" },
          reimbursement_impact: { type: "string" },
          estimated_revenue_impact: { type: "string" }
        }
      }
    },
    cross_validation_failures: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rule_violated: { type: "string" },
          items_involved: { type: "array", items: { type: "string" } },
          current_values: { type: "string" },
          expected_relationship: { type: "string" },
          narrative_evidence: { type: "string" },
          resolution: { type: "string" },
          pdgm_impact: { type: "string" },
          audit_risk: { type: "string" }
        }
      }
    },
    underscoring_opportunities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          oasis_item: { type: "string" },
          current_implied_score: { type: "string" },
          supported_score: { type: "string" },
          score_difference: { type: "string" },
          narrative_evidence: { type: "string" },
          cms_scoring_definition: { type: "string" },
          cms_reference: { type: "string" },
          why_higher_score_applies: { type: "string" },
          revenue_impact: { type: "string" },
          functional_level_change: { type: "string" },
          documentation_enhancement: { type: "string" },
          example_compliant_language: { type: "string" }
        }
      }
    },
    overscoring_risks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          oasis_item: { type: "string" },
          claimed_score: { type: "string" },
          supported_score: { type: "string" },
          score_difference: { type: "string" },
          narrative_evidence: { type: "string" },
          cms_scoring_definition: { type: "string" },
          audit_vulnerability: { type: "object" },
          audit_risk: { type: "string" },
          recommended_action: { type: "string" },
          if_keeping_score: { type: "string" },
          if_lowering_score: { type: "string" }
        }
      }
    },
    inconsistencies: {
      type: "array",
      items: {
        type: "object",
        properties: {
          issue: { type: "string" },
          inconsistency_type: { type: "string" },
          location_1: { type: "string" },
          location_2: { type: "string" },
          oasis_items_affected: { type: "array", items: { type: "string" } },
          why_problematic: { type: "string" },
          resolution: { type: "string" },
          audit_risk: { type: "string" }
        }
      }
    },
    vague_documentation: {
      type: "array",
      items: {
        type: "object",
        properties: {
          oasis_item: { type: "string" },
          current_language: { type: "string" },
          problem: { type: "string" },
          cms_requirement: { type: "string" },
          defensibility_issue: { type: "string" },
          score_range_ambiguity: { type: "string" },
          improved_language: { type: "string" },
          key_elements_to_add: { type: "array", items: { type: "string" } },
          example_for_higher_score: { type: "string" },
          example_for_lower_score: { type: "string" }
        }
      }
    },
    compliant_items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          oasis_item: { type: "string" },
          category: { type: "string" },
          evidence: { type: "string" },
          score_supported: { type: "string" }
        }
      }
    },
    recommendations: { type: "array", items: { type: "string" } },
    quality_measures_impact: { type: "array", items: { type: "string" } },
    audit_defense_summary: {
      type: "object",
      properties: {
        strongest_documentation: { type: "array", items: { type: "string" } },
        weakest_documentation: { type: "array", items: { type: "string" } },
        recommended_priority_fixes: { type: "array", items: { type: "string" } }
      }
    },
    oasis_narrative_mismatches: {
      type: "array",
      items: {
        type: "object",
        properties: {
          oasis_item: { type: "string" },
          uploaded_score: { type: "string" },
          narrative_suggests: { type: "string" },
          discrepancy: { type: "string" },
          recommendation: { type: "string" },
          audit_risk: { type: "string" }
        }
      }
    },
    gg_section_analysis: {
      type: "object",
      properties: {
        gg0130_self_care_summary: { type: "string" },
        gg0170_mobility_summary: { type: "string" },
        goal_appropriateness: { type: "string" },
        functional_improvement_potential: { type: "string" }
      }
    }
  }
};