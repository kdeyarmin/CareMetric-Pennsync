export const METRIC_REFRESH_CADENCE = Object.freeze({
  realtime: 'realtime',
  hourly: 'hourly',
  daily: 'daily',
  manual: 'manual',
});

export const METRIC_DICTIONARY = Object.freeze([
  {
    id: 'referral_timely_initiation_rate',
    label: 'Referral timely initiation rate',
    owner: 'Clinical Operations',
    formula: 'referrals_started_within_policy_window / eligible_referrals * 100',
    sourceEntities: ['Referral', 'Visit'],
    refreshCadence: METRIC_REFRESH_CADENCE.daily,
    exportPath: '/ReportsAnalytics',
    displayFormat: 'percent',
  },
  {
    id: 'oasis_assessments_ready_for_submission',
    label: 'OASIS assessments ready for submission',
    owner: 'QA',
    formula: 'count(OASISAssessment where readiness_status = ready_for_submission)',
    sourceEntities: ['OASISAssessment', 'OASISAudit'],
    refreshCadence: METRIC_REFRESH_CADENCE.hourly,
    exportPath: '/OASISCenter',
    displayFormat: 'count',
  },
  {
    id: 'smart_note_average_compliance_score',
    label: 'SmartNote average compliance score',
    owner: 'Clinical Documentation',
    formula: 'average(Visit.ai_audit_score for documented visits in period)',
    sourceEntities: ['Visit', 'NoteConversion', 'ComplianceAudit'],
    refreshCadence: METRIC_REFRESH_CADENCE.daily,
    exportPath: '/AnalyticsDashboard',
    displayFormat: 'percent',
  },
  {
    id: 'open_incident_review_count',
    label: 'Open incident review count',
    owner: 'Compliance',
    formula: 'count(Incident where status in reported, under_review, corrective_action)',
    sourceEntities: ['Incident', 'Task'],
    refreshCadence: METRIC_REFRESH_CADENCE.hourly,
    exportPath: '/IncidentReview',
    displayFormat: 'count',
  },
  {
    id: 'credential_expiration_risk_count',
    label: 'Credential expiration risk count',
    owner: 'Administration',
    formula: 'count(PersonnelCredential expiring within policy window or pending approval)',
    sourceEntities: ['PersonnelCredential', 'User'],
    refreshCadence: METRIC_REFRESH_CADENCE.daily,
    exportPath: '/CredentialCompliance',
    displayFormat: 'count',
  },
  {
    id: 'communications_delivery_success_rate',
    label: 'Communications delivery success rate',
    owner: 'Operations',
    formula: '(delivered outbound FaxLog + SmsMessage) / attempted outbound communications * 100',
    sourceEntities: ['FaxLog', 'SmsMessage', 'DocumentSignature', 'ProviderFollowUpToken'],
    refreshCadence: METRIC_REFRESH_CADENCE.hourly,
    exportPath: '/CommsDashboard',
    displayFormat: 'percent',
  },
]);

export function metricById(metricId) {
  return METRIC_DICTIONARY.find((metric) => metric.id === metricId) || null;
}

export function validateMetricDefinition(metric) {
  const missing = [];
  for (const field of ['id', 'label', 'owner', 'formula', 'refreshCadence', 'exportPath', 'displayFormat']) {
    if (!metric?.[field]) missing.push(field);
  }
  if (!Array.isArray(metric?.sourceEntities) || metric.sourceEntities.length === 0) missing.push('sourceEntities');
  if (metric?.refreshCadence && !Object.values(METRIC_REFRESH_CADENCE).includes(metric.refreshCadence)) missing.push('valid refreshCadence');
  return { valid: missing.length === 0, missing };
}
