import { test } from "node:test";
import assert from "node:assert/strict";
import {
  payPeriodByIndex,
  periodIndexForDate,
  currentPayPeriod,
  listPayPeriods,
  isAlignedPayPeriod,
  isPastDue,
} from "./payPeriodSchedule.js";

test("anchor period: Sun 6/14 → Sat 6/27, due Mon 6/29, payday Sat 7/4 (holiday shift off Fri 7/3)", () => {
  const p = payPeriodByIndex(0);
  assert.equal(p.start, "2026-06-14");
  assert.equal(p.end, "2026-06-27");
  assert.equal(p.dueDate, "2026-06-29");
  assert.equal(p.dueDateTime, "2026-06-29T12:00:00");
  assert.equal(p.payday, "2026-07-04");
});

test("next period: Sun 6/28 → Sat 7/11, due Mon 7/13, payday Fri 7/17", () => {
  const p = payPeriodByIndex(1);
  assert.equal(p.start, "2026-06-28");
  assert.equal(p.end, "2026-07-11");
  assert.equal(p.dueDate, "2026-07-13");
  assert.equal(p.payday, "2026-07-17");
});

test("previous period steps back exactly 14 days; Juneteenth Fri 6/19 pays Thu 6/18", () => {
  const p = payPeriodByIndex(-1);
  assert.equal(p.start, "2026-05-31");
  assert.equal(p.end, "2026-06-13");
  assert.equal(p.payday, "2026-06-18");
});

test("holiday-Friday paydays always move to the day prior", () => {
  // New Year's Day: 12/13–12/26/2026 period, scheduled Fri 1/1/2027 → Thu 12/31.
  const newYears = payPeriodByIndex(13);
  assert.equal(newYears.start, "2026-12-13");
  assert.equal(newYears.end, "2026-12-26");
  assert.equal(newYears.payday, "2026-12-31");
});

test("payday is the Friday after the period ends, except holiday shifts", () => {
  const dow = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).getDay();
  };
  for (let i = -5; i <= 13; i++) {
    const p = payPeriodByIndex(i);
    if (i === 0) continue; // 7/3 → 7/4 Independence Day payroll exception
    if (i === -1 || i === 13) {
      assert.equal(dow(p.payday), 4, `${p.payday} should be the Thursday before a holiday Friday`);
      continue;
    }
    assert.equal(dow(p.payday), 5, `${p.payday} should be a Friday`);
  }
});

test("periodIndexForDate / currentPayPeriod on 2026-07-01 is the 6/28–7/11 period", () => {
  const now = new Date(2026, 6, 1); // Jul 1 2026 (Wed)
  assert.equal(periodIndexForDate(now), 1);
  const cur = currentPayPeriod(now);
  assert.equal(cur.start, "2026-06-28");
  assert.equal(cur.end, "2026-07-11");
});

test("every start is a Sunday and every end a Saturday", () => {
  const dow = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).getDay();
  };
  for (let i = -5; i <= 5; i++) {
    const p = payPeriodByIndex(i);
    assert.equal(dow(p.start), 0, `${p.start} should be Sunday`);
    assert.equal(dow(p.end), 6, `${p.end} should be Saturday`);
  }
});

test("listPayPeriods returns newest-first and includes the current period", () => {
  const list = listPayPeriods({ now: new Date(2026, 6, 1), back: 3, forward: 1 });
  assert.equal(list.length, 5);
  assert.ok(list[0].start > list[list.length - 1].start, "newest first");
  assert.ok(list.some((p) => p.start === "2026-06-28"), "includes current period");
});

test("isAlignedPayPeriod accepts scheduled periods and rejects off-cycle ones", () => {
  assert.equal(isAlignedPayPeriod("2026-06-14", "2026-06-27"), true);
  assert.equal(isAlignedPayPeriod("2026-06-28", "2026-07-11"), true);
  assert.equal(isAlignedPayPeriod("2026-06-15", "2026-06-28"), false); // Monday start, off-cycle
  assert.equal(isAlignedPayPeriod("2026-06-14", "2026-06-28"), false); // wrong length
  assert.equal(isAlignedPayPeriod("2026-06-21", "2026-07-04"), false); // Sunday but not on the 14-day cadence
});

test("isPastDue reflects the noon-Monday deadline", () => {
  const anchor = payPeriodByIndex(0); // due 2026-06-29 12:00
  assert.equal(isPastDue(anchor, new Date(2026, 5, 29, 11, 0)), false); // 11am Mon — still open
  assert.equal(isPastDue(anchor, new Date(2026, 5, 29, 12, 30)), true); // 12:30pm Mon — closed
  assert.equal(isPastDue(anchor, new Date(2026, 6, 1)), true); // days later
});
