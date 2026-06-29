import test from "node:test";
import assert from "node:assert/strict";
import { crossCheckChart } from "./chartCrossCheck.js";

test("no findings without note or patient", () => {
  assert.deepEqual(crossCheckChart("", { allergies: "Penicillin" }), []);
  assert.deepEqual(crossCheckChart("gave aspirin", null), []);
});

test("flags a medication that appears in the patient's allergies", () => {
  const patient = { allergies: "Aspirin, Sulfa" };
  const out = crossCheckChart("Administered aspirin 81 mg per order.", patient);
  const allergy = out.find((f) => f.category === "Allergy");
  assert.ok(allergy, "expected an allergy finding");
  assert.equal(allergy.severity, "critical");
  assert.match(allergy.message, /Aspirin/);
});

test("ignores allergies marked NKDA / none", () => {
  const out = crossCheckChart("Administered aspirin.", { allergies: "NKDA" });
  assert.equal(out.find((f) => f.category === "Allergy"), undefined);
});

test("flags a note medication missing from the chart med list", () => {
  const patient = { current_medications: [{ name: "Metformin", dosage: "500 mg" }] };
  const out = crossCheckChart("Started patient on warfarin this visit.", patient);
  const recon = out.find((f) => f.category === "Medication");
  assert.ok(recon);
  assert.equal(recon.severity, "info");
  assert.match(recon.message, /Warfarin/);
});

test("does not flag a medication already on the chart list", () => {
  const patient = { current_medications: [{ name: "Metformin 500mg" }] };
  const out = crossCheckChart("Reviewed metformin with patient.", patient);
  assert.equal(out.find((f) => f.category === "Medication"), undefined);
});

test("warns when high fall risk is not addressed in the note", () => {
  const patient = { functional_status: { fall_risk: "high" } };
  const out = crossCheckChart("Assessed wound, vitals stable.", patient);
  const safety = out.find((f) => f.category === "Safety");
  assert.ok(safety);
  assert.equal(safety.severity, "warning");
});

test("no fall-risk warning when the note addresses safety", () => {
  const patient = { functional_status: { fall_risk: "high" } };
  const out = crossCheckChart("Reviewed fall precautions and removed throw rugs.", patient);
  assert.equal(out.find((f) => f.category === "Safety"), undefined);
});

test("no fall-risk warning when fall risk is not high", () => {
  const patient = { functional_status: { fall_risk: "low" } };
  const out = crossCheckChart("Assessed wound.", patient);
  assert.equal(out.find((f) => f.category === "Safety"), undefined);
});
