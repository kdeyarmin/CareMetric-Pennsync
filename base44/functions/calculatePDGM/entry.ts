import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

// CMS PDGM 2024 Base Payment Rates
const BASE_PAYMENT_RATE_2024 = 2031.64; // 2024 national standardized 30-day payment

// Clinical Group Weights by Admission Source and Episode Timing (CMS PDGM model)
// Format: { [clinicalGroup]: { community_early, community_late, institutional_early, institutional_late } }
const CLINICAL_GROUP_WEIGHTS = {
  'MMTA_Surgical_Aftercare': { 
    community_early: 0.9234, community_late: 0.8512, 
    institutional_early: 1.1456, institutional_late: 1.0534 
  },
  'MMTA_Cardiac_Circulatory': { 
    community_early: 0.9456, community_late: 0.8698, 
    institutional_early: 1.0876, institutional_late: 1.0006 
  },
  'MMTA_Endocrine': { 
    community_early: 0.8234, community_late: 0.7575, 
    institutional_early: 0.9934, institutional_late: 0.9139 
  },
  'MMTA_GI_GU': { 
    community_early: 0.8823, community_late: 0.8117, 
    institutional_early: 1.0123, institutional_late: 0.9313 
  },
  'MMTA_Infectious_Disease': { 
    community_early: 1.0534, community_late: 0.9691, 
    institutional_early: 1.2234, institutional_late: 1.1255 
  },
  'MMTA_Other': { 
    community_early: 0.8756, community_late: 0.8055, 
    institutional_early: 1.0456, institutional_late: 0.9619 
  },
  'MMTA_Respiratory': { 
    community_early: 1.0067, community_late: 0.9262, 
    institutional_early: 1.1567, institutional_late: 1.0641 
  },
  'MMTA_Neuro_Rehab': { 
    community_early: 1.1290, community_late: 1.0387, 
    institutional_early: 1.2890, institutional_late: 1.1859 
  },
  'MMTA_Wounds': { 
    community_early: 1.1845, community_late: 1.0897, 
    institutional_early: 1.3345, institutional_late: 1.2277 
  },
  'MMTA_Complex_Nursing': { 
    community_early: 1.2956, community_late: 1.1919, 
    institutional_early: 1.4456, institutional_late: 1.3299 
  },
  'MMTA_Behavioral_Health': { 
    community_early: 0.8165, community_late: 0.7512, 
    institutional_early: 0.9665, institutional_late: 0.8892 
  },
  'MMTA_Medication_Management': { 
    community_early: 0.7834, community_late: 0.7207, 
    institutional_early: 0.9234, institutional_late: 0.8495 
  },
  'MMTA_Musculoskeletal': {
    community_early: 0.9678, community_late: 0.8904,
    institutional_early: 1.1178, institutional_late: 1.0284
  },
  'MMTA_Skin_Non_Surgical': {
    community_early: 1.0123, community_late: 0.9313,
    institutional_early: 1.1623, institutional_late: 1.0693
  }
};

// Functional Impairment Level Points by Admission Source and Timing
// Low/Medium/High thresholds differ based on source/timing
const FUNCTIONAL_THRESHOLDS = {
  community_early: { low: 9, high: 18 },
  community_late: { low: 8, high: 16 },
  institutional_early: { low: 10, high: 20 },
  institutional_late: { low: 9, high: 18 }
};

// Functional Multipliers by Level, Source, and Timing
const FUNCTIONAL_MULTIPLIERS = {
  community_early: { low: 0.82, medium: 1.0, high: 1.28 },
  community_late: { low: 0.80, medium: 0.96, high: 1.22 },
  institutional_early: { low: 0.88, medium: 1.04, high: 1.32 },
  institutional_late: { low: 0.85, medium: 1.0, high: 1.26 }
};

// Comorbidity Adjustment Multipliers by Source and Timing
const COMORBIDITY_MULTIPLIERS = {
  community_early: { none: 1.0, low: 1.025, high: 1.065 },
  community_late: { none: 1.0, low: 1.02, high: 1.055 },
  institutional_early: { none: 1.0, low: 1.035, high: 1.085 },
  institutional_late: { none: 1.0, low: 1.03, high: 1.075 }
};

// High-value comorbidities for PDGM (ICD-10 categories that increase payment)
const HIGH_VALUE_COMORBIDITIES = [
  // Diabetes complications
  'e11.2', 'e11.3', 'e11.4', 'e11.5', 'e11.6', 'diabetes with complications',
  // Heart failure
  'i50', 'chf', 'heart failure', 'congestive heart failure',
  // COPD/Respiratory
  'j44', 'j43', 'copd', 'chronic obstructive',
  // Renal
  'n18', 'ckd', 'chronic kidney', 'renal failure', 'esrd',
  // Stroke/CVA
  'i63', 'i64', 'stroke', 'cva', 'cerebrovascular',
  // Dementia
  'f01', 'f02', 'f03', 'g30', 'dementia', 'alzheimer',
  // Cancer (active treatment)
  'c', 'cancer', 'malignant', 'neoplasm',
  // Wound infection
  'l89', 'pressure ulcer', 'wound infection',
  // Peripheral vascular disease
  'i70', 'i73', 'pvd', 'peripheral vascular',
  // Paralysis
  'g81', 'g82', 'g83', 'hemiplegia', 'paraplegia', 'quadriplegia'
];

// Medium-value comorbidities
const MEDIUM_VALUE_COMORBIDITIES = [
  'hypertension', 'i10', 'htn',
  'diabetes', 'e11', 'dm',
  'atrial fibrillation', 'i48', 'afib',
  'obesity', 'e66',
  'depression', 'f32', 'f33',
  'anxiety', 'f41',
  'osteoarthritis', 'm15', 'm16', 'm17',
  'osteoporosis', 'm80', 'm81',
  'anemia', 'd64'
];

// ICD-10 to Clinical Group Mapping (enhanced)
const ICD10_CLINICAL_GROUPS = {
  // Neuro/Rehab (G codes, stroke, etc.)
  'G': 'MMTA_Neuro_Rehab',
  'I63': 'MMTA_Neuro_Rehab', // Cerebral infarction
  'I64': 'MMTA_Neuro_Rehab', // Stroke
  
  // Cardiac/Circulatory (I codes except stroke)
  'I': 'MMTA_Cardiac_Circulatory',
  'I50': 'MMTA_Cardiac_Circulatory', // Heart failure
  'I10': 'MMTA_Cardiac_Circulatory', // Hypertension
  'I25': 'MMTA_Cardiac_Circulatory', // Chronic ischemic heart
  
  // Respiratory (J codes)
  'J': 'MMTA_Respiratory',
  'J44': 'MMTA_Respiratory', // COPD
  'J18': 'MMTA_Respiratory', // Pneumonia
  
  // Endocrine (E codes)
  'E': 'MMTA_Endocrine',
  'E11': 'MMTA_Endocrine', // Type 2 diabetes
  'E10': 'MMTA_Endocrine', // Type 1 diabetes
  
  // GI/GU (K and N codes)
  'K': 'MMTA_GI_GU',
  'N': 'MMTA_GI_GU',
  'N18': 'MMTA_GI_GU', // CKD
  
  // Wounds (L codes, pressure ulcers)
  'L': 'MMTA_Wounds',
  'L89': 'MMTA_Wounds', // Pressure ulcer
  
  // Musculoskeletal (M codes)
  'M': 'MMTA_Musculoskeletal',
  'M79': 'MMTA_Musculoskeletal', // Soft tissue disorders
  
  // Infectious Disease (A, B codes, some specific)
  'A': 'MMTA_Infectious_Disease',
  'B': 'MMTA_Infectious_Disease',
  
  // Surgical aftercare (Z codes)
  'Z96': 'MMTA_Surgical_Aftercare', // Joint replacement
  'Z47': 'MMTA_Surgical_Aftercare', // Orthopedic aftercare
  'Z48': 'MMTA_Surgical_Aftercare', // Surgical aftercare
  
  // Behavioral (F codes)
  'F': 'MMTA_Behavioral_Health',
  
  // Skin non-surgical
  'S': 'MMTA_Skin_Non_Surgical'
};

// Map diagnosis to clinical group with ICD-10 code analysis
function mapDiagnosisToClinicalGroup(primaryDiagnosis, icd10Code) {
  // First try ICD-10 code mapping (most accurate)
  if (icd10Code) {
    const code = icd10Code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    
    // Check specific codes first (more specific = higher priority)
    for (const [prefix, group] of Object.entries(ICD10_CLINICAL_GROUPS)) {
      if (code.startsWith(prefix)) {
        // Handle stroke specially - it's neuro even though it starts with I
        if (code.startsWith('I63') || code.startsWith('I64')) {
          return 'MMTA_Neuro_Rehab';
        }
        return group;
      }
    }
  }
  
  // Fall back to text-based diagnosis mapping
  const diagnosis = (primaryDiagnosis || '').toLowerCase();
  
  // Wounds and ulcers
  if (diagnosis.includes('wound') || diagnosis.includes('ulcer') || diagnosis.includes('surgical site') || 
      diagnosis.includes('pressure injury') || diagnosis.includes('skin breakdown')) {
    return 'MMTA_Wounds';
  }
  
  // Cardiac/Circulatory
  if (diagnosis.includes('chf') || diagnosis.includes('heart failure') || diagnosis.includes('cardiac') || 
      diagnosis.includes('hypertension') || diagnosis.includes('atrial fibrillation') || diagnosis.includes('coronary')) {
    return 'MMTA_Cardiac_Circulatory';
  }
  
  // Respiratory
  if (diagnosis.includes('copd') || diagnosis.includes('respiratory') || diagnosis.includes('pneumonia') || 
      diagnosis.includes('lung') || diagnosis.includes('bronchitis') || diagnosis.includes('asthma')) {
    return 'MMTA_Respiratory';
  }
  
  // Endocrine
  if (diagnosis.includes('diabetes') || diagnosis.includes('thyroid') || diagnosis.includes('endocrine') ||
      diagnosis.includes('metabolic')) {
    return 'MMTA_Endocrine';
  }
  
  // Neuro/Rehab
  if (diagnosis.includes('stroke') || diagnosis.includes('cva') || diagnosis.includes('parkinson') || 
      diagnosis.includes('neuro') || diagnosis.includes('alzheimer') || diagnosis.includes('dementia') ||
      diagnosis.includes('multiple sclerosis') || diagnosis.includes('paralysis') || diagnosis.includes('brain')) {
    return 'MMTA_Neuro_Rehab';
  }
  
  // Surgical Aftercare
  if (diagnosis.includes('surgery') || diagnosis.includes('post-op') || diagnosis.includes('arthroplasty') || 
      diagnosis.includes('replacement') || diagnosis.includes('fracture') || diagnosis.includes('fusion') ||
      diagnosis.includes('amputation')) {
    return 'MMTA_Surgical_Aftercare';
  }
  
  // Musculoskeletal
  if (diagnosis.includes('arthritis') || diagnosis.includes('joint') || diagnosis.includes('back pain') ||
      diagnosis.includes('musculoskeletal') || diagnosis.includes('osteo')) {
    return 'MMTA_Musculoskeletal';
  }
  
  // Infectious Disease
  if (diagnosis.includes('infection') || diagnosis.includes('sepsis') || diagnosis.includes('uti') ||
      diagnosis.includes('cellulitis') || diagnosis.includes('osteomyelitis')) {
    return 'MMTA_Infectious_Disease';
  }
  
  // GI/GU
  if (diagnosis.includes('gi') || diagnosis.includes('bowel') || diagnosis.includes('kidney') || 
      diagnosis.includes('renal') || diagnosis.includes('bladder') || diagnosis.includes('gastrointestinal')) {
    return 'MMTA_GI_GU';
  }
  
  // Behavioral Health
  if (diagnosis.includes('depression') || diagnosis.includes('anxiety') || diagnosis.includes('behavioral') || 
      diagnosis.includes('psychiatric') || diagnosis.includes('mental')) {
    return 'MMTA_Behavioral_Health';
  }
  
  // Complex Nursing
  if (diagnosis.includes('complex') || diagnosis.includes('iv') || diagnosis.includes('infusion') || 
      diagnosis.includes('trach') || diagnosis.includes('ventilator') || diagnosis.includes('tube feeding')) {
    return 'MMTA_Complex_Nursing';
  }
  
  // Medication Management
  if (diagnosis.includes('medication') || diagnosis.includes('polypharmacy')) {
    return 'MMTA_Medication_Management';
  }
  
  return 'MMTA_Other';
}

// Calculate functional impairment level with source/timing consideration
function calculateFunctionalLevel(functionalData, sourceTimingKey) {
  let totalPoints = 0;
  
  // M1800 - Grooming (0-3)
  totalPoints += parseInt(functionalData.m1800_grooming) || 0;
  
  // M1810 - Dress Upper (0-3)
  totalPoints += parseInt(functionalData.m1810_dress_upper) || 0;
  
  // M1820 - Dress Lower (0-3)
  totalPoints += parseInt(functionalData.m1820_dress_lower) || 0;
  
  // M1830 - Bathing (0-6)
  totalPoints += parseInt(functionalData.m1830_bathing) || 0;
  
  // M1840 - Toilet Transfer (0-4)
  totalPoints += parseInt(functionalData.m1840_toilet_transfer) || 0;
  
  // M1850 - Transferring (0-5)
  totalPoints += parseInt(functionalData.m1850_transferring) || 0;
  
  // M1860 - Ambulation (0-6)
  totalPoints += parseInt(functionalData.m1860_ambulation) || 0;
  
  // Get thresholds based on admission source and timing
  const thresholds = FUNCTIONAL_THRESHOLDS[sourceTimingKey] || FUNCTIONAL_THRESHOLDS.community_early;
  
  // Determine level
  if (totalPoints >= thresholds.high) return { level: 'high', points: totalPoints };
  if (totalPoints >= thresholds.low) return { level: 'medium', points: totalPoints };
  return { level: 'low', points: totalPoints };
}

// Enhanced comorbidity analysis
function calculateComorbidityAdjustment(comorbidities, sourceTimingKey) {
  if (!comorbidities || comorbidities.length === 0) {
    return { level: 'none', count: 0, highValueCount: 0, mediumValueCount: 0 };
  }
  
  let highValueCount = 0;
  let mediumValueCount = 0;
  
  for (const comorbidity of comorbidities) {
    const cLower = (comorbidity || '').toLowerCase();
    
    // Check high-value comorbidities
    const isHighValue = HIGH_VALUE_COMORBIDITIES.some(hc => cLower.includes(hc));
    if (isHighValue) {
      highValueCount++;
      continue;
    }
    
    // Check medium-value comorbidities
    const isMediumValue = MEDIUM_VALUE_COMORBIDITIES.some(mc => cLower.includes(mc));
    if (isMediumValue) {
      mediumValueCount++;
    }
  }
  
  // Determine level based on high-value and total count
  let level = 'none';
  if (highValueCount >= 2 || (highValueCount >= 1 && mediumValueCount >= 2)) {
    level = 'high';
  } else if (highValueCount >= 1 || mediumValueCount >= 2) {
    level = 'low';
  }
  
  return { 
    level, 
    count: comorbidities.length, 
    highValueCount, 
    mediumValueCount 
  };
}

// Validate admission source from M1000 data
function validateAdmissionSource(data) {
  const discrepancies = [];
  const m1000 = data.m1000_from_where_admitted || data.admission_info?.m1000_from_where_admitted;
  const declaredSource = (data.admission_source || 'community').toLowerCase();
  
  // M1000 values: 1=Community, 2=Short-term acute hospital, 3=Long-term hospital, 
  // 4=SNF, 5=SNF transition, 6=Psychiatric, 7=Other
  const m1000Val = String(m1000 || '').trim();
  
  let expectedSource = 'community';
  if (['2', '3', '4'].includes(m1000Val) || 
      m1000Val.toLowerCase().includes('hospital') || 
      m1000Val.toLowerCase().includes('snf') ||
      m1000Val.toLowerCase().includes('skilled nursing') ||
      m1000Val.toLowerCase().includes('acute')) {
    expectedSource = 'institutional';
  }
  
  // Check for inpatient discharge date (indicates institutional)
  const inpatientDischargeDate = data.m1005_inpatient_discharge_date || 
    data.admission_info?.m1005_inpatient_discharge_date;
  
  if (inpatientDischargeDate && declaredSource === 'community') {
    discrepancies.push({
      type: 'admission_source_conflict',
      severity: 'high',
      message: 'Inpatient discharge date present but admission source is community',
      expected: 'institutional',
      actual: declaredSource,
      evidence: `M1005 Inpatient Discharge Date: ${inpatientDischargeDate}`,
      revenueImpact: 'Institutional admission typically increases payment by 5-10%'
    });
  }
  
  if (expectedSource !== declaredSource && m1000Val) {
    discrepancies.push({
      type: 'admission_source_mismatch',
      severity: 'medium',
      message: `M1000 value suggests ${expectedSource} but ${declaredSource} was used`,
      expected: expectedSource,
      actual: declaredSource,
      evidence: `M1000 value: ${m1000Val}`,
      revenueImpact: expectedSource === 'institutional' ? 
        'May be underreporting - institutional admission increases payment' :
        'May be overreporting - community admission has lower payment'
    });
  }
  
  return { validatedSource: expectedSource, discrepancies, m1000Value: m1000Val };
}

// Validate primary diagnosis code
function validatePrimaryDiagnosis(data) {
  const discrepancies = [];
  
  // Try to find diagnosis code from multiple possible fields
  let diagnosisCode = data.primary_diagnosis_code || '';
  const diagnosisDescription = data.primary_diagnosis || data.primary_diagnosis_description || '';
  
  // If no explicit code, try to extract from description
  if (!diagnosisCode && diagnosisDescription) {
    const codeMatch = diagnosisDescription.match(/\b([A-Z]\d{2}\.?\d{0,2})\b/i);
    if (codeMatch) {
      diagnosisCode = codeMatch[1].toUpperCase();
    }
  }
  
  // Check M1021 fields as well
  if (!diagnosisCode) {
    diagnosisCode = data.m1021_primary_diagnosis_code || '';
  }
  
  // Validate the code format if we have one
  if (diagnosisCode) {
    const cleanCode = diagnosisCode.toUpperCase().replace(/[^A-Z0-9.]/g, '');
    const validFormat = /^[A-Z]\d{2}\.?\d{0,4}$/.test(cleanCode);
    
    if (!validFormat) {
      discrepancies.push({
        type: 'invalid_diagnosis_code_format',
        severity: 'warning',
        message: `Primary diagnosis code format may be invalid: ${diagnosisCode}`,
        expected: 'ICD-10-CM format (e.g., I50.9, J44.1)',
        actual: diagnosisCode,
        revenueImpact: 'Invalid code may affect clinical grouping.'
      });
    }
  } else if (!diagnosisDescription) {
    // Only flag as critical if we have neither code nor description
    discrepancies.push({
      type: 'missing_primary_diagnosis',
      severity: 'critical',
      message: 'No primary diagnosis code or description found',
      expected: 'ICD-10-CM code (e.g., I50.9) or diagnosis description',
      actual: 'Not provided',
      revenueImpact: 'Required for PDGM grouping - using default clinical group.'
    });
  }
  
  return {
    validatedCode: diagnosisCode,
    validatedDescription: diagnosisDescription,
    discrepancies
  };
}

// Validate episode timing from dates
function validateEpisodeTiming(data) {
  const discrepancies = [];
  const declaredTiming = (data.episode_timing || 'early').toLowerCase();
  
  // Try to determine timing from dates
  const socDate = data.soc_date || data.patient_info?.soc_date || data.m0102_soc_roc_date;
  const assessmentDate = data.assessment_date || data.patient_info?.assessment_date;
  const m0110 = data.m0110_episode_timing || data.admission_info?.m0110_episode_timing;
  
  let expectedTiming = 'early';
  let daysSinceSoc = null;
  
  // Check M0110 first (most reliable)
  if (m0110) {
    const m0110Val = String(m0110).toLowerCase();
    if (m0110Val.includes('2') || m0110Val.includes('late')) {
      expectedTiming = 'late';
    }
  }
  
  // Calculate from dates if available
  if (socDate && assessmentDate) {
    try {
      const soc = new Date(socDate);
      const assessment = new Date(assessmentDate);
      daysSinceSoc = Math.floor((assessment - soc) / (1000 * 60 * 60 * 24));
      
      if (daysSinceSoc > 30) {
        expectedTiming = 'late';
      }
    } catch (e) {
      // Date parsing failed, ignore
    }
  }
  
  if (expectedTiming !== declaredTiming) {
    discrepancies.push({
      type: 'episode_timing_mismatch',
      severity: 'high',
      message: `Episode timing appears to be ${expectedTiming} but ${declaredTiming} was used`,
      expected: expectedTiming,
      actual: declaredTiming,
      evidence: daysSinceSoc !== null ? 
        `Days since SOC: ${daysSinceSoc}` : 
        (m0110 ? `M0110 value: ${m0110}` : 'Based on available date data'),
      revenueImpact: expectedTiming === 'early' ? 
        'Early episodes have higher payment rates' :
        'Late episodes have ~8% lower payment rates'
    });
  }
  
  return { 
    validatedTiming: expectedTiming, 
    discrepancies, 
    daysSinceSoc,
    m0110Value: m0110 
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { pdgmData, correctedPdgmData, wageIndex } = await req.json();

    if (!pdgmData) {
      return Response.json({ error: 'No PDGM data provided' }, { status: 400 });
    }

    // Fetch agency settings for wage index
    let appliedWageIndex = wageIndex || 1.0;
    try {
      const agencySettings = await base44.asServiceRole.entities.AgencySettings.list();
      if (agencySettings && agencySettings.length > 0 && agencySettings[0].wage_index) {
        appliedWageIndex = agencySettings[0].wage_index;
      }
    } catch (e) {
      // If no settings found, use default or provided value
      console.log('No agency settings found, using default wage index');
    }

    // Validate primary diagnosis code
    const diagnosisValidation = validatePrimaryDiagnosis(pdgmData);
    
    // Validate admission source and timing
    const sourceValidation = validateAdmissionSource(pdgmData);
    const timingValidation = validateEpisodeTiming(pdgmData);
    
    // Combine all discrepancies
    const allDiscrepancies = [
      ...diagnosisValidation.discrepancies,
      ...sourceValidation.discrepancies,
      ...timingValidation.discrepancies
    ];

    // Calculate original PDGM revenue
    const originalRevenue = calculatePDGMRevenue(pdgmData, appliedWageIndex);
    originalRevenue.dataValidation = {
      admissionSource: sourceValidation,
      episodeTiming: timingValidation,
      discrepancies: allDiscrepancies,
      hasDiscrepancies: allDiscrepancies.length > 0
    };
    
    // Calculate corrected PDGM revenue if provided
    let correctedRevenue = null;
    let revenueDifference = null;
    let percentageIncrease = null;

    if (correctedPdgmData) {
      // Apply validated values if not explicitly overridden
      const correctedWithValidation = {
        ...correctedPdgmData,
        // Only use validated values if corrected data doesn't explicitly set them
        admission_source: correctedPdgmData.admission_source || sourceValidation.validatedSource,
        episode_timing: correctedPdgmData.episode_timing || timingValidation.validatedTiming
      };
      
      correctedRevenue = calculatePDGMRevenue(correctedWithValidation, appliedWageIndex);
      correctedRevenue._appliedCorrections = correctedPdgmData._appliedCorrections || [];
      correctedRevenue._correctionCount = correctedPdgmData._correctionCount || 0;
      
      revenueDifference = correctedRevenue.totalPayment - originalRevenue.totalPayment;
      percentageIncrease = ((revenueDifference / originalRevenue.totalPayment) * 100).toFixed(2);
    }

    // Calculate alternative scenarios for comparison
    const scenarios = calculateAlternativeScenarios(pdgmData, appliedWageIndex);

    return Response.json({
      original: originalRevenue,
      corrected: correctedRevenue,
      revenueDifference: revenueDifference ? Math.round(revenueDifference * 100) / 100 : null,
      percentageIncrease: percentageIncrease ? parseFloat(percentageIncrease) : null,
      financialImpact: revenueDifference ? {
        perEpisode: Math.round(revenueDifference * 100) / 100,
        annual30Episodes: Math.round(revenueDifference * 30 * 100) / 100,
        annual60Episodes: Math.round(revenueDifference * 60 * 100) / 100
      } : null,
      dataValidation: {
        discrepancies: allDiscrepancies,
        hasDiscrepancies: allDiscrepancies.length > 0,
        validatedAdmissionSource: sourceValidation.validatedSource,
        validatedEpisodeTiming: timingValidation.validatedTiming,
        m1000Value: sourceValidation.m1000Value,
        m0110Value: timingValidation.m0110Value,
        daysSinceSoc: timingValidation.daysSinceSoc
      },
      alternativeScenarios: scenarios,
      wageIndexApplied: appliedWageIndex
    });

  } catch (error) {
    console.error('PDGM calculation error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

// Calculate all 4 scenario combinations for comparison
function calculateAlternativeScenarios(data, wageIndex = 1.0) {
  const scenarios = {};
  const combinations = [
    { admission_source: 'community', episode_timing: 'early', key: 'community_early' },
    { admission_source: 'community', episode_timing: 'late', key: 'community_late' },
    { admission_source: 'institutional', episode_timing: 'early', key: 'institutional_early' },
    { admission_source: 'institutional', episode_timing: 'late', key: 'institutional_late' }
  ];
  
  for (const combo of combinations) {
    const scenarioData = {
      ...data,
      admission_source: combo.admission_source,
      episode_timing: combo.episode_timing
    };
    const result = calculatePDGMRevenue(scenarioData, wageIndex);
    scenarios[combo.key] = {
      admissionSource: combo.admission_source,
      episodeTiming: combo.episode_timing,
      totalPayment: result.totalPayment,
      caseMixWeight: result.caseMixWeight,
      clinicalWeight: result.clinicalWeight,
      functionalMultiplier: result.functionalMultiplier,
      comorbidityMultiplier: result.comorbidityMultiplier
    };
  }
  
  // Find highest and lowest
  const payments = Object.values(scenarios).map(s => s.totalPayment);
  const maxPayment = Math.max(...payments);
  const minPayment = Math.min(...payments);
  
  return {
    scenarios,
    maxPayment,
    minPayment,
    paymentRange: maxPayment - minPayment,
    highestScenario: Object.entries(scenarios).find(([k, v]) => v.totalPayment === maxPayment)?.[0],
    lowestScenario: Object.entries(scenarios).find(([k, v]) => v.totalPayment === minPayment)?.[0]
  };
}

function calculatePDGMRevenue(data, wageIndex = 1.0) {
  // Extract data - try multiple fields for primary diagnosis
  const primaryDiagnosis = data.primary_diagnosis || data.primary_diagnosis_description || '';
  
  // Try multiple fields for ICD-10 code
  let icd10Code = data.primary_diagnosis_code || '';
  
  // If no code found, try to extract from primary_diagnosis text (e.g., "I50.9 - Heart Failure")
  if (!icd10Code && primaryDiagnosis) {
    const codeMatch = primaryDiagnosis.match(/\b([A-Z]\d{2}\.?\d{0,2})\b/i);
    if (codeMatch) {
      icd10Code = codeMatch[1].toUpperCase();
    }
  }
  
  const comorbidities = data.comorbidities || [];
  const admissionSource = (data.admission_source || 'community').toLowerCase();
  const episodeTiming = (data.episode_timing || 'early').toLowerCase();
  const functionalData = data.functional_scores || {};

  // Create source-timing key for lookups
  const sourceTimingKey = `${admissionSource}_${episodeTiming}`;

  // Determine clinical group from diagnosis
  const clinicalGroup = mapDiagnosisToClinicalGroup(primaryDiagnosis, icd10Code);
  
  // Get clinical weight based on source and timing
  const groupWeights = CLINICAL_GROUP_WEIGHTS[clinicalGroup] || CLINICAL_GROUP_WEIGHTS['MMTA_Other'];
  const clinicalWeight = groupWeights[sourceTimingKey] || groupWeights.community_early || 1.0;

  // Calculate functional level with source/timing consideration
  const functionalResult = calculateFunctionalLevel(functionalData, sourceTimingKey);
  const functionalMultipliers = FUNCTIONAL_MULTIPLIERS[sourceTimingKey] || FUNCTIONAL_MULTIPLIERS.community_early;
  const functionalMultiplier = functionalMultipliers[functionalResult.level];

  // Calculate comorbidity adjustment
  const comorbidityResult = calculateComorbidityAdjustment(comorbidities, sourceTimingKey);
  const comorbidityMultipliers = COMORBIDITY_MULTIPLIERS[sourceTimingKey] || COMORBIDITY_MULTIPLIERS.community_early;
  const comorbidityMultiplier = comorbidityMultipliers[comorbidityResult.level];

  // Calculate total case-mix weight (clinical × functional × comorbidity)
  // Note: Source and timing are already factored into the individual weights
  const caseMixWeight = clinicalWeight * functionalMultiplier * comorbidityMultiplier;

  // Apply wage index to base payment
  const adjustedBasePayment = Math.round(BASE_PAYMENT_RATE_2024 * wageIndex * 100) / 100;

  // Calculate payment with wage-adjusted base
  const totalPayment = Math.round(adjustedBasePayment * caseMixWeight * 100) / 100;

  return {
    basePayment: BASE_PAYMENT_RATE_2024,
    wageIndex: wageIndex,
    adjustedBasePayment: adjustedBasePayment,
    clinicalGroup,
    clinicalWeight: Math.round(clinicalWeight * 10000) / 10000,
    functionalLevel: functionalResult.level,
    functionalMultiplier: Math.round(functionalMultiplier * 10000) / 10000,
    functionalPoints: functionalResult.points,
    comorbidityLevel: comorbidityResult.level,
    comorbidityMultiplier: Math.round(comorbidityMultiplier * 10000) / 10000,
    comorbidityCount: comorbidityResult.count,
    comorbidityHighValueCount: comorbidityResult.highValueCount,
    comorbidityMediumValueCount: comorbidityResult.mediumValueCount,
    admissionSource,
    episodeTiming,
    sourceTimingKey,
    caseMixWeight: Math.round(caseMixWeight * 10000) / 10000,
    totalPayment,
    calculationBreakdown: {
      formula: wageIndex !== 1.0 
        ? 'Base Payment × Wage Index × Clinical Weight × Functional Multiplier × Comorbidity Multiplier'
        : 'Base Payment × Clinical Weight × Functional Multiplier × Comorbidity Multiplier',
      values: wageIndex !== 1.0
        ? `$${BASE_PAYMENT_RATE_2024} × ${wageIndex.toFixed(4)} × ${clinicalWeight.toFixed(4)} × ${functionalMultiplier.toFixed(4)} × ${comorbidityMultiplier.toFixed(4)}`
        : `$${BASE_PAYMENT_RATE_2024} × ${clinicalWeight.toFixed(4)} × ${functionalMultiplier.toFixed(4)} × ${comorbidityMultiplier.toFixed(4)}`,
      result: `$${totalPayment.toFixed(2)}`
    }
  };
}