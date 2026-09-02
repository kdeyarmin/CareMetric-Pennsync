import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateDemographics,
  aggregateTopDiagnoses,
  aggregateFunctionalScores,
  aggregatePaymentTrends,
  computeSummaryStats,
  computeAge,
} from "./oasisAnalytics.js";

const u = (over = {}) => ({ pdgm_data: {}, ...over });

test("computeAge accounts for whether the birthday has occurred (no off-by-one)", () => {
  const ref = new Date(2026, 5, 5); // 2026-06-05, local
  assert.equal(computeAge("1961-12-01", ref), 64); // birthday later this year -> 64, not 65
  assert.equal(computeAge("1961-05-01", ref), 65); // birthday already passed -> 65
  assert.equal(computeAge("1961-06-05", ref), 65); // birthday today -> 65
  assert.ok(Number.isNaN(computeAge("Not found", ref)));
  assert.ok(Number.isNaN(computeAge(undefined, ref)));
});

test("computeAge rejects a malformed-but-ISO-shaped dob (out-of-range month/day)", () => {
  const ref = new Date(2026, 5, 5);
  assert.ok(Number.isNaN(computeAge("2020-99-99", ref)));
  assert.ok(Number.isNaN(computeAge("2020-13-01", ref)));
  assert.ok(Number.isNaN(computeAge("2020-02-30", ref))); // Feb 30 doesn't exist
  assert.equal(computeAge("2020-02-29", ref), 6); // valid leap day still works
});

test("aggregateDemographics classifies gender and age ranges", () => {
  const { gender, age } = aggregateDemographics([
    u({ pdgm_data: { patient_info: { gender: "Male", dob: "1950-01-01" } } }), // ~75-84
    u({ pdgm_data: { patient_info: { gender: "female", dob: "2020-01-01" } } }), // 0-64
    u({ pdgm_data: { patient_info: { gender: "", dob: "Not found" } } }), // unknown both
  ]);
  const g = Object.fromEntries(gender.map((x) => [x.name, x.value]));
  assert.equal(g.Male, 1);
  assert.equal(g.Female, 1);
  assert.equal(g.Unknown, 1);
  const a = Object.fromEntries(age.map((x) => [x.name, x.value]));
  assert.equal(a["0-64"], 1);
  assert.equal(a.Unknown, 1);
  assert.equal(a["75-84"], 1);
});

test("aggregateTopDiagnoses counts, sorts, limits, and filters placeholders", () => {
  const rows = aggregateTopDiagnoses(
    [
      u({ pdgm_data: { primary_diagnosis: "CHF" } }),
      u({ pdgm_data: { primary_diagnosis: "CHF" } }),
      u({ pdgm_data: { primary_diagnosis: "COPD" } }),
      u({ pdgm_data: { primary_diagnosis: "Unknown" } }),
      u({ pdgm_data: { primary_diagnosis: "Not found" } }),
    ],
    1,
  );
  assert.equal(rows.length, 1); // limit
  assert.deepEqual(rows[0], { name: "CHF", count: 2 }); // most frequent first
});

const V2 = "pennsync-oasis-response-v2-cms-e2";
/** An upload whose derived values state the CMS-aligned response set. */
const v2Upload = (over = {}) => u({ response_schema_id: V2, ...over });

test("aggregateFunctionalScores filters, orders oldest->newest, slices, maps fields", () => {
  const { points } = aggregateFunctionalScores(
    [
      v2Upload({ assessment_date: "2026-03-01", patient_name: "Bob", pdgm_data: { functional_scores: { m1860_ambulation: 3 } } }),
      v2Upload({ assessment_date: "2026-01-01", patient_name: "Amy", pdgm_data: { functional_scores: { m1850_transferring: 2 } } }),
      v2Upload({ assessment_date: null, pdgm_data: { functional_scores: { m1830_bathing: 1 } } }), // filtered (no date)
      v2Upload({ assessment_date: "2026-02-01", patient_name: "Cy" }), // filtered (no functional_scores)
    ],
    20,
  );
  assert.equal(points.length, 2);
  assert.equal(points[0].patient, "Amy"); // oldest first
  assert.equal(points[0].transferring, 2);
  assert.equal(points[1].ambulation, 3);
  // A MISSING score is null, not 0. On every OASIS functional scale 0 means
  // fully independent, so defaulting a gap to 0 plotted an incompletely
  // extracted upload as an independent patient.
  assert.equal(points[1].bathing, null);
});

test("aggregateFunctionalScores excludes uploads whose response set cannot be verified", () => {
  const scores = { functional_scores: { m1860_ambulation: 3 } };
  const res = aggregateFunctionalScores([
    v2Upload({ assessment_date: "2026-01-01", patient_name: "Amy", pdgm_data: scores }),
    u({ assessment_date: "2026-02-01", patient_name: "Bob", response_schema_id: "pennsync-oasis-response-v1-legacy", pdgm_data: scores }),
    // ABSENT is unknown, not "fine". Legacy M1860 "2" is a one-handed device;
    // CMS "2" is two-handed/supervision — they cannot share an axis.
    u({ assessment_date: "2026-02-15", patient_name: "Cy", pdgm_data: scores }),
    u({ assessment_date: "2026-02-20", patient_name: "Di", response_schema_id: "pennsync-oasis-response-v9", pdgm_data: scores }),
  ]);
  assert.equal(res.points.length, 1);
  assert.equal(res.points[0].patient, "Amy");
  assert.equal(res.excluded, 3, "legacy, absent and unknown schemas are all excluded");
  assert.match(res.excluded_reason, /cannot verify/);
});

test("before cutover the series is EMPTY rather than mixing incompatible scales", () => {
  // Every upload predates the response-schema stamp. An empty chart with a
  // stated reason is the honest state; a populated one would be plotting
  // legacy and CMS codes on the same axis.
  const res = aggregateFunctionalScores([
    u({ assessment_date: "2026-01-01", patient_name: "Amy", pdgm_data: { functional_scores: { m1860_ambulation: 3 } } }),
    u({ assessment_date: "2026-02-01", patient_name: "Bob", pdgm_data: { functional_scores: { m1860_ambulation: 4 } } }),
  ]);
  assert.deepEqual(res.points, []);
  assert.equal(res.excluded, 2);
  assert.ok(res.excluded_reason.length > 0);
});

test("aggregatePaymentTrends keeps only rows with date + payment", () => {
  const rows = aggregatePaymentTrends([
    u({ assessment_date: "2026-01-01", estimated_payment: 100, patient_name: "Amy" }),
    u({ assessment_date: "2026-02-01" }), // no payment
    u({ estimated_payment: 200 }), // no date
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payment, 100);
});

test("computeSummaryStats handles populated and empty inputs", () => {
  const stats = computeSummaryStats([
    u({ scores: { overall: 80 }, estimated_payment: 1000 }),
    u({ scores: { overall: 90 }, estimated_payment: 3000 }),
  ]);
  assert.equal(stats.totalAssessments, 2);
  assert.equal(stats.avgScore, 85);
  assert.equal(stats.avgPayment, 2000);
  assert.equal(stats.totalRevenue, 4000);

  const empty = computeSummaryStats([]);
  assert.deepEqual(empty, { totalAssessments: 0, avgScore: 0, avgPayment: 0, totalRevenue: 0 });
});

test("aggregateDemographics routes an unparseable dob to Unknown, not 85+", () => {
  const u = (over) => ({ ...over });
  const { age } = aggregateDemographics([
    u({ pdgm_data: { patient_info: { gender: "Male", dob: "garbage" } } }),
  ]);
  const byName = Object.fromEntries(age.map((a) => [a.name, a.value]));
  assert.equal(byName.Unknown, 1);
  assert.equal(byName["85+"], 0);
});
