import { test } from "node:test";
import assert from "node:assert/strict";
import {
  areNicknames,
  calculateSimilarity,
  normalizeDob,
  parseDateComponents,
  calculateMatchScore,
} from "./dedupUtils.js";

// --- DOB normalization (the fix) ---

test("normalizeDob passes ISO dates through", () => {
  assert.equal(normalizeDob("1945-04-15"), "1945-04-15");
});

test("normalizeDob canonicalizes slash dates", () => {
  assert.equal(normalizeDob("04/15/1945"), "1945-04-15");
  assert.equal(normalizeDob("4/5/1945"), "1945-04-05");
});

test("normalizeDob pivots 2-digit years into the past", () => {
  assert.equal(normalizeDob("04/15/45", 2026), "1945-04-15");
  assert.equal(normalizeDob("01/05/20", 2026), "2020-01-05");
});

test("normalizeDob parses 8 packed digits", () => {
  assert.equal(normalizeDob("19450415"), "1945-04-15"); // YYYYMMDD
  assert.equal(normalizeDob("04151945"), "1945-04-15"); // MMDDYYYY
});

test("normalizeDob rejects junk and impossible dates", () => {
  assert.equal(normalizeDob(""), null);
  assert.equal(normalizeDob("not a date"), null);
  assert.equal(normalizeDob("13/40/2020"), null);
});

// --- DOB exact-match regression: same date, different formats ---

test("calculateMatchScore awards dob_exact across differing date formats", () => {
  const { matches } = calculateMatchScore(
    { first_name: "Jane", last_name: "Doe", date_of_birth: "1945-04-15" },
    { first_name: "Jane", last_name: "Doe", date_of_birth: "04/15/1945" },
  );
  // Previously these stripped to "19450415" vs "04151945" and missed dob_exact.
  assert.ok(matches.includes("dob_exact"), `expected dob_exact, got ${matches.join(",")}`);
  assert.ok(matches.includes("name_exact"));
});

test("calculateMatchScore awards dob_exact for a 2-digit-year duplicate", () => {
  const { matches } = calculateMatchScore(
    { first_name: "Mary", last_name: "Jones", date_of_birth: "1945-04-15" },
    { first_name: "Mary", last_name: "Jones", date_of_birth: "04/15/45" },
  );
  assert.ok(matches.includes("dob_exact"), `expected dob_exact, got ${matches.join(",")}`);
});

// --- Existing scoring behavior is preserved ---

test("identical patients score very high and flag the right reasons", () => {
  const p = { first_name: "John", last_name: "Smith", date_of_birth: "1950-01-01", medical_record_number: "X1", phone: "215-555-1212", address: "1 Main St" };
  const { score, matches } = calculateMatchScore(p, { ...p });
  assert.ok(score >= 95, `score was ${score}`);
  for (const reason of ["name_exact", "address_exact", "dob_exact", "mrn_exact", "phone_exact"]) {
    assert.ok(matches.includes(reason), `expected ${reason}, got ${matches.join(",")}`);
  }
});

test("clearly different people stay below the dedup threshold", () => {
  const { score } = calculateMatchScore(
    { first_name: "Alice", last_name: "Anderson", date_of_birth: "1930-02-02", medical_record_number: "A", phone: "1112223333", address: "5 Oak Ave" },
    { first_name: "Bob", last_name: "Zimmer", date_of_birth: "1975-11-30", medical_record_number: "B", phone: "9998887777", address: "92 Pine Rd" },
  );
  assert.ok(score < 50, `score was ${score}`);
});

test("nickname + same last name is recognized", () => {
  assert.equal(areNicknames("bill", "william"), true);
  const { matches } = calculateMatchScore(
    { first_name: "Bill", last_name: "Smith" },
    { first_name: "William", last_name: "Smith" },
  );
  assert.ok(matches.includes("nickname_match"));
});

test("reversed month/day is still detected via parseDateComponents", () => {
  // Different formats so normalizeDob does not collapse them to equal ISO.
  const { matches } = calculateMatchScore(
    { first_name: "Sam", last_name: "Lee", date_of_birth: "1950-04-05" },
    { first_name: "Sam", last_name: "Lee", date_of_birth: "05/04/1950" },
  );
  // 04/05 vs 05/04 (M/D) in the same year -> reversed.
  assert.ok(matches.includes("dob_reversed"), `got ${matches.join(",")}`);
});

test("fuzzy DOB variation checks still fire when a date uses a 2-digit year", () => {
  // "04/05/50" canonicalizes to 1950-04-05; reversed vs "05/04/50". The old
  // variation path used parseDateComponents (8-digit only) and skipped these.
  const { matches } = calculateMatchScore(
    { first_name: "Sam", last_name: "Lee", date_of_birth: "04/05/50" },
    { first_name: "Sam", last_name: "Lee", date_of_birth: "05/04/50" },
  );
  assert.ok(matches.includes("dob_reversed"), `got ${matches.join(",")}`);
});

test("calculateSimilarity returns 100 for identical strings and scales down", () => {
  assert.equal(calculateSimilarity("smith", "smith"), 100);
  assert.ok(calculateSimilarity("smith", "smyth") < 100);
  assert.ok(calculateSimilarity("smith", "smyth") >= 80);
});

test("parseDateComponents reads packed 8-digit strings", () => {
  assert.deepEqual(parseDateComponents("1945-04-15"), { year: "1945", month: "04", day: "15" });
});
