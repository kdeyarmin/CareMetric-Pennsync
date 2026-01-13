/**
 * Billing Code Mapping System
 * Maps CPT, HCPCS, and G-codes to visit types, care settings, and provider roles
 */

// Base billing codes by care setting and visit type
export const BILLING_CODES = {
  TELEHEALTH: {
    SYNCHRONOUS_AUDIO_VIDEO: {
      code: '98000-98007',
      description: 'Synchronous audio-video E/M via telehealth',
      duration: '15+ minutes',
      type: 'G-code / CPT',
      notes: 'Real-time interactive audio-visual consultation'
    },
    SYNCHRONOUS_AUDIO_ONLY: {
      code: '98008-98015',
      description: 'Synchronous audio-only E/M via telehealth',
      duration: '15+ minutes',
      type: 'G-code / CPT',
      notes: 'Real-time phone consultation, audio-only'
    },
    RPM_MONITORING: {
      code: '99457-99458',
      description: 'Remote patient monitoring services',
      duration: 'Per month',
      type: 'CPT',
      notes: 'Automated monitoring with no human contact'
    },
    ASYNC_COMMUNICATION: {
      code: '99421-99423',
      description: 'Asynchronous digital communication services',
      duration: 'Per month',
      type: 'CPT',
      notes: 'Store-and-forward, not real-time'
    }
  },

  HOME_HEALTH: {
    RN_SKILLED_VISIT: {
      code: 'G0299',
      description: 'Direct skilled nursing services - RN, each 15 minutes',
      duration: '15 minutes increments',
      type: 'HCPCS',
      notes: 'Requires OASIS documentation'
    },
    LPN_SKILLED_VISIT: {
      code: 'G0300',
      description: 'Direct skilled nursing services - LPN, each 15 minutes',
      duration: '15 minutes increments',
      type: 'HCPCS',
      notes: 'Under RN supervision'
    },
    PT_VISIT: {
      code: '97161-97163',
      description: 'Physical therapy evaluation',
      duration: 'Initial evaluation tiers',
      type: 'CPT',
      notes: 'Home health PT visit with functional assessment'
    },
    PT_TREATMENT: {
      code: '97161-97168',
      description: 'Physical therapy treatment, each 15 minutes',
      duration: '15 minutes increments',
      type: 'CPT',
      notes: 'Therapeutic exercises and techniques'
    },
    OT_VISIT: {
      code: '97165-97167',
      description: 'Occupational therapy evaluation',
      duration: 'Initial evaluation tiers',
      type: 'CPT',
      notes: 'Home health OT visit'
    },
    OT_TREATMENT: {
      code: '97161-97168',
      description: 'Occupational therapy treatment, each 15 minutes',
      duration: '15 minutes increments',
      type: 'CPT',
      notes: 'ADL/IADL training and adaptations'
    },
    SLP_VISIT: {
      code: '92522-92524',
      description: 'Speech-language pathology evaluation',
      duration: 'Initial evaluation tiers',
      type: 'CPT',
      notes: 'Home health speech therapy assessment'
    },
    SLP_TREATMENT: {
      code: '92507-92508',
      description: 'Speech-language pathology treatment, each 15 minutes',
      duration: '15 minutes increments',
      type: 'CPT',
      notes: 'Speech/swallowing intervention'
    },
    MSW_VISIT: {
      code: '90834-90837',
      description: 'Psychotherapy/social work services',
      duration: '45 minutes base',
      type: 'CPT',
      notes: 'Psychosocial assessment and counseling'
    },
    HHA_ADL: {
      code: 'G0156',
      description: 'Home health aide services',
      duration: '15 minutes increments',
      type: 'HCPCS',
      notes: 'ADL/personal care assistance'
    }
  },

  CLINIC_OUTPATIENT: {
    OFFICE_NEW_PATIENT: {
      code: '99202-99205',
      description: 'Office visit - new patient',
      duration: '20-60 minutes',
      type: 'CPT',
      notes: 'Based on medical decision making and time'
    },
    OFFICE_ESTABLISHED_PATIENT: {
      code: '99211-99215',
      description: 'Office visit - established patient',
      duration: '10-40 minutes',
      type: 'CPT',
      notes: 'Based on medical decision making and time'
    },
    PT_EVAL: {
      code: '97161-97163',
      description: 'Physical therapy evaluation',
      duration: 'Initial tiers',
      type: 'CPT',
      notes: 'Clinic-based PT'
    },
    PT_TREATMENT: {
      code: '97161-97168',
      description: 'Physical therapy treatment, each 15 minutes',
      duration: '15 minutes increments',
      type: 'CPT',
      notes: 'Therapeutic services'
    },
    OT_EVAL: {
      code: '97165-97167',
      description: 'Occupational therapy evaluation',
      duration: 'Initial tiers',
      type: 'CPT',
      notes: 'Clinic-based OT'
    },
    OT_TREATMENT: {
      code: '97161-97168',
      description: 'Occupational therapy treatment',
      duration: '15 minutes increments',
      type: 'CPT',
      notes: 'Clinic-based OT services'
    }
  },

  HOSPITAL_INPATIENT: {
    INITIAL_HOSPITAL_CARE: {
      code: '99223-99225',
      description: 'Initial hospital care',
      duration: 'Per admission',
      type: 'CPT',
      notes: 'Physician comprehensive assessment'
    },
    SUBSEQUENT_HOSPITAL_CARE: {
      code: '99231-99233',
      description: 'Subsequent hospital care',
      duration: 'Daily visit',
      type: 'CPT',
      notes: 'Daily inpatient assessment'
    },
    HOSPITAL_CONSULTATION: {
      code: '99252-99255',
      description: 'Inpatient consultation',
      duration: 'Per consultation',
      type: 'CPT',
      notes: 'Specialist consultation'
    },
    DISCHARGE_MANAGEMENT: {
      code: '99238-99239',
      description: 'Hospital discharge day management',
      duration: 'Per discharge',
      type: 'CPT',
      notes: 'Discharge planning and documentation'
    }
  },

  SKILLED_NURSING: {
    SNF_INITIAL_VISIT: {
      code: '99304-99306',
      description: 'Initial nursing facility care',
      duration: 'Per admission',
      type: 'CPT',
      notes: 'Comprehensive SNF admission assessment'
    },
    SNF_SUBSEQUENT_VISIT: {
      code: '99307-99310',
      description: 'Subsequent nursing facility care',
      duration: 'Per visit',
      type: 'CPT',
      notes: 'Routine SNF visit'
    },
    RN_SKILLED_VISIT: {
      code: 'G0299',
      description: 'Direct skilled nursing services - RN',
      duration: '15 minutes increments',
      type: 'HCPCS',
      notes: 'If billed separately from physician visit'
    },
    PT_VISIT: {
      code: '97161-97163',
      description: 'Physical therapy evaluation',
      duration: 'Initial tiers',
      type: 'CPT',
      notes: 'SNF-based PT'
    },
    OT_VISIT: {
      code: '97165-97167',
      description: 'Occupational therapy evaluation',
      duration: 'Initial tiers',
      type: 'CPT',
      notes: 'SNF-based OT'
    }
  },

  HOSPICE: {
    PHYSICIAN_VISIT: {
      code: '99211-99215',
      description: 'Hospice physician visit',
      duration: 'Per visit',
      type: 'CPT',
      notes: 'End-of-life care coordination'
    },
    RN_VISIT: {
      code: 'G0409',
      description: 'Hospice visit by RN',
      duration: 'Per visit',
      type: 'HCPCS',
      notes: 'Comfort care assessment'
    },
    AIDE_VISIT: {
      code: 'G0410',
      description: 'Hospice visit by aide',
      duration: 'Per visit',
      type: 'HCPCS',
      notes: 'Personal care services'
    },
    BEREAVEMENT_COUNSELING: {
      code: '90834-90837',
      description: 'Bereavement counseling',
      duration: '45 minutes base',
      type: 'CPT',
      notes: 'Family support services'
    }
  }
};

/**
 * Get billing codes for a specific visit type and care setting
 * @param {string} careSetting - The care setting
 * @param {string} visitType - The visit type
 * @returns {Object} Billing code information
 */
export const getBillingCodes = (careSetting, visitType) => {
  const settingCodes = BILLING_CODES[careSetting];
  if (!settingCodes) return null;

  // Convert visit type ID to billing code key (e.g., 'routine_visit' -> 'RN_SKILLED_VISIT')
  const billingKey = Object.keys(settingCodes).find(key =>
    key.toLowerCase().includes(visitType.replace(/_/g, ''))
  );

  return billingKey ? settingCodes[billingKey] : null;
};

/**
 * Get all billing codes for a care setting
 * @param {string} careSetting - The care setting
 * @returns {Object} All billing codes for the setting
 */
export const getBillingCodesForSetting = (careSetting) => {
  return BILLING_CODES[careSetting] || {};
};

/**
 * Provider-specific billing considerations
 */
export const PROVIDER_BILLING_REQUIREMENTS = {
  RN: {
    requiresAssessment: true,
    primaryCodes: ['G0299', '99223-99225'],
    supervisesOtherBills: true,
    canBillInd: true,
    billingNote: 'Can bill for assessment and skilled nursing services'
  },
  LPN: {
    requiresAssessment: false,
    primaryCodes: ['G0300'],
    supervisesOtherBills: false,
    canBillInd: false,
    billingNote: 'Bill under RN supervision; LPN cannot bill independently'
  },
  NP: {
    requiresAssessment: true,
    primaryCodes: ['99202-99205', '99211-99215'],
    supervisesOtherBills: true,
    canBillInd: true,
    billingNote: 'Can bill as independent practitioner with NPI'
  },
  MD: {
    requiresAssessment: true,
    primaryCodes: ['99202-99205', '99211-99215', '99223-99225'],
    supervisesOtherBills: true,
    canBillInd: true,
    billingNote: 'Full billing authority with physician NPI'
  },
  DO: {
    requiresAssessment: true,
    primaryCodes: ['99202-99205', '99211-99215', '99223-99225'],
    supervisesOtherBills: true,
    canBillInd: true,
    billingNote: 'Full billing authority with physician NPI'
  },
  PT: {
    requiresAssessment: true,
    primaryCodes: ['97161-97168'],
    supervisesOtherBills: false,
    canBillInd: true,
    billingNote: 'Direct access in most states; evaluation code required initially'
  },
  OT: {
    requiresAssessment: true,
    primaryCodes: ['97165-97168'],
    supervisesOtherBills: false,
    canBillInd: true,
    billingNote: 'Evaluation code required; treatment in 15-minute increments'
  },
  ST: {
    requiresAssessment: true,
    primaryCodes: ['92522-92524', '92507-92508'],
    supervisesOtherBills: false,
    canBillInd: true,
    billingNote: 'Evaluation required initially; treatment billed per 15 minutes'
  },
  MSW: {
    requiresAssessment: true,
    primaryCodes: ['90834-90837'],
    supervisesOtherBills: false,
    canBillInd: true,
    billingNote: 'Psychotherapy/counseling codes; varies by state licensure'
  }
};

/**
 * Get billing requirements for a provider
 * @param {string} providerType - The provider type
 * @returns {Object} Billing requirements
 */
export const getProviderBillingRequirements = (providerType) => {
  return PROVIDER_BILLING_REQUIREMENTS[providerType] || null;
};

/**
 * Get modifiers for telehealth services
 */
export const TELEHEALTH_MODIFIERS = {
  GT: {
    code: 'GT',
    description: 'Via interactive audio-video telecommunication system',
    usage: 'Synchronous audio-video telehealth'
  },
  GQ: {
    code: 'GQ',
    description: 'Via asynchronous telecommunications system',
    usage: 'Asynchronous/store-and-forward telehealth'
  },
  95: {
    code: '95',
    description: 'Synchronous telemedicine visit rendered via real-time interactive audio and video',
    usage: 'Current standard for telehealth services'
  }
};

/**
 * Get telehealth modifier for visit type
 * @param {string} visitType - The visit type (e.g., 'synchronous', 'asynchronous')
 * @returns {Object} Appropriate modifier
 */
export const getTelehealthModifier = (visitType) => {
  if (visitType === 'asynchronous') {
    return TELEHEALTH_MODIFIERS.GQ;
  }
  // Default to current standard
  return TELEHEALTH_MODIFIERS['95'];
};

/**
 * Home health specific billing considerations
 */
export const HOME_HEALTH_BILLING_NOTES = {
  oasisRequired: 'OASIS completion required for Medicare/Medicaid',
  visitCodeing: 'Visit codes in 15-minute increments',
  supervisionRequirement: 'LPN visits require RN oversight',
  disciplineSpecific: 'Use discipline-specific codes (G0299 for RN, G0300 for LPN, 97xxx for rehab)',
  priorAuthorization: 'Prior authorization may be required for certain diagnoses',
  episodeOfCare: 'Billed per 60-day episode of care'
};

/**
 * Telehealth specific billing considerations
 */
export const TELEHEALTH_BILLING_NOTES = {
  modifierRequired: 'Must append appropriate modifier (GT, GQ, or 95)',
  originating: 'Originating site requirements vary by payer',
  patientLocation: 'Patient must be at home or covered location',
  provider: 'Supervision rules may apply depending on provider type',
  policyVariation: 'Medicare, Medicaid, and commercial vary significantly'
};

export default BILLING_CODES;