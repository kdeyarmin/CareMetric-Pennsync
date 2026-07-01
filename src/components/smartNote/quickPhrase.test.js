import test from "node:test";
import assert from "node:assert/strict";
import {
  detectTrigger,
  filterPhrases,
  applyExpansion,
  expansionTextFor,
  DEFAULT_QUICK_PHRASES,
  TRIGGER,
} from "./quickPhrase.js";

// ── detectTrigger ──

test("detects a dot token at the caret", () => {
  const text = "Assessment complete. .diabeticedu";
  const res = detectTrigger(text, text.length);
  assert.ok(res);
  assert.equal(res.type, TRIGGER.DOT);
  assert.equal(res.query, "diabeticedu");
  assert.equal(res.token, ".diabeticedu");
  assert.equal(text.slice(res.start, res.end), ".diabeticedu");
});

test("detects a slash menu at the start of the field", () => {
  const res = detectTrigger("/wound", 6);
  assert.ok(res);
  assert.equal(res.type, TRIGGER.SLASH);
  assert.equal(res.query, "wound");
});

test("a slash with an empty query still opens the menu", () => {
  const res = detectTrigger("notes /", 7);
  assert.ok(res);
  assert.equal(res.type, TRIGGER.SLASH);
  assert.equal(res.query, "");
});

test("a bare period (sentence end) does NOT trigger", () => {
  assert.equal(detectTrigger("Patient tolerated care.", 23), null);
});

test("a decimal number does NOT trigger (word char before the dot)", () => {
  assert.equal(detectTrigger("O2 sat 97.5", 11), null);
});

test("a slash inside a word (and/or) does NOT trigger", () => {
  // caret after "and/o"
  assert.equal(detectTrigger("and/or", 5), null);
});

test("detection is scoped to the caret, not the whole string", () => {
  const text = ".woundcare and more text here";
  // caret in the middle of "more" — no active trigger
  assert.equal(detectTrigger(text, 20), null);
  // caret right after the token
  const res = detectTrigger(text, 10);
  assert.equal(res.query, "woundcare");
});

test("dot requires a leading letter (so numbers-only after a dot are ignored)", () => {
  assert.equal(detectTrigger("dose .5", 7), null);
});

// ── filterPhrases ──

test("empty query returns the full list (opened slash menu)", () => {
  const res = filterPhrases(DEFAULT_QUICK_PHRASES, "");
  assert.equal(res.length, Math.min(8, DEFAULT_QUICK_PHRASES.length));
});

test("token prefix ranks above phrase substring", () => {
  const res = filterPhrases(DEFAULT_QUICK_PHRASES, "wound");
  assert.equal(res[0].token, "woundcare");
});

test("exact token match wins", () => {
  const res = filterPhrases(DEFAULT_QUICK_PHRASES, "medrec");
  assert.equal(res[0].token, "medrec");
});

test("no match returns an empty list", () => {
  assert.deepEqual(filterPhrases(DEFAULT_QUICK_PHRASES, "zzzznotathing"), []);
});

// ── applyExpansion ──

test("replaces the trigger token with the expansion and returns the caret", () => {
  const text = "Education: .diabeticedu";
  const range = detectTrigger(text, text.length);
  const { text: next, caret } = applyExpansion(text, range, "Provided diabetic education.");
  assert.equal(next, "Education: Provided diabetic education.");
  assert.equal(caret, next.length);
});

test("inserts a trailing space when followed immediately by more text", () => {
  const text = ".medrec and next steps";
  const range = detectTrigger(text, 7); // token is ".medrec"
  const { text: next } = applyExpansion(text, range, "Completed med rec.");
  assert.equal(next, "Completed med rec. and next steps");
});

test("applyExpansion clamps out-of-range indices safely", () => {
  const { text, caret } = applyExpansion("abc", { start: -5, end: 99 }, "X");
  assert.equal(text, "X");
  assert.equal(caret, 1);
});

// ── expansionTextFor ──

test("expansionTextFor prefers expanded_text, falls back to phrase/token", () => {
  assert.equal(expansionTextFor({ expanded_text: "full", phrase: "p" }), "full");
  assert.equal(expansionTextFor({ phrase: "p" }), "p");
  assert.equal(expansionTextFor({ token: "t" }), "t");
  assert.equal(expansionTextFor(null), "");
});

test("default phrases carry no fabricated findings — factual specifics use [cues]", () => {
  // Every default expansion is generic/attestable; anything patient-specific is a
  // bracketed cue the nurse must fill (guards against auto-fabrication).
  const withRawFindings = DEFAULT_QUICK_PHRASES.filter(
    (p) => /\b(afebrile|no edema|clear breath sounds|BP \d)\b/i.test(p.expanded_text),
  );
  assert.deepEqual(withRawFindings, []);
});
