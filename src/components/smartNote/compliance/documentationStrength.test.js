import test from "node:test";
import assert from "node:assert/strict";
import {
  STRENGTH_LABELS,
  STRENGTH_LEVELS,
  analyzeDocumentationStrength,
  analyzeHomebound,
  analyzePatientResponse,
  analyzeSkilledNeed,
  analyzeTeaching,
} from "./documentationStrength.js";

// ── Language guardrails ────────────────────────────────────────────────────

test("no strength label ever certifies Medicare compliance", () => {
  for (const [level, label] of Object.entries(STRENGTH_LABELS)) {
    const lowered = label.toLowerCase();
    assert.ok(!/medicare compliant|is compliant|guaranteed|payable/.test(lowered), `${level}: "${label}"`);
  }
  assert.equal(STRENGTH_LABELS.strong, "No documentation gaps detected by PennSync's current rules");
  assert.equal(STRENGTH_LABELS.weak, "Potential documentation gap");
  assert.equal(STRENGTH_LABELS.partial, "Review recommended");
});

test("every finding is marked advisory and carries its rule, citation and remediation", () => {
  const { findings } = analyzeDocumentationStrength("Patient is homebound. Skilled nursing visit completed.");
  assert.ok(findings.length >= 4);
  for (const f of findings) {
    assert.equal(f.advisory, true, `${f.id} must be advisory`);
    assert.ok(f.rule, `${f.id} needs a rule statement`);
    assert.ok(f.citation, `${f.id} needs a citation`);
    assert.ok(f.remediation, `${f.id} needs remediation guidance`);
    assert.ok(STRENGTH_LEVELS.includes(f.level), `${f.id} level must be a known band`);
    assert.equal(f.label, STRENGTH_LABELS[f.level]);
  }
});

// ── Homebound ──────────────────────────────────────────────────────────────

test('"Patient is homebound." is weak, not documented', () => {
  const finding = analyzeHomebound("Patient is homebound. Vitals stable.");
  assert.equal(finding.level, "weak");
  assert.equal(finding.found.length, 0);
  assert.ok(finding.questions.length > 0, "a weak homebound statement must produce questions");
  assert.ok(
    finding.questions.some((q) => /medical condition/i.test(q)),
    "must ask for the medical reason",
  );
  assert.deepEqual(finding.evidence, ["Patient is homebound"]);
});

test("a fully supported homebound narrative grades strong", () => {
  const note =
    "Patient is homebound due to severe exertional dyspnea; requires a rolling walker and the "
    + "assistance of one person to ambulate, and tolerates only a few steps before resting. "
    + "She leaves the home only for medical appointments.";
  const finding = analyzeHomebound(note);
  assert.equal(finding.level, "strong");
  const ids = finding.found.map((f) => f.id);
  assert.ok(ids.includes("medical_reason"));
  assert.ok(ids.includes("assistive_device"));
  assert.ok(ids.includes("human_assistance"));
  assert.ok(ids.includes("exertional_symptom"));
});

test("homebound with a single supporting factor grades partial, not strong", () => {
  const finding = analyzeHomebound("Patient is homebound and uses a walker.");
  assert.equal(finding.level, "partial");
  assert.deepEqual(finding.found.map((f) => f.id), ["assistive_device"]);
  assert.ok(finding.missing.some((m) => m.id === "medical_reason"));
});

test("homebound not mentioned at all grades absent", () => {
  const finding = analyzeHomebound("BP 148/90. Dressing changed to the right heel.");
  assert.equal(finding.level, "absent");
  assert.deepEqual(finding.evidence, []);
});

test("homebound questions never suggest the clinical answer", () => {
  const finding = analyzeHomebound("Patient is homebound.");
  for (const q of finding.questions) {
    assert.ok(q.trim().endsWith("?"), `"${q}" must be a question`);
    assert.ok(!/^Document that /i.test(q), "must not dictate a fact to write");
  }
});

// ── Skilled need ───────────────────────────────────────────────────────────

test('"Skilled nursing visit completed." is weak', () => {
  const finding = analyzeSkilledNeed("Skilled nursing visit completed.");
  assert.equal(finding.level, "weak");
  assert.ok(finding.questions.some((q) => /skilled assessment/i.test(q)));
});

test("a described skilled service grades strong", () => {
  const note =
    "Performed a skilled assessment of the sacral wound and determined the granulation had "
    + "worsened since the prior visit; irrigated and packed the wound with saline gauze. Taught "
    + "the caregiver signs of infection requiring a call.";
  const finding = analyzeSkilledNeed(note);
  assert.equal(finding.level, "strong");
  const ids = finding.found.map((f) => f.id);
  assert.ok(ids.includes("skilled_assessment"));
  assert.ok(ids.includes("licensed_intervention"));
});

test("skilled need absent when nothing skilled is mentioned", () => {
  assert.equal(analyzeSkilledNeed("Visited the patient. Chatted with family.").level, "absent");
});

// ── Patient response ───────────────────────────────────────────────────────

test("an intervention with no response is flagged with that exact sentence", () => {
  const finding = analyzePatientResponse("Dressing change performed to the right heel wound.");
  assert.equal(finding.level, "weak");
  assert.equal(finding.interventionCount, 1);
  assert.equal(finding.unmatchedCount, 1);
  assert.match(finding.questions[0], /How did the patient respond/i);
  assert.match(finding.questions[0], /Dressing change performed/);
});

test("a response in the very next sentence counts", () => {
  const finding = analyzePatientResponse(
    "Dressing change performed to the right heel wound. Patient tolerated the procedure without complaint.",
  );
  assert.equal(finding.level, "strong");
  assert.equal(finding.unmatchedCount, 0);
});

test("a response in the same sentence counts", () => {
  const finding = analyzePatientResponse("Administered insulin; patient tolerated it without adverse effect.");
  assert.equal(finding.level, "strong");
  assert.equal(finding.unmatchedCount, 0);
});

test("mixed coverage grades partial and names only the unmatched intervention", () => {
  const note =
    "Dressing change performed to the right heel wound. Patient tolerated it well. "
    + "Administered the scheduled insulin dose.";
  const finding = analyzePatientResponse(note);
  assert.equal(finding.level, "partial");
  assert.equal(finding.interventionCount, 2);
  assert.equal(finding.unmatchedCount, 1);
  assert.match(finding.evidence[0], /insulin/);
  assert.ok(!finding.evidence.some((e) => /heel/.test(e)), "a matched intervention must not be flagged");
});

test("a note with no interventions and no response is absent, not weak", () => {
  const finding = analyzePatientResponse("BP 148/90. Lungs clear bilaterally.");
  assert.equal(finding.level, "absent");
  assert.equal(finding.interventionCount, 0);
});

// ── Teaching ───────────────────────────────────────────────────────────────

test('"Education provided." is weak', () => {
  const finding = analyzeTeaching("Education provided.");
  assert.equal(finding.level, "weak");
  assert.ok(finding.questions.some((q) => /teach-back|confirm understanding/i.test(q)));
});

test("teaching is graded only on the teaching sentences, not the whole note", () => {
  // "patient" and "reviewed the" appear elsewhere; a bare education line must
  // not borrow them as supporting factors.
  const note = "Patient alert and oriented. Reviewed the vital signs record. Education provided.";
  const finding = analyzeTeaching(note);
  assert.equal(finding.level, "weak");
});

test("a full teaching narrative grades strong", () => {
  const note =
    "Educated the patient and her daughter on the low-sodium diet using written materials and a "
    + "hands-on review of food labels; patient correctly identified three high-sodium foods on "
    + "teach-back and verbalized understanding. Will reinforce daily weight monitoring next visit.";
  const finding = analyzeTeaching(note);
  assert.equal(finding.level, "strong");
  const ids = finding.found.map((f) => f.id);
  assert.ok(ids.includes("teach_back"));
  assert.ok(ids.includes("understanding"));
  assert.ok(ids.includes("remaining_need"));
});

test("teaching not mentioned grades absent", () => {
  assert.equal(analyzeTeaching("BP 148/90. Wound clean and dry.").level, "absent");
});

// ── Aggregate ──────────────────────────────────────────────────────────────

test("hospice notes are not graded on homebound", () => {
  const { findings } = analyzeDocumentationStrength("Comfort measures provided.", { serviceLine: "hospice" });
  assert.ok(!findings.some((f) => f.element === "homebound"), "homebound is not a hospice requirement");
});

test("home health notes are graded on homebound", () => {
  const { findings } = analyzeDocumentationStrength("Patient is homebound.");
  assert.ok(findings.some((f) => f.element === "homebound"));
});

test("needsReview surfaces weak and partial findings but not absent ones", () => {
  // Absent elements are already reported by the required-element gate; this
  // module must not duplicate that nagging.
  const { needsReview } = analyzeDocumentationStrength("Patient is homebound.");
  assert.ok(needsReview.every((f) => f.level === "weak" || f.level === "partial"));
  assert.ok(needsReview.some((f) => f.element === "homebound"));
  assert.ok(!needsReview.some((f) => f.level === "absent"));
});

test("weakest reports the lowest band across all findings", () => {
  const strong = analyzeDocumentationStrength(
    "Patient is homebound due to severe COPD; requires a walker and one-person assist and rests "
    + "after only a few steps. She leaves the home only for medical appointments. Performed a "
    + "skilled assessment of the sacral wound and determined it had worsened; irrigated and packed "
    + "it. Patient tolerated the procedure without complaint. Educated the patient and daughter on "
    + "the low-sodium diet with written materials; patient correctly described which foods to avoid "
    + "on teach-back and verbalized understanding. Will reinforce next visit.",
  );
  assert.equal(strong.weakest, "strong");
  assert.deepEqual(strong.needsReview, []);

  // Every element present but asserted without support — the classic cloned/
  // template note. Nothing is "absent", so the floor is "weak".
  const weak = analyzeDocumentationStrength(
    "Patient is homebound. Skilled nursing visit completed. Dressing change performed. Education provided.",
  );
  assert.equal(weak.weakest, "weak");
  assert.ok(weak.findings.every((f) => f.level !== "absent"));

  // A note that omits elements entirely floors at "absent" — the lowest band.
  const missing = analyzeDocumentationStrength("Patient is homebound. Education provided.");
  assert.equal(missing.weakest, "absent");
});

test("empty input never throws and reports everything absent", () => {
  for (const input of ["", null, undefined]) {
    const { findings } = analyzeDocumentationStrength(input);
    assert.ok(findings.every((f) => f.level === "absent"), `input ${JSON.stringify(input)}`);
  }
});
