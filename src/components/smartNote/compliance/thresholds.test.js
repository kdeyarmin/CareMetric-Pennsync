import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_THRESHOLDS,
  clearThresholdOverrides,
  describeCalibration,
  getThreshold,
  setThresholdOverrides,
  thresholdValue,
} from "./thresholds.js";
import { analyzeHomebound } from "./documentationStrength.js";
import { bandFor } from "./noteSimilarity.js";

test.afterEach(() => clearThresholdOverrides());

// ── Honesty about provenance ───────────────────────────────────────────────

test("every shipped threshold declares itself uncalibrated with a stated basis", () => {
  for (const [key, t] of Object.entries(DEFAULT_THRESHOLDS)) {
    assert.equal(t.calibrated, false, `${key} must not ship claiming calibration`);
    assert.ok(t.basis, `${key} needs a stated basis`);
    assert.ok(t.rationale, `${key} needs a rationale for moving it`);
    assert.ok(Number.isFinite(t.value), `${key} needs a numeric value`);
  }
});

test("the calibration statement says these are defaults, not standards", () => {
  const c = describeCalibration();
  assert.equal(c.complete, false);
  assert.equal(c.calibrated, 0);
  assert.equal(c.uncalibrated, c.total);
  assert.match(c.statement, /uncalibrated PennSync defaults, not standards/i);
  assert.match(c.statement, /your own denials and notes/i);
});

test("the numbers the brief called out are the ones documented as untuned", () => {
  assert.equal(DEFAULT_THRESHOLDS.homebound_strong_factors.value, 3);
  assert.equal(DEFAULT_THRESHOLDS.similarity_high.value, 0.72);
  assert.equal(DEFAULT_THRESHOLDS.similarity_very_high.value, 0.88);
  assert.match(DEFAULT_THRESHOLDS.similarity_high.basis, /Not calibrated against this agency/i);
});

// ── Overrides ──────────────────────────────────────────────────────────────

test("an override changes what the engines actually use", () => {
  const note = "Patient is homebound and uses a walker.";
  assert.equal(analyzeHomebound(note).level, "partial");

  setThresholdOverrides({ homebound_strong_factors: 1 });
  assert.equal(analyzeHomebound(note).level, "strong", "the engine must read the override");

  clearThresholdOverrides();
  assert.equal(analyzeHomebound(note).level, "partial", "clearing restores the default");
});

test("a similarity band override moves the band boundaries", () => {
  assert.equal(bandFor(0.6).id, "moderate");
  setThresholdOverrides({ similarity_high: 0.6 });
  assert.equal(bandFor(0.6).id, "high");
});

test("an unknown threshold is rejected, not silently ignored", () => {
  const out = setThresholdOverrides({ not_a_threshold: 5 });
  assert.deepEqual(out.applied, []);
  assert.equal(out.rejected[0].key, "not_a_threshold");
  assert.match(out.rejected[0].reason, /Unknown threshold/);
});

test("an out-of-range value is rejected with the bound that was breached", () => {
  const low = setThresholdOverrides({ homebound_strong_factors: 0 });
  assert.match(low.rejected[0].reason, /Below the minimum of 1/);

  const high = setThresholdOverrides({ homebound_strong_factors: 99 });
  assert.match(high.rejected[0].reason, /Above the maximum of 7/);

  const bad = setThresholdOverrides({ similarity_high: "very high" });
  assert.match(bad.rejected[0].reason, /not a number/i);
});

test("a rejected override leaves the default in force", () => {
  setThresholdOverrides({ homebound_strong_factors: 99 });
  assert.equal(thresholdValue("homebound_strong_factors"), 3);
});

test("setting a number by hand is not calibration", () => {
  setThresholdOverrides({ homebound_strong_factors: 2 });
  assert.equal(getThreshold("homebound_strong_factors").calibrated, false);
  assert.equal(describeCalibration().complete, false);

  setThresholdOverrides({
    homebound_strong_factors: { value: 2, calibrated: true, basis: "Tuned on 400 labelled notes." },
  });
  assert.equal(getThreshold("homebound_strong_factors").calibrated, true);
  assert.match(getThreshold("homebound_strong_factors").basis, /400 labelled notes/);
});

test("describeCalibration counts only the thresholds still untuned", () => {
  setThresholdOverrides({
    homebound_strong_factors: { value: 3, calibrated: true },
    similarity_high: { value: 0.7, calibrated: true },
  });
  const c = describeCalibration();
  assert.equal(c.calibrated, 2);
  assert.equal(c.uncalibrated, c.total - 2);
  assert.ok(!c.keys.includes("homebound_strong_factors"));
});

test("applying a new override set replaces the previous one rather than merging", () => {
  setThresholdOverrides({ homebound_strong_factors: 1 });
  setThresholdOverrides({ similarity_high: 0.6 });
  assert.equal(thresholdValue("homebound_strong_factors"), 3, "the earlier override is dropped");
  assert.equal(thresholdValue("similarity_high"), 0.6);
});

test("getThreshold returns null for an unknown key rather than throwing", () => {
  assert.equal(getThreshold("nope"), null);
  assert.equal(thresholdValue("nope"), null);
});
