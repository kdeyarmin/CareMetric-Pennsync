/**
 * Maps provider types and care settings to available visit types and their requirements
 */

export const CARE_SETTINGS = {
  HOME_HEALTH: 'home_health',
  TELEHEALTH: 'telehealth',
  CLINIC_OUTPATIENT: 'clinic_outpatient',
  HOSPITAL_INPATIENT: 'hospital_inpatient',
  SKILLED_NURSING: 'skilled_nursing',
  HOSPICE: 'hospice'
};

export const CARE_SETTING_LABELS = {
  [CARE_SETTINGS.HOME_HEALTH]: 'Home Health',
  [CARE_SETTINGS.TELEHEALTH]: 'Telehealth/Virtual',
  [CARE_SETTINGS.CLINIC_OUTPATIENT]: 'Clinic/Outpatient',
  [CARE_SETTINGS.HOSPITAL_INPATIENT]: 'Hospital/Inpatient',
  [CARE_SETTINGS.SKILLED_NURSING]: 'Skilled Nursing Facility',
  [CARE_SETTINGS.HOSPICE]: 'Hospice'
};

// Visit types available by care setting
export const VISIT_TYPES_BY_SETTING = {
  [CARE_SETTINGS.HOME_HEALTH]: [
    { id: 'admission', label: 'Admission', description: 'Initial comprehensive assessment' },
    { id: 'routine_visit', label: 'Routine Visit', description: 'Regular skilled visit' },
    { id: 'recertification', label: 'Recertification', description: '60-day recertification assessment' },
    { id: 'discharge', label: 'Discharge', description: 'Final visit and discharge summary' },
    { id: 'prn', label: 'PRN Visit', description: 'Urgent/as-needed visit' }
  ],
  [CARE_SETTINGS.TELEHEALTH]: [
    { id: 'synchronous', label: 'Synchronous Visit', description: 'Real-time video/audio consultation' },
    { id: 'asynchronous', label: 'Asynchronous Visit', description: 'Store-and-forward telehealth' },
    { id: 'rpm', label: 'Remote Patient Monitoring', description: 'Automated monitoring and assessment' },
    { id: 'follow_up', label: 'Follow-up Consultation', description: 'Virtual follow-up visit' }
  ],
  [CARE_SETTINGS.CLINIC_OUTPATIENT]: [
    { id: 'initial_eval', label: 'Initial Evaluation', description: 'New patient evaluation' },
    { id: 'follow_up', label: 'Follow-up Visit', description: 'Established patient follow-up' },
    { id: 'urgent_care', label: 'Urgent Care', description: 'Urgent outpatient visit' },
    { id: 'preventive', label: 'Preventive Visit', description: 'Preventive care/wellness visit' }
  ],
  [CARE_SETTINGS.HOSPITAL_INPATIENT]: [
    { id: 'admission', label: 'Admission Assessment', description: 'Hospital admission evaluation' },
    { id: 'daily_rounds', label: 'Daily Rounds', description: 'Inpatient daily assessment' },
    { id: 'discharge', label: 'Discharge Planning', description: 'Hospital discharge assessment' },
    { id: 'consultation', label: 'Consultation', description: 'Specialist consultation' }
  ],
  [CARE_SETTINGS.SKILLED_NURSING]: [
    { id: 'admission', label: 'Admission', description: 'SNF admission assessment' },
    { id: 'routine_visit', label: 'Routine Visit', description: 'SNF routine skilled visit' },
    { id: 'recertification', label: 'Recertification', description: 'Recertification assessment' },
    { id: 'discharge', label: 'Discharge', description: 'SNF discharge summary' }
  ],
  [CARE_SETTINGS.HOSPICE]: [
    { id: 'admission', label: 'Admission', description: 'Hospice admission assessment' },
    { id: 'routine_visit', label: 'Routine Visit', description: 'Routine hospice visit' },
    { id: 'end_of_life', label: 'End of Life Care', description: 'End of life support visit' },
    { id: 'family_support', label: 'Family Support', description: 'Family counseling/support' }
  ]
};

export const PROVIDER_VISIT_TYPES = {
  RN: {
    label: "Registered Nurse",
    canAccessSettings: [
      CARE_SETTINGS.HOME_HEALTH,
      CARE_SETTINGS.TELEHEALTH,
      CARE_SETTINGS.HOSPITAL_INPATIENT,
      CARE_SETTINGS.SKILLED_NURSING,
      CARE_SETTINGS.HOSPICE
    ],
    requiresAssessment: true,
    requiresCarePlanReview: true,
    canEstablishCarePlan: true,
    canOversee: true
  },

  LPN: {
    label: "Licensed Practical Nurse",
    canAccessSettings: [
      CARE_SETTINGS.HOME_HEALTH,
      CARE_SETTINGS.CLINIC_OUTPATIENT,
      CARE_SETTINGS.HOSPITAL_INPATIENT,
      CARE_SETTINGS.SKILLED_NURSING
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
    canAccessSettings: [
      CARE_SETTINGS.HOME_HEALTH,
      CARE_SETTINGS.TELEHEALTH,
      CARE_SETTINGS.CLINIC_OUTPATIENT,
      CARE_SETTINGS.HOSPITAL_INPATIENT,
      CARE_SETTINGS.SKILLED_NURSING,
      CARE_SETTINGS.HOSPICE
    ],
    requiresAssessment: true,
    requiresCarePlanReview: true,
    canEstablishCarePlan: true,
    canOversee: true,
    canPrescribe: true
  },

  PHYSICIAN: {
    label: "Physician (MD/DO)",
    canAccessSettings: [
      CARE_SETTINGS.HOME_HEALTH,
      CARE_SETTINGS.TELEHEALTH,
      CARE_SETTINGS.CLINIC_OUTPATIENT,
      CARE_SETTINGS.HOSPITAL_INPATIENT,
      CARE_SETTINGS.SKILLED_NURSING,
      CARE_SETTINGS.HOSPICE
    ],
    requiresAssessment: true,
    requiresCarePlanReview: true,
    canEstablishCarePlan: true,
    canOversee: true,
    canPrescribe: true
  },

  PT: {
    label: "Physical Therapist",
    canAccessSettings: [
      CARE_SETTINGS.HOME_HEALTH,
      CARE_SETTINGS.TELEHEALTH,
      CARE_SETTINGS.CLINIC_OUTPATIENT,
      CARE_SETTINGS.HOSPITAL_INPATIENT,
      CARE_SETTINGS.SKILLED_NURSING
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
    canAccessSettings: [
      CARE_SETTINGS.HOME_HEALTH,
      CARE_SETTINGS.TELEHEALTH,
      CARE_SETTINGS.CLINIC_OUTPATIENT,
      CARE_SETTINGS.HOSPITAL_INPATIENT,
      CARE_SETTINGS.SKILLED_NURSING
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
    canAccessSettings: [
      CARE_SETTINGS.HOME_HEALTH,
      CARE_SETTINGS.TELEHEALTH,
      CARE_SETTINGS.CLINIC_OUTPATIENT,
      CARE_SETTINGS.HOSPITAL_INPATIENT,
      CARE_SETTINGS.SKILLED_NURSING
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
    canAccessSettings: [
      CARE_SETTINGS.HOME_HEALTH,
      CARE_SETTINGS.TELEHEALTH,
      CARE_SETTINGS.CLINIC_OUTPATIENT,
      CARE_SETTINGS.HOSPITAL_INPATIENT,
      CARE_SETTINGS.SKILLED_NURSING,
      CARE_SETTINGS.HOSPICE
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
    canAccessSettings: [
      CARE_SETTINGS.CLINIC_OUTPATIENT,
      CARE_SETTINGS.TELEHEALTH
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
 * Get visit types for a specific provider type and care setting
 * @param {string} providerType - The provider type (RN, LPN, NP, etc.)
 * @param {string} careSetting - The care setting (home_health, telehealth, etc.)
 * @returns {Array} Array of visit type objects
 */
export const getVisitTypesForProvider = (providerType, careSetting = null) => {
  const provider = PROVIDER_VISIT_TYPES[providerType];
  if (!provider) return [];

  // If no care setting specified, return all visit types (backward compatibility)
  if (!careSetting) {
    // Combine all visit types from all accessible settings
    const allTypes = new Map();
    provider.canAccessSettings?.forEach(setting => {
      VISIT_TYPES_BY_SETTING[setting]?.forEach(vt => {
        if (!allTypes.has(vt.id)) {
          allTypes.set(vt.id, vt);
        }
      });
    });
    return Array.from(allTypes.values());
  }

  // If care setting is specified, check if provider can access it
  if (!provider.canAccessSettings?.includes(careSetting)) {
    return [];
  }

  return VISIT_TYPES_BY_SETTING[careSetting] || [];
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

/**
 * Get accessible care settings for a provider type
 * @param {string} providerType - The provider type
 * @returns {Array} Array of care setting codes
 */
export const getAccessibleCareSettings = (providerType) => {
  return PROVIDER_VISIT_TYPES[providerType]?.canAccessSettings || [];
};

/**
 * Get care setting label
 * @param {string} careSetting - The care setting code
 * @returns {string} Human-readable care setting label
 */
export const getCareSettingLabel = (careSetting) => {
  return CARE_SETTING_LABELS[careSetting] || careSetting;
};

export default PROVIDER_VISIT_TYPES;