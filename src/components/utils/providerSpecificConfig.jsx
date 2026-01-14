/**
 * Provider-Specific Configuration for AI, Compliance, and Workflows
 * Tailors features, compliance checks, and AI suggestions to each provider type
 */

export const PROVIDER_TYPES = {
  RN: 'RN',
  LPN: 'LPN',
  NP: 'NP',
  MD: 'MD',
  DO: 'DO',
  PA: 'PA',
  PT: 'PT',
  OT: 'OT',
  ST: 'ST',
  MSW: 'MSW',
  CHIRO: 'Chiropractor'
};

/**
 * Provider-Specific Compliance Standards
 */
export const PROVIDER_COMPLIANCE_STANDARDS = {
  [PROVIDER_TYPES.RN]: {
    primary: 'Medicare Home Health CoP',
    standards: ['42 CFR 484', 'OASIS-E', 'Nursing Practice Act'],
    requiredElements: [
      'Skilled nursing justification',
      'Patient response to interventions',
      'Vital signs documentation',
      'Teaching/training provided',
      'Homebound status indicators',
      'Coordination with physician'
    ],
    focusAreas: ['Care coordination', 'Patient education', 'Medication management']
  },
  [PROVIDER_TYPES.LPN]: {
    primary: 'Medicare Home Health CoP',
    standards: ['42 CFR 484', 'State LPN Scope of Practice'],
    requiredElements: [
      'Supervised care documentation',
      'Vital signs monitoring',
      'Basic wound care details',
      'Patient response to care',
      'RN supervision noted'
    ],
    focusAreas: ['Vital signs', 'Basic care', 'Patient observation']
  },
  [PROVIDER_TYPES.NP]: {
    primary: 'Medicare Physician Services',
    standards: ['E/M Guidelines', 'CPT Coding', 'Incident-to billing'],
    requiredElements: [
      'Chief complaint',
      'History of present illness',
      'Physical examination',
      'Medical decision making',
      'Assessment and plan',
      'Prescriptions and orders'
    ],
    focusAreas: ['Diagnosis', 'Treatment planning', 'Prescribing']
  },
  [PROVIDER_TYPES.MD]: {
    primary: 'Medicare Physician Services',
    standards: ['E/M Guidelines', 'CPT Coding', 'ICD-10 Documentation'],
    requiredElements: [
      'Chief complaint',
      'History of present illness',
      'Review of systems',
      'Physical examination',
      'Medical decision making complexity',
      'Assessment and plan with medical necessity'
    ],
    focusAreas: ['Diagnosis', 'Treatment', 'Medical complexity']
  },
  [PROVIDER_TYPES.DO]: {
    primary: 'Medicare Physician Services',
    standards: ['E/M Guidelines', 'CPT Coding', 'ICD-10 Documentation'],
    requiredElements: [
      'Chief complaint',
      'History of present illness',
      'Physical examination',
      'Osteopathic manipulative treatment (if performed)',
      'Medical decision making',
      'Assessment and plan'
    ],
    focusAreas: ['Holistic care', 'OMT documentation', 'Medical management']
  },
  [PROVIDER_TYPES.PA]: {
    primary: 'Medicare Physician Services',
    standards: ['E/M Guidelines', 'CPT Coding', 'Incident-to billing'],
    requiredElements: [
      'Chief complaint',
      'History of present illness',
      'Physical examination',
      'Medical decision making',
      'Assessment and plan',
      'Supervising physician noted'
    ],
    focusAreas: ['Diagnosis', 'Treatment', 'Collaborative care']
  },
  [PROVIDER_TYPES.PT]: {
    primary: 'Medicare Therapy Services',
    standards: ['Medicare Therapy Guidelines', 'PT Documentation Standards'],
    requiredElements: [
      'Initial evaluation or progress note',
      'Functional limitations',
      'Skilled therapy justification',
      'Treatment goals (SMART)',
      'Treatment plan with frequency/duration',
      'Patient progress toward goals'
    ],
    focusAreas: ['Functional mobility', 'Strength and ROM', 'ADL performance']
  },
  [PROVIDER_TYPES.OT]: {
    primary: 'Medicare Therapy Services',
    standards: ['Medicare Therapy Guidelines', 'OT Documentation Standards'],
    requiredElements: [
      'Initial evaluation or progress note',
      'ADL/IADL assessment',
      'Skilled OT justification',
      'Functional goals',
      'Treatment interventions',
      'Patient progress and response'
    ],
    focusAreas: ['ADLs/IADLs', 'Fine motor skills', 'Cognitive function']
  },
  [PROVIDER_TYPES.ST]: {
    primary: 'Medicare Therapy Services',
    standards: ['Medicare Therapy Guidelines', 'ST Documentation Standards'],
    requiredElements: [
      'Initial evaluation or progress note',
      'Speech/language/swallowing assessment',
      'Skilled ST justification',
      'Communication goals',
      'Treatment plan',
      'Progress toward functional communication'
    ],
    focusAreas: ['Speech clarity', 'Swallowing safety', 'Communication effectiveness']
  },
  [PROVIDER_TYPES.MSW]: {
    primary: 'Medicare Home Health CoP',
    standards: ['42 CFR 484', 'Social Work Documentation Standards'],
    requiredElements: [
      'Psychosocial assessment',
      'Social determinants of health',
      'Community resources identified',
      'Counseling provided',
      'Safety concerns addressed',
      'Discharge planning'
    ],
    focusAreas: ['Psychosocial needs', 'Resource coordination', 'Safety planning']
  },
  [PROVIDER_TYPES.CHIRO]: {
    primary: 'Chiropractic Documentation Standards',
    standards: ['CPT Coding', 'Manipulation documentation'],
    requiredElements: [
      'Chief complaint',
      'Mechanism of injury',
      'Physical examination findings',
      'Spinal manipulation details',
      'Patient response to treatment',
      'Treatment plan'
    ],
    focusAreas: ['Spinal alignment', 'Pain management', 'Functional improvement']
  }
};

/**
 * Provider-Specific AI Prompts for Compliance Review
 */
export const getProviderCompliancePrompt = (providerType) => {
  const config = PROVIDER_COMPLIANCE_STANDARDS[providerType] || PROVIDER_COMPLIANCE_STANDARDS[PROVIDER_TYPES.RN];
  
  return `You are reviewing clinical documentation for a ${providerType}.

PRIMARY STANDARD: ${config.primary}
APPLICABLE STANDARDS: ${config.standards.join(', ')}

REQUIRED DOCUMENTATION ELEMENTS FOR ${providerType}:
${config.requiredElements.map((el, i) => `${i + 1}. ${el}`).join('\n')}

FOCUS AREAS FOR THIS PROVIDER TYPE:
${config.focusAreas.map((area, i) => `- ${area}`).join('\n')}

When reviewing this note, check specifically for ${providerType}-appropriate documentation including skilled nature of services, medical necessity, and provider-specific requirements.`;
};

/**
 * Provider-Specific Care Plan Priorities
 */
export const PROVIDER_CARE_PLAN_FOCUS = {
  [PROVIDER_TYPES.RN]: {
    primaryFocus: 'Nursing diagnoses and nursing interventions',
    problemTypes: ['Pain management', 'Medication education', 'Disease management', 'Safety', 'Caregiver education'],
    interventionStyle: 'Nursing interventions with teaching/training focus',
    goalFormat: 'Patient-centered, measurable nursing outcomes'
  },
  [PROVIDER_TYPES.LPN]: {
    primaryFocus: 'Basic nursing care and monitoring',
    problemTypes: ['Vital signs monitoring', 'Basic wound care', 'Medication administration', 'ADL assistance'],
    interventionStyle: 'Task-oriented care under RN supervision',
    goalFormat: 'Observable care outcomes'
  },
  [PROVIDER_TYPES.NP]: {
    primaryFocus: 'Medical management and prescriptive authority',
    problemTypes: ['Chronic disease management', 'Acute illness', 'Medication optimization', 'Health maintenance'],
    interventionStyle: 'Medical orders, prescriptions, and patient education',
    goalFormat: 'Clinical outcomes and disease control'
  },
  [PROVIDER_TYPES.MD]: {
    primaryFocus: 'Medical diagnosis and treatment',
    problemTypes: ['Complex medical conditions', 'Multi-system disease', 'Medication management', 'Specialist coordination'],
    interventionStyle: 'Medical orders, referrals, and treatment plans',
    goalFormat: 'Disease resolution or stabilization'
  },
  [PROVIDER_TYPES.DO]: {
    primaryFocus: 'Holistic medical care with OMT',
    problemTypes: ['Musculoskeletal issues', 'Systemic conditions', 'Pain management', 'Wellness'],
    interventionStyle: 'Medical treatment plus osteopathic manipulation',
    goalFormat: 'Functional improvement and wellness'
  },
  [PROVIDER_TYPES.PA]: {
    primaryFocus: 'Medical care under physician supervision',
    problemTypes: ['Common medical conditions', 'Follow-up care', 'Minor procedures', 'Patient education'],
    interventionStyle: 'Medical orders and collaborative treatment',
    goalFormat: 'Clinical improvement and care continuity'
  },
  [PROVIDER_TYPES.PT]: {
    primaryFocus: 'Physical function and mobility',
    problemTypes: ['Strength deficits', 'Range of motion limitations', 'Gait instability', 'Balance impairment', 'Pain with movement'],
    interventionStyle: 'Therapeutic exercises, manual therapy, modalities',
    goalFormat: 'Functional mobility goals (e.g., walk 50 feet independently)'
  },
  [PROVIDER_TYPES.OT]: {
    primaryFocus: 'Activities of daily living and independence',
    problemTypes: ['ADL deficits', 'Upper extremity weakness', 'Cognitive impairment', 'Home safety', 'Fine motor deficits'],
    interventionStyle: 'ADL training, adaptive equipment, cognitive strategies',
    goalFormat: 'Functional independence in daily activities'
  },
  [PROVIDER_TYPES.ST]: {
    primaryFocus: 'Communication and swallowing',
    problemTypes: ['Speech clarity', 'Expressive/receptive language', 'Swallowing safety', 'Voice quality', 'Cognitive-communication'],
    interventionStyle: 'Speech exercises, swallow strategies, communication devices',
    goalFormat: 'Communication effectiveness and safe swallowing'
  },
  [PROVIDER_TYPES.MSW]: {
    primaryFocus: 'Psychosocial wellbeing and resources',
    problemTypes: ['Social isolation', 'Caregiver stress', 'Financial barriers', 'Mental health', 'Discharge planning'],
    interventionStyle: 'Counseling, resource coordination, advocacy',
    goalFormat: 'Improved coping and access to resources'
  },
  [PROVIDER_TYPES.CHIRO]: {
    primaryFocus: 'Spinal health and pain management',
    problemTypes: ['Back pain', 'Neck pain', 'Joint dysfunction', 'Posture', 'Headaches'],
    interventionStyle: 'Spinal manipulation, adjustments, therapeutic modalities',
    goalFormat: 'Pain reduction and functional improvement'
  }
};

/**
 * Provider-Specific Billing Code Focus
 */
export const PROVIDER_BILLING_FOCUS = {
  [PROVIDER_TYPES.RN]: {
    codeTypes: [],
    note: 'Home health RN visits are typically bundled under PDGM payment model, not individually billed with CPT codes'
  },
  [PROVIDER_TYPES.LPN]: {
    codeTypes: [],
    note: 'Home health LPN visits are typically bundled under PDGM payment model, not individually billed with CPT codes'
  },
  [PROVIDER_TYPES.NP]: {
    codeTypes: ['E/M Codes', 'Procedure Codes', 'Prolonged Services'],
    commonCodes: ['99211-99215 (Office visits)', '99347-99350 (Home visits)', '99490-99491 (Chronic care management)'],
    focus: 'Medical decision making complexity and time-based coding'
  },
  [PROVIDER_TYPES.MD]: {
    codeTypes: ['E/M Codes', 'Procedure Codes', 'Prolonged Services', 'Critical Care'],
    commonCodes: ['99211-99215 (Office)', '99347-99350 (Home)', '99221-99223 (Hospital admission)', '99490-99491 (CCM)'],
    focus: 'Medical decision making complexity, visit level, and medical necessity'
  },
  [PROVIDER_TYPES.DO]: {
    codeTypes: ['E/M Codes', 'OMT Codes', 'Procedure Codes'],
    commonCodes: ['99211-99215 (Office)', '99347-99350 (Home)', '98925-98929 (OMT)'],
    focus: 'Medical complexity and osteopathic manipulative treatment'
  },
  [PROVIDER_TYPES.PA]: {
    codeTypes: ['E/M Codes', 'Procedure Codes'],
    commonCodes: ['99211-99215 (Office)', '99347-99350 (Home)', '99490-99491 (CCM)'],
    focus: 'Visit complexity and incident-to billing requirements'
  },
  [PROVIDER_TYPES.PT]: {
    codeTypes: ['Therapy Evaluation', 'Therapeutic Procedures', 'Modalities'],
    commonCodes: ['97161-97163 (PT Eval)', '97110 (Therapeutic exercise)', '97140 (Manual therapy)', '97530 (Therapeutic activities)'],
    focus: 'Skilled therapy justification and 8-minute rule'
  },
  [PROVIDER_TYPES.OT]: {
    codeTypes: ['Therapy Evaluation', 'Therapeutic Activities', 'ADL Training'],
    commonCodes: ['97165-97167 (OT Eval)', '97530 (Therapeutic activities)', '97535 (ADL training)', '97110 (Therapeutic exercise)'],
    focus: 'Functional goals and skilled OT justification'
  },
  [PROVIDER_TYPES.ST]: {
    codeTypes: ['Therapy Evaluation', 'Speech Therapy', 'Swallowing'],
    commonCodes: ['92521-92524 (ST Eval)', '92507 (Speech therapy)', '92526 (Swallow therapy)', '92610 (Swallow function)'],
    focus: 'Communication/swallowing goals and skilled ST justification'
  },
  [PROVIDER_TYPES.MSW]: {
    codeTypes: [],
    note: 'Home health MSW services are typically bundled under PDGM payment model, not individually billed with CPT codes'
  },
  [PROVIDER_TYPES.CHIRO]: {
    codeTypes: ['Manipulation', 'E/M Codes', 'Modalities'],
    commonCodes: ['98940-98943 (Spinal manipulation)', '99201-99205 (Office visits)', '97010-97039 (Modalities)'],
    focus: 'Regions manipulated and medical necessity'
  }
};

/**
 * Get AI prompt for care plan generation specific to provider type
 */
export const getCarePlanPrompt = (providerType, diagnosis, patientContext) => {
  const config = PROVIDER_CARE_PLAN_FOCUS[providerType] || PROVIDER_CARE_PLAN_FOCUS[PROVIDER_TYPES.RN];
  
  return `You are generating a care plan for a ${providerType}.

PRIMARY FOCUS: ${config.primaryFocus}

PROBLEM TYPES RELEVANT TO ${providerType}:
${config.problemTypes.join(', ')}

INTERVENTION STYLE: ${config.interventionStyle}
GOAL FORMAT: ${config.goalFormat}

PATIENT CONTEXT:
- Diagnosis: ${diagnosis}
${patientContext ? `- Additional context: ${patientContext}` : ''}

Generate care plans appropriate for ${providerType} scope of practice with ${providerType}-specific problems, goals, and interventions.`;
};

/**
 * Get AI prompt for billing code suggestions specific to provider type
 */
export const getBillingCodePrompt = (providerType, visitNote, visitDuration) => {
  const config = PROVIDER_BILLING_FOCUS[providerType];
  
  if (!config || config.codeTypes.length === 0) {
    return null; // No billing codes for this provider type
  }
  
  return `You are suggesting billing codes for a ${providerType}.

CODE TYPES FOR ${providerType}: ${config.codeTypes.join(', ')}
COMMON CODES: ${config.commonCodes.join(', ')}
BILLING FOCUS: ${config.focus}

VISIT NOTE:
${visitNote}

${visitDuration ? `VISIT DURATION: ${visitDuration} minutes` : ''}

Suggest appropriate CPT codes and ICD-10 codes based on ${providerType} documentation. Explain medical necessity and level of service.`;
};

/**
 * Check if provider type can generate billing codes
 */
export const canGenerateBillingCodes = (providerType) => {
  const config = PROVIDER_BILLING_FOCUS[providerType];
  return config && config.codeTypes && config.codeTypes.length > 0;
};

/**
 * Check if provider type can generate care plans
 */
export const canGenerateCarePlans = (providerType) => {
  // All provider types can generate care plans, but focus differs
  return true;
};

/**
 * Get provider-specific dashboard priorities
 */
export const PROVIDER_DASHBOARD_PRIORITIES = {
  [PROVIDER_TYPES.RN]: ['patients', 'visits', 'carePlans', 'compliance', 'alerts'],
  [PROVIDER_TYPES.LPN]: ['patients', 'visits', 'vitals', 'tasks', 'supervision'],
  [PROVIDER_TYPES.NP]: ['patients', 'diagnoses', 'prescriptions', 'billing', 'followUp'],
  [PROVIDER_TYPES.MD]: ['patients', 'diagnoses', 'orders', 'billing', 'consultations'],
  [PROVIDER_TYPES.DO]: ['patients', 'diagnoses', 'omt', 'billing', 'wellness'],
  [PROVIDER_TYPES.PA]: ['patients', 'diagnoses', 'procedures', 'billing', 'collaboration'],
  [PROVIDER_TYPES.PT]: ['patients', 'evaluations', 'progress', 'goals', 'discharge'],
  [PROVIDER_TYPES.OT]: ['patients', 'evaluations', 'adls', 'goals', 'equipment'],
  [PROVIDER_TYPES.ST]: ['patients', 'evaluations', 'communication', 'swallowing', 'goals'],
  [PROVIDER_TYPES.MSW]: ['patients', 'psychosocial', 'resources', 'discharge', 'counseling'],
  [PROVIDER_TYPES.CHIRO]: ['patients', 'adjustments', 'pain', 'progress', 'wellness']
};