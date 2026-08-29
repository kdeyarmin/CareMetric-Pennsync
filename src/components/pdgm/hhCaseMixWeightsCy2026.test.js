import test from "node:test";
import assert from "node:assert/strict";
import { HH_CASE_MIX_WEIGHTS_CY2026 } from "./hhCaseMixWeightsCy2026.js";
import { parseCaseMixWeightsCsv, EXPECTED_GROUP_COUNT } from "./caseMixWeightsLoader.js";
import { buildStoredWeightTable, reconcileScenario } from "./caseMixReconciliation.js";
import { caseMixKey } from "./pdgmGrouper.js";

const parsed = parseCaseMixWeightsCsv(HH_CASE_MIX_WEIGHTS_CY2026.csv, {
  year: HH_CASE_MIX_WEIGHTS_CY2026.payment_year,
  source: HH_CASE_MIX_WEIGHTS_CY2026.source_file,
});

test("bundle carries its provenance and parses clean through the STRICT loader", () => {
  assert.match(HH_CASE_MIX_WEIGHTS_CY2026.source_file, /CY 2026 Final HH PDGM Case Mix Weights/);
  assert.match(HH_CASE_MIX_WEIGHTS_CY2026.source_url, /^https:\/\/www\.cms\.gov\//);
  assert.equal(HH_CASE_MIX_WEIGHTS_CY2026.payment_year, "2026");
  assert.equal(parsed.ok, true, parsed.errors.join("; "));
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.meta.groups, EXPECTED_GROUP_COUNT); // all 432 payment groups
});

test("every group carries a verbatim HIPPS code and a LUPA threshold in the 2–6 band", () => {
  for (const [key, entry] of Object.entries(parsed.caseMixTable)) {
    assert.match(entry.hipps, /^[1-4][A-L][A-C][1-3]1$/, `${key}: ${entry.hipps}`);
    assert.ok(entry.lupaThreshold >= 2 && entry.lupaThreshold <= 6, `${key}: LUPA ${entry.lupaThreshold}`);
    assert.ok(entry.weight > 0.2 && entry.weight < 5.0, `${key}: weight ${entry.weight}`);
  }
});

test("spot values match the CMS CY2026 file verbatim", () => {
  const at = (scenario) => parsed.caseMixTable[caseMixKey(scenario)];
  const bhEarlyCommHighNone = at({
    timing: "early", admissionSource: "community",
    clinicalGroup: "Behavioral Health", functionalLevel: "high", comorbidityLevel: "none",
  });
  assert.deepEqual(bhEarlyCommHighNone, { weight: 1.0804, hipps: "1FC11", lupaThreshold: 4 });
  const woundLateInstMedHigh = at({
    timing: "late", admissionSource: "institutional",
    clinicalGroup: "Wound", functionalLevel: "medium", comorbidityLevel: "high",
  });
  assert.deepEqual(woundLateInstMedHigh, { weight: 1.752, hipps: "4CB31", lupaThreshold: 4 });
});

test("the stored table drives reconcileScenario end to end (official HIPPS + weight + LUPA)", () => {
  const stored = buildStoredWeightTable(parsed, {
    year: HH_CASE_MIX_WEIGHTS_CY2026.payment_year,
    source: HH_CASE_MIX_WEIGHTS_CY2026.source_file,
    uploadedBy: "admin@test.example",
  });
  assert.equal(stored.groups, EXPECTED_GROUP_COUNT);
  const recon = reconcileScenario(
    {
      clinicalGroup: "MMTA_Cardiac_Circulatory",
      admissionSource: "institutional",
      timing: "early",
      functionalLevel: "high",
      comorbidityLevel: "low",
    },
    stored
  );
  assert.equal(recon.available, true);
  assert.equal(recon.hipps, "2HC21"); // official code for that combination
  assert.ok(Number.isFinite(recon.weight));
  assert.ok(recon.lupaThreshold >= 2 && recon.lupaThreshold <= 6);
});
