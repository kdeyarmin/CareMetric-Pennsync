/**
 * PDGM clinical-group and comorbidity determination.
 *
 * Pure, deterministic classification of a patient's diagnoses into a PDGM
 * clinical group and CMS comorbidity-adjustment tier. Extracted verbatim from
 * OASISScrubber so the logic can be unit-tested and reused without rendering the
 * 3.9k-LOC component. No React, no network, no I/O — inputs are plain strings
 * and the outputs are plain objects.
 */

/**
 * Determine the most likely PDGM clinical group from the patient's diagnoses.
 *
 * Scores each candidate group by regex pattern matches (2 pts) and keyword
 * substring matches (1 pt) against the lower-cased diagnosis text, returning the
 * highest-scoring group. Defaults to MMTA-05 (Medication Management) when nothing
 * matches, matching CMS's catch-all behavior.
 *
 * @param {string} primaryDx
 * @param {string[]} [secondaryDx]
 * @returns {{ group: string, name: string, confidence: 'low'|'medium'|'high', matchedPatterns: string[] }}
 */
export function determineClinicalGroup(primaryDx, secondaryDx = []) {
  const allDx = [primaryDx, ...secondaryDx].filter(Boolean).map(d => d.toLowerCase());
  const dxText = allDx.join(' ');

  // MMTA clinical groups, matched against diagnosis-text patterns/keywords
  // (free-text regexes such as /fracture/ — not ICD-10 codes).
  const clinicalGroups = {
    // Musculoskeletal Rehabilitation
    'MMTA-01': {
      name: 'Musculoskeletal Rehabilitation',
      patterns: [/fracture/, /arthroplasty/, /joint replacement/, /hip replacement/, /knee replacement/, /spinal fusion/, /amputation/, /orthopedic/],
      keywords: ['fracture', 'arthroplasty', 'THR', 'TKR', 'joint replacement', 'hip surgery', 'knee surgery']
    },
    // Neuro Rehabilitation
    'MMTA-02': {
      name: 'Neuro Rehabilitation',
      patterns: [/stroke/, /cva/, /cerebrovascular/, /hemiplegia/, /hemiparesis/, /parkinson/, /multiple sclerosis/, /brain injury/, /spinal cord/],
      keywords: ['stroke', 'CVA', 'TIA', 'hemiplegia', 'parkinson', 'MS', 'brain injury']
    },
    // Wounds
    'MMTA-03': {
      name: 'Wounds',
      patterns: [/wound/, /ulcer/, /pressure injury/, /surgical wound/, /dehiscence/, /skin graft/, /debridement/],
      keywords: ['wound', 'ulcer', 'pressure injury', 'surgical wound', 'skin breakdown']
    },
    // Complex Nursing Interventions
    'MMTA-04': {
      name: 'Complex Nursing Interventions',
      patterns: [/ostomy/, /tracheostomy/, /ventilator/, /tube feeding/, /iv therapy/, /infusion/, /dialysis/],
      keywords: ['ostomy', 'trach', 'ventilator', 'TPN', 'IV therapy', 'PICC', 'dialysis']
    },
    // Medication Management
    'MMTA-05': {
      name: 'Medication Management, Teaching, Assessment (MMTA)',
      patterns: [/diabetes/, /heart failure/, /chf/, /copd/, /hypertension/, /anticoagul/, /cardiac/, /respiratory/],
      keywords: ['diabetes', 'CHF', 'COPD', 'HTN', 'cardiac', 'respiratory', 'medication management']
    },
    // Behavioral Health
    'MMTA-06': {
      name: 'Behavioral Health',
      patterns: [/depression/, /anxiety/, /bipolar/, /schizophrenia/, /dementia/, /alzheimer/, /psychiatric/, /mental/],
      keywords: ['depression', 'anxiety', 'dementia', 'Alzheimer', 'psychiatric', 'behavioral']
    }
  };

  let bestMatch = { group: 'MMTA-05', name: 'Medication Management, Teaching, Assessment (MMTA)', confidence: 'low', matchedPatterns: [] };
  let highestScore = 0;

  for (const [groupCode, group] of Object.entries(clinicalGroups)) {
    let score = 0;
    const matchedPatterns = [];

    for (const pattern of group.patterns) {
      if (pattern.test(dxText)) {
        score += 2;
        matchedPatterns.push(pattern.source);
      }
    }
    for (const keyword of group.keywords) {
      if (dxText.includes(keyword.toLowerCase())) {
        score += 1;
        if (!matchedPatterns.includes(keyword)) matchedPatterns.push(keyword);
      }
    }

    if (score > highestScore) {
      highestScore = score;
      bestMatch = {
        group: groupCode,
        name: group.name,
        confidence: score >= 4 ? 'high' : score >= 2 ? 'medium' : 'low',
        matchedPatterns
      };
    }
  }

  return bestMatch;
}

/**
 * Identify CMS-recognized comorbidities for the PDGM comorbidity adjustment.
 *
 * Scans the combined diagnosis + narrative text for high- and low-impact
 * comorbidity patterns and derives the adjustment tier per CMS rules: a single
 * high-impact comorbidity yields a `high` adjustment; two or more low-impact
 * comorbidities yield a `low` adjustment; otherwise `none`.
 *
 * @param {string} primaryDx
 * @param {string[]} [secondaryDx]
 * @param {string} [narrativeText]
 * @returns {{ high: object[], low: object[], count: number, adjustment: 'none'|'low'|'high' }}
 */
export function identifyComorbidities(primaryDx, secondaryDx = [], narrativeText) {
  const allText = [primaryDx, ...secondaryDx, narrativeText].filter(Boolean).join(' ').toLowerCase();

  // CMS-recognized comorbidities for PDGM adjustment
  const comorbidityCategories = {
    high: [
      { name: 'Diabetes with Complications', patterns: [/diabetes.*complication/, /diabetic.*neuropathy/, /diabetic.*nephropathy/, /diabetic.*retinopathy/, /diabetic.*foot/], icd10: ['E11.2', 'E11.4', 'E11.5', 'E11.6'] },
      { name: 'Heart Failure', patterns: [/heart failure/, /chf/, /congestive heart/, /hfref/, /hfpef/], icd10: ['I50', 'I50.1', 'I50.2', 'I50.9'] },
      { name: 'COPD', patterns: [/copd/, /chronic obstructive/, /emphysema/, /chronic bronchitis/], icd10: ['J44', 'J43', 'J42'] },
      { name: 'Chronic Kidney Disease', patterns: [/chronic kidney/, /ckd/, /renal failure/, /esrd/], icd10: ['N18', 'N18.3', 'N18.4', 'N18.5'] },
      { name: 'Malignant Neoplasm', patterns: [/cancer/, /malignant/, /neoplasm/, /carcinoma/, /metast/], icd10: ['C00-C96'] },
      { name: 'Stroke/CVA', patterns: [/stroke/, /cva/, /cerebrovascular accident/, /hemiplegia/], icd10: ['I63', 'I69'] }
    ],
    low: [
      { name: 'Hypertension', patterns: [/hypertension/, /htn/, /high blood pressure/], icd10: ['I10', 'I11', 'I12'] },
      { name: 'Atrial Fibrillation', patterns: [/atrial fibrillation/, /afib/, /a-fib/], icd10: ['I48'] },
      { name: 'Diabetes (uncomplicated)', patterns: [/diabetes mellitus/, /type 2 diabetes/, /type 1 diabetes/], icd10: ['E11.9', 'E10.9'] },
      { name: 'Osteoarthritis', patterns: [/osteoarthritis/, /degenerative joint/, /\boa\b/], icd10: ['M15', 'M16', 'M17'] },
      { name: 'Anxiety/Depression', patterns: [/anxiety/, /depression/, /depressive/], icd10: ['F41', 'F32', 'F33'] },
      { name: 'Obesity', patterns: [/obesity/, /obese/, /bmi.*3[0-9]/, /bmi.*4[0-9]/], icd10: ['E66'] }
    ]
  };

  const foundComorbidities = { high: [], low: [], count: 0, adjustment: 'none' };

  // The diabetes family spans both tiers: "Diabetes with Complications" (high)
  // and "Diabetes (uncomplicated)" (low) can match the same text. Treat them as
  // mutually exclusive so a complicated-diabetes dx is counted once (in high)
  // rather than double-counted in both tiers.
  let diabetesMatched = false;

  for (const category of ['high', 'low']) {
    for (const comorbidity of comorbidityCategories[category]) {
      const isDiabetes = comorbidity.name.startsWith('Diabetes');
      if (isDiabetes && diabetesMatched) continue;
      for (const pattern of comorbidity.patterns) {
        if (pattern.test(allText)) {
          foundComorbidities[category].push({
            name: comorbidity.name,
            icd10_codes: comorbidity.icd10,
            matched: pattern.source
          });
          foundComorbidities.count++;
          if (isDiabetes) diabetesMatched = true;
          break;
        }
      }
    }
  }

  // Determine adjustment level per CMS rules
  if (foundComorbidities.high.length >= 1) {
    foundComorbidities.adjustment = 'high';
  } else if (foundComorbidities.low.length >= 2) {
    foundComorbidities.adjustment = 'low';
  }

  return foundComorbidities;
}
