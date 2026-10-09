// Decide whether a saved OASIS analysis is flagged for the agency's audit queue,
// and build the OASISAudit record when it is.
//
// The flag used to be written from the browser after a save, as the nurse, into
// an entity no client may create — so it never landed, and a client that could
// write it could also have filed an audit against any upload id it liked. The
// decision now runs on the server inside the same request that saves the upload
// (manageOASISRecords `create_upload`), from the analysis it is saving. This
// module is that decision's ONE source: base44/_shared/backendHelpers.mjs
// inlines the function below verbatim (`toString()`), so the browser and the
// broker cannot drift apart.
//
// Pure. No React, no SDK, no imports — the function is copied into a Deno
// function as text, so it may reference nothing but its own arguments and the
// thresholds it is handed.

export const OASIS_AUDIT_THRESHOLDS = Object.freeze({
  accuracy: 75,
  compliance: 80,
  overall: 70,
});

/**
 * Build the OASISAudit record for a saved upload, or null when the analysis
 * clears every threshold. No revenue or rescore figure is ever written: the
 * audit carries documentation gaps instead.
 *
 * @param {{id: string, patient_id?: string|null, patient_name?: string}} upload
 * @param {object} analysisResults
 * @param {{accuracy: number, compliance: number, overall: number}} thresholds
 */
export function buildOasisAuditRecord(upload, analysisResults, thresholds) {
  if (!upload || !analysisResults || typeof analysisResults !== 'object') return null;
  const limits = thresholds || { accuracy: 75, compliance: 80, overall: 70 };
  const score = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  const accuracy = score(analysisResults.accuracy_score);
  const compliance = score(analysisResults.compliance_score);
  const overall = score(analysisResults.overall_score);
  const below = (value, limit) => value !== null && value < limit;

  const shouldFlag = below(accuracy, limits.accuracy)
    || below(compliance, limits.compliance)
    || below(overall, limits.overall);
  if (!shouldFlag) return null;

  const list = (value) => (Array.isArray(value) ? value : []);
  const text = (value, max) => {
    if (value === null || value === undefined) return '';
    const s = typeof value === 'string' ? value : String(value);
    return s.length > max ? s.slice(0, max) : s;
  };

  // Each arm lines up with a trigger above, so a record flagged for one reason
  // is never mislabeled with another.
  let flagReason = 'low_accuracy';
  let priority = 'medium';
  if (below(accuracy, 60)) {
    flagReason = 'low_accuracy';
    priority = 'critical';
  } else if (below(compliance, limits.compliance)) {
    flagReason = 'low_compliance';
    priority = 'high';
  } else if (list(analysisResults.audit_risk_areas).some((r) => r && r.risk_level === 'high')) {
    flagReason = 'high_audit_risk';
    priority = 'high';
  } else if (below(accuracy, limits.accuracy)) {
    flagReason = 'low_accuracy';
    priority = 'high';
  } else if (below(overall, limits.overall)) {
    flagReason = 'low_overall_score';
    priority = 'high';
  }

  const keyIssues = [];
  for (const issue of list(analysisResults.accuracy_issues).slice(0, 5)) {
    keyIssues.push({
      category: 'accuracy',
      item: text(issue && issue.item, 120),
      issue: text(issue && issue.issue, 1000),
      severity: text(issue && issue.severity, 40),
      recommendation: text(issue && issue.recommendation, 1000),
    });
  }
  for (const concern of list(analysisResults.compliance_concerns).slice(0, 3)) {
    keyIssues.push({
      category: 'compliance',
      item: text(concern && concern.area, 120),
      issue: text(concern && concern.issue, 1000),
      severity: text(concern && concern.severity, 40),
      recommendation: text(concern && concern.recommendation, 1000),
    });
  }
  for (const risk of list(analysisResults.audit_risk_areas).slice(0, 3)) {
    keyIssues.push({
      category: 'audit_risk',
      item: text(risk && risk.area, 120),
      issue: text(risk && risk.explanation, 1000),
      severity: text(risk && risk.risk_level, 40),
      recommendation: text(risk && risk.mitigation, 1000),
    });
  }

  const documentationGaps = list(analysisResults.documentation_gaps).slice(0, 20).map((gap) => ({
    m_item: text(gap && (gap.m_item_code || gap.m_item), 40),
    gap_description: text(gap && gap.gap_description, 1000),
    question: text(gap && (gap.documentation_question || gap.question), 1000),
    supporting_documentation: text(gap && gap.supporting_documentation, 1000),
  }));

  const shown = (value) => (value === null ? 'N/A' : `${value}%`);
  return {
    oasis_upload_id: upload.id,
    patient_id: upload.patient_id || null,
    patient_name: text(upload.patient_name, 200),
    flag_reason: flagReason,
    priority,
    status: 'pending_review',
    accuracy_score: accuracy,
    compliance_score: compliance,
    overall_score: overall,
    key_issues: keyIssues,
    documentation_gaps: documentationGaps,
    summary: `Auto-flagged (${flagReason}) at ${priority} priority — accuracy ${shown(accuracy)}, `
      + `compliance ${shown(compliance)}, overall ${shown(overall)}.`,
  };
}
