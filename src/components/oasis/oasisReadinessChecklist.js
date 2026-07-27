const isPresent = (value) => {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && String(value).trim() !== '';
};

const normalizeText = (value) => String(value || '').trim().toLowerCase();

const parseDateOnly = (value) => {
  if (!isPresent(value)) return null;
  const s = String(value).trim();
  // Date-only ISO strings parse as UTC midnight while datetime/US formats
  // parse local — mixing the two skews a same-day comparison across the date
  // line. Anchor date-only values to local midnight.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const date = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
  return Number.isNaN(date.getTime()) ? null : date;
};

const FUNCTIONAL_ITEMS = [
  { key: 'm1800_grooming', label: 'M1800 Grooming', max: 3 },
  { key: 'm1810_dress_upper', label: 'M1810 Dress Upper', max: 3 },
  { key: 'm1820_dress_lower', label: 'M1820 Dress Lower', max: 3 },
  { key: 'm1830_bathing', label: 'M1830 Bathing', max: 6 },
  { key: 'm1840_toilet_transfer', label: 'M1840 Toilet Transfer', max: 4 },
  { key: 'm1850_transferring', label: 'M1850 Transferring', max: 5 },
  { key: 'm1860_ambulation', label: 'M1860 Ambulation', max: 6 },
];

const CHECKS = [
  {
    id: 'patient-identity',
    category: 'Patient identity',
    label: 'Patient identity is confirmed',
    severity: 'critical',
    fields: ['patient_name', 'patient_info.name', 'patient_id'],
    evaluate: (data) => isPresent(data.patient_name || data.patient_info?.name || data.patient_id),
    action: 'Confirm patient identity before signing or submitting the assessment.',
  },
  {
    id: 'assessment-type',
    category: 'Assessment setup',
    label: 'Assessment type is documented',
    severity: 'critical',
    fields: ['assessment_type', 'oasis_type'],
    evaluate: (data) => isPresent(data.assessment_type || data.oasis_type),
    action: 'Select the correct OASIS reason/type so timing and required items can be validated.',
  },
  {
    id: 'soc-or-roc-date',
    category: 'Assessment setup',
    label: 'SOC/ROC date is present',
    severity: 'critical',
    fields: ['soc_date', 'm0102_soc_roc_date', 'patient_info.soc_date'],
    evaluate: (data) => isPresent(data.soc_date || data.m0102_soc_roc_date || data.patient_info?.soc_date),
    action: 'Add the Start of Care or Resumption of Care date before submission.',
  },
  {
    id: 'assessment-date',
    category: 'Assessment setup',
    label: 'Assessment completion date is present',
    severity: 'critical',
    fields: ['assessment_date', 'patient_info.assessment_date'],
    evaluate: (data) => isPresent(data.assessment_date || data.patient_info?.assessment_date),
    action: 'Document the assessment completion date for audit and claim timing.',
  },
  {
    id: 'assessment-not-before-soc',
    category: 'Assessment setup',
    label: 'Assessment date is not before SOC/ROC',
    severity: 'critical',
    fields: ['assessment_date', 'soc_date', 'm0102_soc_roc_date'],
    evaluate: (data) => {
      const soc = parseDateOnly(data.soc_date || data.m0102_soc_roc_date || data.patient_info?.soc_date);
      const assessment = parseDateOnly(data.assessment_date || data.patient_info?.assessment_date);
      if (!soc || !assessment) return true;
      return assessment >= soc;
    },
    action: 'Correct the assessment date or SOC/ROC date; assessment date cannot precede the episode start.',
  },
  {
    id: 'admission-source',
    category: 'PDGM timing and source',
    label: 'Admission source is reconciled',
    severity: 'high',
    fields: ['admission_source', 'm1000_from_where_admitted'],
    evaluate: (data) => isPresent(data.admission_source || data.m1000_from_where_admitted || data.admission_info?.m1000_from_where_admitted),
    action: 'Reconcile M1000/admission source because institutional vs community source changes PDGM grouping.',
  },
  {
    id: 'episode-timing',
    category: 'PDGM timing and source',
    label: 'Episode timing is documented',
    severity: 'high',
    fields: ['episode_timing', 'm0110_episode_timing'],
    evaluate: (data) => isPresent(data.episode_timing || data.m0110_episode_timing || data.admission_info?.m0110_episode_timing),
    action: 'Document early/late episode timing or M0110 before revenue review.',
  },
  {
    id: 'primary-diagnosis',
    category: 'Diagnosis and coding',
    label: 'Primary diagnosis is coded or described',
    severity: 'critical',
    fields: ['primary_diagnosis_code', 'primary_diagnosis'],
    evaluate: (data) => isPresent(data.primary_diagnosis_code || data.primary_diagnosis || data.primary_diagnosis_description),
    action: 'Add the primary diagnosis and verify it supports the reason for home health services.',
  },
  {
    id: 'icd-format',
    category: 'Diagnosis and coding',
    label: 'Primary diagnosis code format is valid when supplied',
    severity: 'high',
    fields: ['primary_diagnosis_code'],
    evaluate: (data) => {
      if (!isPresent(data.primary_diagnosis_code)) return true;
      const cleanCode = String(data.primary_diagnosis_code).toUpperCase().replace(/[^A-Z0-9.]/g, '');
      // The 3rd character may be a letter in valid ICD-10-CM codes (e.g. M1A.0,
      // C4A, Z3A, O9A), so allow a digit OR letter there — requiring two digits
      // rejected those legitimate codes.
      return /^[A-Z][0-9][0-9A-Z]\.?[A-Z0-9]{0,4}$/.test(cleanCode);
    },
    action: 'Correct the ICD-10-CM format before billing or quality review.',
  },
  {
    id: 'functional-items-complete',
    category: 'Functional scoring',
    label: 'All PDGM functional M-items are complete',
    severity: 'critical',
    fields: FUNCTIONAL_ITEMS.map((item) => item.key),
    evaluate: (data) => FUNCTIONAL_ITEMS.every((item) => isPresent(data.functional_scores?.[item.key] ?? data[item.key])),
    action: 'Complete M1800-M1860 so functional level and outcome measures are not under-coded.',
  },
  {
    id: 'functional-items-valid',
    category: 'Functional scoring',
    label: 'Functional M-item values are in range',
    severity: 'critical',
    fields: FUNCTIONAL_ITEMS.map((item) => item.key),
    evaluate: (data) => FUNCTIONAL_ITEMS.every((item) => {
      const rawValue = data.functional_scores?.[item.key] ?? data[item.key];
      if (!isPresent(rawValue)) return true;
      // Number(), not parseInt(): parseInt truncates "3.7" to 3 and "6abc"
      // to 6, passing values that are not valid OASIS responses.
      const value = Number(rawValue);
      return Number.isInteger(value) && value >= 0 && value <= item.max;
    }),
    action: 'Correct out-of-range functional values before using the assessment for PDGM grouping.',
  },
  {
    id: 'quality-score-reviewed',
    category: 'Quality review',
    label: 'Documentation quality score is acceptable',
    severity: 'high',
    fields: ['qualityScore.overall_quality_score', 'analysisResults.quality_score'],
    evaluate: (_data, analysisResults = {}) => {
      const score = analysisResults.qualityScore?.overall_quality_score
        ?? analysisResults.quality_score
        ?? analysisResults.overall_quality_score;
      return !isPresent(score) || Number(score) >= 85;
    },
    action: 'Resolve quality findings or obtain reviewer approval for a score below 85%.',
  },
  {
    id: 'reviewer-attestation',
    category: 'Reviewer sign-off',
    label: 'Clinician/reviewer attestation is captured',
    severity: 'critical',
    fields: ['reviewer_attested', 'review_status', 'reviewer_name'],
    evaluate: (data) => {
      // A rejected/returned review is never attestation, no matter what other
      // fields are filled in.
      const status = normalizeText(data.review_status);
      if (['rejected', 'declined', 'returned', 'needs_revision'].includes(status)) return false;
      // A reviewer_name alone is who is ASSIGNED, not proof they attested —
      // it must not satisfy this check by itself.
      return data.reviewer_attested === true
        || ['reviewed', 'approved', 'attested', 'ready'].includes(status);
    },
    action: 'Capture reviewer attestation after resolving critical and high-priority checks.',
  },
];

export function buildOasisReadinessChecklist(pdgmData = {}, analysisResults = {}) {
  const items = CHECKS.map((check) => {
    const passed = Boolean(check.evaluate(pdgmData, analysisResults));
    return {
      id: check.id,
      category: check.category,
      label: check.label,
      severity: check.severity,
      fields: check.fields,
      status: passed ? 'complete' : 'needs_review',
      action: passed ? 'No action needed.' : check.action,
      blocksSubmission: !passed && check.severity === 'critical',
    };
  });

  const failedItems = items.filter((item) => item.status !== 'complete');
  const blockingItems = failedItems.filter((item) => item.blocksSubmission);
  const highPriorityItems = failedItems.filter((item) => item.severity === 'high');
  const passedItems = items.length - failedItems.length;
  const readinessScore = items.length > 0 ? Math.round((passedItems / items.length) * 100) : 100;

  return {
    items,
    summary: {
      totalItems: items.length,
      passedItems,
      failedItems: failedItems.length,
      blockingItems: blockingItems.length,
      highPriorityItems: highPriorityItems.length,
      readinessScore,
      status: blockingItems.length > 0 ? 'blocked' : highPriorityItems.length > 0 ? 'needs_review' : 'ready',
    },
  };
}

export function groupReadinessItemsByCategory(items = []) {
  return items.reduce((groups, item) => {
    const existing = groups.find((group) => group.category === item.category);
    if (existing) {
      existing.items.push(item);
      return groups;
    }
    groups.push({ category: item.category, items: [item] });
    return groups;
  }, []);
}
