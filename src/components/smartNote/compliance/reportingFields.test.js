import test from "node:test";
import assert from "node:assert/strict";
import {
  toAuditIssues,
  toDenialAuditIssues,
  escalateAuditStatus,
  toAiTags,
  toComplianceIssueStrings,
  toDenialComplianceIssueStrings,
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

// Denial-guardrail findings in the engine's shape (denialGuardrailEngine.js):
// one critical fail, one high fail (no remediation), one pass, one not-applicable.
const denialFindings = [
  { cluster: "homebound_narrative", status: "fail", severity: "critical", denial_risk: 30, cop_reference: "42 CFR 484.55(c)", message: "Homebound statement is conclusory — missing a medical reason for confinement.", remediation: "Document the medical reason AND the taxing effort needed to leave home." },
  { cluster: "medical_necessity_linkage", status: "fail", severity: "high", denial_risk: 20, cop_reference: "42 CFR 484.75", message: "Medical-necessity linkage is weak — missing a diagnosis / condition reference." },
  { cluster: "skilled_need_specificity", status: "pass", severity: "critical", denial_risk: 0, cop_reference: "42 CFR 484.75", message: "A specific skilled service requiring professional judgment is documented." },
  { cluster: "face_to_face", status: "not_applicable", severity: "info", denial_risk: 0, cop_reference: "42 CFR 424.22", message: "No F2F validation supplied for this note (evaluated at referral intake)." },
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

test("toDenialAuditIssues maps only FAILING clusters, labeled and severity-translated", () => {
  const issues = toDenialAuditIssues(denialFindings);
  assert.equal(issues.length, 2); // pass / not_applicable clusters never become issues
  assert.deepEqual(issues[0], {
    element: "Denial risk: Homebound narrative",
    severity: "critical",
    problem: "Homebound statement is conclusory — missing a medical reason for confinement.",
    suggestion: "Document the medical reason AND the taxing effort needed to leave home.",
  });
  // high stays high (orange in the dashboard); a missing remediation yields ""
  assert.equal(issues[1].element, "Denial risk: Medical necessity linkage");
  assert.equal(issues[1].severity, "high");
  assert.equal(issues[1].suggestion, "");
});

test("escalateAuditStatus forces critical when a critical conflict exists", () => {
  assert.equal(escalateAuditStatus("passed", findings), "critical");
});

test("escalateAuditStatus leaves the base status when no critical conflict", () => {
  const noCritical = findings.filter((f) => f.severity !== "critical");
  assert.equal(escalateAuditStatus("passed", noCritical), "passed");
  assert.equal(escalateAuditStatus("flagged", []), "flagged");
});

test("escalateAuditStatus forces critical on a critical FAILING denial finding", () => {
  assert.equal(escalateAuditStatus("passed", [], denialFindings), "critical");
});

test("escalateAuditStatus ignores passing / non-critical denial clusters", () => {
  const noCriticalFail = denialFindings.filter((f) => !(f.status === "fail" && f.severity === "critical"));
  assert.equal(escalateAuditStatus("passed", [], noCriticalFail), "passed");
  // A PASSING critical cluster is not an escalation trigger.
  assert.equal(escalateAuditStatus("flagged", [], [denialFindings[2]]), "flagged");
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

test("toDenialComplianceIssueStrings includes only critical FAILING clusters", () => {
  assert.deepEqual(toDenialComplianceIssueStrings(denialFindings), [
    "[Denial risk: Homebound narrative] Homebound statement is conclusory — missing a medical reason for confinement.",
  ]);
});

test("toAiTags emits namespaced denial_risk tags for failing clusters only", () => {
  const tags = toAiTags(trends, findings, denialFindings);
  assert.ok(tags.includes("denial_risk:homebound_narrative"));
  assert.ok(tags.includes("denial_risk:medical_necessity_linkage"));
  assert.ok(!tags.includes("denial_risk:skilled_need_specificity")); // passed
  assert.ok(!tags.includes("denial_risk:face_to_face")); // not applicable
});

test("buildVisitReportingFields bundles ai_tags + compliance_issues", () => {
  const out = buildVisitReportingFields({ chartFindings: findings, sustainedTrends: trends });
  assert.ok(out.ai_tags.includes("trend:weight:up"));
  assert.deepEqual(out.compliance_issues, ["[Allergy] References Aspirin, in allergies."]);
});

test("buildVisitReportingFields folds denial findings into ai_tags + compliance_issues", () => {
  const out = buildVisitReportingFields({ chartFindings: findings, sustainedTrends: trends, denialFindings });
  assert.ok(out.ai_tags.includes("denial_risk:homebound_narrative"));
  assert.deepEqual(out.compliance_issues, [
    "[Allergy] References Aspirin, in allergies.",
    "[Denial risk: Homebound narrative] Homebound statement is conclusory — missing a medical reason for confinement.",
  ]);
});

test("buildAuditFields derives score/status/issues and escalates on critical", () => {
  const out = buildAuditFields({ coverageScore: 95, chartFindings: findings });
  assert.equal(out.compliance_score, 95);
  assert.equal(out.status, "critical"); // 95 would be "passed" but a critical conflict escalates
  assert.equal(out.issues.length, 3);
  assert.equal(out.acknowledgment, null);
});

test("buildAuditFields appends denial issues and escalates on a critical denial finding", () => {
  const out = buildAuditFields({ coverageScore: 95, denialFindings });
  assert.equal(out.status, "critical"); // 95 would be "passed" but a critical denial finding escalates
  assert.equal(out.issues.length, 2);
  assert.ok(out.issues.every((i) => i.element.startsWith("Denial risk:")));
});

test("buildAuditFields keeps the score-based status when denial fails are only high", () => {
  const out = buildAuditFields({ coverageScore: 95, denialFindings: [denialFindings[1]] });
  assert.equal(out.status, "passed");
  assert.equal(out.issues.length, 1);
});

test("buildAuditFields uses the score-based status when no critical conflict", () => {
  assert.equal(buildAuditFields({ coverageScore: 95, chartFindings: [] }).status, "passed");
  assert.equal(buildAuditFields({ coverageScore: 84, chartFindings: [] }).status, "flagged");
  assert.equal(buildAuditFields({ coverageScore: 70, chartFindings: [] }).status, "critical");
});

test("buildAuditFields always emits rule_versions so a re-save clears a stale stamp", () => {
  // Empty/absent appliedRules → [] (not omitted), so a partial ComplianceAudit
  // update overwrites a prior stamp instead of leaving it in place.
  assert.deepEqual(buildAuditFields({ coverageScore: 90 }).rule_versions, []);
  assert.deepEqual(buildAuditFields({ coverageScore: 90, appliedRules: [] }).rule_versions, []);
  const applied = [{ rule_name: "Homebound", cop_reference: "42 CFR 484.55(c)", category: "homebound_status", severity: "critical", effective_date: "2024-01-01" }];
  assert.deepEqual(buildAuditFields({ coverageScore: 90, appliedRules: applied }).rule_versions, applied);
});

test("buildAuditFields always emits the acknowledgment trail so a re-save clears a stale one", () => {
  const ack = { acknowledged_by: "n@x.io", acknowledged_at: "2026-06-20T00:00:00Z", justification: "new order", finding_ids: ["allergy_aspirin"] };
  assert.deepEqual(buildAuditFields({ coverageScore: 90, chartFindings: findings, acknowledgment: ack }).acknowledgment, ack);
  // Absent acknowledgment → null (not omitted), so a partial ComplianceAudit
  // update overwrites a prior override trail instead of leaving it in place.
  assert.equal(buildAuditFields({ coverageScore: 90 }).acknowledgment, null);
});

test("isSystemTag / hasSemanticTags distinguish namespaced tags from clinical tags", () => {
  assert.equal(isSystemTag("trend:weight:up"), true);
  assert.equal(isSystemTag("chart_flag:allergy"), true);
  assert.equal(isSystemTag("denial_risk:homebound_narrative"), true);
  assert.equal(isSystemTag("wound_care"), false);
  assert.equal(hasSemanticTags(["trend:weight:up", "chart_flag:allergy"]), false);
  assert.equal(hasSemanticTags(["denial_risk:homebound_narrative"]), false);
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
  assert.deepEqual(toDenialAuditIssues(), []);
  assert.deepEqual(toAiTags(), []);
  assert.deepEqual(toComplianceIssueStrings(), []);
  assert.deepEqual(toDenialComplianceIssueStrings(), []);
  assert.equal(escalateAuditStatus("flagged"), "flagged");
  assert.deepEqual(buildVisitReportingFields().ai_tags, []);
  assert.equal(buildAuditFields({ coverageScore: 100 }).status, "passed");
});
