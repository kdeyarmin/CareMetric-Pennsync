import { test } from "node:test";
import assert from "node:assert/strict";
import { timezoneForNumber, isWithinQuietHours, AREA_CODE_TIMEZONE } from "./quietHours.js";

test("timezoneForNumber resolves area codes across zones", () => {
  assert.equal(timezoneForNumber("+12155550100"), "America/New_York"); // 215 Philly
  assert.equal(timezoneForNumber("2155550100"), "America/New_York");
  assert.equal(timezoneForNumber("1-312-555-0100"), "America/Chicago"); // 312 Chicago
  assert.equal(timezoneForNumber("(303) 555-0100"), "America/Denver"); // 303 Denver
  assert.equal(timezoneForNumber("+16025550100"), "America/Phoenix"); // 602 AZ
  assert.equal(timezoneForNumber("+14155550100"), "America/Los_Angeles"); // 415 SF
  assert.equal(timezoneForNumber("+18085550100"), "Pacific/Honolulu"); // 808 HI
  // Regression: 915 (El Paso, TX) is Mountain time, not Central.
  assert.equal(timezoneForNumber("+19155550100"), "America/Denver"); // 915 El Paso
});

test("timezoneForNumber returns null for unknown / malformed numbers", () => {
  assert.equal(timezoneForNumber("+442079460958"), null); // UK
  assert.equal(timezoneForNumber("12345"), null);
  assert.equal(timezoneForNumber(""), null);
  assert.equal(timezoneForNumber(null), null);
});

test("isWithinQuietHours allows mid-afternoon in the recipient's zone", () => {
  // 2026-06-04T20:00:00Z = 16:00 EDT (215) and 13:00 PDT (415) — both daytime.
  const now = new Date("2026-06-04T20:00:00Z");
  assert.equal(isWithinQuietHours("+12155550100", now).allowed, true);
  assert.equal(isWithinQuietHours("+14155550100", now).allowed, true);
});

test("isWithinQuietHours blocks early morning on the recipient's coast", () => {
  // 2026-06-04T11:30:00Z = 07:30 EDT (before 8am) but 04:30 PDT.
  const now = new Date("2026-06-04T11:30:00Z");
  const east = isWithinQuietHours("+12155550100", now);
  assert.equal(east.allowed, false);
  assert.equal(east.reason, "quiet_hours");
  assert.equal(east.localHour, 7);
  const west = isWithinQuietHours("+14155550100", now);
  assert.equal(west.allowed, false);
  assert.equal(west.localHour, 4);
});

test("isWithinQuietHours blocks late night and respects the 9pm boundary", () => {
  // 2026-06-05T01:30:00Z = 21:30 EDT (after 9pm) for an Eastern number.
  const late = isWithinQuietHours("+12155550100", new Date("2026-06-05T01:30:00Z"));
  assert.equal(late.allowed, false);
  assert.equal(late.localHour, 21);
  // 20:59 local is still allowed (exclusive end at 21:00).
  const nine = isWithinQuietHours("+12155550100", new Date("2026-06-05T00:59:00Z"));
  assert.equal(nine.localHour, 20);
  assert.equal(nine.allowed, true);
});

test("isWithinQuietHours honors the 8am open boundary inclusively", () => {
  // 12:00Z = 08:00 EDT exactly → allowed.
  const eight = isWithinQuietHours("+12155550100", new Date("2026-06-04T12:00:00Z"));
  assert.equal(eight.localHour, 8);
  assert.equal(eight.allowed, true);
});

test("isWithinQuietHours fails OPEN for an unknown timezone", () => {
  const r = isWithinQuietHours("+442079460958", new Date());
  assert.equal(r.allowed, true);
  assert.equal(r.reason, "unknown_timezone");
});

test("isWithinQuietHours can be disabled", () => {
  // Even at 3am local, disabled → allowed.
  const r = isWithinQuietHours("+12155550100", new Date("2026-06-04T07:00:00Z"), { enabled: false });
  assert.equal(r.allowed, true);
  assert.equal(r.reason, "disabled");
});

test("custom window narrows the allowed hours", () => {
  // 9am–5pm window: 08:00 local now disallowed.
  const r = isWithinQuietHours("+12155550100", new Date("2026-06-04T12:00:00Z"), { startHour: 9, endHour: 17 });
  assert.equal(r.localHour, 8);
  assert.equal(r.allowed, false);
});

test("an overnight allowed window (start > end) wraps past midnight correctly", () => {
  // Allowed 22:00–06:00 ET. +1 215 => America/New_York.
  const opts = { startHour: 22, endHour: 6 };
  // 08:00 ET (12:00Z) → outside the window → blocked.
  const day = isWithinQuietHours("+12155550100", new Date("2026-06-04T12:00:00Z"), opts);
  assert.equal(day.localHour, 8);
  assert.equal(day.allowed, false);
  // 23:00 ET (03:00Z next day) → inside the late side → allowed.
  const late = isWithinQuietHours("+12155550100", new Date("2026-06-05T03:00:00Z"), opts);
  assert.equal(late.localHour, 23);
  assert.equal(late.allowed, true);
  // 02:00 ET (06:00Z) → inside the early side → allowed.
  const early = isWithinQuietHours("+12155550100", new Date("2026-06-04T06:00:00Z"), opts);
  assert.equal(early.localHour, 2);
  assert.equal(early.allowed, true);
});

test("start === end means the window is always open", () => {
  const r = isWithinQuietHours("+12155550100", new Date("2026-06-04T07:00:00Z"), { startHour: 0, endHour: 0 });
  assert.equal(r.allowed, true);
});

test("the area-code table only maps to valid IANA zones", () => {
  const valid = new Set([
    "America/New_York", "America/Chicago", "America/Denver",
    "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu",
  ]);
  for (const tz of Object.values(AREA_CODE_TIMEZONE)) {
    assert.ok(valid.has(tz), `unexpected zone ${tz}`);
  }
});
