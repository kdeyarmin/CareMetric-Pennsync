export const RISK_SEVERITY_ORDER = Object.freeze({ critical: 4, high: 3, medium: 2, low: 1, info: 0 });
export const RISK_DECISION_STATUSES = Object.freeze(["accepted", "overridden", "dismissed", "escalated"]);

export function normalizeRiskEvidence(evidence = {}) {
  return {
    source_type: evidence.source_type || evidence.sourceType || null,
    source_id: evidence.source_id || evidence.sourceId || null,
    observed_at: evidence.observed_at || evidence.observedAt || null,
    summary: evidence.summary || "",
    confidence: Number.isFinite(Number(evidence.confidence)) ? Math.max(0, Math.min(1, Number(evidence.confidence))) : null,
  };
}

export function validateRiskEvidence(evidence = {}) {
  const normalized = normalizeRiskEvidence(evidence);
  const missing = [];
  if (!normalized.source_type) missing.push("source_type");
  if (!normalized.source_id) missing.push("source_id");
  if (!normalized.observed_at) missing.push("observed_at");
  if (!normalized.summary) missing.push("summary");
  if (normalized.confidence === null) missing.push("confidence");
  return { valid: missing.length === 0, missing, evidence: normalized };
}

export function normalizeExplainableRiskAlert(alert = {}) {
  const evidence = (Array.isArray(alert.evidence) ? alert.evidence : []).map(normalizeRiskEvidence);
  const severity = String(alert.severity || "info").toLowerCase();
  return {
    id: alert.id || alert.alert_id || null,
    patient_id: alert.patient_id || alert.patientId || null,
    category: alert.category || null,
    severity: RISK_SEVERITY_ORDER[severity] === undefined ? "info" : severity,
    score: Number.isFinite(Number(alert.score)) ? Number(alert.score) : null,
    recommendation: alert.recommendation || "",
    rationale: alert.rationale || "",
    provenance_id: alert.provenance_id || alert.provenanceId || null,
    evidence,
    created_at: alert.created_at || alert.createdAt || new Date(0).toISOString(),
  };
}

export function validateExplainableRiskAlert(alert = {}) {
  const normalized = normalizeExplainableRiskAlert(alert);
  const missing = [];
  if (!normalized.patient_id) missing.push("patient_id");
  if (!normalized.category) missing.push("category");
  if (!normalized.recommendation) missing.push("recommendation");
  if (!normalized.provenance_id) missing.push("provenance_id");
  if (normalized.evidence.length === 0) missing.push("evidence");

  const evidenceResults = normalized.evidence.map(validateRiskEvidence);
  const invalidEvidence = evidenceResults.some((result) => !result.valid);
  if (invalidEvidence) missing.push("complete_evidence");

  return { valid: missing.length === 0, missing: [...new Set(missing)], alert: normalized };
}

export function rankExplainableRiskAlerts(alerts = []) {
  return alerts
    .map(normalizeExplainableRiskAlert)
    .sort((a, b) => {
      const severityDelta = RISK_SEVERITY_ORDER[b.severity] - RISK_SEVERITY_ORDER[a.severity];
      if (severityDelta !== 0) return severityDelta;
      return (b.score || 0) - (a.score || 0);
    });
}

export function toRiskAlertDisplayRow(alert = {}) {
  const normalized = normalizeExplainableRiskAlert(alert);
  return {
    id: normalized.id,
    patient_id: normalized.patient_id,
    category: normalized.category,
    severity: normalized.severity,
    score: normalized.score,
    recommendation: normalized.recommendation,
    evidence_count: normalized.evidence.length,
    evidence_summaries: normalized.evidence.map((item) => item.summary),
    provenance_id: normalized.provenance_id,
    created_at: normalized.created_at,
  };
}

export function createRiskDecisionEvent({ alertId, patientId, reviewerId, status, rationale, followUpTaskId = null, occurredAt = new Date().toISOString() } = {}) {
  if (!alertId) throw new Error("alertId is required");
  if (!patientId) throw new Error("patientId is required");
  if (!reviewerId) throw new Error("reviewerId is required");
  if (!RISK_DECISION_STATUSES.includes(status)) throw new Error("status must be accepted, overridden, dismissed, or escalated");
  if (["overridden", "dismissed"].includes(status) && !rationale) throw new Error("rationale is required for override or dismissal");
  return {
    alert_id: alertId,
    patient_id: patientId,
    reviewer_id: reviewerId,
    status,
    rationale: rationale || null,
    follow_up_task_id: followUpTaskId,
    occurred_at: occurredAt,
  };
}
