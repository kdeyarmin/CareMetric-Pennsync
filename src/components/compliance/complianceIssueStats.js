/**
 * complianceIssueStats — derive the filtered/grouped view and summary counts from
 * a list of compliance issues.
 *
 * This computation was duplicated verbatim in ComplianceMonitoringDashboard and
 * the Compliance Center page. The two screens still build their own upstream
 * `complianceIssues` list (they source different signals), but the downstream
 * filter → group → count logic is identical, so it lives here once and is
 * unit-tested in isolation.
 *
 * @param {Array<{userId?: string, userName?: string, userRole?: string, title?: string, type?: string, severity?: string}>} complianceIssues
 * @param {{ searchTerm?: string, categoryFilter?: string, severityFilter?: string }} [filters]
 * @returns {{
 *   filteredIssues: Array<object>,
 *   groupedByUser: Record<string, { userName: string, userRole: string, issues: object[] }>,
 *   criticalCount: number, highCount: number, affectedUsers: number,
 *   overdueTraining: number, expiringCreds: number,
 * }}
 */
export function deriveComplianceIssueStats(
  complianceIssues,
  { searchTerm = "", categoryFilter = "all", severityFilter = "all" } = {}
) {
  const issues = Array.isArray(complianceIssues) ? complianceIssues : [];

  const filteredIssues = issues.filter((issue) => {
    const matchesSearch =
      !searchTerm ||
      (issue.userName || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (issue.title || "").toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = categoryFilter === "all" || issue.type === categoryFilter;
    const matchesSeverity = severityFilter === "all" || issue.severity === severityFilter;
    return matchesSearch && matchesCategory && matchesSeverity;
  });

  const groupedByUser = filteredIssues.reduce((acc, issue) => {
    if (!acc[issue.userId]) {
      acc[issue.userId] = {
        userName: issue.userName,
        userRole: issue.userRole,
        issues: [],
      };
    }
    acc[issue.userId].issues.push(issue);
    return acc;
  }, {});

  return {
    filteredIssues,
    groupedByUser,
    criticalCount: issues.filter((i) => i.severity === "critical").length,
    highCount: issues.filter((i) => i.severity === "high").length,
    affectedUsers: Object.keys(groupedByUser).length,
    overdueTraining: issues.filter((i) => i.type === "overdue_training").length,
    expiringCreds: issues.filter((i) => i.type === "expiring_credential").length,
  };
}
