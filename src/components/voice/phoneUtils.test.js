import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeE164, last10, phoneVariants, getThreadId, maskPhone, formatPhoneDisplay } from "./phoneUtils.js";

test("normalizeE164 handles 10-digit US numbers", () => {
  assert.equal(normalizeE164("2155550100"), "+12155550100");
  assert.equal(normalizeE164("(215) 555-0100"), "+12155550100");
  assert.equal(normalizeE164("215-555-0100"), "+12155550100");
  assert.equal(normalizeE164("215.555.0100"), "+12155550100");
});

test("normalizeE164 handles 11-digit and already-E.164 numbers", () => {
  assert.equal(normalizeE164("12155550100"), "+12155550100");
  assert.equal(normalizeE164("+12155550100"), "+12155550100");
  assert.equal(normalizeE164("+44 20 7946 0958"), "+442079460958");
});

test("normalizeE164 rejects out-of-range + numbers (length and leading zero)", () => {
  assert.equal(normalizeE164("+1234567890123456789"), null); // 19 digits > E.164 max 15
  assert.equal(normalizeE164("+02155550100"), null);          // leading 0 after +
  assert.equal(normalizeE164("+1234567"), null);              // 7 digits < 8
  assert.equal(normalizeE164("+123456789012345"), "+123456789012345"); // exactly 15 ok
});

test("normalizeE164 returns null for invalid input", () => {
  assert.equal(normalizeE164(""), null);
  assert.equal(normalizeE164(null), null);
  assert.equal(normalizeE164(undefined), null);
  assert.equal(normalizeE164("12345"), null); // too short, no leading +
  assert.equal(normalizeE164("not a phone"), null);
});

test("last10 extracts the final ten digits", () => {
  assert.equal(last10("+12155550100"), "2155550100");
  assert.equal(last10("(215) 555-0100"), "2155550100");
  assert.equal(last10(""), "");
  assert.equal(last10(null), "");
});

test("phoneVariants produces common stored formats for matching", () => {
  const variants = phoneVariants("+12155550100");
  assert.ok(variants.includes("+12155550100"));
  assert.ok(variants.includes("2155550100"));
  assert.ok(variants.includes("(215) 555-0100"));
  assert.ok(variants.includes("215-555-0100"));
  assert.ok(variants.includes("215.555.0100"));
});

test("phoneVariants contains no duplicates when input is already normalized", () => {
  // An E.164 input collides with the generated `+1${ten}` form; the deduped
  // list must not issue the same Patient.filter() lookup twice.
  const variants = phoneVariants("+12155550100");
  assert.equal(variants.length, new Set(variants).size);
  assert.ok(variants.includes("+12155550100"));
});

test("phoneVariants degrades gracefully without ten digits", () => {
  assert.deepEqual(phoneVariants(""), []);
  assert.deepEqual(phoneVariants("123"), ["123"]);
});

test("getThreadId is stable regardless of argument order", () => {
  const work = "+12155550100";
  const patient = "+12155559999";
  assert.equal(getThreadId(work, patient), getThreadId(patient, work));
});

test("getThreadId normalizes both numbers before keying", () => {
  // The same patient texting from a free-form vs E.164 number maps to one thread.
  assert.equal(getThreadId("+12155550100", "(215) 555-9999"), getThreadId("+12155550100", "+12155559999"));
});

test("maskPhone reveals only the last four digits", () => {
  assert.equal(maskPhone("+12155550100"), "(•••) •••-0100");
  assert.equal(maskPhone("(215) 555-0100"), "(•••) •••-0100");
  assert.equal(maskPhone("2155550100"), "(•••) •••-0100");
});

test("maskPhone never leaks more than the last four digits", () => {
  // The full number must not appear anywhere in the masked output.
  const masked = maskPhone("+12155550100");
  assert.ok(!masked.includes("215555"));
  assert.ok(!masked.includes("2155550"));
});

test("maskPhone degrades safely for empty or short input", () => {
  assert.equal(maskPhone(""), "unknown");
  assert.equal(maskPhone(null), "unknown");
  assert.equal(maskPhone(undefined), "unknown");
  assert.equal(maskPhone("12"), "••••");
});

test("formatPhoneDisplay pretty-prints US numbers", () => {
  assert.equal(formatPhoneDisplay("+12155550100"), "(215) 555-0100");
  assert.equal(formatPhoneDisplay("2155550100"), "(215) 555-0100");
  assert.equal(formatPhoneDisplay("1-215-555-0100"), "(215) 555-0100");
});

test("formatPhoneDisplay falls back without dropping non-US numbers", () => {
  assert.equal(formatPhoneDisplay("+442079460958"), "+442079460958");
  assert.equal(formatPhoneDisplay(""), "");
  assert.equal(formatPhoneDisplay(null), "");
});
