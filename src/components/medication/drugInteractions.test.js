import { test } from "node:test";
import assert from "node:assert/strict";
import { findDeterministicInteractions, mergeInteractions } from "./drugInteractions.js";

test("flags warfarin + ibuprofen as a major bleeding interaction", () => {
  const r = findDeterministicInteractions([{ name: "Warfarin 5mg" }, { name: "Ibuprofen 400mg" }]);
  assert.equal(r.length, 1);
  assert.equal(r[0].severity, "major");
  assert.equal(r[0].source, "deterministic");
  assert.equal(r[0].verified, true);
});

test("flags nitrate + PDE5 as critical/contraindicated", () => {
  const [r] = findDeterministicInteractions([{ name: "Isosorbide mononitrate" }, { name: "sildenafil" }]);
  assert.equal(r.severity, "critical");
  assert.equal(r.interaction_type, "contraindication");
});

test("flags MAOI + SSRI serotonin-syndrome risk (case-insensitive, brand-ish names)", () => {
  const [r] = findDeterministicInteractions([{ medication_name: "PHENELZINE" }, { medication_name: "Sertraline 50 mg" }]);
  assert.equal(r.severity, "critical");
});

test("flags ACE inhibitor + potassium-sparing diuretic (hyperkalemia)", () => {
  const [r] = findDeterministicInteractions([{ name: "lisinopril" }, { name: "spironolactone" }]);
  assert.equal(r.severity, "major");
});

test("flags opioid + benzodiazepine (respiratory depression)", () => {
  const [r] = findDeterministicInteractions([{ name: "oxycodone" }, { name: "alprazolam" }]);
  assert.ok(r.requires_intervention);
});

test("flags warfarin + amiodarone (INR potentiator)", () => {
  const [r] = findDeterministicInteractions([{ name: "Warfarin" }, { name: "amiodarone 200mg" }]);
  assert.equal(r.severity, "major");
});

test("flags simvastatin + gemfibrozil (rhabdomyolysis)", () => {
  const [r] = findDeterministicInteractions([{ name: "simvastatin" }, { name: "gemfibrozil" }]);
  assert.equal(r.severity, "major");
});

test("flags clopidogrel + omeprazole (reduced antiplatelet effect)", () => {
  const [r] = findDeterministicInteractions([{ name: "clopidogrel" }, { name: "omeprazole" }]);
  assert.equal(r.severity, "moderate");
});

test("flags sumatriptan + sertraline (serotonin syndrome risk)", () => {
  const [r] = findDeterministicInteractions([{ name: "sumatriptan" }, { name: "sertraline" }]);
  assert.equal(r.severity, "moderate");
});

test("no false positive for an unrelated pair", () => {
  assert.deepEqual(findDeterministicInteractions([{ name: "acetaminophen" }, { name: "vitamin d" }]), []);
});

test("warfarin + aspirin is flagged as an antiplatelet bleeding interaction, not an NSAID one", () => {
  // Aspirin is an antiplatelet, not an NSAID for this safety-net. The pair is a
  // genuine, dangerous bleeding interaction and MUST still be surfaced — but with
  // the correct antiplatelet label, never the warfarin/NSAID "GI bleeding" one.
  const r = findDeterministicInteractions([{ name: "Warfarin 5mg" }, { name: "Aspirin 81mg" }]);
  assert.equal(r.length, 1);
  assert.equal(r[0].severity, "major");
  assert.match(r[0].description, /antiplatelet/i);
  assert.ok(!r.some((x) => /NSAID/i.test(x.description)));
});

test("warfarin + clopidogrel is flagged as an antiplatelet bleeding interaction", () => {
  const r = findDeterministicInteractions([{ name: "Warfarin" }, { name: "Clopidogrel" }]);
  assert.ok(r.some((x) => /antiplatelet/i.test(x.description) && x.severity === "major"));
});

test("aspirin keeps its renal interactions with methotrexate and lithium (salicylate)", () => {
  const mtx = findDeterministicInteractions([{ name: "Methotrexate" }, { name: "Aspirin 81mg" }]);
  assert.ok(mtx.some((x) => x.severity === "major" && /methotrexate clearance/i.test(x.description)));
  const li = findDeterministicInteractions([{ name: "Lithium" }, { name: "Aspirin" }]);
  assert.ok(li.some((x) => x.severity === "major" && /lithium clearance/i.test(x.description)));
  // ...but a non-aspirin antiplatelet must NOT false-flag the MTX renal interaction.
  const clopidogrel = findDeterministicInteractions([{ name: "Methotrexate" }, { name: "Clopidogrel" }]);
  assert.ok(!clopidogrel.some((x) => /methotrexate clearance/i.test(x.description)));
});

test("brand-name Klor-Con still matches potassium_sparing (hyphen tokenized)", () => {
  const r = findDeterministicInteractions([{ name: "Klor-Con 10 mEq" }, { name: "lisinopril" }]);
  assert.ok(r.some((x) => x.severity === "major" && /hyperkalemia/i.test(x.description)));
});

test("token matching avoids substring false positives but keeps true matches", () => {
  // "mononitrate" must not match the bare "nitrate" fragment as a substring;
  // the nitrate group is still detected via the "isosorbide" token, so the
  // nitrate + PDE5 critical interaction still fires.
  const r = findDeterministicInteractions([{ name: "Isosorbide mononitrate" }, { name: "sildenafil" }]);
  assert.equal(r.length, 1);
  assert.equal(r[0].severity, "critical");
});

test("handles <2 meds and empty/blank input", () => {
  assert.deepEqual(findDeterministicInteractions([{ name: "warfarin" }]), []);
  assert.deepEqual(findDeterministicInteractions([]), []);
  assert.deepEqual(findDeterministicInteractions([{ name: "" }, { name: "  " }]), []);
});

test("mergeInteractions: deterministic wins on the same pair; AI-only tagged unverified", () => {
  const det = [{ drug_a: "Warfarin", drug_b: "Ibuprofen", severity: "major", source: "deterministic", verified: true }];
  const ai = [
    { drug_a: "ibuprofen", drug_b: "warfarin", severity: "moderate" }, // same pair, different order
    { drug_a: "Lisinopril", drug_b: "Metformin", severity: "minor" },  // AI-only
  ];
  const merged = mergeInteractions(ai, det);
  assert.equal(merged.length, 2); // duplicate pair dropped
  const det1 = merged.find((m) => m.source === "deterministic");
  assert.equal(det1.severity, "major");
  const aiOnly = merged.find((m) => m.drug_b === "Metformin");
  assert.equal(aiOnly.verified, false);
  assert.equal(aiOnly.source, "ai_suggested");
});
