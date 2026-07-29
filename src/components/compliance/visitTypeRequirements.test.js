import test from "node:test";
import assert from "node:assert/strict";
import {
  HOME_HEALTH_REQUIREMENTS,
  HOSPICE_REQUIREMENTS,
  normalizeVisitTypeKey,
  requirementsFor,
} from "./visitTypeRequirements.js";

test("extractor vocabulary maps onto the right requirement sets", () => {
  // Regression: the extractor emits "SOC", "ROC", "Recert", "Follow-up",
  // "Transfer", "Discharge" — the old exact-key lookup matched NONE of them,
  // so every note was graded against the weakest routine-visit checklist.
  assert.equal(normalizeVisitTypeKey("SOC").key, "admission");
  assert.equal(normalizeVisitTypeKey("Start of Care").key, "admission");
  assert.equal(normalizeVisitTypeKey("Recert").key, "recertification");
  assert.equal(normalizeVisitTypeKey("ROC").key, "recertification");
  assert.equal(normalizeVisitTypeKey("Resumption of Care").key, "recertification");
  assert.equal(normalizeVisitTypeKey("Discharge").key, "discharge");
  assert.equal(normalizeVisitTypeKey("Transfer").key, "discharge");
  assert.equal(normalizeVisitTypeKey("Follow-up").key, "routine_visit");
  for (const raw of ["SOC", "Recert", "Discharge"]) {
    assert.equal(normalizeVisitTypeKey(raw).recognized, true, raw);
  }
});

test("psychosocial/social-work visits are NOT graded as admissions", () => {
  // Regression: an unanchored /soc/ matched inside "psychosocial" and
  // "social work", grading an MSW note against the full admission checklist
  // (election statement, comprehensive assessment, ...) with cascading false
  // "missing element" findings. A real "SOC" still maps to admission.
  for (const raw of ["psychosocial", "Social Work", "MSW psychosocial visit"]) {
    assert.notEqual(normalizeVisitTypeKey(raw).key, "admission", raw);
  }
  assert.equal(normalizeVisitTypeKey("SOC").key, "admission");
  assert.equal(normalizeVisitTypeKey("soc visit").key, "admission");
});

test("exact keys and unknowns behave sanely", () => {
  assert.deepEqual(normalizeVisitTypeKey("admission"), { key: "admission", recognized: true });
  assert.deepEqual(normalizeVisitTypeKey("skilled_nursing"), { key: "skilled_nursing", recognized: true });
  const unknown = normalizeVisitTypeKey("telehealth check");
  assert.equal(unknown.key, "routine_visit");
  assert.equal(unknown.recognized, false);
  assert.equal(normalizeVisitTypeKey("").recognized, false);
  assert.equal(normalizeVisitTypeKey(null).key, "routine_visit");
});

test("hospice notes are framed under 42 CFR 418, never OASIS", () => {
  // Regression: hospice visits were graded against the home-health table,
  // demanding OASIS (which does not apply to hospice) and citing 42 CFR 484.
  for (const [key, set] of Object.entries(HOSPICE_REQUIREMENTS)) {
    assert.match(set.cms_reference, /418/, `${key} must cite 42 CFR 418`);
    for (const el of set.required_elements) {
      assert.ok(!/oasis/i.test(el), `${key}: hospice element must not require OASIS ("${el}")`);
    }
  }
  const hospiceSoc = requirementsFor("SOC", "hospice");
  assert.equal(hospiceSoc.display, "Hospice Admission");
  assert.ok(hospiceSoc.required_elements.some((el) => /election statement/i.test(el)));
  assert.ok(hospiceSoc.required_elements.some((el) => /terminal/i.test(el)));
});

test("home-health notes keep the 42 CFR 484 frame with OASIS", () => {
  for (const [key, set] of Object.entries(HOME_HEALTH_REQUIREMENTS)) {
    assert.match(set.cms_reference, /484/, `${key} must cite 42 CFR 484`);
  }
  const soc = requirementsFor("SOC", "home_health");
  assert.equal(soc.display, "Start of Care/Admission");
  assert.ok(soc.required_elements.some((el) => /OASIS/i.test(el)));
  // careType defaults to home health when absent or unrecognized.
  assert.equal(requirementsFor("SOC", undefined).display, "Start of Care/Admission");
  assert.equal(requirementsFor("SOC", "Hospice").display, "Hospice Admission"); // case-insensitive
});

test("both tables define the same visit-type keys", () => {
  assert.deepEqual(
    Object.keys(HOSPICE_REQUIREMENTS).sort(),
    Object.keys(HOME_HEALTH_REQUIREMENTS).sort(),
  );
});
