/**
 * Validation for the AI Compliance Auditor's model answer.
 *
 * The answer is rendered AND persisted as a ComplianceAudit row that the
 * compliance dashboards and the Medicare report read back, so it is shaped here
 * before either happens. A field the model got wrong is dropped or defaulted;
 * an answer whose score or level cannot be read at all is refused, because a
 * stored audit with a meaningless score would be counted in every average.
 */

export const COMPLIANCE_LEVELS = Object.freeze([
  'compliant',
  'minor_issues',
  'major_issues',
  'critical_issues',
]);

export const FINDING_RISK_LEVELS = Object.freeze(['critical', 'high', 'medium', 'low']);

const MAX_ITEMS = 50;
const MAX_TEXT = 2000;

const text = (value) => (typeof value === 'string' ? value.trim().slice(0, MAX_TEXT) : '');
const textList = (value) => (Array.isArray(value)
  ? value.map(text).filter(Boolean).slice(0, MAX_ITEMS)
  : []);
const records = (value) => (Array.isArray(value)
  ? value.filter((item) => item && typeof item === 'object' && !Array.isArray(item)).slice(0, MAX_ITEMS)
  : []);

function score(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) return null;
  return Math.round(number);
}

function finding(item) {
  const issue = text(item.issue);
  if (!issue) return null;
  const risk = text(item.risk_level).toLowerCase();
  return {
    category: text(item.category) || 'General',
    regulation: text(item.regulation),
    issue,
    risk_level: FINDING_RISK_LEVELS.includes(risk) ? risk : 'medium',
    current_state: text(item.current_state),
    required_state: text(item.required_state),
    actionable_steps: textList(item.actionable_steps),
    timeline: text(item.timeline),
    affected_areas: textList(item.affected_areas),
  };
}

const pick = (item, fields) => Object.fromEntries(fields.map((field) => [field, text(item[field])]));

/**
 * Return the shaped answer, or null when the score or compliance level is
 * unusable. Findings missing their `issue` text are dropped rather than
 * stored as empty problems.
 */
export function normalizeComplianceAuditResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const overall = score(result.overall_compliance_score);
  const level = text(result.compliance_level).toLowerCase();
  if (overall === null || !COMPLIANCE_LEVELS.includes(level)) return null;
  return {
    overall_compliance_score: overall,
    compliance_level: level,
    critical_findings: records(result.critical_findings).map(finding).filter(Boolean),
    minor_findings: records(result.minor_findings).map(finding).filter(Boolean),
    best_practices: records(result.best_practices)
      .map((item) => pick(item, ['area', 'recommendation', 'rationale', 'impact']))
      .filter((item) => item.recommendation),
    documentation_gaps: records(result.documentation_gaps)
      .map((item) => pick(item, ['field', 'importance', 'impact', 'suggested_action']))
      .filter((item) => item.field),
    trending_concerns: records(result.trending_concerns)
      .map((item) => pick(item, ['concern', 'evidence', 'recommendation', 'historical_context']))
      .filter((item) => item.concern),
    continuity_issues: records(result.continuity_issues)
      .map((item) => pick(item, ['issue', 'impact', 'previous_documentation', 'current_gap', 'resolution']))
      .filter((item) => item.issue),
    compliance_strengths: textList(result.compliance_strengths),
    priority_actions: records(result.priority_actions)
      .map((item) => pick(item, ['action', 'rationale', 'assigned_to', 'deadline']))
      .filter((item) => item.action),
  };
}

/** Map a normalized answer onto the ComplianceAudit status enum. */
export function complianceAuditStatus(normalized) {
  if (normalized.compliance_level === 'compliant') return 'passed';
  if (normalized.compliance_level === 'critical_issues') return 'critical';
  return 'flagged';
}

/**
 * Build the ComplianceAudit row for a normalized answer. The nurse is the
 * caller: the entity's create rule admits a row whose `nurse_email` is the
 * caller's own address (or an administrator), so a missing address is a
 * refusal here rather than a `'system'` placeholder the rule would reject.
 */
export function buildComplianceAuditRecord({ normalized, nurseEmail, patientId, visitId, now = new Date() }) {
  if (!normalized) throw new Error('A validated audit result is required');
  if (typeof nurseEmail !== 'string' || !nurseEmail.includes('@')) {
    throw new Error('The signed-in user has no email address to attribute this audit to');
  }
  if (typeof visitId !== 'string' || !visitId) throw new Error('A visit is required to attach this audit');
  return {
    visit_id: visitId,
    nurse_email: nurseEmail,
    patient_id: patientId,
    audit_date: now.toISOString(),
    compliance_score: normalized.overall_compliance_score,
    status: complianceAuditStatus(normalized),
    issues: [...normalized.critical_findings, ...normalized.minor_findings].map((item) => ({
      element: item.category,
      severity: item.risk_level,
      problem: item.issue,
      suggestion: item.actionable_steps.length ? item.actionable_steps.join('; ') : item.required_state,
    })),
    compliant_elements: normalized.compliance_strengths,
    audit_type: 'automated',
  };
}
