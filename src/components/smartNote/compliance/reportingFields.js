// Maps the deterministic chart cross-check + multi-visit trend findings onto the
// stable reporting fields the dashboards already read, so conflicts and trends
// surface in compliance reporting instead of living only in the live UI:
//   - ComplianceAudit.issues          (structured element/severity/problem/suggestion)
//   - ComplianceAudit.status          (escalated to "critical" on a critical conflict)
//   - ComplianceAudit.acknowledgment  (the nurse override trail, when present)
//   - Visit.ai_tags                   (concise, searchable trend/safety tags)
//   - Visit.compliance_issues         (human-readable strings for critical conflicts)
// Pure + offline, so it is unit-testable under `node --test`.

/** @typedef {{ id?: string, severity: string, category: string, message: string, recommendation?: string }} ChartFinding */
/** @typedef {{ key: string, label: string, direction: string, display: string }} SustainedTrend */

// The chart cross-check uses an advisory vocabulary (critical/warning/info); the
// compliance audit dashboards color-code on critical/high/medium/low. Translate
// so a fall-risk "warning" renders as a real (orange) issue rather than plain info.
const AUDIT_SEVERITY = { critical: "critical", warning: "high", info: "low" };

// Tags this module writes to Visit.ai_tags are namespaced so the bulk
// AIAutoTagger can tell them apart from its own semantic clinical tags and not
// treat a visit as "already tagged" just because it carries trend/safety tags.
export const SYSTEM_TAG_PREFIXES = ["trend:", "chart_flag:"];

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
 * Escalate the score-derived audit status when a critical chart conflict (e.g. an
 * allergy conflict) is present — a 100%-coverage note that documents a contra-
 * indicated medication must not report "passed".
 * @param {"passed"|"flagged"|"critical"} baseStatus
 * @param {ChartFinding[]} chartFindings
 */
export function escalateAuditStatus(baseStatus, chartFindings = []) {
  return chartFindings.some((f) => f.severity === "critical") ? "critical" : baseStatus;
}

/**
 * Concise, searchable tags for Visit.ai_tags ("for searchability and trend
 * analysis") — one per sustained trend and one per chart finding category.
 * @param {SustainedTrend[]} sustainedTrends
 * @param {ChartFinding[]} chartFindings
 * @returns {string[]} de-duplicated, order-preserving
 */
export function toAiTags(sustainedTrends = [], chartFindings = []) {
  const tags = [];
  for (const t of sustainedTrends) tags.push(`trend:${t.key}:${t.direction}`);
  for (const f of chartFindings) tags.push(`chart_flag:${f.category.toLowerCase()}`);
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
 * The reporting fields written onto the saved Visit on every save path.
 * @param {{ chartFindings?: ChartFinding[], sustainedTrends?: SustainedTrend[] }} args
 */
export function buildVisitReportingFields({ chartFindings = [], sustainedTrends = [] } = {}) {
  return {
    ai_tags: toAiTags(sustainedTrends, chartFindings),
    compliance_issues: toComplianceIssueStrings(chartFindings),
  };
}

/**
 * The ComplianceAudit fields derived from coverage + chart findings, shared by
 * the create, re-save-update, and offline-drain paths so they never drift.
 * @param {{ coverageScore?: number, chartFindings?: ChartFinding[], acknowledgment?: object|null }} args
 */
export function buildAuditFields({ coverageScore = 0, chartFindings = [], acknowledgment = null } = {}) {
  const base = coverageScore >= 90 ? "passed" : coverageScore >= 80 ? "flagged" : "critical";
  return {
    compliance_score: coverageScore,
    status: escalateAuditStatus(base, chartFindings),
    issues: toAuditIssues(chartFindings),
    ...(acknowledgment ? { acknowledgment } : {}),
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
