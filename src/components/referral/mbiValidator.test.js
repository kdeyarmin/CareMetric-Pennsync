import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeMbi,
  validateMbi,
  findMbiCandidates,
  looksLikeMedicare,
  looksLikeMedicareAdvantage,
} from "./mbiValidator.js";

// 1EG4-TE5-MK73 is the CMS sample MBI (format-valid by construction).
const SAMPLE = "1EG4TE5MK73";

// ── normalization ──

test("normalizeMbi strips dashes/whitespace and uppercases", () => {
  assert.equal(normalizeMbi("1eg4-te5-mk73"), SAMPLE);
  assert.equal(normalizeMbi("  1EG4 TE5 MK73 "), SAMPLE);
  assert.equal(normalizeMbi(null), "");
  assert.equal(normalizeMbi(undefined), "");
});

test("validateMbi returns the normalized form alongside the verdict", () => {
  const res = validateMbi("1eg4-te5-mk73");
  assert.equal(res.valid, true);
  assert.equal(res.normalized, SAMPLE);
  assert.deepEqual(res.errors, []);
});

// ── valid MBIs ──

test("accepts well-formed MBIs", () => {
  assert.equal(validateMbi(SAMPLE).valid, true);
  assert.equal(validateMbi("9AA0AA0AA00").valid, true); // minimal letters/digits at every slot
  assert.equal(validateMbi("2T31TT5TT44").valid, true); // AN positions as digits
});

// ── empty / bad length ──

test("empty or missing value is invalid, not a crash", () => {
  const res = validateMbi("");
  assert.equal(res.valid, false);
  assert.equal(res.errors.length, 1);
  assert.equal(validateMbi(null).valid, false);
  assert.equal(validateMbi(undefined).valid, false);
});

test("rejects wrong lengths with a length error", () => {
  for (const bad of ["1EG4TE5MK7", "1EG4TE5MK733", "1EG4"]) {
    const res = validateMbi(bad);
    assert.equal(res.valid, false);
    assert.match(res.errors[0], /11 characters/);
  }
});

// ── excluded letters ──

test("rejects the excluded letters S, L, O, I, B, Z at letter positions", () => {
  for (const letter of ["S", "L", "O", "I", "B", "Z"]) {
    const res = validateMbi(`1${letter}G4TE5MK73`); // position 2 is an A slot
    assert.equal(res.valid, false, `expected ${letter} to be rejected`);
    assert.match(res.errors[0], /never appear in an MBI/);
  }
  // Excluded letter at position 9 (A slot).
  const res = validateMbi("1EG4TE5MZ73");
  assert.equal(res.valid, false);
  assert.match(res.errors[0], /Position 9/);
});

// ── digit-position violations ──

test("position 1 must be 1-9 (0 and letters rejected)", () => {
  const zero = validateMbi("0EG4TE5MK73");
  assert.equal(zero.valid, false);
  assert.match(zero.errors[0], /Position 1 must be a digit 1-9/);
  assert.equal(validateMbi("AEG4TE5MK73").valid, false);
});

test("N positions reject letters", () => {
  // Position 4 is N.
  const p4 = validateMbi("1EGATE5MK73");
  assert.equal(p4.valid, false);
  assert.match(p4.errors[0], /Position 4 must be a digit/);
  // Positions 10-11 are N.
  const p10 = validateMbi("1EG4TE5MKA3");
  assert.equal(p10.valid, false);
  assert.match(p10.errors[0], /Position 10 must be a digit/);
});

test("A positions reject digits", () => {
  // Position 2 is A.
  const p2 = validateMbi("11G4TE5MK73");
  assert.equal(p2.valid, false);
  assert.match(p2.errors[0], /Position 2 must be a letter/);
  // Positions 8-9 are A.
  const p8 = validateMbi("1EG4TE55K73");
  assert.equal(p8.valid, false);
  assert.match(p8.errors[0], /Position 8 must be a letter/);
});

test("collects every position violation, not just the first", () => {
  const res = validateMbi("0SG4TE5MKAA"); // pos 1, 2, 10, 11 all wrong
  assert.equal(res.valid, false);
  assert.equal(res.errors.length, 4);
});

test("non-alphanumeric characters fail their position check", () => {
  assert.equal(validateMbi("1EG4TE5MK7#").valid, false);
});

// ── candidate extraction ──

test("findMbiCandidates pulls dashed MBIs out of mixed policy-number text", () => {
  const cands = findMbiCandidates("Medicare: 1EG4-TE5-MK73; Aetna: W123456789");
  assert.deepEqual(cands, ["1EG4-TE5-MK73"]);
});

test("findMbiCandidates keeps near-miss MBIs so they can be flagged", () => {
  const cands = findMbiCandidates("ID 1SG4-TE5-MK73 on card");
  assert.deepEqual(cands, ["1SG4-TE5-MK73"]);
  assert.equal(validateMbi(cands[0]).valid, false);
});

test("findMbiCandidates ignores pure-digit and wrong-length tokens", () => {
  assert.deepEqual(findMbiCandidates("Policy 12345678901, group 1EG4TE5"), []);
  assert.deepEqual(findMbiCandidates(""), []);
  assert.deepEqual(findMbiCandidates(null), []);
});

// ── payer-text classifiers ──

test("looksLikeMedicare is a plain case-insensitive match", () => {
  assert.equal(looksLikeMedicare("Medicare Part A & B"), true);
  assert.equal(looksLikeMedicare("MEDICARE"), true);
  assert.equal(looksLikeMedicare("Aetna PPO"), false);
  assert.equal(looksLikeMedicare(null), false);
});

test("looksLikeMedicareAdvantage requires medicare plus advantage/HMO/PPO wording", () => {
  assert.equal(looksLikeMedicareAdvantage("Medicare Advantage - Humana"), true);
  assert.equal(looksLikeMedicareAdvantage("UHC Medicare HMO"), true);
  assert.equal(looksLikeMedicareAdvantage("Aetna Medicare PPO plan"), true);
  assert.equal(looksLikeMedicareAdvantage("Medicare Part B"), false);
  assert.equal(looksLikeMedicareAdvantage("Aetna PPO"), false); // PPO without medicare
});

// ── Regression: OCR-wrapped MBIs (2026-07 review) ───────────────────────────

test("an MBI wrapped across a line break or spaced into groups is surfaced", () => {
  assert.ok(findMbiCandidates("MBI: 1EG4-\nTE5-MK73").length >= 1);
  assert.ok(findMbiCandidates("Medicare number 1EG4 TE5 MK73 on file").length >= 1);
});
