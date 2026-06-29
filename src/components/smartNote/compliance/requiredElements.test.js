import test from "node:test";
import assert from "node:assert/strict";
import {
  getRequiredElements,
  getCriticalElements,
  REQUIRED_ELEMENTS,
  VISIT_TYPES,
} from "./requiredElements.js";

test("home health routine visit gates on homebound + skilled need", () => {
  const critical = getCriticalElements("home_health", "routine_visit").map((e) => e.id);
  assert.deepEqual(critical.sort(), ["homebound", "skilled_need"]);
});

test("hospice routine visit gates on comfort-focused skilled need", () => {
  const critical = getCriticalElements("hospice", "routine_visit").map((e) => e.id);
  assert.deepEqual(critical, ["comfort_skilled_need"]);
});

test("unknown visit type falls back to routine_visit", () => {
  const fallback = getRequiredElements("home_health", "made_up_type");
  assert.deepEqual(fallback, getRequiredElements("home_health", "routine_visit"));
});

test("unknown service line falls back to home_health", () => {
  const fallback = getRequiredElements("dental", "routine_visit");
  assert.deepEqual(fallback, getRequiredElements("home_health", "routine_visit"));
});

test("every required element is well-formed", () => {
  for (const line of Object.keys(REQUIRED_ELEMENTS)) {
    for (const vt of VISIT_TYPES) {
      for (const e of getRequiredElements(line, vt)) {
        assert.ok(e.id, `${line}/${vt} element missing id`);
        assert.ok(e.label, `${e.id} missing label`);
        assert.ok(["critical", "required"].includes(e.severity), `${e.id} bad severity`);
        assert.ok(e.question, `${e.id} missing question`);
        assert.ok(e.notDocumentedPhrase, `${e.id} missing notDocumentedPhrase`);
        assert.ok(Array.isArray(e.keywords) && e.keywords.length, `${e.id} missing keywords`);
      }
    }
  }
});

test("standard negatives only on the intended elements", () => {
  const withNegatives = new Set();
  for (const line of Object.keys(REQUIRED_ELEMENTS)) {
    for (const vt of VISIT_TYPES) {
      for (const e of getRequiredElements(line, vt)) {
        if (e.standardNegative) {
          assert.ok(e.standardNegative.prompt && e.standardNegative.phrase, `${e.id} bad negative`);
          withNegatives.add(e.id);
        }
      }
    }
  }
  // pain, complaints, safety (fall risk), allergies per the design decision
  assert.ok(withNegatives.has("pain"));
  assert.ok(withNegatives.has("complaints"));
  assert.ok(withNegatives.has("safety"));
  assert.ok(withNegatives.has("allergies"));
});

test("every service line × visit type has at least one critical gating element", () => {
  for (const line of Object.keys(REQUIRED_ELEMENTS)) {
    for (const vt of VISIT_TYPES) {
      assert.ok(
        getCriticalElements(line, vt).length >= 1,
        `${line}/${vt} has no critical element to gate generation`
      );
    }
  }
});

test("agency overrides take precedence when provided", () => {
  const overrides = {
    home_health: { routine_visit: [{ id: "custom", label: "Custom", severity: "required", question: "q", notDocumentedPhrase: "n", keywords: ["x"] }] },
  };
  const result = getRequiredElements("home_health", "routine_visit", overrides);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "custom");
});
