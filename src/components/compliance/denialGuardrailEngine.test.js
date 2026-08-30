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

// ── negation guards (regressions: negated text used to PASS) ──

test("'no longer homebound' is an eligibility FAIL, never a quality PASS", () => {
  const res = runDenialGuardrail({
    noteText:
      "Patient is no longer homebound due to improved strength and no longer needs the walker; leaves home independently. " +
      "Skilled observation and assessment of an unstable CHF patient for management of CHF.",
    visitType: "routine_visit",
  });
  const hb = find(res, CLUSTER.HOMEBOUND);
  assert.equal(hb.status, GUARD_STATUS.FAIL);
  assert.equal(hb.severity, "critical");
  assert.match(hb.message, /NOT homebound/);
  assert.equal(res.passed, false);
  assert.equal(res.blocking, true);
});

test("a negated or refused skilled service does not pass skilled-need specificity", () => {
  for (const note of [
    "Patient is homebound due to dyspnea; requires a walker and assist of one. No wound care performed this visit; wound has healed.",
    "Patient is homebound due to dyspnea; requires a walker and assist of one. Patient refused wound care and dressing change today.",
  ]) {
    const res = runDenialGuardrail({ noteText: note, visitType: "routine_visit" });
    const sn = find(res, CLUSTER.SKILLED_NEED);
    assert.equal(sn.status, GUARD_STATUS.FAIL, note);
  }
});

test("an affirmative skilled service still passes with the negation guard in place", () => {
  const res = runDenialGuardrail({
    noteText: "Homebound due to CVA; requires two-person assist to leave. Performed sterile wound care and dressing change to the sacral ulcer for treatment of the stage 3 wound.",
    visitType: "routine_visit",
  });
  assert.equal(find(res, CLUSTER.SKILLED_NEED).status, GUARD_STATUS.PASS);
});

test("the primary diagnosis matches on word boundaries, not substrings ('CA' vs 'catheter')", () => {
  const noteText =
    "Homebound due to weakness; requires a walker and assistance of one to leave home. " +
    "Skilled foley catheter change performed to monitor output.";
  const res = runDenialGuardrail({
    noteText,
    visitType: "routine_visit",
    context: { primaryDiagnosis: "CA of prostate" },
  });
  const mn = find(res, CLUSTER.MEDICAL_NECESSITY);
  assert.equal(mn.status, GUARD_STATUS.FAIL);
  assert.match(mn.message, /diagnosis/);
  // A real reference to the diagnosis still passes.
  const linked = runDenialGuardrail({
    noteText: noteText.replace("to monitor output", "to monitor output related to prostate CA obstruction"),
    visitType: "routine_visit",
    context: { primaryDiagnosis: "CA of prostate" },
  });
  assert.equal(find(linked, CLUSTER.MEDICAL_NECESSITY).status, GUARD_STATUS.PASS);
});

// ── F2F on admission without a wired validation ──

test("an admission with no linked F2F validation warns instead of reading green", () => {
  const res = runDenialGuardrail({
    noteText:
      "Homebound due to CVA; requires two-person assist to leave. Skilled observation and assessment of an unstable CHF patient for management of CHF.",
    visitType: "admission",
  });
  const f2f = find(res, CLUSTER.F2F);
  assert.equal(f2f.status, GUARD_STATUS.FAIL);
  assert.equal(f2f.severity, "high"); // visible + risk-scored, but not blocking
  assert.equal(res.blocking, false);
  assert.ok(res.denial_risk_score > 0);
  // A routine visit with no validation stays not-applicable.
  const routine = runDenialGuardrail({
    noteText: "Homebound due to CVA; requires two-person assist. Wound care performed for treatment of the sacral ulcer.",
    visitType: "routine_visit",
  });
  assert.equal(find(routine, CLUSTER.F2F), undefined);
});

// ── hospice comfort vocabulary ──

test("a compliant hospice comfort-care note passes skilled need", () => {
  const res = runDenialGuardrail({
    noteText:
      "Assessed worsening dyspnea and managed with repositioning, mouth care, and caregiver coaching on comfort care for end-stage COPD.",
    serviceLine: "hospice",
    visitType: "routine_visit",
  });
  const sn = find(res, CLUSTER.SKILLED_NEED);
  assert.equal(sn.status, GUARD_STATUS.PASS);
  assert.equal(res.blocking, false);
});

// ── post-term negation + medical-necessity scoping ──

test("a skilled service negated AFTER the term is not a delivered service", () => {
  // Regression: the negation guard only looked BEHIND the matched term, so
  // "Wound care declined by patient" and "Skilled service — none" both counted
  // as skilled care actually delivered and passed the guardrail.
  for (const noteText of [
    "Patient is homebound due to severe exertional dyspnea; requires a walker and one-person assist. Wound care declined by patient.",
    "Patient is homebound due to severe exertional dyspnea; requires a walker and one-person assist. Skilled service — none.",
  ]) {
    const res = runDenialGuardrail({ noteText, visitType: "routine_visit", context: { primaryDiagnosis: "CHF" } });
    assert.equal(find(res, CLUSTER.SKILLED_NEED).status, GUARD_STATUS.FAIL, noteText);
  }
});

test("an affirmative service followed by an unrelated negative still counts", () => {
  // The suffix guard must not swallow real documentation: "no complications"
  // qualifies the care that WAS delivered, it does not deny it.
  const res = runDenialGuardrail({
    noteText:
      "Patient is homebound due to severe exertional dyspnea; requires a rolling walker and one-person assist to ambulate. " +
      "Skilled observation and assessment performed for management of CHF: no complications noted.",
    visitType: "routine_visit",
    context: { primaryDiagnosis: "CHF" },
  });
  assert.equal(find(res, CLUSTER.SKILLED_NEED).status, GUARD_STATUS.PASS);
});

test("medical necessity cannot PASS when no skilled service is documented", () => {
  // Regression: with no skilled sentence the linkage check fell back to the
  // WHOLE note, so the homebound sentence's own "due to CHF" supplied both the
  // diagnosis and the linkage phrase and the cluster reported PASS — denial_risk
  // 0, evidence null — for a note documenting no skilled service at all.
  const res = runDenialGuardrail({
    noteText:
      "Patient is homebound due to CHF exacerbation; requires a rolling walker and one-person assist to ambulate and tolerates only a few steps before resting.",
    visitType: "routine_visit",
    context: { primaryDiagnosis: "CHF" },
  });
  const mn = find(res, CLUSTER.MEDICAL_NECESSITY);
  assert.equal(mn.status, GUARD_STATUS.FAIL);
  assert.match(mn.message, /no skilled service is documented/i);
});

// ── Unfilled template scaffolding must not read as a compliant narrative ────
test('untouched template homebound line does not PASS the homebound cluster', () => {
  // "due to" (causal) + "considerable effort" (taxing effort) both appear on this
  // seeded line, so the cluster used to report PASS at 0% denial risk while the
  // actual reason was still the literal blank "[diagnosis]".
  const res = runDenialGuardrail({
    noteText: [
      '• Homebound status: patient unable to leave home without considerable effort due to [diagnosis]',
      '• Skilled need: [wound care / medication management]',
    ].join('\n'),
    serviceLine: 'home_health',
    visitType: 'routine_visit',
  });
  const homebound = res.findings.find((f) => f.cluster === CLUSTER.HOMEBOUND);
  assert.equal(homebound.status, GUARD_STATUS.FAIL);
  assert.ok(res.denial_risk_score > 0, 'an unfilled template must carry denial risk');

  const skilled = res.findings.find((f) => f.cluster === CLUSTER.SKILLED_NEED);
  assert.equal(skilled.status, GUARD_STATUS.FAIL, 'a bracketed menu is not a documented service');
});

test('the same lines PASS once the blanks are genuinely filled in', () => {
  const res = runDenialGuardrail({
    noteText: [
      'Homebound status: patient unable to leave home without considerable effort due to severe exertional dyspnea and requires a walker with one-person assist.',
      'Skilled need: sterile dressing change to the stage 3 sacral ulcer for management of the wound.',
    ].join('\n'),
    serviceLine: 'home_health',
    visitType: 'routine_visit',
  });
  assert.equal(res.findings.find((f) => f.cluster === CLUSTER.HOMEBOUND).status, GUARD_STATUS.PASS);
  assert.equal(res.findings.find((f) => f.cluster === CLUSTER.SKILLED_NEED).status, GUARD_STATUS.PASS);
});

test('recognizes homebound narratives that never use the word "homebound"', () => {
  // HB_MENTION knew "leaving home" but not "unable to leave home", so a note the
  // required-element detector accepts fell through to "not documented" here.
  // coverageScore uses a FAILED homebound cluster to veto
  // homebound_status_verified, so the mismatch persisted `false` for good
  // documentation. The two vocabularies must agree.
  for (const phrasing of [
    'Patient unable to leave home due to severe dyspnea and requires a walker with one-person assistance.',
    'Patient is confined to the house due to advanced CHF and needs max assist to ambulate.',
    'Patient cannot leave the residence secondary to a recent CVA; requires two-person assist.',
  ]) {
    const res = runDenialGuardrail({ noteText: phrasing, serviceLine: 'home_health', visitType: 'routine_visit' });
    const hb = find(res, CLUSTER.HOMEBOUND);
    assert.equal(hb.status, GUARD_STATUS.PASS, `should PASS: ${phrasing} (got: ${hb.message})`);
  }
});

test('an explicit NOT-homebound statement still fails, whatever the phrasing', () => {
  const res = runDenialGuardrail({
    noteText: 'Patient is no longer homebound and ambulates in the community independently.',
    serviceLine: 'home_health', visitType: 'routine_visit',
  });
  assert.equal(find(res, CLUSTER.HOMEBOUND).status, GUARD_STATUS.FAIL);
});
