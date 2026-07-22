export const PR_READINESS_CHECKS = Object.freeze([
  "summary",
  "feature_workflow",
  "roles_permissions",
  "data_persistence",
  "security_privacy",
  "tests_validation",
  "docs_audit_updates",
  "rollback_plan",
]);

export function evaluatePrReadiness(evidence = {}) {
  const missing = PR_READINESS_CHECKS.filter((check) => !evidence[check]);
  return {
    ready: missing.length === 0,
    missing,
    completed: PR_READINESS_CHECKS.filter((check) => evidence[check]),
  };
}
