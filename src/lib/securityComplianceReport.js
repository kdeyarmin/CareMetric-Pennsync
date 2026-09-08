export function serializeAssessedSecurityChecks(assessedChecks) {
  return assessedChecks.map(({ icon: _icon, ...check }) => ({ ...check }));
}

export function buildSecurityComplianceReport({
  generatedDate,
  complianceScore,
  assessedChecks,
}) {
  return {
    schemaVersion: 2,
    generatedDate,
    complianceScore,
    userActivityEvents: null,
    userActivityHistory: "unavailable_pending_tenant_authorized_provenance",
    securityEventHistory: "unavailable_pending_tenant_authorized_provenance",
    criticalSecurityEvents: null,
    phiAccessSecurityEvents: null,
    checks: serializeAssessedSecurityChecks(assessedChecks),
  };
}
