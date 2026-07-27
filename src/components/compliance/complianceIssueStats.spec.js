import { describe, it, expect } from "vitest";
import { deriveComplianceIssueStats } from "./complianceIssueStats.js";

const ISSUES = [
  { userId: "u1", userName: "Alice RN", userRole: "nurse", title: "TB overdue", type: "overdue_training", severity: "critical" },
  { userId: "u1", userName: "Alice RN", userRole: "nurse", title: "License expiring", type: "expiring_credential", severity: "high" },
  { userId: "u2", userName: "Bob LPN", userRole: "nurse", title: "Doc incomplete", type: "incomplete_documentation", severity: "high" },
  { userId: "u3", userName: "Cara PT", userRole: "therapist", title: "TB overdue", type: "overdue_training", severity: "info" },
];

describe("deriveComplianceIssueStats", () => {
  it("computes counts over the full (unfiltered) issue list", () => {
    const s = deriveComplianceIssueStats(ISSUES);
    expect(s.criticalCount).toBe(1);
    expect(s.highCount).toBe(2);
    expect(s.overdueTraining).toBe(2);
    expect(s.expiringCreds).toBe(1);
    expect(s.filteredIssues).toHaveLength(4);
  });

  it("groups filtered issues by user", () => {
    const s = deriveComplianceIssueStats(ISSUES);
    expect(Object.keys(s.groupedByUser)).toEqual(["u1", "u2", "u3"]);
    expect(s.groupedByUser.u1.issues).toHaveLength(2);
    expect(s.groupedByUser.u1.userName).toBe("Alice RN");
    expect(s.affectedUsers).toBe(3);
  });

  it("filters by search term (userName or title, case-insensitive)", () => {
    expect(deriveComplianceIssueStats(ISSUES, { searchTerm: "alice" }).filteredIssues).toHaveLength(2);
    expect(deriveComplianceIssueStats(ISSUES, { searchTerm: "overdue" }).filteredIssues).toHaveLength(2);
    expect(deriveComplianceIssueStats(ISSUES, { searchTerm: "zzz" }).filteredIssues).toHaveLength(0);
  });

  it("filters by category (type) and severity; affectedUsers follows the filter", () => {
    const byType = deriveComplianceIssueStats(ISSUES, { categoryFilter: "overdue_training" });
    expect(byType.filteredIssues).toHaveLength(2);
    expect(byType.affectedUsers).toBe(2);
    const bySev = deriveComplianceIssueStats(ISSUES, { severityFilter: "high" });
    expect(bySev.filteredIssues).toHaveLength(2);
    // counts are always over the full list, not the filtered view
    expect(bySev.criticalCount).toBe(1);
  });

  it("defends against non-array input", () => {
    const s = deriveComplianceIssueStats(null);
    expect(s.filteredIssues).toEqual([]);
    expect(s.criticalCount).toBe(0);
    expect(s.affectedUsers).toBe(0);
  });
});

describe("grouping hardening", () => {
  it("survives prototype-key userIds and keeps unknown users distinct", () => {
    const issues = [
      { userId: "constructor", userName: "Weird", userRole: "nurse", title: "A", type: "x", severity: "high" },
      { userName: "No Id 1", userRole: "nurse", title: "B", type: "x", severity: "high" },
      { userName: "No Id 2", userRole: "nurse", title: "C", type: "x", severity: "high" },
    ];
    const res = deriveComplianceIssueStats(issues);
    expect(res.groupedByUser["constructor"].issues.length).toBe(1);
    // Two distinct unknown users must not collapse into one "undefined" bucket.
    expect(res.affectedUsers).toBe(3);
  });
});
