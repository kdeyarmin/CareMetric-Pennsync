import { test } from "node:test";
import assert from "node:assert/strict";
import { detectUrgency, DEFAULT_URGENT_KEYWORDS } from "./urgentKeywords.js";

test("detectUrgency flags red-flag phrases", () => {
  assert.equal(detectUrgency("I have chest pain and trouble breathing").urgent, true);
  assert.equal(detectUrgency("This is an EMERGENCY please call").urgent, true);
  assert.equal(detectUrgency("mom fell and can't get up").urgent, true);
  assert.deepEqual(detectUrgency("call 911").matches, ["911"]);
});

test("routine 'blood ...' phrases are not urgent, but 'bleeding' still is", () => {
  // bare "blood" was removed to stop firing on these routine phrases.
  assert.equal(detectUrgency("my blood pressure is normal today").urgent, false);
  assert.equal(detectUrgency("blood sugar was 110 this morning").urgent, false);
  assert.equal(detectUrgency("got my blood test results back").urgent, false);
  assert.ok(!DEFAULT_URGENT_KEYWORDS.includes("blood"));
  // The genuinely urgent case is still caught.
  assert.equal(detectUrgency("there is bleeding from the wound").urgent, true);
});

test("detectUrgency ignores ordinary messages", () => {
  assert.equal(detectUrgency("Thanks, see you at 3pm tomorrow").urgent, false);
  assert.equal(detectUrgency("Running a few minutes late").urgent, false);
  assert.deepEqual(detectUrgency("").matches, []);
  assert.equal(detectUrgency(null).urgent, false);
});

test("detectUrgency matches whole words, not substrings", () => {
  // "football" must not trigger the "fall" keyword.
  assert.equal(detectUrgency("we watched football all day").urgent, false);
  // but "fall" as its own word does.
  assert.equal(detectUrgency("I had a bad fall").urgent, true);
});

test("detectUrgency de-duplicates and reports all matches", () => {
  const r = detectUrgency("urgent urgent — chest pain");
  assert.deepEqual(r.matches.sort(), ["chest pain", "urgent"]);
});

test("detectUrgency merges agency-supplied extra keywords", () => {
  assert.equal(detectUrgency("the wound is dehiscing").urgent, false);
  const r = detectUrgency("the wound is dehiscing", ["dehiscing", "  Infection "]);
  assert.equal(r.urgent, true);
  assert.ok(r.matches.includes("dehiscing"));
  // case/whitespace-normalized extras still match.
  assert.equal(detectUrgency("possible Infection", ["infection"]).urgent, true);
});

test("the default keyword list is non-empty and lowercase", () => {
  assert.ok(DEFAULT_URGENT_KEYWORDS.length > 5);
  for (const k of DEFAULT_URGENT_KEYWORDS) assert.equal(k, k.toLowerCase());
});

test("detectUrgency escalates 'can't breathe' written with a curly apostrophe", () => {
  // Regression: phone keyboards insert U+2019; previously this matched neither
  // "can't breathe" nor "cant breathe", so the life-critical text was dropped.
  assert.equal(detectUrgency("I can’t breathe").urgent, true);
  assert.equal(detectUrgency("I can't breathe").urgent, true);
  assert.equal(detectUrgency("I can‘t breathe").urgent, true);
});
