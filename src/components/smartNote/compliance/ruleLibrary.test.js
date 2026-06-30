import test from "node:test";
import assert from "node:assert/strict";
import { buildMergedElements, buildOverrides } from "./ruleLibrary.js";
import { getRequiredElements } from "./requiredElements.js";

const ctx = { serviceLine: "home_health", visitType: "routine_visit" };

test("empty / unseeded DB returns the static defaults unchanged (offline floor)", () => {
  const base = getRequiredElements(ctx.serviceLine, ctx.visitType);
  for (const rules of [[], null, undefined]) {
    const { elements, applied } = buildMergedElements(rules, ctx);
    assert.equal(applied.length, 0);
    assert.deepEqual(elements.map((e) => e.id), base.map((e) => e.id));
  }
});

test("buildOverrides returns null overrides when nothing applies (caller falls back)", () => {
  const { overrides, applied } = buildOverrides([], ctx);
  assert.equal(overrides, null);
  assert.equal(applied.length, 0);
});

test("a rule enriches the matching static element with keywords + examples", () => {
  const rules = [{
    rule_name: "Homebound documentation",
    category: "homebound_status",
    cop_reference: "42 CFR 484.55(c)",
    severity: "high",
    keywords: ["bedridden", "two-person assist"],
    examples_compliant: ["Patient bedridden, requires two-person assist."],
    is_active: true,
  }];
  const { elements, applied } = buildMergedElements(rules, ctx);
  const hb = elements.find((e) => e.id === "homebound");
  assert.ok(hb.keywords.includes("bedridden"));
  // static homebound already has built-in examples, so DB examples don't clobber them
  assert.ok(hb.examples.length >= 1);
  assert.equal(applied.length, 1);
  assert.equal(applied[0].cop_reference, "42 CFR 484.55(c)");
});

test("severity is only raised, never lowered", () => {
  // homebound is critical by default; a 'high' rule must not downgrade it
  const downgrade = [{ rule_name: "x", category: "homebound_status", severity: "high", is_active: true }];
  const hb = buildMergedElements(downgrade, ctx).elements.find((e) => e.id === "homebound");
  assert.equal(hb.severity, "critical");

  // vitals is 'required' by default; a 'critical' rule upgrades it
  const upgrade = [{ rule_name: "Vitals critical", category: "patient_response", severity: "critical", is_active: true }];
  const pr = buildMergedElements(upgrade, ctx).elements.find((e) => e.id === "patient_response");
  assert.equal(pr.severity, "critical");
});

test("a rule with a new category adds a brand-new element (e.g. infection control)", () => {
  const rules = [{
    rule_name: "Infection control assessment",
    category: "infection_control",
    cop_reference: "42 CFR 484.70",
    severity: "high",
    keywords: ["infection", "hand hygiene"],
    required_elements: ["infection signs", "hand hygiene performed"],
    is_active: true,
  }];
  const { elements } = buildMergedElements(rules, ctx);
  const ic = elements.find((e) => e.id === "infection_control");
  assert.ok(ic, "infection_control element should be added");
  assert.equal(ic.severity, "required");
  assert.ok(ic.question.includes("infection signs"));
  assert.equal(ic.fromRule, true);
});

test("inactive rules and non-matching visit types are ignored", () => {
  const base = getRequiredElements(ctx.serviceLine, ctx.visitType);
  const rules = [
    { rule_name: "inactive", category: "infection_control", severity: "high", is_active: false },
    { rule_name: "wrong visit", category: "infection_control", severity: "high", applies_to_visit_types: ["discharge"], is_active: true },
  ];
  const { elements, applied } = buildMergedElements(rules, ctx);
  assert.equal(applied.length, 0);
  assert.equal(elements.length, base.length);
});

test("does not mutate the shared static definitions across calls", () => {
  const rules = [{ rule_name: "x", category: "homebound_status", severity: "high", keywords: ["zzz-marker"], is_active: true }];
  buildMergedElements(rules, ctx);
  const fresh = getRequiredElements(ctx.serviceLine, ctx.visitType).find((e) => e.id === "homebound");
  assert.ok(!fresh.keywords.includes("zzz-marker"), "static defaults must stay clean");
});

test("buildOverrides produces a shape getRequiredElements accepts", () => {
  const rules = [{ rule_name: "Infection control", category: "infection_control", severity: "high", keywords: ["infection"], is_active: true }];
  const { overrides } = buildOverrides(rules, ctx);
  const resolved = getRequiredElements(ctx.serviceLine, ctx.visitType, overrides);
  assert.ok(resolved.some((e) => e.id === "infection_control"));
});
