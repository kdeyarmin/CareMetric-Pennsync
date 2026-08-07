import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// <<<BEGIN SHARED HELPER: resolveAgencySettings — generated, edit base44/_shared/backendHelpers.mjs>>>
async function resolveAgencySettings(base44, agencyName) {
  let settings = [];
  const key = String(agencyName || '').trim();
  if (key) {
    settings = await base44.asServiceRole.entities.AgencySettings
      .filter({ agency_code: key }, '-created_date', 1)
      .catch(() => []);
    if (!settings?.length) {
      settings = await base44.asServiceRole.entities.AgencySettings
        .filter({ office_name: key }, '-created_date', 1)
        .catch(() => []);
    }
  }
  if (!settings?.length) {
    // Fail closed when the agency hint missed (or no hint but multiple tenant
    // rows exist). Newest-row-wins would silently apply another agency's fax
    // line / dial allowlist / wage index / quiet-hour timezone.
    if (key) return null;
    const newest = await base44.asServiceRole.entities.AgencySettings
      .list('-created_date', 5)
      .catch(() => []);
    if ((newest || []).length > 1) return null;
    settings = (newest || []).slice(0, 1);
  }
  return settings?.[0] || null;
}
// <<<END SHARED HELPER: resolveAgencySettings>>>

// CMS PDGM base payment rate
const BASE_PAYMENT_RATE_2026 = 2038.22; // CY2026 national standardized 30-day period payment, quality submitters (CMS-1828-F, eff. 2026-01-01)

// CY2026 national labor-related share of the 30-day base payment (CMS-1828-F). The
// wage index adjusts ONLY this labor portion; the non-labor remainder is paid
// unadjusted. Overridable per rate year via PDGMRateConfig.rates.laborShare.
// 0.749 per the VERIFIED value in docs/pdgm-cy2026.md (was 0.7676, which
// contradicted the repo's own verified table and skewed every wage-adjusted
// payment).
const PDGM_LABOR_SHARE_2026 = 0.749;

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

// Built-in default rate set. An admin can override ANY of these numbers via the
// PDGMRateSettings page (PDGMRateConfig entity); the handler merges their saved
// values over these defaults so they can keep their case-mix weights / base rate
// current each CMS rate year. Shape mirrors src/components/pdgm/pdgmRates.js.
const DEFAULT_RATES = {
  basePaymentRate: BASE_PAYMENT_RATE_2026,
  laborShare: PDGM_LABOR_SHARE_2026,
  clinicalGroupWeights: CLINICAL_GROUP_WEIGHTS,
  functionalThresholds: FUNCTIONAL_THRESHOLDS,
  functionalMultipliers: FUNCTIONAL_MULTIPLIERS,
  comorbidityMultipliers: COMORBIDITY_MULTIPLIERS,
};

// Recursively overlay the finite numbers in `over` onto `base`, preserving any
// value the override omits or sets to a non-number — so a partial/malformed
// saved override can never blank out a rate. Mirrors deepMergeNumbers in
// src/components/pdgm/pdgmRates.js.
function deepMergeNumbers(base, over) {
  const out = { ...(base || {}) };
  if (!over || typeof over !== 'object') return out;
  for (const key of Object.keys(over)) {
    const ov = over[key];
    if (ov && typeof ov === 'object' && !Array.isArray(ov)) {
      // Mirror the frontend guard (pdgmRates.js): when the base value isn't an
      // object, merge over {} — without this a malformed stored override (e.g.
      // clinicalGroupWeights.MMTA_Wounds: 2) clobbered the whole subtree and
      // the engine silently priced with the 1.0 fallback while the FE preview
      // showed the correct number.
      const baseVal = base?.[key];
      out[key] = deepMergeNumbers(baseVal && typeof baseVal === 'object' && !Array.isArray(baseVal) ? baseVal : {}, ov);
    } else if (typeof ov === 'number' && Number.isFinite(ov) && !(base?.[key] && typeof base[key] === 'object')) {
      // A stored scalar must not clobber an object subtree (e.g. rates.
      // functionalThresholds.community_early: 5 over { low, high }).
      out[key] = ov;
    }
  }
  return out;
}

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
  // Cancer (active treatment). NOTE: no bare 'c' — substring matching would
  // flag any diagnosis containing the letter "c" (scoliosis, fracture, …),
  // falsely inflating comorbidity level and PDGM payment.
  'cancer', 'malignant', 'neoplasm',
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
  // No bare 'dm' — it substring-matches "edema", "abdominal", etc.
  'diabetes', 'e11',
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
  // Cerebrovascular block I60–I69 (stroke, hemorrhage, post-stroke sequelae like
  // I61/I69) is Neuro/Stroke Rehab, not Cardiac. Longest-prefix wins so the
  // Cardiac I50/I10/I25 below are unaffected. Matches the intake preview.
  'I6': 'MMTA_Neuro_Rehab',
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
  'F': 'MMTA_Behavioral_Health'

  // NOTE: there is intentionally NO 'S' prefix here. ICD-10 chapter S (S00–T88)
  // is Injury/Poisoning, NOT skin — skin/subcutaneous conditions are chapter L
  // (mapped to Wounds above). The previous 'S' → 'MMTA_Skin_Non_Surgical' entry
  // mis-grouped every injury diagnosis as skin and inflated the wrong case-mix
  // weight. Injury principal diagnoses now fall through to the text-based mapping
  // (e.g. "fracture" → Surgical Aftercare) and finally MMTA_Other, rather than a
  // fabricated skin group. (A precise S-code → clinical-group mapping requires
  // the official CMS PDGM table; see the estimate disclaimer on the result.)
};

// Map diagnosis to clinical group with ICD-10 code analysis. `icdMap` is the
// admin-editable prefix→group map (defaults to ICD10_CLINICAL_GROUPS).
function mapDiagnosisToClinicalGroup(primaryDiagnosis, icd10Code, icdMap = ICD10_CLINICAL_GROUPS) {
  const map = icdMap && Object.keys(icdMap).length > 0 ? icdMap : ICD10_CLINICAL_GROUPS;
  // First try ICD-10 code mapping (most accurate)
  if (icd10Code) {
    const code = icd10Code.toUpperCase().replace(/[^A-Z0-9]/g, '');

    // Check specific codes first: sort prefixes longest-first so a specific
    // code (e.g. 'I63') wins over a generic one (e.g. 'I') regardless of the
    // object's declaration order.
    const orderedGroups = Object.entries(map).sort((a, b) => b[0].length - a[0].length);
    for (const [prefix, group] of orderedGroups) {
      if (code.startsWith(prefix)) {
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

  // GI/GU. Match 'gi' only as a whole word (\bgi\b) — a bare substring flags
  // "angina", "surgical", "meningitis", etc. and mis-groups them as GI/GU.
  if (/\bgi\b/.test(diagnosis) || diagnosis.includes('bowel') || diagnosis.includes('kidney') ||
      diagnosis.includes('renal') || diagnosis.includes('bladder') || diagnosis.includes('gastrointestinal')) {
    return 'MMTA_GI_GU';
  }

  // Behavioral Health
  if (diagnosis.includes('depression') || diagnosis.includes('anxiety') || diagnosis.includes('behavioral') ||
      diagnosis.includes('psychiatric') || diagnosis.includes('mental')) {
    return 'MMTA_Behavioral_Health';
  }

  // Complex Nursing. Match 'iv' only as a whole word (\biv\b) — a bare substring
  // flags "diverticulitis", "arrival", "survival", etc. and inflates them to the
  // higher-weighted Complex Nursing group.
  if (diagnosis.includes('complex') || /\biv\b/.test(diagnosis) || diagnosis.includes('infusion') ||
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
function calculateFunctionalLevel(functionalData, sourceTimingKey, thresholdsTable = FUNCTIONAL_THRESHOLDS) {
  let totalPoints = 0;
  // Sum only ratable OASIS response codes. M1830 code 6 = "Unable to rate —
  // artificial opening" is unassessable (see outcomeMeasureEngine excludeEither)
  // and must NOT count as max bathing points.
  const addRatable = (raw, { unratable = [] } = {}) => {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || unratable.includes(n)) return;
    totalPoints += n;
  };

  // M1800 - Grooming (0-3)
  addRatable(functionalData.m1800_grooming);

  // M1810 - Dress Upper (0-3)
  addRatable(functionalData.m1810_dress_upper);

  // M1820 - Dress Lower (0-3)
  addRatable(functionalData.m1820_dress_lower);

  // M1830 - Bathing (0-5 ratable; 6 = unratable artificial opening)
  addRatable(functionalData.m1830_bathing, { unratable: [6] });

  // M1840 - Toilet Transfer (0-4)
  addRatable(functionalData.m1840_toilet_transfer);

  // M1850 - Transferring (0-5)
  addRatable(functionalData.m1850_transferring);

  // M1860 - Ambulation (0-6)
  addRatable(functionalData.m1860_ambulation);

  // Get thresholds based on admission source and timing
  const thresholds = thresholdsTable[sourceTimingKey] || thresholdsTable.community_early || FUNCTIONAL_THRESHOLDS.community_early;

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

  // Negation guard: a free-text comorbidity that asserts the condition is ABSENT
  // ("No CHF", "Patient denies COPD", "ruled out heart failure") must not be
  // counted as a present comorbidity — doing so inflates the comorbidity level
  // and the PDGM payment (a Medicare overbilling/compliance risk). We err toward
  // NOT counting a negated entry (under-counting loses revenue but never
  // over-bills). Coded entries (e.g. "I50.9") have no negation words and are
  // unaffected.
  const NEGATION_RE = /\b(no|not|none|never|negative for|denies|denied|without|w\/o|absence of|ruled out|r\/o|free of|resolved)\b/;

  for (const comorbidity of comorbidities) {
    const cLower = (comorbidity || '').toLowerCase();

    if (!cLower.trim() || NEGATION_RE.test(cLower)) {
      continue;
    }

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
  // The extraction prompt emits "the checked code(s) or the facility type text"
  // (e.g. "5 - IRF", "02", "Inpatient rehabilitation facility"), so match the
  // digit anywhere in the value and the full facility-keyword set — a bare
  // equality check classified "5 - IRF" / "LTCH" / "Inpatient psych" as
  // community, producing false discrepancies and community-priced corrections.
  // Mirrors the M1000 handling in src/components/hub-tabs/OASISAnalyzer.jsx.
  // 2=acute hospital, 3=LTCH, 4=SNF, 5=IRF, 6=psychiatric hospital/unit — ALL
  // institutional under PDGM.
  const m1000Digit = (m1000Val.replace(/^0+(?=\d)/, '').match(/\b([1-7])\b/) || [])[1];
  // An explicit M1000 code decides on its own; the keyword scan is only a
  // fallback for values that carry no code at all. OR-ing the two mispriced
  // community admissions, because CMS's own response-1 wording — "Community (no
  // inpatient facility discharge within the past 14 days)" — contains an
  // institutional keyword and beat the code.
  if (m1000Digit) {
    if (['2', '3', '4', '5', '6'].includes(m1000Digit)) expectedSource = 'institutional';
  } else if (/hospital|snf|skilled nursing|acute|inpatient|rehab|irf|ltch|psych/i.test(m1000Val)) {
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

  // If no explicit code, try to extract from description. Allow alphanumerics
  // in the 3rd character and after the decimal — 7th-character extensions
  // (S72.001A), M1A/C4A/Z3A codes — or the old digits-only pattern captured a
  // dangling "S72." out of "S72.001A - hip fx".
  if (!diagnosisCode && diagnosisDescription) {
    const codeMatch = diagnosisDescription.match(/\b([A-Z][0-9][0-9A-Z]\.?[A-Z0-9]{0,4})\b/i);
    if (codeMatch) {
      diagnosisCode = codeMatch[1].toUpperCase();
    }
  }

  // Check M1021 fields as well
  if (!diagnosisCode) {
    diagnosisCode = data.m1021_primary_diagnosis_code || '';
  }

  // Validate the code format if we have one. The 3rd character may be a letter
  // in valid ICD-10-CM codes (M1A.0, C4A, Z3A, O9A) and the characters after
  // the decimal may include letters (7th-character extensions like S72.001A —
  // the norm for fracture/aftercare codes). Mirrors the readiness-checklist
  // pattern in src/components/oasis/oasisReadinessChecklist.js; the previous
  // digits-only pattern flagged those valid, common codes as invalid.
  if (diagnosisCode) {
    const cleanCode = diagnosisCode.toUpperCase().replace(/[^A-Z0-9.]/g, '');
    const validFormat = /^[A-Z][0-9][0-9A-Z]\.?[A-Z0-9]{0,4}$/.test(cleanCode);

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

// Parse a date value for calendar-day math: date-only "YYYY-MM-DD" strings are
// parsed as LOCAL midnight (a bare `new Date("2025-01-31")` is UTC midnight,
// which mixes badly with locally-parsed "01/01/2025" values); everything else
// falls through to the platform parser. Returns null when unparseable. Mirrors
// toLocalDate in src/components/oasis/dischargeComplianceEnforcer.js.
function parseDateForDayMath(v) {
  if (!v) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(v).trim());
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
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
    // M0110: response 01 = early, 02 = late. Match the exact code, not any
    // string containing the digit "2" (which would misread "2024", "12", …).
    const m0110Digits = m0110Val.replace(/[^0-9]/g, '');
    if (m0110Digits === '02' || m0110Digits === '2' || m0110Val.includes('late')) {
      expectedTiming = 'late';
    }
  }

  // Calculate from dates if available
  if (socDate && assessmentDate) {
    try {
      // Whole CALENDAR days, not a raw-millisecond floor: a floor-of-ms diff
      // undercounts by one across spring-forward DST (03/01 -> 03/31 in a US
      // zone is 29.96 days of ms) and whenever the formats mix local-parsed
      // (MM/DD/YYYY) with UTC-parsed (YYYY-MM-DD) dates — letting day 31 of
      // care validate as "early". Mirrors daysBetween in
      // src/components/oasis/dischargeComplianceEnforcer.js.
      const soc = parseDateForDayMath(socDate);
      const assessment = parseDateForDayMath(assessmentDate);
      if (soc && assessment) {
        daysSinceSoc = Math.round(
          (Date.UTC(assessment.getFullYear(), assessment.getMonth(), assessment.getDate()) -
            Date.UTC(soc.getFullYear(), soc.getMonth(), soc.getDate())) / (1000 * 60 * 60 * 24)
        );

        // Day 31 of care (daysSinceSoc >= 30, zero-based) starts the second
        // 30-day period — '> 30' validated day 31 as "early".
        if (daysSinceSoc >= 30) {
          expectedTiming = 'late';
        }
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

// Financial visibility gate. MIRRORS src/lib/permissions.canViewFinancials
// (which is isAdminLike): backend Deno modules can't import src/lib, so the
// literal owner email and the admin checks are duplicated here. Keep in sync.
// PDGM payment/revenue is restricted to administrators; clinical staff (nurses)
// must never receive dollar figures, even by calling this endpoint directly.
function canViewFinancials(user) {
  if (!user) return false;
  return (
    user.role === 'admin' ||
    user.account_type === 'agency_admin' ||
    user.account_type === 'super_admin'
  );
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    const { pdgmData, correctedPdgmData, wageIndex } = await req.json();

    if (!pdgmData) {
      return Response.json({ error: 'No PDGM data provided' }, { status: 400 });
    }

    // Wage index: an EXPLICIT caller value wins (e.g. the admin rate-verification
    // preview passes 1.0 to show the national-standardized amount); the agency's
    // saved wage_index applies only when the caller didn't specify one.
    let appliedWageIndex = Number.isFinite(Number(wageIndex)) && Number(wageIndex) > 0 ? Number(wageIndex) : 0;
    if (!appliedWageIndex) {
      try {
        const agencySettings = await resolveAgencySettings(base44, user?.agency_name);
        if (agencySettings?.wage_index) {
          appliedWageIndex = agencySettings.wage_index;
        }
      } catch (e) {
        console.log('No agency settings found, using default wage index');
      }
    }
    if (!appliedWageIndex) appliedWageIndex = 1.0;

    // Load the admin-editable PDGM rate set (PDGMRateConfig) and merge it over the
    // built-in defaults, so the agency can keep their case-mix weights / base rate
    // current. When they've entered + flagged their official CMS numbers, the
    // result is marked authoritative (isEstimate:false) rather than an estimate.
    let rates = DEFAULT_RATES;
    let isOfficial = false;
    let icdMap = ICD10_CLINICAL_GROUPS;
    try {
      let rateRows = [];
      if (user?.agency_name) {
        rateRows = await base44.asServiceRole.entities.PDGMRateConfig
          .filter({ agency_name: user.agency_name }, '-created_date', 1).catch(() => []);
      }
      if (!rateRows?.length) {
        // Callers with an agency must not inherit another tenant's (or a lone
        // unscoped) rate row — fall through to built-in defaults instead.
        if (!user?.agency_name) {
          const newest = await base44.asServiceRole.entities.PDGMRateConfig.list('-created_date', 5).catch(() => []);
          if ((newest || []).length <= 1) rateRows = (newest || []).slice(0, 1);
        }
      }
      const rateConfig = rateRows && rateRows.length > 0 ? rateRows[0] : null;
      if (rateConfig) {
        rates = deepMergeNumbers(DEFAULT_RATES, rateConfig.rates);
        isOfficial = rateConfig.is_official === true;
        // REPLACE-when-present so the admin can add/edit/remove prefixes.
        if (rateConfig.icd10_clinical_groups && Object.keys(rateConfig.icd10_clinical_groups).length > 0) {
          icdMap = rateConfig.icd10_clinical_groups;
        }
      }
    } catch (e) {
      console.log('No PDGM rate config found, using built-in default rates');
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

    // Server-side financial gate (defense in depth): clinical staff never receive
    // dollar figures, even via a direct API call — this is the real boundary that
    // backs the client-side FinancialGate. Clinical/validation data is still
    // returned, and the revenue math is skipped entirely for non-financial users.
    if (!canViewFinancials(user)) {
      // Strip the payment-impact strings the validation helpers attach to each
      // discrepancy (revenueImpact: admission-source / episode-timing payment
      // effects) so the clinical-only payload carries no financial information.
      const clinicalDiscrepancies = allDiscrepancies.map(({ revenueImpact, ...rest }) => rest);
      return Response.json({
        financialsRestricted: true,
        rateBasis: { isOfficial, isEstimate: !isOfficial },
        dataValidation: {
          discrepancies: clinicalDiscrepancies,
          hasDiscrepancies: clinicalDiscrepancies.length > 0,
          validatedAdmissionSource: sourceValidation.validatedSource,
          validatedEpisodeTiming: timingValidation.validatedTiming,
          m1000Value: sourceValidation.m1000Value,
          m0110Value: timingValidation.m0110Value,
          daysSinceSoc: timingValidation.daysSinceSoc,
        },
      });
    }

    // Calculate original PDGM revenue
    const originalRevenue = calculatePDGMRevenue(pdgmData, appliedWageIndex, rates, isOfficial, icdMap);
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

      correctedRevenue = calculatePDGMRevenue(correctedWithValidation, appliedWageIndex, rates, isOfficial, icdMap);
      correctedRevenue._appliedCorrections = correctedPdgmData._appliedCorrections || [];
      correctedRevenue._correctionCount = correctedPdgmData._correctionCount || 0;

      revenueDifference = correctedRevenue.totalPayment - originalRevenue.totalPayment;
      // Guard against divide-by-zero (Infinity/NaN) if base payment is 0.
      percentageIncrease = originalRevenue.totalPayment > 0
        ? ((revenueDifference / originalRevenue.totalPayment) * 100).toFixed(2)
        : '0.00';
    }

    // Calculate alternative scenarios for comparison
    const scenarios = calculateAlternativeScenarios(pdgmData, appliedWageIndex, rates, isOfficial, icdMap);

    return Response.json({
      rateBasis: {
        isOfficial,
        isEstimate: !isOfficial,
        basePayment: rates.basePaymentRate,
      },
      original: originalRevenue,
      corrected: correctedRevenue,
      // Gate on "a correction was computed" (revenueDifference != null), not on
      // truthiness — a legitimate $0.00 delta was reported as null while
      // percentageIncrease (the truthy string '0.00') was reported as 0, so
      // consumers couldn't distinguish "no correction" from "no change".
      revenueDifference: revenueDifference != null ? Math.round(revenueDifference * 100) / 100 : null,
      percentageIncrease: percentageIncrease != null ? parseFloat(percentageIncrease) : null,
      financialImpact: revenueDifference != null ? {
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
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});

// Calculate all 4 scenario combinations for comparison
function calculateAlternativeScenarios(data, wageIndex = 1.0, rates = DEFAULT_RATES, isOfficial = false, icdMap = ICD10_CLINICAL_GROUPS) {
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
    const result = calculatePDGMRevenue(scenarioData, wageIndex, rates, isOfficial, icdMap);
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

function calculatePDGMRevenue(data, wageIndex = 1.0, rates = DEFAULT_RATES, isOfficial = false, icdMap = ICD10_CLINICAL_GROUPS) {
  const clinicalGroupWeights = rates?.clinicalGroupWeights || CLINICAL_GROUP_WEIGHTS;
  const functionalMultipliersTable = rates?.functionalMultipliers || FUNCTIONAL_MULTIPLIERS;
  const comorbidityMultipliersTable = rates?.comorbidityMultipliers || COMORBIDITY_MULTIPLIERS;
  const functionalThresholdsTable = rates?.functionalThresholds || FUNCTIONAL_THRESHOLDS;
  const basePayment = Number.isFinite(rates?.basePaymentRate) ? rates.basePaymentRate : BASE_PAYMENT_RATE_2026;
  // Labor-related share (clamped to [0,1]); the wage index adjusts only this portion.
  const laborShareRaw = Number.isFinite(rates?.laborShare) ? rates.laborShare : PDGM_LABOR_SHARE_2026;
  const laborShare = Math.min(1, Math.max(0, laborShareRaw));

  // Extract data - try multiple fields for primary diagnosis
  const primaryDiagnosis = data.primary_diagnosis || data.primary_diagnosis_description || '';

  // Try multiple fields for ICD-10 code
  let icd10Code = data.primary_diagnosis_code || '';

  // If no code found, try to extract from primary_diagnosis text (e.g., "I50.9 - Heart Failure").
  // Must match validatePrimaryDiagnosis / oasisReadinessChecklist — the old digits-only
  // pattern truncated S72.001A to "S72." and missed M1A/C4A/Z3A codes entirely.
  if (!icd10Code && primaryDiagnosis) {
    const codeMatch = primaryDiagnosis.match(/\b([A-Z][0-9][0-9A-Z]\.?[A-Z0-9]{0,4})\b/i);
    if (codeMatch) {
      icd10Code = codeMatch[1].toUpperCase();
    }
  }

  const comorbidities = data.comorbidities || [];
  // Normalize free-text variants onto the two real PDGM buckets. An
  // unrecognized value ("inpatient", "hospital", "2nd") used to build a key
  // like "inpatient_early" that missed every rate table and silently priced
  // the period at the community_early fallback.
  const rawSource = String(data.admission_source || 'community').trim().toLowerCase();
  const admissionSource =
    /inst|inpatient|hospital|snf|skilled|facility|rehab|acute|ltch|irf/.test(rawSource)
      ? 'institutional'
      : 'community';
  const rawTiming = String(data.episode_timing || 'early').trim().toLowerCase();
  const episodeTiming = /late|subsequent|second|(?:^|\D)0?2(?:\D|$)/.test(rawTiming) ? 'late' : 'early';
  const inputWarnings = [];
  if (rawSource !== admissionSource) {
    inputWarnings.push(`Admission source "${data.admission_source}" interpreted as ${admissionSource}`);
  }
  if (rawTiming !== episodeTiming) {
    inputWarnings.push(`Episode timing "${data.episode_timing}" interpreted as ${episodeTiming}`);
  }
  const functionalData = data.functional_scores || {};

  // Create source-timing key for lookups
  const sourceTimingKey = `${admissionSource}_${episodeTiming}`;

  // Determine clinical group from diagnosis (admin-editable ICD→group map)
  const clinicalGroup = mapDiagnosisToClinicalGroup(primaryDiagnosis, icd10Code, icdMap);

  // Get clinical weight based on source and timing (from the merged rate table)
  const groupWeights = clinicalGroupWeights[clinicalGroup] || clinicalGroupWeights['MMTA_Other'] || CLINICAL_GROUP_WEIGHTS['MMTA_Other'];
  const clinicalWeight = groupWeights[sourceTimingKey] || groupWeights.community_early || 1.0;

  // Calculate functional level with source/timing consideration
  const functionalResult = calculateFunctionalLevel(functionalData, sourceTimingKey, functionalThresholdsTable);
  const functionalMultipliers = functionalMultipliersTable[sourceTimingKey] || functionalMultipliersTable.community_early || FUNCTIONAL_MULTIPLIERS.community_early;
  const functionalMultiplier = functionalMultipliers[functionalResult.level];

  // Calculate comorbidity adjustment
  const comorbidityResult = calculateComorbidityAdjustment(comorbidities, sourceTimingKey);
  const comorbidityMultipliers = comorbidityMultipliersTable[sourceTimingKey] || comorbidityMultipliersTable.community_early || COMORBIDITY_MULTIPLIERS.community_early;
  const comorbidityMultiplier = comorbidityMultipliers[comorbidityResult.level];

  // Calculate total case-mix weight (clinical × functional × comorbidity)
  // Note: Source and timing are already factored into the individual weights
  const caseMixWeight = clinicalWeight * functionalMultiplier * comorbidityMultiplier;

  // Apply the wage index to the LABOR SHARE only; the non-labor remainder is paid
  // unadjusted (CMS methodology). With wageIndex 1.0 this leaves base unchanged.
  const adjustedBasePayment = Math.round(basePayment * (laborShare * wageIndex + (1 - laborShare)) * 100) / 100;

  // Calculate payment with wage-adjusted base
  const totalPayment = Math.round(adjustedBasePayment * caseMixWeight * 100) / 100;

  return {
    // The case-mix weights / base rate come from the merged PDGMRateConfig (admin
    // values over built-in defaults). They are an ESTIMATE — not a billable
    // amount — UNTIL the admin enters their official CMS numbers and marks the
    // rate set official (is_official), at which point isEstimate flips to false.
    isEstimate: !isOfficial,
    estimateDisclaimer: isOfficial
      ? null
      : 'Estimate only — based on approximate case-mix weights, not confirmed official CMS PDGM rates. Set your official numbers in Admin → PDGM Rate Settings and mark them official.',
    ...(inputWarnings.length ? { inputWarnings } : {}),
    basePayment: basePayment,
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
        ? 'Wage-Adjusted Base (wage index applied to labor share only) × Clinical Weight × Functional Multiplier × Comorbidity Multiplier'
        : 'Base Payment × Clinical Weight × Functional Multiplier × Comorbidity Multiplier',
      values: wageIndex !== 1.0
        ? `$${adjustedBasePayment} × ${clinicalWeight.toFixed(4)} × ${functionalMultiplier.toFixed(4)} × ${comorbidityMultiplier.toFixed(4)}`
        : `$${basePayment} × ${clinicalWeight.toFixed(4)} × ${functionalMultiplier.toFixed(4)} × ${comorbidityMultiplier.toFixed(4)}`,
      result: `$${totalPayment.toFixed(2)}`
    }
  };
}