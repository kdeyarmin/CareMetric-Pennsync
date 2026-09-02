import test from "node:test";
import assert from "node:assert/strict";
import { PREP_PRIORITIES, abnormalVitals, buildVisitPrep } from "./visitPrep.js";

const NOW = new Date("2026-08-31T12:00:00.000Z");
const daysBefore = (n) => new Date(NOW.getTime() - n * 86400000).toISOString().slice(0, 10);

const PATIENT = {
  first_name: "Ada",
  last_name: "Lovelace",
  primary_diagnosis: "CHF",
  secondary_diagnoses: ["COPD", "Type 2 diabetes"],
  allergies: "Penicillin — rash",
  functional_status: { fall_risk: "high", ambulation: "walker", adl_independence: "minimal_assist" },
  current_medications: [
    { name: "Furosemide", dosage: "40 mg", frequency: "daily", start_date: daysBefore(200) },
    { name: "Metoprolol", dosage: "25 mg", frequency: "BID", start_date: daysBefore(5) },
  ],
  wounds: [{ location: "right heel", type: "pressure injury", stage: "2", size_length: 2, size_width: 3 }],
  admission_date: daysBefore(10),
};

const findItem = (prep, category) => prep.items.find((i) => i.category === category);

test("priority bands are ordered most urgent first", () => {
  assert.deepEqual(PREP_PRIORITIES, ["critical", "high", "routine"]);
});

test("an empty input produces a briefing rather than throwing", () => {
  const prep = buildVisitPrep({ now: NOW });
  assert.equal(prep.patientName, "Patient");
  assert.deepEqual(prep.counts, { critical: 0, high: 0, routine: 0 });
  assert.ok(prep.missing.length > 0, "absent data must be reported as missing, not as 'none'");
});

test("absent data is reported as not recorded in PennSync, never as 'none'", () => {
  const prep = buildVisitPrep({ now: NOW });
  assert.ok(prep.missing.some((m) => /not recorded in PennSync/i.test(m)));
  assert.ok(
    prep.missing.every((m) => !/^no known allergies$/i.test(m)),
    "PennSync must not assert a clinical negative it does not hold",
  );
});

test("a real allergy is a critical item; an explicit NKDA is routine", () => {
  const withAllergy = buildVisitPrep({ patient: PATIENT, now: NOW });
  assert.equal(findItem(withAllergy, "allergies").priority, "critical");

  const nkda = buildVisitPrep({ patient: { ...PATIENT, allergies: "NKDA" }, now: NOW });
  assert.equal(findItem(nkda, "allergies").priority, "routine");
});

test("high fall risk is surfaced as critical", () => {
  const prep = buildVisitPrep({ patient: PATIENT, now: NOW });
  const safety = prep.byPriority.critical.find((i) => i.category === "safety");
  assert.ok(safety);
  assert.match(safety.label, /High fall risk/);
});

test("a medication started in the last 30 days is called out separately", () => {
  const prep = buildVisitPrep({ patient: PATIENT, now: NOW });
  const recent = prep.items.find((i) => i.label === "Recent medication changes");
  assert.ok(recent, "a new medication is what changes the visit");
  assert.match(recent.detail, /Metoprolol/);
  assert.ok(!/Furosemide/.test(recent.detail), "a long-standing medication is not a change");
});

test("wounds are listed with their measurements", () => {
  const prep = buildVisitPrep({ patient: PATIENT, now: NOW });
  const wound = findItem(prep, "wound");
  assert.match(wound.label, /right heel/);
  assert.match(wound.detail, /2×3 cm/);
});

test("a hospitalization in the last 60 days is critical; an older one is not shown", () => {
  const recent = buildVisitPrep({
    patient: { ...PATIENT, past_hospitalizations: [{ date: daysBefore(12), reason: "CHF exacerbation" }] },
    now: NOW,
  });
  const event = findItem(recent, "acute_event");
  assert.equal(event.priority, "critical");
  assert.match(event.detail, /CHF exacerbation/);
  assert.match(event.detail, /12 days ago/);

  const old = buildVisitPrep({
    patient: { ...PATIENT, past_hospitalizations: [{ date: daysBefore(400), reason: "Pneumonia" }] },
    now: NOW,
  });
  assert.equal(findItem(old, "acute_event"), undefined);
});

test("abnormal vitals from the last visit are surfaced as critical", () => {
  const prep = buildVisitPrep({
    patient: PATIENT,
    priorVisits: [{
      id: "v1",
      visit_date: daysBefore(7),
      vital_signs: { blood_pressure_systolic: 190, heart_rate: 78, oxygen_saturation: 88 },
    }],
    now: NOW,
  });
  const vitals = findItem(prep, "vitals");
  assert.equal(vitals.priority, "critical");
  assert.match(vitals.detail, /Systolic BP 190 mmHg/);
  assert.match(vitals.detail, /O2 saturation 88%/);
  assert.ok(!/78/.test(vitals.detail), "a normal reading must not be listed as abnormal");
  assert.equal(vitals.visitId, "v1");
});

test("the most recent prior visit is used, not the first in the array", () => {
  const prep = buildVisitPrep({
    patient: PATIENT,
    priorVisits: [
      { id: "old", visit_date: daysBefore(30), compliance_issues: ["stale"] },
      { id: "new", visit_date: daysBefore(3), compliance_issues: ["wound not measured"] },
    ],
    now: NOW,
  });
  const concern = findItem(prep, "prior_concern");
  assert.equal(concern.visitId, "new");
  assert.match(concern.detail, /wound not measured/);
});

test("an unresolved provider follow-up never implies the provider was reached", () => {
  const prep = buildVisitPrep({
    patient: PATIENT,
    openTasks: [{ id: "t1", title: "Notify provider: O2 sat 88%", status: "pending", type: "notify" }],
    now: NOW,
  });
  const followUp = findItem(prep, "provider_followup");
  assert.equal(followUp.priority, "critical");
  assert.match(followUp.caveat, /does not mean the provider was contacted/i);
  assert.ok(!/notified/i.test(followUp.label), "the label must not assert notification");
});

test("completed tasks are not carried into the briefing", () => {
  const prep = buildVisitPrep({
    patient: PATIENT,
    openTasks: [
      { id: "t1", title: "Notify provider: wound decline", status: "completed" },
      { id: "t2", title: "Order new dressing supplies", status: "pending" },
    ],
    now: NOW,
  });
  assert.equal(findItem(prep, "provider_followup"), undefined);
  assert.match(findItem(prep, "task").detail, /dressing supplies/);
});

test("care-plan goals are read from the CarePlan problem/goal pair", () => {
  const prep = buildVisitPrep({
    patient: PATIENT,
    carePlans: [
      { problem: "Fluid overload", goal: "Weight stable within 3 lb", status: "active" },
      // `met` / `not_met` / `revised` are the real CarePlan.status terminal
      // values. The earlier fixture used "completed", which the enum does not
      // contain, so the test passed while every met goal still showed as active.
      { problem: "Old problem", goal: "Resolved", status: "met" },
      { problem: "Missed problem", goal: "Unmet", status: "not_met" },
      { problem: "Changed problem", goal: "Superseded", status: "revised" },
    ],
    now: NOW,
  });
  const plan = findItem(prep, "care_plan");
  assert.match(plan.detail, /Fluid overload — Weight stable within 3 lb/);
  for (const gone of ["Old problem", "Missed problem", "Changed problem"]) {
    assert.ok(!plan.detail.includes(gone), `a "${gone}" goal is no longer active`);
  }
  assert.match(plan.label, /\(1\)/, "only the active goal is counted");
});

test("the OASIS row states PennSync holds only its own copy", () => {
  const prep = buildVisitPrep({
    patient: PATIENT,
    oasisAssessments: [{ assessment_date: daysBefore(9), visit_type: "start_of_care" }],
    now: NOW,
  });
  const oasis = findItem(prep, "oasis");
  assert.match(oasis.caveat, /official assessment lives in your EMR/i);
});

test("the recertification window opens near the end of a 60-day episode", () => {
  const inWindow = buildVisitPrep({ patient: { ...PATIENT, admission_date: daysBefore(54) }, now: NOW });
  assert.ok(findItem(inWindow, "recertification"), "day 55 is inside the window");

  const midEpisode = buildVisitPrep({ patient: { ...PATIENT, admission_date: daysBefore(20) }, now: NOW });
  assert.equal(findItem(midEpisode, "recertification"), undefined, "day 21 is not");
});

test("the recertification reminder points at the EMR, not at PennSync", () => {
  const prep = buildVisitPrep({ patient: { ...PATIENT, admission_date: daysBefore(58) }, now: NOW });
  assert.match(findItem(prep, "recertification").detail, /in your EMR/i);
});

test("long lists are truncated with an overflow count so a phone screen stays usable", () => {
  const meds = Array.from({ length: 12 }, (_, i) => ({ name: `Drug ${i}`, dosage: "1 mg" }));
  const prep = buildVisitPrep({ patient: { ...PATIENT, current_medications: meds }, now: NOW });
  const row = prep.items.find((i) => i.label.startsWith("Medications"));
  assert.equal(row.overflow, 7);
  assert.equal(row.detail.split(";").length, 5);
});

test("items are grouped by priority with matching counts", () => {
  const prep = buildVisitPrep({ patient: PATIENT, now: NOW });
  assert.equal(prep.byPriority.critical.length, prep.counts.critical);
  assert.equal(prep.byPriority.high.length, prep.counts.high);
  assert.equal(prep.byPriority.routine.length, prep.counts.routine);
  assert.equal(
    prep.items.length,
    prep.counts.critical + prep.counts.high + prep.counts.routine,
    "every item lands in exactly one band",
  );
});

test("the briefing is deterministic for the same inputs", () => {
  const a = buildVisitPrep({ patient: PATIENT, now: NOW });
  const b = buildVisitPrep({ patient: PATIENT, now: NOW });
  assert.deepEqual(a, b);
});

test("abnormalVitals ignores missing and non-numeric readings", () => {
  assert.deepEqual(abnormalVitals(null), []);
  assert.deepEqual(abnormalVitals({}), []);
  assert.deepEqual(abnormalVitals({ heart_rate: "fast" }), []);
  assert.deepEqual(abnormalVitals({ heart_rate: 72 }), []);
  assert.deepEqual(abnormalVitals({ heart_rate: 140 }), ["Heart rate 140 bpm"]);
});
