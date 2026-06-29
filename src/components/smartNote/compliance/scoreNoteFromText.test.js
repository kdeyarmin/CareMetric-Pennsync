import test from "node:test";
import assert from "node:assert/strict";
import { scoreNoteFromText } from "./scoreNoteFromText.js";

test("empty text scores 0 and reports nothing covered", () => {
  const { coverageScore, draftScore, structured } = scoreNoteFromText({
    text: "",
    serviceLine: "home_health",
    visitType: "routine_visit",
  });
  assert.equal(coverageScore, 0);
  assert.equal(draftScore, coverageScore); // no Q&A path → draft === final
  assert.equal(structured.homebound_status_verified, false);
  assert.equal(structured.skilled_intervention_documented, false);
});

test("a richer narrative scores higher than a sparse one", () => {
  const sparse = scoreNoteFromText({
    text: "Patient seen today. Did fine.",
    serviceLine: "home_health",
    visitType: "routine_visit",
  });
  const rich = scoreNoteFromText({
    text:
      "Patient is homebound, requires assistance to leave home. Skilled nursing " +
      "performed wound care to the sacral wound. Vital signs: BP 128/76, HR 72, " +
      "temp 98.4, O2 sat 97%. Patient tolerated the visit well and reports pain " +
      "of 2/10. Educated patient on medication compliance and reviewed the care " +
      "plan; goals progressing. Reviewed emergency plan and safety in the home.",
    serviceLine: "home_health",
    visitType: "routine_visit",
  });
  assert.ok(rich.coverageScore > sparse.coverageScore);
  assert.ok(rich.coverageScore > 0 && rich.coverageScore <= 100);
});

test("documented homebound + skilled need flow into the structured Visit fields", () => {
  const { structured } = scoreNoteFromText({
    text:
      "Patient remains homebound and requires a taxing effort to leave the home. " +
      "Skilled nursing assessment and wound care performed this visit.",
    serviceLine: "home_health",
    visitType: "routine_visit",
  });
  assert.equal(structured.homebound_status_verified, true);
  assert.equal(structured.skilled_intervention_documented, true);
  assert.ok(typeof structured.homebound_justification === "string");
});

test("returns a presence row for every required element of the visit type", () => {
  const { presence, required } = scoreNoteFromText({
    text: "Routine visit completed.",
    serviceLine: "hospice",
    visitType: "routine_visit",
  });
  assert.ok(Array.isArray(presence));
  assert.equal(presence.length, required.length);
  assert.ok(required.length > 0);
});

test("a structured vitals block (as Document Visit appends) registers the vitals element", () => {
  const base = "Patient seen for routine visit. Skilled assessment performed.";
  const withVitals =
    `${base}\nVital signs:\nBlood Pressure: 128/76 mmHg\nHeart Rate: 72 bpm\n` +
    `Temperature: 98.4°F\nOxygen Saturation: 97%`;
  const vitalsPresent = (r) => r.presence.find((p) => p.id === "vitals")?.present === true;

  const without = scoreNoteFromText({ text: base, serviceLine: "home_health", visitType: "routine_visit" });
  const withV = scoreNoteFromText({ text: withVitals, serviceLine: "home_health", visitType: "routine_visit" });

  assert.equal(vitalsPresent(without), false);
  assert.equal(vitalsPresent(withV), true);
  assert.ok(withV.coverageScore > without.coverageScore);
});
