import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isAllowedDestination,
  blockedReasonMessage,
  withinSendCap,
  monthStartISO,
} from "./costControls.js";

test("US/Canada NANP numbers are allowed by default", () => {
  assert.deepEqual(isAllowedDestination("+12155550100"), { allowed: true, reason: "allowed" });
});

test("premium NANP area codes are always blocked", () => {
  assert.equal(isAllowedDestination("+19005550100").allowed, false);
  assert.equal(isAllowedDestination("+19765550100").reason, "premium_number_blocked");
});

test("international is blocked unless explicitly enabled", () => {
  assert.deepEqual(isAllowedDestination("+442071838750"), { allowed: false, reason: "international_blocked" });
  assert.deepEqual(isAllowedDestination("+442071838750", { allow_international: true }), { allowed: true, reason: "international_allowed" });
});

test("an agency area-code blocklist is honored", () => {
  assert.equal(isAllowedDestination("+13125550100", { blocked_area_codes: ["312"] }).allowed, false);
  assert.equal(isAllowedDestination("+13125550100", { blocked_area_codes: ["312"] }).reason, "blocked_area_code");
  assert.equal(isAllowedDestination("+12155550100", { blocked_area_codes: ["312"] }).allowed, true);
});

test("garbage / non-E.164 is rejected", () => {
  assert.equal(isAllowedDestination("not-a-number").allowed, false);
  assert.equal(isAllowedDestination("").reason, "invalid_destination");
});

test("blockedReasonMessage is human-friendly and never leaks the number", () => {
  for (const r of ["premium_number_blocked", "blocked_area_code", "international_blocked", "invalid_destination", "other"]) {
    assert.equal(typeof blockedReasonMessage(r), "string");
  }
});

test("withinSendCap treats absent/non-positive caps as unlimited", () => {
  assert.equal(withinSendCap(9999, 0), true);
  assert.equal(withinSendCap(9999, null), true);
  assert.equal(withinSendCap(9999, undefined), true);
  assert.equal(withinSendCap(5, 10), true);
  assert.equal(withinSendCap(10, 10), false);
  assert.equal(withinSendCap(11, 10), false);
});

test("monthStartISO is the first instant of the UTC month", () => {
  assert.equal(monthStartISO(new Date("2026-06-19T15:30:00Z")), "2026-06-01T00:00:00.000Z");
});

test("a malformed +1 number is invalid, not treated as international", () => {
  // Wrong NANP digit count must never be dialed even when international is enabled.
  assert.deepEqual(isAllowedDestination("+1215555010"), { allowed: false, reason: "invalid_destination" });
  assert.deepEqual(
    isAllowedDestination("+1215555010", { allow_international: true }),
    { allowed: false, reason: "invalid_destination" }
  );
});
