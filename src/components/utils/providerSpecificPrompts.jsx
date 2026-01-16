/**
 * Provider-specific prompt templates and context builders
 */

export const PROVIDER_SPECIFIC_CONTEXT = {
  RN: {
    focusAreas: ['patient assessment', 'vital signs', 'nursing interventions', 'discharge planning', 'compliance documentation'],
    complianceEmphasis: 'Medicare Home Health Standards',
    documentationStyle: 'comprehensive nursing assessment',
    noteStructure: 'SOAP or narrative',
    suggestedCareElements: ['skilled nursing need', 'patient education', 'medication management', 'wound care', 'symptom monitoring']
  },
  LPN: {
    focusAreas: ['basic patient assessment', 'vital signs', 'supervised care delivery', 'patient comfort'],
    complianceEmphasis: 'LPN scope of practice boundaries',
    documentationStyle: 'focused patient observations',
    noteStructure: 'narrative',
    suggestedCareElements: ['vital sign changes', 'patient comfort measures', 'supervised procedures']
  },
  NP: {
    focusAreas: ['comprehensive assessment', 'diagnosis', 'treatment plans', 'medication management', 'patient education'],
    complianceEmphasis: 'NP prescribing authority and clinical decision-making',
    documentationStyle: 'detailed clinical assessment with clinical reasoning',
    noteStructure: 'SOAP with explicit assessment and plan',
    suggestedCareElements: ['differential diagnosis', 'clinical decision-making', 'medication adjustments', 'referrals']
  },
  Physician: {
    focusAreas: ['diagnosis', 'treatment decisions', 'medical management', 'complex case coordination'],
    complianceEmphasis: 'Physician medical decision-making and liability',
    documentationStyle: 'clinical assessment with diagnostic reasoning',
    noteStructure: 'SOAP format',
    suggestedCareElements: ['diagnostic reasoning', 'medical decisions', 'medication management', 'specialist coordination']
  },
  PT: {
    focusAreas: ['physical assessment', 'mobility', 'functional capacity', 'therapy outcomes', 'fall risk'],
    complianceEmphasis: 'Rehabilitation and Medicare skilled PT requirements',
    documentationStyle: 'functional assessment and therapy progress',
    noteStructure: 'therapy note format',
    suggestedCareElements: ['range of motion', 'functional mobility', 'therapeutic exercises', 'progress toward goals']
  },
  OT: {
    focusAreas: ['occupational performance', 'ADL function', 'adaptive strategies', 'home modifications'],
    complianceEmphasis: 'Occupational therapy standards and skilled care',
    documentationStyle: 'functional and occupational assessment',
    noteStructure: 'therapy note format',
    suggestedCareElements: ['ADL independence', 'functional capacity', 'adaptive equipment', 'home safety']
  },
  ST: {
    focusAreas: ['speech/language function', 'swallowing', 'communication', 'cognitive status'],
    complianceEmphasis: 'Speech-language pathology standards',
    documentationStyle: 'communication and swallowing assessment',
    noteStructure: 'therapy note format',
    suggestedCareElements: ['speech clarity', 'swallowing function', 'communication strategies', 'cognitive status']
  },
  MSW: {
    focusAreas: ['psychosocial assessment', 'social determinants', 'discharge planning', 'resource coordination'],
    complianceEmphasis: 'Psychosocial and discharge planning standards',
    documentationStyle: 'psychosocial assessment and care coordination',
    noteStructure: 'assessment and plan format',
    suggestedCareElements: ['social situation', 'mental health status', 'family dynamics', 'discharge barriers']
  },
  Chiropractor: {
    focusAreas: ['spinal assessment', 'musculoskeletal function', 'treatment response', 'pain management'],
    complianceEmphasis: 'Chiropractic care standards',
    documentationStyle: 'structural and functional assessment',
    noteStructure: 'clinical note format',
    suggestedCareElements: ['spinal alignment', 'pain levels', 'functional improvement', 'treatment response']
  }
};

export const CARE_LOCATION_CONTEXT = {
  home_health: {
    complianceEmphasis: 'Medicare Home Health Conditions of Participation',
    suggestedElements: ['homebound status', 'caregiver support', 'home safety', 'discharge planning'],
    relevantNotifications: ['compliance', 'discharge_planning', 'caregiver_issues']
  },
  hospice: {
    complianceEmphasis: 'Hospice comfort and symptom management',
    suggestedElements: ['symptom control', 'family support', 'goals of care', 'spiritual needs'],
    relevantNotifications: ['comfort_measures', 'family_needs', 'goal_alignment']
  },
  hospital: {
    complianceEmphasis: 'Hospital inpatient standards',
    suggestedElements: ['hospital course', 'discharge planning', 'specialist coordination'],
    relevantNotifications: ['coordination', 'discharge_planning', 'lab_results']
  },
  clinic: {
    complianceEmphasis: 'Outpatient clinical standards',
    suggestedElements: ['outpatient plan', 'follow-up appointments', 'medication refills'],
    relevantNotifications: ['follow_up', 'medication_management', 'appointment_reminders']
  },
  rehab: {
    complianceEmphasis: 'Rehabilitation and functional recovery standards',
    suggestedElements: ['functional goals', 'therapy progress', 'discharge plans'],
    relevantNotifications: ['therapy_progress', 'functional_goals', 'discharge_planning']
  },
  ltc: {
    complianceEmphasis: 'Long-term care and skilled nursing facility standards',
    suggestedElements: ['care plan updates', 'quality of life', 'family communication'],
    relevantNotifications: ['care_plan_updates', 'family_communication', 'resident_safety']
  }
};

/**
 * Get AI prompt additions for provider type
 */
export const getProviderSpecificPromptAdditions = (providerType) => {
  const context = PROVIDER_SPECIFIC_CONTEXT[providerType] || PROVIDER_SPECIFIC_CONTEXT.RN;
  
  return `
PROVIDER-SPECIFIC CONTEXT:
Provider Type: ${providerType}
Focus Areas: ${context.focusAreas.join(', ')}
Documentation Style: ${context.documentationStyle}
Expected Note Structure: ${context.noteStructure}
Compliance Standard: ${context.complianceEmphasis}

When generating suggestions, prioritize these care plan elements for ${providerType}:
${context.suggestedCareElements.map(elem => `- ${elem}`).join('\n')}

Apply this provider's scope of practice and standards throughout the documentation.`;
};

/**
 * Get care location specific prompt additions
 */
export const getCareLocationPromptAdditions = (serviceType) => {
  const context = CARE_LOCATION_CONTEXT[serviceType];
  
  if (!context) return '';
  
  return `
CARE LOCATION CONTEXT:
Service Type: ${serviceType}
Compliance Focus: ${context.complianceEmphasis}

Ensure documentation includes these location-specific elements:
${context.suggestedElements.map(elem => `- ${elem}`).join('\n')}`;
};

/**
 * Get relevant compliance checks for provider and location
 */
export const getRelevantComplianceChecks = (providerType, serviceType) => {
  const checks = ['basic_documentation', 'timeliness'];
  
  // Add provider-specific checks
  if (['RN', 'LPN', 'NP'].includes(providerType)) {
    checks.push('medicare_home_health');
  }
  
  if (['NP', 'Physician'].includes(providerType)) {
    checks.push('medical_decision_making', 'prescribing_authority');
  }
  
  if (['PT', 'OT', 'ST'].includes(providerType)) {
    checks.push('therapy_skilled_need', 'functional_progress');
  }
  
  if (providerType === 'MSW') {
    checks.push('psychosocial_assessment', 'care_coordination');
  }
  
  // Add location-specific checks
  if (serviceType === 'home_health') {
    checks.push('homebound_status', 'caregiver_support');
  }
  
  if (serviceType === 'hospice') {
    checks.push('comfort_focused_care', 'family_involvement');
  }
  
  return checks;
};

/**
 * Get task types relevant for provider
 */
export const getRelevantTaskTypes = (providerType) => {
  const taskTypes = {
    RN: ['care_coordination', 'patient_education', 'medication_management', 'visit_scheduling', 'discharge_planning'],
    LPN: ['vital_monitoring', 'patient_care', 'visit_scheduling'],
    NP: ['medication_adjustment', 'specialist_referral', 'patient_education', 'diagnosis_follow_up'],
    Physician: ['medical_decision', 'prescription', 'specialist_coordination', 'diagnosis_review'],
    PT: ['therapy_scheduling', 'exercise_progression', 'functional_goal_update'],
    OT: ['functional_assessment', 'home_modification', 'adaptive_equipment'],
    ST: ['swallowing_assessment', 'communication_therapy'],
    MSW: ['discharge_planning', 'resource_coordination', 'family_meeting'],
    Chiropractor: ['treatment_scheduling', 'pain_monitoring', 'follow_up_care']
  };
  
  return taskTypes[providerType] || taskTypes.RN;
};