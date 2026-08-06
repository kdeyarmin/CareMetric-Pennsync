import test from "node:test";
import assert from "node:assert/strict";
import {
  detectMissingDischargeOASIS,
  computeStarEligibilityGap,
} from "./dischargeComplianceEnforcer.js";
import { rollupMeasures, computeEpisodeOutcome, STAR_MIN_EPISODES } from "./outcomeMeasureEngine.js";

const patient = (over = {}) => ({ id: "p1", first_name: "Jane", last_name: "Doe", status: "active", ...over });
const ASOF = "2026-07-01";

test("discharged patient with no Discharge OASIS is flagged critical", () => {
  const res = detectMissingDischargeOASIS(
    { patient: patient({ status: "discharged" }), oasisAssessments: [{ visit_type: "Start of Care", status: "completed" }], visits: [] },
    { asOf: ASOF },
  );
  assert.ok(res);
  assert.equal(res.severity, "critical");
  assert.equal(res.reason, "discharged_without_discharge_oasis");
  assert.equal(res.alert.alert_type, "documentation_risk");
  assert.equal(res.alert.patient_id, "p1");
});

test("completed Discharge OASIS clears the flag", () => {
  const res = detectMissingDischargeOASIS(
    { patient: patient({ status: "discharged" }), oasisAssessments: [{ visit_type: "Discharge", status: "completed" }], visits: [] },
    { asOf: ASOF },
  );
  assert.equal(res, null);
});

test("a submitted Discharge OASIS also clears the flag", () => {
  const res = detectMissingDischargeOASIS(
    { patient: patient({ status: "discharged" }), oasisAssessments: [{ visit_type: "Discharge", status: "submitted" }], visits: [] },
    { asOf: ASOF },
  );
  assert.equal(res, null);
});

test("a draft Discharge OASIS is flagged as incomplete, not missing", () => {
  const res = detectMissingDischargeOASIS(
    { patient: patient({ status: "discharged" }), oasisAssessments: [{ visit_type: "Discharge", status: "draft" }], visits: [] },
    { asOf: ASOF },
  );
  assert.ok(res);
  assert.equal(res.reason, "discharge_oasis_incomplete");
  assert.match(res.alert.title, /Not Completed/);
});

test("active patient with a stale last visit (episode likely ended) is flagged high", () => {
  const res = detectMissingDischargeOASIS(
    { patient: patient(), oasisAssessments: [{ visit_type: "Start of Care", status: "completed" }], visits: [{ visit_date: "2026-06-01" }] },
    { asOf: ASOF, staleDays: 14 },
  );
  assert.ok(res);
  assert.equal(res.severity, "high");
  assert.equal(res.reason, "episode_stale_without_discharge_oasis");
});

test("active patient seen recently is NOT flagged (episode still open)", () => {
  const res = detectMissingDischargeOASIS(
    { patient: patient(), oasisAssessments: [{ visit_type: "Start of Care", status: "completed" }], visits: [{ visit_date: "2026-06-28" }] },
    { asOf: ASOF, staleDays: 14 },
  );
  assert.equal(res, null);
});

test("date-only asOf does not UTC-shift the 14-day stale window", () => {
  // Regression: `new Date("2026-07-01")` is UTC midnight; in US zones
  // daysBetween then undercounts vs a date-only last visit and misses the alert.
  const res = detectMissingDischargeOASIS(
    {
      patient: patient(),
      oasisAssessments: [{ visit_type: "Start of Care", status: "completed" }],
      visits: [{ visit_date: "2026-06-17" }],
    },
    { asOf: "2026-07-01", staleDays: 14 },
  );
  assert.ok(res, "exactly 14 local calendar days must flag");
  assert.equal(res.alert.data_sources.days_since_last_visit, 14);
});

test("deceased episodes are not flagged (excluded from improvement measures)", () => {
  const res = detectMissingDischargeOASIS(
    { patient: patient({ status: "deceased" }), oasisAssessments: [], visits: [] },
    { asOf: ASOF },
  );
  assert.equal(res, null);
});

test("missing baseline SOC/ROC is surfaced in the contributing factors", () => {
  const res = detectMissingDischargeOASIS(
    { patient: patient({ status: "discharged" }), oasisAssessments: [], visits: [] },
    { asOf: ASOF },
  );
  assert.ok(res.alert.contributing_factors.some((f) => /No SOC\/ROC/.test(f)));
});

test("no patient id → null (defensive)", () => {
  assert.equal(detectMissingDischargeOASIS({ patient: { status: "discharged" } }, { asOf: ASOF }), null);
  assert.equal(detectMissingDischargeOASIS({}, { asOf: ASOF }), null);
});

// ── star-eligibility gap ──

test("computeStarEligibilityGap reports measures below the 20-episode floor", () => {
  // 10 improving ambulation episodes only → 1 measure with denom 10, rest 0.
  const outcomes = Array.from({ length: 10 }, () =>
    computeEpisodeOutcome({ start: { m1860: 3 }, discharge: { m1860: 1 } }),
  );
  const gap = computeStarEligibilityGap(rollupMeasures(outcomes));
  assert.equal(gap.at_risk, true);
  assert.equal(gap.measures_eligible, 0);
  const amb = gap.measures_short.find((m) => m.key === "ambulation");
  assert.equal(amb.denominator, 10);
  assert.equal(amb.episodes_needed, STAR_MIN_EPISODES - 10);
});

test("an agency clearing 5 measures at >= 20 episodes is not at risk", () => {
  const outcomes = Array.from({ length: STAR_MIN_EPISODES }, () =>
    computeEpisodeOutcome({
      start: { m1860: 3, m1850: 2, m1830: 3, m1400: 3, m2020: 2 },
      discharge: { m1860: 1, m1850: 1, m1830: 1, m1400: 1, m2020: 1 },
    }),
  );
  const gap = computeStarEligibilityGap(rollupMeasures(outcomes));
  assert.equal(gap.measures_eligible, 5);
  assert.equal(gap.at_risk, false);
  assert.equal(gap.measures_needed, 0);
});

test("visit-type and status casing drift does not create a false missing-discharge alarm", () => {
  // Regression: "DISCHARGE"/"Completed" failed the exact-match sets and raised
  // a missing-discharge alert for an episode whose discharge OASIS was done.
  const res = detectMissingDischargeOASIS(
    { patient: patient({ status: "discharged" }), oasisAssessments: [{ visit_type: "DISCHARGE", status: "Completed" }], visits: [] },
    { asOf: ASOF },
  );
  assert.equal(res, null);
});
