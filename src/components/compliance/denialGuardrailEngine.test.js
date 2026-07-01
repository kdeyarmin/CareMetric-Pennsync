import test from "node:test";
import assert from "node:assert/strict";
import { runDenialGuardrail, CLUSTER, GUARD_STATUS } from "./denialGuardrailEngine.js";

const find = (res, cluster) => res.findings.find((f) => f.cluster === cluster);

// ── homebound narrative QUALITY (the headline case) ──

test("conclusory 'patient is homebound' FAILS despite passing a keyword check", () => {
  const res = runDenialGuardrail({
    noteText: "Patient is homebound. Provided nursing care.",
    visitType: "routine_visit",
  });
  const hb = find(res, CLUSTER.HOMEBOUND);
  assert.equal(hb.status, GUARD_STATUS.FAIL);
  assert.equal(hb.severity, "critical");
  assert.match(hb.message, /conclusory/i);
  assert.equal(res.blocking, true);
});

test("a substantive homebound narrative PASSES", () => {
  const res = runDenialGuardrail({
    noteText:
      "Patient is homebound due to severe exertional dyspnea; requires a rolling walker and one-person assist to ambulate and tolerates only a few steps before resting. " +
      "Skilled observation and assessment of an unstable CHF patient performed for management of CHF.",
    visitType: "routine_visit",
    context: { primaryDiagnosis: "CHF" },
  });
  const hb = find(res, CLUSTER.HOMEBOUND);
  assert.equal(hb.status, GUARD_STATUS.PASS);
});

test("homebound with a reason but no taxing-effort evidence is a high (not critical) risk", () => {
  const res = runDenialGuardrail({
    noteText: "Patient is homebound due to severe COPD. Skilled wound care to sacral ulcer for treatment of pressure ulcer.",
    visitType: "routine_visit",
  });
  const hb = find(res, CLUSTER.HOMEBOUND);
  assert.equal(hb.status, GUARD_STATUS.FAIL);
  assert.equal(hb.severity, "high");
  assert.match(hb.message, /taxing/i);
});

test("homebound not mentioned at all is a critical miss", () => {
  const res = runDenialGuardrail({
    noteText: "Skilled wound care performed to the sacral ulcer using sterile technique.",
    visitType: "routine_visit",
  });
  const hb = find(res, CLUSTER.HOMEBOUND);
  assert.equal(hb.status, GUARD_STATUS.FAIL);
  assert.match(hb.message, /not documented/i);
});

// ── skilled-need specificity ──

test("'provided nursing care' FAILS skilled-need specificity", () => {
  const res = runDenialGuardrail({ noteText: "Patient is homebound due to CVA requiring two-person assist. Provided nursing care.", visitType: "routine_visit" });
  const sn = find(res, CLUSTER.SKILLED_NEED);
  assert.equal(sn.status, GUARD_STATUS.FAIL);
  assert.equal(sn.severity, "critical");
});

test("a specific skilled service PASSES", () => {
  const res = runDenialGuardrail({
    noteText: "Skilled wound care: cleansed and measured the stage 3 sacral ulcer and applied an ordered hydrocolloid dressing using sterile technique due to pressure ulcer.",
    visitType: "routine_visit",
  });
  const sn = find(res, CLUSTER.SKILLED_NEED);
  assert.equal(sn.status, GUARD_STATUS.PASS);
});

// ── medical-necessity linkage ──

test("skilled service with no diagnosis linkage FAILS medical necessity", () => {
  const res = runDenialGuardrail({
    noteText: "Homebound due to weakness requiring a walker. Skilled wound care performed with sterile dressing change.",
    visitType: "routine_visit",
  });
  const mn = find(res, CLUSTER.MEDICAL_NECESSITY);
  assert.equal(mn.status, GUARD_STATUS.FAIL);
  assert.match(mn.message, /linkage/i);
});

test("linkage to the diagnosis PASSES medical necessity", () => {
  const res = runDenialGuardrail({
    noteText: "Homebound due to CHF with dyspnea, requires walker and assist. Skilled assessment for management of CHF exacerbation with lung auscultation.",
    visitType: "routine_visit",
    context: { primaryDiagnosis: "Congestive Heart Failure" },
  });
  const mn = find(res, CLUSTER.MEDICAL_NECESSITY);
  assert.equal(mn.status, GUARD_STATUS.PASS);
});

// ── F2F (referral-sourced, not note-scanned) ──

test("F2F cluster is not-applicable on a routine visit with no validation supplied", () => {
  const res = runDenialGuardrail({ noteText: "Homebound due to CVA needing walker; skilled wound care for ulcer.", visitType: "routine_visit" });
  const f2f = find(res, CLUSTER.F2F);
  assert.equal(f2f, undefined); // not evaluated for routine visits without context
});

test("admission requires F2F and FAILS when validation is missing/invalid", () => {
  const res = runDenialGuardrail({
    noteText: "Homebound due to fracture, non-weight-bearing, requires wheelchair and max assist. Skilled assessment and med reconciliation for management of post-op care.",
    visitType: "admission",
    context: { f2fValidation: { valid: false, reasons: ["No encounter within the window"] } },
  });
  const f2f = find(res, CLUSTER.F2F);
  assert.equal(f2f.status, GUARD_STATUS.FAIL);
  assert.equal(f2f.severity, "critical");
  assert.equal(res.blocking, true);
});

test("a valid F2F validation PASSES the cluster", () => {
  const res = runDenialGuardrail({
    noteText: "Homebound due to fracture, non-weight-bearing, requires wheelchair and max assist. Skilled assessment for management of post-op fracture care with med reconciliation.",
    visitType: "admission",
    context: { f2fValidation: { valid: true }, primaryDiagnosis: "Hip fracture" },
  });
  const f2f = find(res, CLUSTER.F2F);
  assert.equal(f2f.status, GUARD_STATUS.PASS);
});

// ── aggregation ──

test("a fully compliant note passes with zero denial risk", () => {
  const res = runDenialGuardrail({
    noteText:
      "Patient is homebound due to severe COPD with exertional dyspnea; requires a rolling walker and one-person assist, tolerates only a few steps. " +
      "Skilled observation and assessment for management of COPD with lung auscultation; medication management and teach-back completed.",
    visitType: "routine_visit",
    context: { primaryDiagnosis: "COPD" },
  });
  assert.equal(res.passed, true);
  assert.equal(res.blocking, false);
  assert.equal(res.denial_risk_score, 0);
});

test("denial risk score accumulates across failing clusters and caps at 100", () => {
  const res = runDenialGuardrail({ noteText: "Routine nursing visit completed.", visitType: "admission", context: { f2fValidation: { valid: false, reasons: ["missing"] } } });
  assert.ok(res.denial_risk_score > 0 && res.denial_risk_score <= 100);
  assert.equal(res.passed, false);
  assert.equal(res.blocking, true);
  // homebound missing + skilled missing + medical necessity + f2f all fail
  assert.ok(res.blocking_findings.length >= 2);
});

test("hospice routine visit evaluates comfort skilled need, not homebound", () => {
  const res = runDenialGuardrail({
    noteText: "Skilled assessment of uncontrolled pain; titrated ordered morphine for management of end-stage cancer pain.",
    serviceLine: "hospice",
    visitType: "routine_visit",
    context: { primaryDiagnosis: "cancer" },
  });
  assert.equal(find(res, CLUSTER.HOMEBOUND), undefined); // homebound N/A in hospice
  assert.ok(find(res, CLUSTER.SKILLED_NEED)); // comfort skilled need evaluated
});
