import test from "node:test";
import assert from "node:assert/strict";
import {
  toAuditIssues,
  escalateAuditStatus,
  toAiTags,
  toComplianceIssueStrings,
  buildVisitReportingFields,
  buildAuditFields,
  isSystemTag,
  hasSemanticTags,
  mergeAiTags,
} from "./reportingFields.js";

const findings = [
  { id: "allergy_aspirin", severity: "critical", category: "Allergy", message: "References Aspirin, in allergies.", recommendation: "Verify the allergy." },
  { id: "med_recon_warfarin", severity: "info", category: "Medication", message: "Warfarin not on chart." },
  { id: "fall_risk", severity: "warning", category: "Safety", message: "High fall risk not addressed.", recommendation: "Document fall precautions." },
];

const trends = [
  { key: "weight", label: "Weight", direction: "up", display: "180 → 184 → 188 lbs" },
  { key: "o2", label: "Oxygen saturation", direction: "down", display: "97% → 95% → 92%" },
];

test("toAuditIssues maps to the structured shape and translates the severity vocabulary", () => {
  const issues = toAuditIssues(findings);
  assert.equal(issues.length, 3);
  assert.deepEqual(issues[0], {
    element: "Allergy",
    severity: "critical",
    problem: "References Aspirin, in allergies.",
    suggestion: "Verify the allergy.",
  });
  // warning -> high (orange in the dashboard), info -> low
  assert.equal(issues.find((i) => i.element === "Safety").severity, "high");
  assert.equal(issues.find((i) => i.element === "Medication").severity, "low");
});

test("toAuditIssues carries the recommendation through as suggestion, empty when absent", () => {
  assert.equal(toAuditIssues([{ category: "Medication", severity: "info", message: "x" }])[0].suggestion, "");
});

test("escalateAuditStatus forces critical when a critical conflict exists", () => {
  assert.equal(escalateAuditStatus("passed", findings), "critical");
});

test("escalateAuditStatus leaves the base status when no critical conflict", () => {
  const noCritical = findings.filter((f) => f.severity !== "critical");
  assert.equal(escalateAuditStatus("passed", noCritical), "passed");
  assert.equal(escalateAuditStatus("flagged", []), "flagged");
});

test("toAiTags builds searchable trend + chart tags, de-duplicated", () => {
  const tags = toAiTags(trends, findings);
  assert.ok(tags.includes("trend:weight:up"));
  assert.ok(tags.includes("trend:o2:down"));
  assert.ok(tags.includes("chart_flag:allergy"));
  assert.ok(tags.includes("chart_flag:medication"));
  assert.ok(tags.includes("chart_flag:safety"));
  assert.equal(tags.length, new Set(tags).size); // no duplicates
});

test("toComplianceIssueStrings includes only critical conflicts", () => {
  assert.deepEqual(toComplianceIssueStrings(findings), ["[Allergy] References Aspirin, in allergies."]);
});

test("buildVisitReportingFields bundles ai_tags + compliance_issues", () => {
  const out = buildVisitReportingFields({ chartFindings: findings, sustainedTrends: trends });
  assert.ok(out.ai_tags.includes("trend:weight:up"));
  assert.deepEqual(out.compliance_issues, ["[Allergy] References Aspirin, in allergies."]);
});

test("buildAuditFields derives score/status/issues and escalates on critical", () => {
  const out = buildAuditFields({ coverageScore: 95, chartFindings: findings });
  assert.equal(out.compliance_score, 95);
  assert.equal(out.status, "critical"); // 95 would be "passed" but a critical conflict escalates
  assert.equal(out.issues.length, 3);
  assert.ok(!("acknowledgment" in out));
});

test("buildAuditFields uses the score-based status when no critical conflict", () => {
  assert.equal(buildAuditFields({ coverageScore: 95, chartFindings: [] }).status, "passed");
  assert.equal(buildAuditFields({ coverageScore: 84, chartFindings: [] }).status, "flagged");
  assert.equal(buildAuditFields({ coverageScore: 70, chartFindings: [] }).status, "critical");
});

test("buildAuditFields includes the acknowledgment trail only when provided", () => {
  const ack = { acknowledged_by: "n@x.io", acknowledged_at: "2026-06-20T00:00:00Z", justification: "new order", finding_ids: ["allergy_aspirin"] };
  assert.deepEqual(buildAuditFields({ coverageScore: 90, chartFindings: findings, acknowledgment: ack }).acknowledgment, ack);
});

test("isSystemTag / hasSemanticTags distinguish namespaced tags from clinical tags", () => {
  assert.equal(isSystemTag("trend:weight:up"), true);
  assert.equal(isSystemTag("chart_flag:allergy"), true);
  assert.equal(isSystemTag("wound_care"), false);
  assert.equal(hasSemanticTags(["trend:weight:up", "chart_flag:allergy"]), false);
  assert.equal(hasSemanticTags(["trend:weight:up", "wound_care"]), true);
  assert.equal(hasSemanticTags(undefined), false);
});

test("mergeAiTags unions existing + generated without duplicates", () => {
  assert.deepEqual(
    mergeAiTags(["trend:weight:up", "wound_care"], ["wound_care", "chf_monitoring"]),
    ["trend:weight:up", "wound_care", "chf_monitoring"],
  );
  assert.deepEqual(mergeAiTags(undefined, ["a"]), ["a"]);
});

test("all mappers tolerate empty / missing input", () => {
  assert.deepEqual(toAuditIssues(), []);
  assert.deepEqual(toAiTags(), []);
  assert.deepEqual(toComplianceIssueStrings(), []);
  assert.equal(escalateAuditStatus("flagged"), "flagged");
  assert.deepEqual(buildVisitReportingFields().ai_tags, []);
  assert.equal(buildAuditFields({ coverageScore: 100 }).status, "passed");
});
