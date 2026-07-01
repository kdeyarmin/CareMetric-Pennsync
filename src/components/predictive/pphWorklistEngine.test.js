import test from "node:test";
import assert from "node:assert/strict";
import {
  computePphRisk,
  daysInEpisode,
  recommendInterventions,
  buildPphWorklist,
  toPphOutcomeUpdate,
  DTC_PAC_WINDOW_DAYS,
  PPH_MEASURE,
} from "./pphWorklistEngine.js";

const oasisWith = (pdgm) => [{ pdgm_data: pdgm }];

// ── risk scoring (mirrors RehospitalizationPredictor) ──

test("institutional admission + CHF + severe function scores high", () => {
  const risk = computePphRisk({
    oasis: oasisWith({
      admission_source: "institutional",
      primary_diagnosis: "Congestive heart failure",
      functional_scores: { m1860_ambulation: 5, m1850_transferring: 4, m1830_bathing: 4 },
    }),
  });
  // 15 base + 25 + 20 + 18 = 78
  assert.equal(risk.score, 78);
  assert.equal(risk.level, "high");
  assert.equal(risk.factors[0].factor, "Recent hospitalization/SNF stay");
});

test("a low-risk community patient stays low", () => {
  const risk = computePphRisk({ oasis: oasisWith({ admission_source: "community", primary_diagnosis: "Hypertension" }) });
  assert.equal(risk.score, 15);
  assert.equal(risk.level, "low");
});

test("risk is capped at 95", () => {
  const risk = computePphRisk({
    oasis: oasisWith({
      admission_source: "institutional",
      primary_diagnosis: "heart failure copd diabetes with complication",
      functional_scores: { m1860_ambulation: 5, m1850_transferring: 5, m1830_bathing: 5 },
      comorbidities: [1, 2, 3, 4, 5],
    }),
  });
  assert.ok(risk.score <= 95);
});

test("low visit adherence adds risk only when visits were scheduled", () => {
  const withGap = computePphRisk({ visits: [{ status: "scheduled" }, { status: "scheduled" }, { status: "scheduled" }] });
  assert.ok(withGap.factors.some((f) => f.factor === "Low visit adherence"));
  const noVisits = computePphRisk({ visits: [] });
  assert.ok(!noVisits.factors.some((f) => f.factor === "Low visit adherence"));
});

// ── episode window ──

test("daysInEpisode computes age from admission_date", () => {
  assert.equal(daysInEpisode({ admission_date: "2026-06-01" }, "2026-06-15"), 14);
  assert.equal(daysInEpisode({}, "2026-06-15"), null);
});

// ── interventions ──

test("high-risk recommendations always include the three HHVBP drivers", () => {
  const rec = recommendInterventions([{ factor: "CHF/Heart Failure", impact: 18 }], "high");
  assert.ok(rec.includes("Front-loaded visit schedule"));
  assert.ok(rec.includes("MD contact / care coordination"));
  assert.ok(rec.includes("Medication review"));
  assert.ok(rec.some((r) => /weight monitoring/i.test(r)));
});

// ── worklist ──

test("buildPphWorklist ranks urgent, in-window patients first", () => {
  const list = buildPphWorklist(
    [
      {
        patient: { id: "hi", first_name: "High", last_name: "Risk", admission_date: "2026-06-20", status: "active" },
        oasis: oasisWith({ admission_source: "institutional", primary_diagnosis: "CHF", functional_scores: { m1860_ambulation: 5, m1850_transferring: 4, m1830_bathing: 4 } }),
      },
      {
        patient: { id: "lo", first_name: "Low", last_name: "Risk", admission_date: "2026-01-01", status: "active" },
        oasis: oasisWith({ admission_source: "community", primary_diagnosis: "Hypertension" }),
      },
    ],
    { asOf: "2026-07-01" },
  );
  assert.equal(list[0].patient_id, "hi");
  assert.equal(list[0].priority, "urgent");
  assert.equal(list[0].measure, PPH_MEASURE);
  assert.equal(list[0].within_dtc_pac_window, true); // 11 days in
  assert.ok(list[0].interventions.length > 0);
});

test("the DTC-PAC window boost only applies within 31 days", () => {
  const inWindow = buildPphWorklist(
    [{ patient: { id: "a", admission_date: "2026-06-20", status: "active" }, oasis: oasisWith({ admission_source: "institutional" }) }],
    { asOf: "2026-07-01" },
  )[0];
  const outWindow = buildPphWorklist(
    [{ patient: { id: "a", admission_date: "2026-05-01", status: "active" }, oasis: oasisWith({ admission_source: "institutional" }) }],
    { asOf: "2026-07-01" },
  )[0];
  assert.equal(inWindow.within_dtc_pac_window, true);
  assert.equal(outWindow.within_dtc_pac_window, false);
  assert.ok(inWindow.priority_score > outWindow.priority_score);
  assert.ok(DTC_PAC_WINDOW_DAYS === 31);
});

test("discharged patients are de-prioritized (episode over)", () => {
  const list = buildPphWorklist(
    [{ patient: { id: "d", admission_date: "2026-06-25", status: "discharged" }, oasis: oasisWith({ admission_source: "institutional" }) }],
    { asOf: "2026-07-01" },
  );
  assert.equal(list[0].within_stay, false);
  assert.ok(list[0].priority_score < list[0].risk_score); // penalized
});

test("limit truncates the worklist", () => {
  const items = Array.from({ length: 5 }, (_, i) => ({ patient: { id: `p${i}`, admission_date: "2026-06-25", status: "active" }, oasis: oasisWith({ admission_source: "institutional" }) }));
  assert.equal(buildPphWorklist(items, { asOf: "2026-07-01", limit: 2 }).length, 2);
});

// ── outcome capture ──

test("toPphOutcomeUpdate captures intervention + outcome to PatientOutcomeMetric shape", () => {
  const entry = buildPphWorklist(
    [{ patient: { id: "p1", first_name: "A", last_name: "B", admission_date: "2026-06-20", status: "active" }, oasis: oasisWith({ admission_source: "institutional", primary_diagnosis: "CHF" }) }],
    { asOf: "2026-07-01" },
  )[0];
  const update = toPphOutcomeUpdate(entry, { rehospitalized: false, erVisit: false, episodeStart: "2026-06-20" });
  assert.equal(update.patient_id, "p1");
  assert.equal(update.readmission_30_day, false);
  assert.equal(update.pph_prevention.measure, PPH_MEASURE);
  assert.equal(update.pph_prevention.within_dtc_pac_window, true);
  assert.ok(Array.isArray(update.pph_prevention.interventions));
});
