import test from "node:test";
import assert from "node:assert/strict";
import {
  createRiskDecisionEvent,
  rankExplainableRiskAlerts,
  toRiskAlertDisplayRow,
  validateExplainableRiskAlert,
  validateRiskEvidence,
} from "./explainableRisk.js";

const validEvidence = {
  source_type: "visit_note",
  source_id: "note-1",
  observed_at: "2026-07-22T10:00:00.000Z",
  summary: "Patient reported increased dyspnea and gained five pounds in seven days.",
  confidence: 0.91,
};

const validAlert = {
  id: "risk-1",
  patient_id: "pat-1",
  category: "hospitalization_risk",
  severity: "high",
  score: 82,
  recommendation: "Schedule same-day nurse call and medication reconciliation.",
  rationale: "Weight gain plus dyspnea indicates CHF exacerbation risk.",
  provenance_id: "ai-prov-1",
  evidence: [validEvidence],
  created_at: "2026-07-22T11:00:00.000Z",
};

test("validates risk evidence only when source, date, summary, and confidence are present", () => {
  assert.equal(validateRiskEvidence(validEvidence).valid, true);
  const result = validateRiskEvidence({ source_type: "oasis" });
  assert.equal(result.valid, false);
  assert.deepEqual(result.missing, ["source_id", "observed_at", "summary", "confidence"]);
});

test("requires provenance and complete evidence for explainable risk alerts", () => {
  assert.equal(validateExplainableRiskAlert(validAlert).valid, true);
  const result = validateExplainableRiskAlert({ ...validAlert, provenance_id: null, evidence: [{ source_id: "note-1" }] });
  assert.equal(result.valid, false);
  assert.deepEqual(result.missing, ["provenance_id", "complete_evidence"]);
});

test("ranks alerts by severity then score", () => {
  const ranked = rankExplainableRiskAlerts([
    { ...validAlert, id: "medium", severity: "medium", score: 95 },
    { ...validAlert, id: "critical-low", severity: "critical", score: 40 },
    { ...validAlert, id: "critical-high", severity: "critical", score: 90 },
  ]);
  assert.deepEqual(ranked.map((alert) => alert.id), ["critical-high", "critical-low", "medium"]);
});

test("creates PHI-minimized display rows with evidence summaries but not raw prompt content", () => {
  const row = toRiskAlertDisplayRow({ ...validAlert, raw_prompt: "do not export" });
  assert.equal(row.patient_id, "pat-1");
  assert.deepEqual(row.evidence_summaries, [validEvidence.summary]);
  assert.equal(row.raw_prompt, undefined);
});

test("creates clinician decision events and requires rationale for overrides/dismissals", () => {
  assert.deepEqual(createRiskDecisionEvent({
    alertId: "risk-1",
    patientId: "pat-1",
    reviewerId: "nurse-1",
    status: "accepted",
    occurredAt: "2026-07-22T12:00:00.000Z",
  }), {
    alert_id: "risk-1",
    patient_id: "pat-1",
    reviewer_id: "nurse-1",
    status: "accepted",
    rationale: null,
    follow_up_task_id: null,
    occurred_at: "2026-07-22T12:00:00.000Z",
  });
  assert.throws(() => createRiskDecisionEvent({ alertId: "risk-1", patientId: "pat-1", reviewerId: "nurse-1", status: "overridden" }), /rationale is required/);
  assert.throws(() => createRiskDecisionEvent({ alertId: "risk-1", patientId: "pat-1", reviewerId: "nurse-1", status: "ignored" }), /status must be/);
});
