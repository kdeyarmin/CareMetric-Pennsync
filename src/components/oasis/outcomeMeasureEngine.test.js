import test from "node:test";
import assert from "node:assert/strict";
import {
  answersFromOasisItems,
  computeEpisodeOutcome,
  computeGGDischargeFunctionScore,
  toPatientOutcomeMetric,
  rollupMeasures,
  toAgencyKPIs,
  IMPROVEMENT_MEASURES,
  MEASURE_STATUS,
  STAR_MIN_EPISODES,
} from "./outcomeMeasureEngine.js";

// ── answersFromOasisItems ──

test("normalizes oasis_items array into a flat lower-cased map", () => {
  const items = [
    { item_number: "M1860", response: "2" },
    { item_number: "M1400", response: "3" },
    { item_number: "M2020", response: "notanumber" },
  ];
  const map = answersFromOasisItems(items);
  assert.equal(map.m1860, 2);
  assert.equal(map.m1400, 3);
  assert.equal(map.m2020, undefined); // non-numeric dropped
});

test("passes through an already-flat map, coercing strings", () => {
  const map = answersFromOasisItems({ M1830: "4", m1850: 1 });
  assert.equal(map.m1830, 4);
  assert.equal(map.m1850, 1);
});

test("empty / null input yields an empty map", () => {
  assert.deepEqual(answersFromOasisItems(null), {});
  assert.deepEqual(answersFromOasisItems([]), {});
});

// ── improvement scoring (lower discharge code == improvement) ──

test("ambulation improves when discharge value < SOC value", () => {
  const outcome = computeEpisodeOutcome({ start: { m1860: 3 }, discharge: { m1860: 1 } });
  const amb = outcome.measures.find((m) => m.key === "ambulation");
  assert.equal(amb.status, MEASURE_STATUS.IMPROVED);
  assert.equal(outcome.improved_count, 1);
});

test("no change is not_improved, not excluded", () => {
  const outcome = computeEpisodeOutcome({ start: { m1860: 3 }, discharge: { m1860: 3 } });
  const amb = outcome.measures.find((m) => m.key === "ambulation");
  assert.equal(amb.status, MEASURE_STATUS.NOT_IMPROVED);
  assert.equal(outcome.eligible_measure_count, 1);
});

test("M1850=5 (bedfast) is a valid start value and 5→3 counts as improvement", () => {
  const outcome = computeEpisodeOutcome({ start: { m1850: 5 }, discharge: { m1850: 3 } });
  const t = outcome.measures.find((m) => m.key === "bed_transfer");
  assert.equal(t.status, MEASURE_STATUS.IMPROVED); // not excluded as unratable
});

test("a WORSE (higher) discharge value is not_improved", () => {
  const outcome = computeEpisodeOutcome({ start: { m1850: 1 }, discharge: { m1850: 3 } });
  const t = outcome.measures.find((m) => m.key === "bed_transfer");
  assert.equal(t.status, MEASURE_STATUS.NOT_IMPROVED);
});

test("SOC already independent (value 0) → excluded, no room to improve", () => {
  const outcome = computeEpisodeOutcome({ start: { m1860: 0 }, discharge: { m1860: 0 } });
  const amb = outcome.measures.find((m) => m.key === "ambulation");
  assert.equal(amb.status, MEASURE_STATUS.EXCLUDED);
  assert.equal(amb.reason, "no_room_to_improve");
});

test("missing SOC or discharge value → excluded (missing_data)", () => {
  const outcome = computeEpisodeOutcome({ start: {}, discharge: { m1860: 1 } });
  const amb = outcome.measures.find((m) => m.key === "ambulation");
  assert.equal(amb.status, MEASURE_STATUS.EXCLUDED);
  assert.equal(amb.reason, "missing_data");
});

test("bathing artificial-opening code (6) is unratable → excluded", () => {
  const outcome = computeEpisodeOutcome({ start: { m1830: 6 }, discharge: { m1830: 2 } });
  const bath = outcome.measures.find((m) => m.key === "bathing");
  assert.equal(bath.status, MEASURE_STATUS.EXCLUDED);
  assert.equal(bath.reason, "unratable_code");
});

test("out-of-range codes are excluded, not scored as improvement", () => {
  // m2020 max assessable is 3; a stray 9 must not read as a huge impairment.
  const outcome = computeEpisodeOutcome({ start: { m2020: 9 }, discharge: { m2020: 1 } });
  const meds = outcome.measures.find((m) => m.key === "oral_meds");
  assert.equal(meds.status, MEASURE_STATUS.EXCLUDED);
  assert.equal(meds.reason, "unratable_code");
});

test("string answers are coerced through the whole pipeline", () => {
  const outcome = computeEpisodeOutcome({ start: { m1400: "4" }, discharge: { m1400: "1" } });
  const dys = outcome.measures.find((m) => m.key === "dyspnea");
  assert.equal(dys.status, MEASURE_STATUS.IMPROVED);
});

test("all five improvement measures are evaluated", () => {
  const outcome = computeEpisodeOutcome({
    start: { m1860: 3, m1850: 2, m1830: 3, m1400: 3, m2020: 2 },
    discharge: { m1860: 1, m1850: 1, m1830: 1, m1400: 1, m2020: 1 },
  });
  assert.equal(outcome.measures.length, IMPROVEMENT_MEASURES.length);
  assert.equal(outcome.improved_count, 5);
  assert.equal(outcome.overall_improvement_score, 100);
});

test("overall improvement score is improved / eligible, not improved / total", () => {
  const outcome = computeEpisodeOutcome({
    // ambulation improves; transfer no change; bathing excluded (SOC independent)
    start: { m1860: 2, m1850: 2, m1830: 0 },
    discharge: { m1860: 1, m1850: 2, m1830: 0 },
  });
  assert.equal(outcome.eligible_measure_count, 2); // ambulation + transfer
  assert.equal(outcome.improved_count, 1);
  assert.equal(outcome.overall_improvement_score, 50);
});

// ── episode-level death exclusion ──

test("an episode ending in death is excluded from all improvement measures", () => {
  const outcome = computeEpisodeOutcome({
    start: { m1860: 3, m1850: 2 },
    discharge: { m1860: 1, m1850: 1 },
    dischargeDisposition: "deceased",
  });
  assert.equal(outcome.eligible, false);
  assert.equal(outcome.episode_excluded_reason, "episode_ended_in_death");
  assert.ok(outcome.measures.every((m) => m.status === MEASURE_STATUS.EXCLUDED));
});

test("a live discharge to community is eligible", () => {
  const outcome = computeEpisodeOutcome({
    start: { m1860: 3 },
    discharge: { m1860: 1 },
    dischargeDisposition: "remained_home",
  });
  assert.equal(outcome.eligible, true);
});

// ── GG Discharge Function Score ──

test("GG score sums coded function items when enough are present", () => {
  const dc = {};
  // Code all 18 items at 4 → total 72.
  for (const item of [
    "gg0130a", "gg0130b", "gg0130c", "gg0130e", "gg0130f", "gg0130g", "gg0130h",
    "gg0170a", "gg0170b", "gg0170c", "gg0170d", "gg0170e", "gg0170f",
    "gg0170i", "gg0170j", "gg0170k", "gg0170l", "gg0170m",
  ]) dc[item] = 4;
  const gg = computeGGDischargeFunctionScore(dc);
  assert.equal(gg.applicable, true);
  assert.equal(gg.score, 72);
  assert.equal(gg.items_scored, 18);
});

test('GG "activity not attempted" codes impute to most-dependent (1)', () => {
  const dc = { gg0130a: 7, gg0130b: 88 }; // both not-attempted → 1 each
  const gg = computeGGDischargeFunctionScore(dc);
  // Only 2 of 18 items → not applicable, but the summing rule is still exercised.
  assert.equal(gg.items_scored, 2);
});

test("GG score is not applicable when fewer than half the items are coded", () => {
  const gg = computeGGDischargeFunctionScore({ gg0130a: 6, gg0170a: 6 });
  assert.equal(gg.applicable, false);
  assert.equal(gg.score, null);
});

test("episodes with no GG items report GG as not applicable", () => {
  const outcome = computeEpisodeOutcome({ start: { m1860: 2 }, discharge: { m1860: 1 } });
  assert.equal(outcome.gg_discharge_function.applicable, false);
});

// ── PatientOutcomeMetric mapping ──

test("toPatientOutcomeMetric maps improvement flags onto entity fields", () => {
  const outcome = computeEpisodeOutcome({
    start: { m1860: 3, m1830: 2, m1850: 2, m2020: 2, m1400: 2 },
    discharge: { m1860: 1, m1830: 1, m1850: 2, m2020: 1, m1400: 2 },
  });
  const rec = toPatientOutcomeMetric(
    { patientId: "p1", episodeStart: "2026-01-01", episodeEnd: "2026-03-01", primaryDiagnosis: "CHF" },
    outcome,
  );
  assert.equal(rec.patient_id, "p1");
  assert.equal(rec.functional_improvement.ambulation_improved, true);
  assert.equal(rec.functional_improvement.bathing_improved, true);
  assert.equal(rec.functional_improvement.transferring_improved, false); // no change
  assert.equal(rec.functional_improvement.medication_management_improved, true);
  assert.equal(rec.functional_improvement.dyspnea_improved, false); // no change
  assert.ok(Array.isArray(rec.measure_results));
  assert.equal(rec.measure_results.length, 5);
});

// ── agency rollup ──

test("rollupMeasures aggregates numerator/denominator and star eligibility", () => {
  const outcomes = [];
  // 25 episodes, 20 improved on ambulation → 80%, star eligible (>=20 denom).
  for (let i = 0; i < 25; i++) {
    outcomes.push(computeEpisodeOutcome({
      start: { m1860: 3 },
      discharge: { m1860: i < 20 ? 1 : 3 },
    }));
  }
  const rollup = rollupMeasures(outcomes);
  const amb = rollup.measures.find((m) => m.key === "ambulation");
  assert.equal(amb.denominator, 25);
  assert.equal(amb.numerator, 20);
  assert.equal(amb.rate, 80);
  assert.equal(amb.star_eligible, true);
});

test("a measure below the 20-episode threshold is not star eligible", () => {
  const outcomes = [computeEpisodeOutcome({ start: { m1860: 3 }, discharge: { m1860: 1 } })];
  const rollup = rollupMeasures(outcomes);
  const amb = rollup.measures.find((m) => m.key === "ambulation");
  assert.equal(amb.denominator, 1);
  assert.equal(amb.star_eligible, false);
  assert.ok(rollup.star_eligible === false);
});

test("excluded measures never inflate the denominator", () => {
  // SOC value 0 → excluded on ambulation for all episodes.
  const outcomes = Array.from({ length: 30 }, () =>
    computeEpisodeOutcome({ start: { m1860: 0 }, discharge: { m1860: 0 } }),
  );
  const rollup = rollupMeasures(outcomes);
  const amb = rollup.measures.find((m) => m.key === "ambulation");
  assert.equal(amb.denominator, 0);
  assert.equal(amb.rate, null);
});

test("STAR_MIN_EPISODES gate wires into rollup", () => {
  const outcomes = Array.from({ length: STAR_MIN_EPISODES }, () =>
    computeEpisodeOutcome({ start: { m1850: 2 }, discharge: { m1850: 1 } }),
  );
  const rollup = rollupMeasures(outcomes);
  const t = rollup.measures.find((m) => m.key === "bed_transfer");
  assert.equal(t.denominator, STAR_MIN_EPISODES);
  assert.equal(t.star_eligible, true);
});

// ── AgencyKPI mapping ──

test("toAgencyKPIs emits one quality KPI per computable measure", () => {
  const outcomes = Array.from({ length: 25 }, (_, i) =>
    computeEpisodeOutcome({ start: { m1860: 3 }, discharge: { m1860: i < 15 ? 1 : 3 } }),
  );
  const rollup = rollupMeasures(outcomes);
  const kpis = toAgencyKPIs(rollup, { periodStart: "2026-01-01", periodEnd: "2026-03-31", benchmark: 75 });
  const amb = kpis.find((k) => k.metric_name.includes("Ambulation"));
  assert.ok(amb);
  assert.equal(amb.metric_category, "quality");
  assert.equal(amb.unit, "%");
  assert.equal(amb.metric_value, 60); // 15/25
  assert.equal(amb.benchmark_value, 75);
  assert.equal(amb.status, "critical"); // 60 < 75-10
});

test("toAgencyKPIs skips measures with an empty denominator", () => {
  const rollup = rollupMeasures([
    computeEpisodeOutcome({ start: { m1860: 0 }, discharge: { m1860: 0 } }),
  ]);
  const kpis = toAgencyKPIs(rollup, { periodStart: "2026-01-01", periodEnd: "2026-03-31" });
  assert.ok(!kpis.some((k) => k.metric_name.includes("Ambulation")));
});

test("an all-excluded episode omits overall_improvement_score instead of fabricating 0", () => {
  // Every measure excluded (start values at 0 / not assessed) → score is null,
  // which must NOT be written as a measured 0% improvement.
  const outcome = computeEpisodeOutcome({ start: { m1860: 0 }, discharge: { m1860: 0 } });
  assert.equal(outcome.overall_improvement_score, null);
  const rec = toPatientOutcomeMetric({ patientId: "p1" }, outcome);
  assert.ok(!("overall_improvement_score" in rec.functional_improvement));
});

test("toAgencyKPIs never claims on_target without a benchmark", () => {
  // Regression: star_eligible (a VOLUME threshold) used to earn "on_target"
  // (a PERFORMANCE status) when no benchmark was configured.
  const outcomes = Array.from({ length: 25 }, (_, i) =>
    computeEpisodeOutcome({ start: { m1860: 3 }, discharge: { m1860: i < 15 ? 1 : 3 } }),
  );
  const kpis = toAgencyKPIs(rollupMeasures(outcomes), { periodStart: "2026-01-01", periodEnd: "2026-03-31" });
  const amb = kpis.find((k) => k.metric_name.includes("Ambulation"));
  assert.equal(amb.status, "warning");
  assert.ok(amb.contributing_factors.some((f) => /no national benchmark/i.test(f)));
});
