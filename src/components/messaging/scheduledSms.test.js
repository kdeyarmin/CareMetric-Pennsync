import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateScheduleTime,
  isDue,
  dueRows,
  upcomingRows,
  canCancel,
  MIN_LEAD_MS,
  MAX_SCHEDULE_DAYS,
} from "./scheduledSms.js";

const now = new Date("2026-06-02T12:00:00Z");
const at = (ms) => new Date(now.getTime() + ms).toISOString();

test("validateScheduleTime rejects empty/invalid input", () => {
  assert.equal(validateScheduleTime("", now).ok, false);
  assert.equal(validateScheduleTime("not a date", now).ok, false);
});

test("validateScheduleTime rejects times too soon", () => {
  const r = validateScheduleTime(at(MIN_LEAD_MS - 1000), now);
  assert.equal(r.ok, false);
});

test("validateScheduleTime rejects times too far out", () => {
  const r = validateScheduleTime(at((MAX_SCHEDULE_DAYS + 1) * 86400000), now);
  assert.equal(r.ok, false);
});

test("validateScheduleTime accepts a valid future time and normalizes ISO", () => {
  const target = at(2 * 3600 * 1000);
  const r = validateScheduleTime(target, now);
  assert.equal(r.ok, true);
  assert.equal(r.iso, new Date(target).toISOString());
});

test("isDue is true only for pending rows whose time has passed", () => {
  assert.equal(isDue({ status: "pending", send_at: at(-1000) }, now), true);
  assert.equal(isDue({ status: "pending", send_at: at(1000) }, now), false);
  assert.equal(isDue({ status: "sent", send_at: at(-1000) }, now), false);
  assert.equal(isDue({ status: "canceled", send_at: at(-1000) }, now), false);
  assert.equal(isDue(null, now), false);
  assert.equal(isDue({ status: "pending", send_at: "bad" }, now), false);
});

test("dueRows returns only due pending rows", () => {
  const rows = [
    { id: 1, status: "pending", send_at: at(-5000) },
    { id: 2, status: "pending", send_at: at(5000) },
    { id: 3, status: "sent", send_at: at(-5000) },
  ];
  assert.deepEqual(dueRows(rows, now).map((r) => r.id), [1]);
});

test("upcomingRows returns future pending rows soonest-first", () => {
  const rows = [
    { id: 1, status: "pending", send_at: at(10000) },
    { id: 2, status: "pending", send_at: at(2000) },
    { id: 3, status: "pending", send_at: at(-2000) }, // already due, excluded
    { id: 4, status: "canceled", send_at: at(3000) },
  ];
  assert.deepEqual(upcomingRows(rows, now).map((r) => r.id), [2, 1]);
});

test("upcomingRows excludes pending rows with an unparseable send_at", () => {
  const rows = [
    { id: 1, status: "pending", send_at: at(5000) },
    { id: 2, status: "pending", send_at: "not-a-date" }, // malformed, excluded
    { id: 3, status: "pending", send_at: null }, // missing, excluded
  ];
  assert.deepEqual(upcomingRows(rows, now).map((r) => r.id), [1]);
});

test("canCancel only allows pending rows", () => {
  assert.equal(canCancel({ status: "pending" }), true);
  assert.equal(canCancel({ status: "sent" }), false);
  assert.equal(canCancel({ status: "failed" }), false);
  assert.equal(canCancel(null), false);
});
