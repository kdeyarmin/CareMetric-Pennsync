/**
 * Maps provider types to available visit types and their requirements
 */

export const PROVIDER_VISIT_TYPES = {
  RN: {
    label: "Registered Nurse",
    visitTypes: [
      { id: 'admission', label: 'Admission', description: 'Initial comprehensive assessment' },
      { id: 'routine_visit', label: 'Routine Visit', description: 'Regular skilled nursing visit' },
      { id: 'recertification', label: 'Recertification', description: '60-day recertification assessment' },
      { id: 'discharge', label: 'Discharge', description: 'Final visit and discharge summary' },
      { id: 'prn', label: 'PRN Visit', description: 'Urgent/as-needed visit' }
    ],
    requiresAssessment: true,
    requiresCarePlanReview: true,
    canEstablishCarePlan: true,
    canOversee: true
  },

  LPN: {
    label: "Licensed Practical Nurse",
    visitTypes: [
      { id: 'routine_visit', label: 'Routine Visit', description: 'Skilled nursing intervention visit' },
      { id: 'prn', label: 'PRN Visit', description: 'Urgent/as-needed visit' }
    ],
    requiresAssessment: false,
    requiresCarePlanReview: true,
    canEstablishCarePlan: false,
    canOversee: false,
    noteRequirements: [
      'Care plan implementation documented',
      'Interventions performed',
      'Patient response',
      'Reporting to RN supervisor'
    ]
  },

  NP: {
    label: "Nurse Practitioner",
    visitTypes: [
      { id: 'admission', label: 'Admission Evaluation', description: 'Initial evaluation and assessment' },
      { id: 'routine_visit', label: 'Follow-up Visit', description: 'Clinical follow-up' },
      { id: 'discharge', label: 'Discharge', description: 'Final evaluation and discharge' },
      { id: 'prn', label: 'Urgent Visit', description: 'Urgent evaluation' }
    ],
    requiresAssessment: true,
    requiresCarePlanReview: true,
    canEstablishCarePlan: true,
    canOversee: true,
    canPrescribe: true
  },

  MD: {
    label: "Physician (MD)",
    visitTypes: [
      { id: 'admission', label: 'Admission', description: 'Initial physician assessment' },
      { id: 'routine_visit', label: 'Follow-up', description: 'Clinical follow-up visit' },
      { id: 'discharge', label: 'Discharge', description: 'Discharge evaluation' }
    ],
    requiresAssessment: true,
    requiresCarePlanReview: true,
    canEstablishCarePlan: true,
    canOversee: true,
    canPrescribe: true
  },

  DO: {
    label: "Osteopathic Doctor (DO)",
    visitTypes: [
      { id: 'admission', label: 'Admission', description: 'Initial physician assessment' },
      { id: 'routine_visit', label: 'Follow-up', description: 'Clinical follow-up visit' },
      { id: 'discharge', label: 'Discharge', description: 'Discharge evaluation' }
    ],
    requiresAssessment: true,
    requiresCarePlanReview: true,
    canEstablishCarePlan: true,
    canOversee: true,
    canPrescribe: true
  },

  PT: {
    label: "Physical Therapist",
    visitTypes: [
      { id: 'admission', label: 'Initial Evaluation', description: 'PT evaluation and treatment plan' },
      { id: 'routine_visit', label: 'Treatment Visit', description: 'Physical therapy intervention' },
      { id: 'discharge', label: 'Discharge', description: 'Final therapy summary' },
      { id: 'prn', label: 'Urgent Visit', description: 'Urgent therapy visit' }
    ],
    requiresAssessment: true,
    requiresCarePlanReview: false,
    canEstablishCarePlan: true,
    noteRequirements: [
      'Functional status assessment',
      'Interventions performed',
      'Patient tolerance',
      'Progress toward goals'
    ]
  },

  OT: {
    label: "Occupational Therapist",
    visitTypes: [
      { id: 'admission', label: 'Initial Evaluation', description: 'OT evaluation and treatment plan' },
      { id: 'routine_visit', label: 'Treatment Visit', description: 'Occupational therapy intervention' },
      { id: 'discharge', label: 'Discharge', description: 'Final therapy summary' },
      { id: 'prn', label: 'Urgent Visit', description: 'Urgent therapy visit' }
    ],
    requiresAssessment: true,
    requiresCarePlanReview: false,
    canEstablishCarePlan: true,
    noteRequirements: [
      'ADL/IADL functional status',
      'Interventions and adaptations',
      'Patient response',
      'Progress toward goals'
    ]
  },

  ST: {
    label: "Speech-Language Pathologist",
    visitTypes: [
      { id: 'admission', label: 'Initial Evaluation', description: 'SLP evaluation and plan' },
      { id: 'routine_visit', label: 'Treatment Visit', description: 'Speech therapy intervention' },
      { id: 'discharge', label: 'Discharge', description: 'Final therapy summary' },
      { id: 'prn', label: 'Urgent Visit', description: 'Urgent therapy visit' }
    ],
    requiresAssessment: true,
    requiresCarePlanReview: false,
    canEstablishCarePlan: true,
    noteRequirements: [
      'Speech/language assessment',
      'Swallowing evaluation if applicable',
      'Interventions performed',
      'Patient progress'
    ]
  },

  MSW: {
    label: "Clinical Social Worker",
    visitTypes: [
      { id: 'admission', label: 'Initial Psychosocial Assessment', description: 'Psychosocial evaluation' },
      { id: 'routine_visit', label: 'Counseling Visit', description: 'Psychosocial support/counseling' },
      { id: 'discharge', label: 'Discharge', description: 'Discharge planning/summary' },
      { id: 'prn', label: 'Crisis Visit', description: 'Urgent psychosocial intervention' }
    ],
    requiresAssessment: true,
    requiresCarePlanReview: false,
    canEstablishCarePlan: true,
    noteRequirements: [
      'Mental health status',
      'Psychosocial factors',
      'Interventions provided',
      'Resources and referrals',
      'Patient/family response'
    ]
  },

  Chiropractor: {
    label: "Chiropractor",
    visitTypes: [
      { id: 'admission', label: 'Initial Evaluation', description: 'Chiropractic evaluation' },
      { id: 'routine_visit', label: 'Treatment', description: 'Chiropractic treatment' },
      { id: 'discharge', label: 'Discharge', description: 'Treatment summary' }
    ],
    requiresAssessment: true,
    requiresCarePlanReview: false,
    canEstablishCarePlan: true,
    noteRequirements: [
      'Musculoskeletal assessment',
      'Treatment performed',
      'Patient response',
      'Functional improvement'
    ]
  }
};

/**
 * Get visit types for a specific provider type
 * @param {string} providerType - The provider type (RN, LPN, NP, etc.)
 * @returns {Array} Array of visit type objects
 */
export const getVisitTypesForProvider = (providerType) => {
  return PROVIDER_VISIT_TYPES[providerType]?.visitTypes || [];
};

/**
 * Get provider information including visit types and requirements
 * @param {string} providerType - The provider type
 * @returns {Object} Provider configuration object
 */
export const getProviderConfig = (providerType) => {
  return PROVIDER_VISIT_TYPES[providerType] || null;
};

/**
 * Check if provider can establish care plans
 * @param {string} providerType - The provider type
 * @returns {boolean}
 */
export const canEstablishCarePlan = (providerType) => {
  return PROVIDER_VISIT_TYPES[providerType]?.canEstablishCarePlan || false;
};

/**
 * Check if provider requires comprehensive assessment
 * @param {string} providerType - The provider type
 * @returns {boolean}
 */
export const requiresAssessment = (providerType) => {
  return PROVIDER_VISIT_TYPES[providerType]?.requiresAssessment || false;
};

/**
 * Get specific note requirements for a provider type
 * @param {string} providerType - The provider type
 * @returns {Array} Array of required note elements
 */
export const getNoteRequirements = (providerType) => {
  const config = PROVIDER_VISIT_TYPES[providerType];
  return config?.noteRequirements || [];
};

export default PROVIDER_VISIT_TYPES;