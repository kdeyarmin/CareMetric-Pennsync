import test from "node:test";
import assert from "node:assert/strict";
import { valueGuard } from "./valueGuard.js";

test("passes when every output value is present in the input", () => {
  const input = "BP 148/90, gave Metformin 500 mg. Wound 2x3 cm.";
  const output = "Blood pressure was 148/90. Administered Metformin 500 mg. The wound measured 2x3 cm.";
  const result = valueGuard(output, input);
  assert.equal(result.ok, true);
  assert.equal(result.unverified.length, 0);
});

test("flags an invented vital that is not in the input", () => {
  const input = "Patient stable, ambulating in hallway.";
  const output = "Patient stable. BP 200/110 noted.";
  const result = valueGuard(output, input);
  assert.equal(result.ok, false);
  assert.ok(result.unverified.some((u) => u.type === "number" && u.value === "200/110"));
});

test("flags an invented medication", () => {
  const input = "Reviewed the medication list with the patient.";
  const output = "Reviewed medications. Started Warfarin.";
  const result = valueGuard(output, input);
  assert.equal(result.ok, false);
  assert.ok(result.unverified.some((u) => u.type === "medication" && /warfarin/i.test(u.value)));
});

test("does not flag prose reordering without new values", () => {
  const input = "Taught the patient about diet. Patient verbalized understanding.";
  const output = "The patient verbalized understanding after being taught about diet.";
  assert.equal(valueGuard(output, input).ok, true);
});

test("medication match is case-insensitive (no false flag on casing)", () => {
  const input = "Patient takes metformin daily.";
  const output = "The patient takes Metformin daily.";
  assert.equal(valueGuard(output, input).ok, true);
});

test("does not flag a wound dimension when the note normalizes the spacing around x", () => {
  // The nurse's draft writes the compact "4x5 cm"; the generated note faithfully
  // rephrases it as "4 x 5 cm". This must NOT be flagged — the value is identical,
  // only the spacing around the 'x' changed.
  const input = "Sacral wound 4x5 cm with granulation tissue.";
  const output = "Assessed a sacral wound measuring 4 x 5 cm with granulation tissue.";
  const result = valueGuard(output, input);
  assert.equal(result.ok, true);
  assert.equal(result.unverified.length, 0);
});

test("still flags an invented single measurement that is absent from the input", () => {
  const input = "Wound assessed, no dimensions recorded.";
  const output = "Wound measured 7 cm in length.";
  const result = valueGuard(output, input);
  assert.equal(result.ok, false);
  assert.ok(result.unverified.some((u) => u.type === "number" && u.value === "7cm"));
});

test("flags multiple invented values at once", () => {
  const input = "Patient stable.";
  const output = "BP 200/110, O2 84%, gave 250 mg.";
  const result = valueGuard(output, input);
  assert.equal(result.ok, false);
  const flagged = result.unverified.map((u) => u.value);
  assert.ok(flagged.includes("200/110"));
  assert.ok(flagged.includes("84%"));
  assert.ok(flagged.includes("250mg"));
});
