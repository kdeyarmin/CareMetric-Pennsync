import { test } from "node:test";
import assert from "node:assert/strict";
import { smsSegments } from "./smsUtils.js";

test("empty draft has zero chars and zero segments", () => {
  const r = smsSegments("");
  assert.equal(r.chars, 0);
  assert.equal(r.segments, 0);
  assert.equal(r.encoding, "GSM-7");
  assert.equal(r.remaining, 160);
});

test("short GSM-7 text is one segment", () => {
  const r = smsSegments("Hello, your visit is confirmed.");
  assert.equal(r.encoding, "GSM-7");
  assert.equal(r.segments, 1);
  assert.equal(r.chars, 31);
  assert.equal(r.remaining, 160 - 31);
});

test("GSM-7 at the 160 boundary stays one segment, 161 splits to two", () => {
  assert.equal(smsSegments("a".repeat(160)).segments, 1);
  const two = smsSegments("a".repeat(161));
  assert.equal(two.segments, 2);
  assert.equal(two.perSegment, 153);
});

test("GSM-7 extension characters cost two units", () => {
  // "€" is in the extension table -> 2 units.
  const r = smsSegments("€");
  assert.equal(r.encoding, "GSM-7");
  assert.equal(r.chars, 2);
});

test("a single emoji forces UCS-2 at 70 per segment", () => {
  const r = smsSegments("Hi 😀");
  assert.equal(r.encoding, "UCS-2");
  // "Hi " = 3 units, emoji is astral -> 2 units.
  assert.equal(r.chars, 5);
  assert.equal(r.segments, 1);
  assert.equal(r.perSegment, 70);
});

test("UCS-2 splits at 70/67", () => {
  // The emoji forces UCS-2; 70 single-unit chars + a 2-unit emoji = 72 > 70.
  assert.equal(smsSegments("a".repeat(70) + "😀").segments >= 2, true);
  const r = smsSegments("ñ😀".repeat(40)); // emoji forces UCS-2, and it's long
  assert.equal(r.encoding, "UCS-2");
  assert.equal(r.perSegment, 67);
  assert.ok(r.segments >= 2);
});

test("a 2-unit char straddling a segment boundary is not split (no undercount)", () => {
  // 152 'a' + '{' (2 units) + 152 'a': the escape pair can't sit across the
  // 153-unit boundary, so this packs into 3 segments, not 2.
  const r = smsSegments("a".repeat(152) + "{" + "a".repeat(152));
  assert.equal(r.chars, 306);
  assert.equal(r.segments, 3);
});
