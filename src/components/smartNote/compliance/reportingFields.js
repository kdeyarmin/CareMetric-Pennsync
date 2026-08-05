// Maps the deterministic chart cross-check + multi-visit trend findings — and the
// denial-guardrail findings (denialGuardrailEngine.js) — onto the stable reporting
// fields the dashboards already read, so conflicts, trends, and denial risks
// surface in compliance reporting instead of living only in the live UI:
//   - ComplianceAudit.issues          (structured element/severity/problem/suggestion)
//   - ComplianceAudit.status          (escalated to "critical" on a critical conflict)
//   - ComplianceAudit.acknowledgment  (the nurse override trail, when present)
//   - Visit.ai_tags                   (concise, searchable trend/safety tags)
//   - Visit.compliance_issues         (human-readable strings for critical conflicts)
// Pure + offline, so it is unit-testable under `node --test`.

/** @typedef {{ id?: string, severity: string, category: string, message: string, recommendation?: string }} ChartFinding */
/** @typedef {{ key: string, label: string, direction: string, display: string }} SustainedTrend */
/** @typedef {{ cluster: string, status: string, severity: string, message: string, remediation?: string, denial_risk?: number }} DenialFinding */

// The chart cross-check uses an advisory vocabulary (critical/warning/info); the
// compliance audit dashboards color-code on critical/high/medium/low. Translate
// so a fall-risk "warning" renders as a real (orange) issue rather than plain info.
const AUDIT_SEVERITY = { critical: "critical", warning: "high", info: "low" };

// The denial guardrail speaks critical/high/info; same dashboard vocabulary.
const DENIAL_AUDIT_SEVERITY = { critical: "critical", high: "high", info: "low" };

// The guardrail's cluster ids, humanized for audit issue rows / visit strings.
// Exported as the single label source so the live reviewer UI and the persisted
// compliance issues/tags name each cluster identically.
export const DENIAL_CLUSTER_LABELS = {
  homebound_narrative: "Homebound narrative",
  skilled_need_specificity: "Skilled need specificity",
  face_to_face: "Face-to-Face encounter",
  medical_necessity_linkage: "Medical necessity linkage",
};
const denialLabel = (f) => DENIAL_CLUSTER_LABELS[f.cluster] || f.cluster;

// Only FAILING clusters are reportable — a pass/not-applicable finding is UI
// context, not a compliance issue. "fail" mirrors the engine's GUARD_STATUS.FAIL
// (kept as a literal so this module stays dependency-free and node-testable).
const failedDenialFindings = (denialFindings = []) =>
  (denialFindings || []).filter((f) => f.status === "fail");

// Tags this module writes to Visit.ai_tags are namespaced so the bulk
// AIAutoTagger can tell them apart from its own semantic clinical tags and not
// treat a visit as "already tagged" just because it carries trend/safety tags.
export const SYSTEM_TAG_PREFIXES = ["trend:", "chart_flag:", "denial_risk:"];

/**
 * @param {ChartFinding[]} chartFindings
 * @returns {{ element: string, severity: string, problem: string, suggestion: string }[]}
 */
export function toAuditIssues(chartFindings = []) {
  return chartFindings.map((f) => ({
    element: f.category,
    severity: AUDIT_SEVERITY[f.severity] || f.severity,
    problem: f.message,
    suggestion: f.recommendation || "",
  }));
}

/**
 * Map failing denial-guardrail clusters onto the same structured audit-issue
 * shape as the chart findings, so denial risks render in the existing dashboards
 * without a schema change. Pass/not-applicable clusters never become issues.
 * @param {DenialFinding[]} denialFindings
 * @returns {{ element: string, severity: string, problem: string, suggestion: string }[]}
 */
export function toDenialAuditIssues(denialFindings = []) {
  return failedDenialFindings(denialFindings).map((f) => ({
    element: `Denial risk: ${denialLabel(f)}`,
    severity: DENIAL_AUDIT_SEVERITY[f.severity] || f.severity,
    problem: f.message,
    suggestion: f.remediation || "",
  }));
}

/**
 * Escalate the score-derived audit status when a critical chart conflict (e.g. an
 * allergy conflict) is present — a 100%-coverage note that documents a contra-
 * indicated medication must not report "passed". A critical FAILING denial-
 * guardrail cluster (e.g. a conclusory homebound statement) escalates the same
 * way: that note is a live denial risk regardless of its coverage score.
 * @param {"passed"|"flagged"|"critical"} baseStatus
 * @param {ChartFinding[]} chartFindings
 * @param {DenialFinding[]} denialFindings
 */
export function escalateAuditStatus(baseStatus, chartFindings = [], denialFindings = []) {
  const criticalConflict = chartFindings.some((f) => f.severity === "critical");
  const criticalDenial = failedDenialFindings(denialFindings).some((f) => f.severity === "critical");
  return criticalConflict || criticalDenial ? "critical" : baseStatus;
}

/**
 * Concise, searchable tags for Visit.ai_tags ("for searchability and trend
 * analysis") — one per sustained trend, one per chart finding category, and one
 * per FAILING denial-guardrail cluster.
 * @param {SustainedTrend[]} sustainedTrends
 * @param {ChartFinding[]} chartFindings
 * @param {DenialFinding[]} denialFindings
 * @returns {string[]} de-duplicated, order-preserving
 */
export function toAiTags(sustainedTrends = [], chartFindings = [], denialFindings = []) {
  const tags = [];
  for (const t of sustainedTrends) tags.push(`trend:${t.key}:${t.direction}`);
  for (const f of chartFindings) tags.push(`chart_flag:${f.category.toLowerCase()}`);
  for (const f of failedDenialFindings(denialFindings)) tags.push(`denial_risk:${f.cluster}`);
  return Array.from(new Set(tags));
}

/**
 * Visit.compliance_issues strings for the critical chart conflicts only (the
 * ones that warrant visit-level visibility, not the informational reconciliation
 * prompts).
 * @param {ChartFinding[]} chartFindings
 * @returns {string[]}
 */
export function toComplianceIssueStrings(chartFindings = []) {
  return chartFindings
    .filter((f) => f.severity === "critical")
    .map((f) => `[${f.category}] ${f.message}`);
}

/**
 * Visit.compliance_issues strings for the critical (blocking) denial-guardrail
 * failures only — the same visit-level bar the chart conflicts use.
 * @param {DenialFinding[]} denialFindings
 * @returns {string[]}
 */
export function toDenialComplianceIssueStrings(denialFindings = []) {
  return failedDenialFindings(denialFindings)
    .filter((f) => f.severity === "critical")
    .map((f) => `[Denial risk: ${denialLabel(f)}] ${f.message}`);
}

/**
 * The reporting fields written onto the saved Visit on every save path.
 * @param {{ chartFindings?: ChartFinding[], sustainedTrends?: SustainedTrend[], denialFindings?: DenialFinding[] }} args
 */
export function buildVisitReportingFields({ chartFindings = [], sustainedTrends = [], denialFindings = [] } = {}) {
  return {
    ai_tags: toAiTags(sustainedTrends, chartFindings, denialFindings),
    compliance_issues: [
      ...toComplianceIssueStrings(chartFindings),
      ...toDenialComplianceIssueStrings(denialFindings),
    ],
  };
}

/**
 * The ComplianceAudit fields derived from coverage + chart findings + denial-
 * guardrail findings, shared by the create, re-save-update, and offline-drain
 * paths so they never drift.
 * @param {{ coverageScore?: number, chartFindings?: ChartFinding[], acknowledgment?: object|null, appliedRules?: Array, denialFindings?: DenialFinding[] }} args
 */
export function buildAuditFields({ coverageScore = 0, chartFindings = [], acknowledgment = null, appliedRules = [], denialFindings = [] } = {}) {
  const base = coverageScore >= 90 ? "passed" : coverageScore >= 80 ? "flagged" : "critical";
  return {
    compliance_score: coverageScore,
    status: escalateAuditStatus(base, chartFindings, denialFindings),
    issues: [...toAuditIssues(chartFindings), ...toDenialAuditIssues(denialFindings)],
    // ALWAYS included, for the same reason as rule_versions below: omitting the
    // key on a re-save that resolved the critical findings left the prior
    // override stamp on the audit, so the record still claimed the nurse
    // acknowledged findings the note no longer has.
    acknowledgment: acknowledgment || null,
    // Version stamp: which agency-configured rules judged this note ([] when only
    // the static defaults applied). ALWAYS included — partial ComplianceAudit
    // updates only write the fields present, so omitting it on a re-save would
    // leave a stale prior stamp claiming rules judged a note they no longer do.
    rule_versions: Array.isArray(appliedRules) ? appliedRules : [],
  };
}

/** True when `tag` is one of this module's namespaced system tags. */
export function isSystemTag(tag) {
  return typeof tag === "string" && SYSTEM_TAG_PREFIXES.some((p) => tag.startsWith(p));
}

/**
 * True when the visit already carries a *semantic* (non-system) tag — i.e. the
 * bulk auto-tagger has nothing to add. A visit holding only trend/chart_flag
 * system tags is NOT considered tagged.
 * @param {string[]|undefined} tags
 */
export function hasSemanticTags(tags) {
  return Array.isArray(tags) && tags.some((t) => !isSystemTag(t));
}

/**
 * Union the auto-tagger's generated tags with whatever system tags the save
 * already wrote, so enrichment never clobbers the trend/safety tags.
 * @param {string[]|undefined} existing
 * @param {string[]|undefined} generated
 * @returns {string[]}
 */
export function mergeAiTags(existing, generated) {
  return Array.from(new Set([...(existing || []), ...(generated || [])]));
}
