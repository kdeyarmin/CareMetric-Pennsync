import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MEDICARE_RULES, rulesToSeed } from "./defaultMedicareRules.js";
import { buildMergedElements } from "../smartNote/compliance/ruleLibrary.js";

// Mirror of the MedicareComplianceRule schema enums (kept in step with the .jsonc).
const CATEGORIES = new Set([
  "homebound_status", "skilled_need", "patient_response", "coordination_of_care",
  "safety_assessment", "functional_status", "patient_education", "plan_of_care",
  "physician_orders", "infection_control",
]);
const SEVERITIES = new Set(["critical", "high", "medium"]);
const VISIT_TYPES = new Set(["routine_visit", "admission", "recertification", "discharge", "prn"]);

test("every default rule has the schema-required fields", () => {
  for (const r of DEFAULT_MEDICARE_RULES) {
    for (const f of ["rule_name", "cop_reference", "category", "description", "severity"]) {
      assert.ok(r[f], `rule "${r.rule_name}" missing required field ${f}`);
    }
  }
});

test("every category and severity is a valid schema enum member", () => {
  for (const r of DEFAULT_MEDICARE_RULES) {
    assert.ok(CATEGORIES.has(r.category), `bad category ${r.category} in ${r.rule_name}`);
    assert.ok(SEVERITIES.has(r.severity), `bad severity ${r.severity} in ${r.rule_name}`);
  }
});

test("applies_to_visit_types only uses known smart-note visit types", () => {
  for (const r of DEFAULT_MEDICARE_RULES) {
    for (const v of r.applies_to_visit_types || []) {
      assert.ok(VISIT_TYPES.has(v), `bad visit type ${v} in ${r.rule_name}`);
    }
  }
});

test("rule names are unique", () => {
  const names = DEFAULT_MEDICARE_RULES.map((r) => r.rule_name.toLowerCase());
  assert.equal(new Set(names).size, names.length);
});

test("includes at least one Pennsylvania-specific rule", () => {
  assert.ok(DEFAULT_MEDICARE_RULES.some((r) => r.pennsylvania_specific === true));
});

test("rulesToSeed returns all rules against an empty DB and is idempotent", () => {
  assert.equal(rulesToSeed([]).length, DEFAULT_MEDICARE_RULES.length);
  // After 'seeding', a second pass finds nothing new (case/whitespace-insensitive).
  const seeded = DEFAULT_MEDICARE_RULES.map((r) => ({ rule_name: `  ${r.rule_name.toUpperCase()}  ` }));
  assert.equal(rulesToSeed(seeded).length, 0);
});

test("rulesToSeed only returns the missing rules", () => {
  const existing = [{ rule_name: "Homebound Status Documentation" }];
  const missing = rulesToSeed(existing);
  assert.equal(missing.length, DEFAULT_MEDICARE_RULES.length - 1);
  assert.ok(!missing.some((r) => r.rule_name === "Homebound Status Documentation"));
});

test("the seeded rules actually feed the smart-note required elements", () => {
  // A routine home-health visit should gain the infection_control element (no
  // static default) and keep homebound critical once the defaults are applied.
  const { elements, applied } = buildMergedElements(DEFAULT_MEDICARE_RULES, {
    serviceLine: "home_health",
    visitType: "routine_visit",
  });
  assert.ok(applied.length > 0, "rules should apply to a routine visit");
  assert.ok(elements.some((e) => e.id === "infection_control"), "infection_control should be added");
  assert.equal(elements.find((e) => e.id === "homebound")?.severity, "critical");
});

test("regulatory citations are the verified ones", () => {
  const byName = Object.fromEntries(DEFAULT_MEDICARE_RULES.map((r) => [r.rule_name, r]));
  // Homebound eligibility is 42 CFR 409.42(a) — 484.55(c) is the
  // comprehensive-assessment content list.
  assert.equal(byName["Homebound Status Documentation"].cop_reference, "42 CFR 409.42(a)");
  // 484.55(c)(1) is functional status; (c)(5) is the medication review.
  assert.equal(byName["Functional Status Assessment"].cop_reference, "42 CFR 484.55(c)(1)");
  // 28 Pa. Code § 601.35 is home health aide services (601.31 is acceptance
  // of patients / plan of treatment); POT review is 601.31(c).
  assert.equal(byName["PA Home Health Aide Supervision"].cop_reference, "28 Pa. Code § 601.35");
  assert.equal(byName["PA Plan of Treatment Review"].cop_reference, "28 Pa. Code § 601.31(c)");
});

test("every default rule is scoped to home_health", () => {
  // These are all 42 CFR 484 / PA home-health rules — without the scope,
  // seeding injected homebound/skilled-need CRITICALS into hospice notes.
  for (const rule of DEFAULT_MEDICARE_RULES) {
    assert.equal(rule.service_line, "home_health", rule.rule_name);
  }
});

test("seeded home-health rules never inject elements into hospice notes", () => {
  const { elements, applied } = buildMergedElements(DEFAULT_MEDICARE_RULES, {
    serviceLine: "hospice",
    visitType: "routine_visit",
  });
  assert.equal(applied.length, 0);
  const ids = elements.map((e) => e.id);
  assert.ok(!ids.includes("homebound"), "hospice has no homebound requirement");
  assert.ok(!ids.includes("skilled_need"));
});
