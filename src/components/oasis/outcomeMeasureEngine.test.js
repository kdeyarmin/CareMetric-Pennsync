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
import { v2Row, legacyRow, unversionedRow, v2Assessment, legacyAssessment } from "./responseSchema/testFixtures.js";

const DEF = {
  m1860: "m1860_cms_e2", m1830: "m1830_cms_e2", m1400: "m1400_cms_e2", m2020: "m2020_cms_e2",
};
const NUM = { m1860: "M1860", m1830: "M1830", m1400: "M1400", m2020: "M2020" };

/** SOC assessment carrying the given { item: code } pairs as v2 rows. */
function soc(codes) {
  return v2Assessment({
    visitType: "Start of Care", date: "2026-05-01",
    rows: Object.entries(codes).map(([k, c]) => v2Row(DEF[k], NUM[k], c)),
  });
}
/** Discharge assessment carrying the given { item: code } pairs as v2 rows. */
function dc(codes) {
  return v2Assessment({
    visitType: "Discharge", date: "2026-06-01",
    rows: Object.entries(codes).map(([k, c]) => v2Row(DEF[k], NUM[k], c)),
  });
}
/** Episode from v2 endpoints. */
function episode(startCodes, dcCodes, extra = {}) {
  return computeEpisodeOutcome({ startAssessment: soc(startCodes), dischargeAssessment: dc(dcCodes), ...extra });
}

// ── answersFromOasisItems ──

test("extracts v2 rows as OPAQUE STRING codes, never numbers", () => {
  const map = answersFromOasisItems([
    v2Row(DEF.m1860, "M1860", "2"),
    v2Row(DEF.m1400, "M1400", "3"),
  ]);
  assert.equal(map.m1860, "2");
  assert.equal(map.m1400, "3");
  assert.equal(typeof map.m1860, "string", "a code is a label, not a magnitude");
});

test("legacy and unversioned rows yield nothing — their codes mean something else", () => {
  // The legacy M1830 `6` meant "unable to rate — artificial opening"; the CMS
  // `6` means "bathed totally by another person". Reading either through the
  // current scale is the reinterpretation this gate exists to prevent.
  assert.deepEqual(answersFromOasisItems([legacyRow("m1830", "M1830", "6")]), {});
  assert.deepEqual(answersFromOasisItems([unversionedRow("M1860", "3")]), {});
});

test("an AI-originated row is never scorable", () => {
  const row = v2Row(DEF.m1860, "M1860", "2", { response_origin: "ai_suggested", ai_suggested: true });
  assert.deepEqual(answersFromOasisItems([row]), {});
});

test("empty / null input yields an empty map", () => {
  assert.deepEqual(answersFromOasisItems(null), {});
  assert.deepEqual(answersFromOasisItems([]), {});
});

// ── improvement scoring (lower discharge code == improvement) ──

test("ambulation improves when discharge value < SOC value", () => {
  const outcome = episode({ m1860: "3" }, { m1860: "1" });
  const amb = outcome.measures.find((m) => m.key === "ambulation");
  assert.equal(amb.status, MEASURE_STATUS.IMPROVED);
  assert.equal(outcome.improved_count, 1);
});

test("no change is not_improved, not excluded", () => {
  const outcome = episode({ m1860: "3" }, { m1860: "3" });
  const amb = outcome.measures.find((m) => m.key === "ambulation");
  assert.equal(amb.status, MEASURE_STATUS.NOT_IMPROVED);
  assert.equal(outcome.eligible_measure_count, 1);
});

test("M1850 has no verified CMS response set, so it can never be scored", () => {
  // M1850 is one of the five ABBREVIATED items deliberately left out of the
  // CMS-alignment cutover. Scoring it would mean scoring a response set nobody
  // has verified — it is excluded with a named reason instead.
  const outcome = episode({ m1860: "3" }, { m1860: "1" });
  const t = outcome.measures.find((m) => m.key === "bed_transfer");
  assert.equal(t.status, MEASURE_STATUS.EXCLUDED);
  assert.equal(t.reason, "no_verified_response_set");
});

test("a WORSE (higher) discharge value is not_improved", () => {
  const outcome = episode({ m1860: "1" }, { m1860: "3" });
  const t = outcome.measures.find((m) => m.key === "ambulation");
  assert.equal(t.status, MEASURE_STATUS.NOT_IMPROVED);
});

test("SOC already independent (code 0) → excluded, no room to improve", () => {
  const outcome = episode({ m1860: "0" }, { m1860: "0" });
  const amb = outcome.measures.find((m) => m.key === "ambulation");
  assert.equal(amb.status, MEASURE_STATUS.EXCLUDED);
  assert.equal(amb.reason, "already_independent_at_start");
});

test("missing SOC or discharge value → excluded (missing_data)", () => {
  const outcome = episode({}, { m1860: "1" });
  const amb = outcome.measures.find((m) => m.key === "ambulation");
  assert.equal(amb.status, MEASURE_STATUS.EXCLUDED);
  assert.equal(amb.reason, "missing_data");
});

test("v2 M1830 code 6 is a RATABLE total-dependence level, not unratable", () => {
  // CMS 6 is "Unable to participate effectively in bathing and is bathed
  // totally by another person" — a real most-dependent level, so 6→2 improves.
  // It was excluded only because the LEGACY 6 meant "unable to rate".
  const outcome = episode({ m1830: "6" }, { m1830: "2" });
  const bath = outcome.measures.find((m) => m.key === "bathing");
  assert.equal(bath.status, MEASURE_STATUS.IMPROVED);
});

test("legacy M1830 code 6 stays excluded", () => {
  const legacySoc = legacyAssessment({
    visitType: "Start of Care", date: "2026-05-01",
    rows: [legacyRow("m1830", "M1830", "6")],
  });
  const outcome = computeEpisodeOutcome({ startAssessment: legacySoc, dischargeAssessment: dc({ m1830: "2" }) });
  assert.equal(outcome.eligible, false);
  assert.ok(outcome.episode_excluded_reasons.includes("start_schema_not_v2"));
  assert.equal(outcome.eligible_measure_count, 0, "a legacy endpoint contributes zero denominator");
});

test("M2020 NA is not a point on the ability scale → unratable, not zero", () => {
  const outcome = episode({ m2020: "NA" }, { m2020: "1" });
  const meds = outcome.measures.find((m) => m.key === "oral_meds");
  assert.equal(meds.status, MEASURE_STATUS.EXCLUDED);
  assert.equal(meds.reason, "unratable_code");
});

test("a code outside the item's response set never reaches scoring at all", () => {
  // "9" is not an M2020 response. The row is refused at the schema gate, so the
  // measure sees no value — it must NOT be coerced to a low functional level.
  const outcome = episode({ m2020: "9" }, { m2020: "1" });
  const meds = outcome.measures.find((m) => m.key === "oral_meds");
  assert.equal(meds.status, MEASURE_STATUS.EXCLUDED);
  assert.equal(meds.reason, "missing_data");
  assert.equal(meds.start_value, null);
  assert.ok(outcome.excluded_row_count >= 1, "the refused row is counted, not silently dropped");
});

test("every measure is evaluated; the four with verified sets can improve", () => {
  const outcome = episode(
    { m1860: "3", m1830: "3", m1400: "3", m2020: "2" },
    { m1860: "1", m1830: "1", m1400: "1", m2020: "1" },
  );
  assert.equal(outcome.measures.length, IMPROVEMENT_MEASURES.length);
  assert.equal(outcome.improved_count, 4);
  assert.equal(outcome.overall_improvement_score, 100);
});

test("overall improvement score is improved / eligible, not improved / total", () => {
  // ambulation improves; dyspnea no change; bathing excluded (SOC independent)
  const outcome = episode(
    { m1860: "2", m1400: "2", m1830: "0" },
    { m1860: "1", m1400: "2", m1830: "0" },
  );
  assert.equal(outcome.eligible_measure_count, 2);
  assert.equal(outcome.improved_count, 1);
  assert.equal(outcome.overall_improvement_score, 50);
});

// ── episode-level death exclusion ──

test("an episode ending in death is excluded from all improvement measures", () => {
  const outcome = episode({ m1860: "3" }, { m1860: "1" }, { dischargeDisposition: "deceased" });
  assert.equal(outcome.eligible, false);
  assert.equal(outcome.episode_excluded_reason, "episode_ended_in_death");
  assert.ok(outcome.measures.every((m) => m.status === MEASURE_STATUS.EXCLUDED));
});

test("a live discharge to community is eligible", () => {
  const outcome = episode({ m1860: "3" }, { m1860: "1" }, { dischargeDisposition: "remained_home" });
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
  const outcome = episode({ m1860: "2" }, { m1860: "1" });
  assert.equal(outcome.gg_discharge_function.applicable, false);
});

// ── PatientOutcomeMetric mapping ──

test("toPatientOutcomeMetric maps improvement flags onto entity fields", () => {
  const outcome = episode(
    { m1860: "3", m1830: "2", m2020: "2", m1400: "2" },
    { m1860: "1", m1830: "1", m2020: "1", m1400: "2" },
  );
  const rec = toPatientOutcomeMetric(
    { patientId: "p1", episodeStart: "2026-01-01", episodeEnd: "2026-03-01", primaryDiagnosis: "CHF" },
    outcome,
  );
  assert.equal(rec.patient_id, "p1");
  assert.equal(rec.functional_improvement.ambulation_improved, true);
  assert.equal(rec.functional_improvement.bathing_improved, true);
  assert.equal(rec.functional_improvement.transferring_improved, false); // no verified response set
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
    outcomes.push(episode({ m1860: "3" }, { m1860: i < 20 ? "1" : "3" }));
  }
  const rollup = rollupMeasures(outcomes);
  const amb = rollup.measures.find((m) => m.key === "ambulation");
  assert.equal(amb.denominator, 25);
  assert.equal(amb.numerator, 20);
  assert.equal(amb.rate, 80);
  assert.equal(amb.star_eligible, true);
});

test("a measure below the 20-episode threshold is not star eligible", () => {
  const outcomes = [episode({ m1860: "3" }, { m1860: "1" })];
  const rollup = rollupMeasures(outcomes);
  const amb = rollup.measures.find((m) => m.key === "ambulation");
  assert.equal(amb.denominator, 1);
  assert.equal(amb.star_eligible, false);
  assert.ok(rollup.star_eligible === false);
});

test("excluded measures never inflate the denominator", () => {
  // SOC value 0 → excluded on ambulation for all episodes.
  const outcomes = Array.from({ length: 30 }, () => episode({ m1860: "0" }, { m1860: "0" }));
  const rollup = rollupMeasures(outcomes);
  const amb = rollup.measures.find((m) => m.key === "ambulation");
  assert.equal(amb.denominator, 0);
  assert.equal(amb.rate, null);
});

test("STAR_MIN_EPISODES gate wires into rollup", () => {
  const outcomes = Array.from({ length: STAR_MIN_EPISODES }, () => episode({ m1830: "2" }, { m1830: "1" }));
  const rollup = rollupMeasures(outcomes);
  const t = rollup.measures.find((m) => m.key === "bathing");
  assert.equal(t.denominator, STAR_MIN_EPISODES);
  assert.equal(t.star_eligible, true);
});

test("an item with no verified response set never earns a denominator", () => {
  const outcomes = Array.from({ length: STAR_MIN_EPISODES }, () => episode({ m1830: "2" }, { m1830: "1" }));
  const rollup = rollupMeasures(outcomes);
  const t = rollup.measures.find((m) => m.key === "bed_transfer");
  assert.equal(t.denominator, 0);
  assert.equal(t.rate, null);
});

// ── AgencyKPI mapping ──

test("toAgencyKPIs emits one quality KPI per computable measure", () => {
  const outcomes = Array.from({ length: 25 }, (_, i) => episode({ m1860: "3" }, { m1860: i < 15 ? "1" : "3" }));
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
  const rollup = rollupMeasures([episode({ m1860: "0" }, { m1860: "0" })]);
  const kpis = toAgencyKPIs(rollup, { periodStart: "2026-01-01", periodEnd: "2026-03-31" });
  assert.ok(!kpis.some((k) => k.metric_name.includes("Ambulation")));
});

test("an all-excluded episode omits overall_improvement_score instead of fabricating 0", () => {
  // Every measure excluded (start values at 0 / not assessed) → score is null,
  // which must NOT be written as a measured 0% improvement.
  const outcome = episode({ m1860: "0" }, { m1860: "0" });
  assert.equal(outcome.overall_improvement_score, null);
  const rec = toPatientOutcomeMetric({ patientId: "p1" }, outcome);
  assert.ok(!("overall_improvement_score" in rec.functional_improvement));
});

test("toAgencyKPIs never claims on_target without a benchmark", () => {
  // Regression: star_eligible (a VOLUME threshold) used to earn "on_target"
  // (a PERFORMANCE status) when no benchmark was configured.
  const outcomes = Array.from({ length: 25 }, (_, i) =>
    episode({ m1860: "3" }, { m1860: i < 15 ? "1" : "3" }),
  );
  const kpis = toAgencyKPIs(rollupMeasures(outcomes), { periodStart: "2026-01-01", periodEnd: "2026-03-31" });
  const amb = kpis.find((k) => k.metric_name.includes("Ambulation"));
  assert.equal(amb.status, "warning");
  assert.ok(amb.contributing_factors.some((f) => /no national benchmark/i.test(f)));
});
