export function serializeAssessedSecurityChecks(assessedChecks) {
  return assessedChecks.map(({ icon: _icon, ...check }) => ({ ...check }));
}

/**
 * `logMetrics` is the measured log summary, or null when the logs were not
 * readable — in which case every history field is exported as unavailable and
 * null, never as zero.
 */
export function buildSecurityComplianceReport({
  generatedDate,
  complianceScore,
  assessedChecks,
  logMetrics = null,
}) {
  const measured = logMetrics && typeof logMetrics === "object";
  return {
    schemaVersion: 3,
    generatedDate,
    complianceScore,
    userActivityEvents: measured ? logMetrics.userActivityEvents : null,
    userActivityHistory: measured ? "loaded" : "unavailable",
    securityEventHistory: measured ? "loaded" : "unavailable",
    criticalSecurityEvents: measured ? logMetrics.criticalEvents : null,
    phiAccessSecurityEvents: measured ? logMetrics.phiAccess : null,
    checks: serializeAssessedSecurityChecks(assessedChecks),
  };
}
