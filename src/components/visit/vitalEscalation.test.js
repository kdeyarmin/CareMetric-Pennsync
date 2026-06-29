import test from "node:test";
import assert from "node:assert/strict";
import { detectCriticalVitals } from "./vitalEscalation.js";

test("normal vitals produce no critical breaches", () => {
  assert.deepEqual(
    detectCriticalVitals({
      blood_pressure_systolic: "120",
      blood_pressure_diastolic: "80",
      oxygen_saturation: "98",
      pain_level: "2",
    }),
    [],
  );
});

test("empty / blank vitals produce no breaches", () => {
  assert.deepEqual(detectCriticalVitals({}), []);
  assert.deepEqual(detectCriticalVitals({ oxygen_saturation: "", pain_level: "" }), []);
  assert.deepEqual(detectCriticalVitals(null), []);
});

test("hypertensive crisis triggers on systolic > 180", () => {
  const breaches = detectCriticalVitals({ blood_pressure_systolic: "190", blood_pressure_diastolic: "95" });
  assert.equal(breaches.length, 1);
  assert.equal(breaches[0].id, "hypertensive_crisis");
  assert.equal(breaches[0].severity, "critical");
});

test("hypertensive crisis triggers on diastolic > 120", () => {
  const breaches = detectCriticalVitals({ blood_pressure_systolic: "150", blood_pressure_diastolic: "125" });
  assert.equal(breaches.length, 1);
  assert.equal(breaches[0].id, "hypertensive_crisis");
});

test("a leading-digit BP typo is rejected, not parsed as 180/120", () => {
  // "1180/120" must NOT be read as 180/120 (which would slip under >180/120 and
  // miss the crisis) nor corrupt the reading. The implausible value is dropped.
  assert.deepEqual(detectCriticalVitals({ bp: "1180/120" }), []);
  // A genuine crisis via the bp-string path still escalates.
  assert.equal(detectCriticalVitals({ bp: "200/130" })[0]?.id, "hypertensive_crisis");
});

test("severe hypoxia triggers below 88% but not at/above", () => {
  assert.equal(detectCriticalVitals({ oxygen_saturation: "85" })[0]?.id, "severe_hypoxia");
  assert.deepEqual(detectCriticalVitals({ oxygen_saturation: "88" }), []);
  assert.deepEqual(detectCriticalVitals({ oxygen_saturation: "97" }), []);
  // A blank/zero field must not falsely alert.
  assert.deepEqual(detectCriticalVitals({ oxygen_saturation: "0" }), []);
});

test("severe pain triggers at 10/10", () => {
  assert.equal(detectCriticalVitals({ pain_level: "10" })[0]?.id, "severe_pain");
  assert.deepEqual(detectCriticalVitals({ pain_level: "9" }), []);
});

test("multiple simultaneous breaches are all reported", () => {
  const breaches = detectCriticalVitals({
    blood_pressure_systolic: "200",
    blood_pressure_diastolic: "130",
    oxygen_saturation: "84",
    pain_level: "10",
  });
  const ids = breaches.map((b) => b.id).sort();
  assert.deepEqual(ids, ["hypertensive_crisis", "severe_hypoxia", "severe_pain"]);
});

test("supports the SmartVitalsInput key convention (bp string, o2, pain)", () => {
  assert.equal(detectCriticalVitals({ bp: "190/125" })[0]?.id, "hypertensive_crisis");
  assert.equal(detectCriticalVitals({ bp: "150 / 122" })[0]?.id, "hypertensive_crisis");
  assert.equal(detectCriticalVitals({ o2: "85" })[0]?.id, "severe_hypoxia");
  assert.equal(detectCriticalVitals({ pain: "10" })[0]?.id, "severe_pain");
  // Normal values in the SmartVitalsInput convention must not alert.
  assert.deepEqual(detectCriticalVitals({ bp: "120/80", o2: "98", pain: "2" }), []);
});
