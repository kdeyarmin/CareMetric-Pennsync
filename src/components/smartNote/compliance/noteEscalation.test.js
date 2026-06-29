import test from "node:test";
import assert from "node:assert/strict";
import { detectNoteCriticalVitals } from "./noteEscalation.js";

test("flags a hypertensive-crisis BP documented in the note", () => {
  const hits = detectNoteCriticalVitals("Visit note. BP 190/100, patient comfortable.");
  assert.ok(hits.find((h) => h.id === "hypertensive_crisis"), "expected hypertensive crisis");
});

test("flags severe hypoxia documented in the note", () => {
  const hits = detectNoteCriticalVitals("O2 85% on room air, mild dyspnea.");
  assert.ok(hits.find((h) => h.id === "severe_hypoxia"), "expected severe hypoxia");
});

test("flags 10/10 pain documented in the note", () => {
  const hits = detectNoteCriticalVitals("Patient reports pain 10/10 at the wound site.");
  assert.ok(hits.find((h) => h.id === "severe_pain"), "expected severe pain");
});

test("no critical vitals for a normal note", () => {
  assert.deepEqual(detectNoteCriticalVitals("BP 128/78, O2 97%, pain 2/10."), []);
});

test("empty note yields nothing", () => {
  assert.deepEqual(detectNoteCriticalVitals(""), []);
});
