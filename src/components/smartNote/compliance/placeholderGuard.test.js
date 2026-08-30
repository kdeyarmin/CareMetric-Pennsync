import test from "node:test";
import assert from "node:assert/strict";
import {
  findPlaceholders,
  hasPlaceholder,
  describePlaceholders,
  countPlaceholders,
} from "./placeholderGuard.js";

test("finds bracketed template placeholders", () => {
  const found = findPlaceholders("Homebound due to [diagnosis] per [MD name].");
  assert.deepEqual(found.map((p) => p.value), ["[diagnosis]", "[MD name]"]);
  assert.ok(found.every((p) => p.type === "bracket"));
});

test("finds underscore blanks, including the BP _/_ form", () => {
  const found = findPlaceholders("Vital signs: BP _/_, HR _, O2 _% on RA");
  assert.equal(found.length, 4);
  assert.ok(found.every((p) => p.type === "blank"));
});

test("does NOT flag underscores inside identifiers", () => {
  // snake_case words are ordinary text, not fill-in blanks.
  assert.equal(hasPlaceholder("visit_type recorded as routine_visit"), false);
  assert.equal(hasPlaceholder("field date_of_birth verified"), false);
});

test("does NOT flag a genuinely completed note", () => {
  const note =
    "Patient is homebound due to severe exertional dyspnea; requires a rolling walker "
    + "and one-person assist. BP 148/90 mmHg, HR 82 bpm, O2 95%.";
  assert.equal(hasPlaceholder(note), false);
  assert.equal(countPlaceholders(note), 0);
});

test("placeholders are returned in document order across both types", () => {
  const found = findPlaceholders("HR _ then dx [chf] then wt _ lbs");
  assert.deepEqual(found.map((p) => p.value), ["_", "[chf]", "_"]);
});

test("describePlaceholders reports the offending lines with their tokens", () => {
  const draft = [
    "• Homebound status: unable to leave home due to [diagnosis]",
    "• Skilled need: wound assessment and sterile dressing change",
    "• Pain level: _/10, location: _",
  ].join("\n");
  const rows = describePlaceholders(draft);
  assert.equal(rows.length, 2, "only the two lines with blanks are reported");
  assert.match(rows[0].line, /^Homebound status/);
  assert.deepEqual(rows[0].placeholders, ["[diagnosis]"]);
  assert.match(rows[1].line, /^Pain level/);
  // Distinct tokens only — the three separate "_" runs collapse to one sample.
  assert.deepEqual(rows[1].placeholders, ["_"]);
});

test("describePlaceholders caps its output", () => {
  const draft = Array.from({ length: 20 }, (_, i) => `line ${i} value [x${i}]`).join("\n");
  assert.equal(describePlaceholders(draft).length, 6);
  assert.equal(describePlaceholders(draft, 2).length, 2);
});

test("hasPlaceholder is stateless across repeated calls", () => {
  // Both patterns carry /g; a stale lastIndex made every other call return false.
  const text = "due to [diagnosis]";
  for (let i = 0; i < 5; i += 1) assert.equal(hasPlaceholder(text), true);
  const blanks = "HR _";
  for (let i = 0; i < 5; i += 1) assert.equal(hasPlaceholder(blanks), true);
});

test("empty / nullish input is safe", () => {
  assert.deepEqual(findPlaceholders(""), []);
  assert.deepEqual(findPlaceholders(null), []);
  assert.equal(hasPlaceholder(undefined), false);
  assert.deepEqual(describePlaceholders(null), []);
});

test("detection is not corrupted by interleaved hasPlaceholder calls", () => {
  // Regression: the patterns used to be module-level /g regexes. `.test()`
  // advanced their lastIndex, and matchAll seeds its matcher from it, so a
  // findPlaceholders call after a hasPlaceholder call started mid-string and
  // dropped earlier matches. scanDraft interleaves these two exact calls.
  const draft = "• Homebound status: unable to leave home due to [diagnosis]\n• Pain level: _/10";
  const expected = findPlaceholders(draft).map((p) => p.value);
  assert.deepEqual(expected, ["[diagnosis]", "_"]);

  for (const line of draft.split("\n")) hasPlaceholder(line);
  assert.deepEqual(findPlaceholders(draft).map((p) => p.value), expected);
  assert.equal(describePlaceholders(draft).length, 2);
});
