/**
 * Diagnosis-to-Checklist Mapping
 * Maps primary diagnoses to specific nursing assessment checklists
 */

export const DIAGNOSIS_CHECKLIST_MAP = {
  // Wound Care
  'pressure_ulcer': {
    category: 'Wound Care',
    items: [
      { id: 'wound_location', label: 'Document wound location and stage', required: true },
      { id: 'wound_measure', label: 'Measure wound dimensions (L×W×D)', required: true },
      { id: 'wound_appearance', label: 'Assess wound bed appearance and color', required: true },
      { id: 'wound_drainage', label: 'Evaluate drainage type and amount', required: true },
      { id: 'wound_odor', label: 'Note any odor present', required: false },
      { id: 'wound_pain', label: 'Assess pain level during wound care', required: true },
      { id: 'wound_dressing', label: 'Apply appropriate dressing per care plan', required: true },
      { id: 'wound_documentation', label: 'Document dressing change in notes', required: true }
    ]
  },
  'diabetic_foot_ulcer': {
    category: 'Wound Care',
    items: [
      { id: 'ulcer_location', label: 'Identify ulcer location on foot', required: true },
      { id: 'ulcer_depth', label: 'Assess ulcer depth and tunneling', required: true },
      { id: 'foot_circulation', label: 'Check foot pulses bilaterally', required: true },
      { id: 'foot_sensation', label: 'Perform monofilament testing for sensation', required: true },
      { id: 'foot_appearance', label: 'Inspect for redness, swelling, warmth', required: true },
      { id: 'foot_hygiene', label: 'Provide foot hygiene education', required: true },
      { id: 'footwear_assessment', label: 'Assess footwear appropriateness', required: true },
      { id: 'glucose_check', label: 'Monitor blood glucose level', required: true }
    ]
  },
  'surgical_wound': {
    category: 'Wound Care',
    items: [
      { id: 'incision_integrity', label: 'Assess incision line integrity', required: true },
      { id: 'incision_redness', label: 'Check for erythema or induration', required: true },
      { id: 'staple_removal', label: 'Check if sutures/staples intact or ready for removal', required: true },
      { id: 'wound_separation', label: 'Assess for dehiscence or separation', required: true },
      { id: 'seroma_check', label: 'Palpate for fluid collection (seroma)', required: false },
      { id: 'drain_check', label: 'Assess any drainage tubes and output', required: false },
      { id: 'dressing_change', label: 'Change dressing per protocol', required: true },
      { id: 'pain_management', label: 'Assess and manage post-operative pain', required: true }
    ]
  },

  // Cardiac Conditions
  'chf': {
    category: 'Cardiac Assessment',
    items: [
      { id: 'weight_check', label: 'Weigh patient and compare to baseline', required: true },
      { id: 'weight_gain', label: 'Note any sudden weight gain (>2-3 lbs/day)', required: true },
      { id: 'fluid_intake', label: 'Review fluid intake and encourage restriction', required: true },
      { id: 'edema_assess', label: 'Assess for peripheral edema (scale 0-4+)', required: true },
      { id: 'lung_sounds', label: 'Auscultate lungs for crackles/rales', required: true },
      { id: 'jvd_check', label: 'Check jugular venous distention', required: true },
      { id: 'orthopnea', label: 'Assess for orthopnea and dyspnea on exertion', required: true },
      { id: 'heart_rate', label: 'Monitor heart rate and rhythm', required: true },
      { id: 'bp_check', label: 'Monitor blood pressure', required: true },
      { id: 'med_adherence', label: 'Verify medication adherence', required: true }
    ]
  },
  'hypertension': {
    category: 'Cardiovascular Monitoring',
    items: [
      { id: 'bp_bilateral', label: 'Take blood pressure in both arms', required: true },
      { id: 'bp_position', label: 'Measure BP sitting, standing, and lying down', required: true },
      { id: 'heart_rate', label: 'Assess heart rate and rhythm', required: true },
      { id: 'pulse_check', label: 'Palpate peripheral pulses', required: true },
      { id: 'med_review', label: 'Review current antihypertensive medications', required: true },
      { id: 'salt_diet', label: 'Reinforce low-sodium diet education', required: true },
      { id: 'exercise', label: 'Discuss appropriate exercise', required: true },
      { id: 'stress_mgmt', label: 'Discuss stress management techniques', required: true }
    ]
  },
  'post_mi': {
    category: 'Post-MI Care',
    items: [
      { id: 'chest_pain', label: 'Assess for chest pain or anginal symptoms', required: true },
      { id: 'sob_assess', label: 'Evaluate shortness of breath', required: true },
      { id: 'vitals_monitor', label: 'Monitor vital signs including O2 sat', required: true },
      { id: 'activity_tolerance', label: 'Assess activity tolerance progression', required: true },
      { id: 'ekg_available', label: 'Review current EKG if available', required: false },
      { id: 'cardiac_meds', label: 'Verify cardiac medication compliance', required: true },
      { id: 'dietary_review', label: 'Review heart-healthy diet', required: true },
      { id: 'cardiac_rehab', label: 'Discuss cardiac rehabilitation program', required: true }
    ]
  },

  // Respiratory
  'copd': {
    category: 'Respiratory Assessment',
    items: [
      { id: 'breath_sounds', label: 'Auscultate lungs for wheezes/diminished sounds', required: true },
      { id: 'sputum_assess', label: 'Assess sputum color, consistency, amount', required: true },
      { id: 'breathing_pattern', label: 'Observe breathing pattern and rate', required: true },
      { id: 'use_of_accessory', label: 'Assess use of accessory muscles', required: true },
      { id: 'o2_sat', label: 'Monitor oxygen saturation', required: true },
      { id: 'inhaler_technique', label: 'Verify proper inhaler technique', required: true },
      { id: 'med_adherence', label: 'Review medication compliance', required: true },
      { id: 'activity_dyspnea', label: 'Assess dyspnea with activities', required: true }
    ]
  },
  'pneumonia': {
    category: 'Infection/Respiratory',
    items: [
      { id: 'fever_check', label: 'Monitor temperature and fever pattern', required: true },
      { id: 'cough_assess', label: 'Assess cough characteristics and productivity', required: true },
      { id: 'lung_auscultation', label: 'Auscultate lungs for consolidation', required: true },
      { id: 'o2_sat', label: 'Check oxygen saturation', required: true },
      { id: 'antibiotic_verify', label: 'Verify antibiotic administration', required: true },
      { id: 'fluid_intake', label: 'Encourage fluid intake', required: true },
      { id: 'cough_hygiene', label: 'Reinforce cough hygiene and isolation precautions', required: true },
      { id: 'shortness_breath', label: 'Assess for increasing shortness of breath', required: true }
    ]
  },

  // Neurological
  'stroke': {
    category: 'Neurological Assessment',
    items: [
      { id: 'mental_status', label: 'Assess mental status and orientation', required: true },
      { id: 'speech', label: 'Evaluate speech clarity and comprehension', required: true },
      { id: 'motor_strength', label: 'Check motor strength bilaterally (0-5 scale)', required: true },
      { id: 'sensory_response', label: 'Assess sensory response', required: true },
      { id: 'pupil_response', label: 'Check pupil size and reactivity', required: true },
      { id: 'vision_fields', label: 'Assess visual fields', required: true },
      { id: 'gait_balance', label: 'Observe gait and balance', required: true },
      { id: 'swallow_screen', label: 'Perform swallow screen before eating', required: true },
      { id: 'falls_prevention', label: 'Implement falls prevention measures', required: true }
    ]
  },
  'diabetes': {
    category: 'Endocrine Assessment',
    items: [
      { id: 'glucose_check', label: 'Monitor blood glucose level', required: true },
      { id: 'glucose_trend', label: 'Review glucose trends if available', required: true },
      { id: 'hyperglycemia_signs', label: 'Assess for signs of hyperglycemia', required: false },
      { id: 'hypoglycemia_signs', label: 'Assess for signs of hypoglycemia', required: false },
      { id: 'injection_site', label: 'Inspect insulin injection sites for lipohypertrophy', required: false },
      { id: 'foot_check', label: 'Perform comprehensive foot inspection', required: true },
      { id: 'medication_adherence', label: 'Verify medication/insulin compliance', required: true },
      { id: 'diet_education', label: 'Reinforce diabetic diet education', required: true },
      { id: 'exercise_plan', label: 'Discuss exercise and activity level', required: true }
    ]
  }
};

/**
 * Get checklist items for a primary diagnosis
 * Falls back to a generic assessment if diagnosis not found
 */
export function getChecklistForDiagnosis(primaryDiagnosis) {
  if (!primaryDiagnosis) return getGenericChecklist();

  const diagnosisKey = primaryDiagnosis
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');

  return DIAGNOSIS_CHECKLIST_MAP[diagnosisKey] || getGenericChecklist();
}

/**
 * Generic assessment checklist for when diagnosis not specifically mapped
 */
function getGenericChecklist() {
  return {
    category: 'General Assessment',
    items: [
      { id: 'vital_signs', label: 'Obtain and document vital signs', required: true },
      { id: 'general_appearance', label: 'Assess general appearance and comfort level', required: true },
      { id: 'skin_integrity', label: 'Inspect skin for integrity and changes', required: true },
      { id: 'mental_status', label: 'Evaluate mental status and cognition', required: true },
      { id: 'pain_assessment', label: 'Assess pain level and management', required: true },
      { id: 'mobility', label: 'Assess mobility and safety', required: true },
      { id: 'medication_review', label: 'Review and verify medications', required: true },
      { id: 'patient_goals', label: 'Discuss patient goals and concerns', required: true }
    ]
  };
}

/**
 * Get all diagnosis options for selection
 */
export function getAllDiagnoses() {
  return Object.keys(DIAGNOSIS_CHECKLIST_MAP).map(key => ({
    value: key,
    label: DIAGNOSIS_CHECKLIST_MAP[key].category
  }));
}