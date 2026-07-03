import test from "node:test";
import assert from "node:assert/strict";
import {
  OPEN_ADR_STATUSES,
  REMINDER_DAYS_BEFORE,
  MAX_OVERDUE_REMINDER_DAYS,
  parseDateOnlyUTC,
  planAdrDeadlineReminders,
} from "./adrDeadlines.js";

const TODAY = "2026-07-03";

const makeCase = (over = {}) => ({
  id: "case1",
  status: "checklist_ready",
  created_by: "office@agency.com",
  case_name: "Palmetto TPE — J. Smith",
  response_due_date: "2026-07-10",
  ...over,
});

// ── parseDateOnlyUTC ──

test("parseDateOnlyUTC parses valid dates and rejects junk", () => {
  assert.equal(parseDateOnlyUTC("2026-07-03"), Date.UTC(2026, 6, 3));
  assert.equal(parseDateOnlyUTC("2026-02-31"), null, "impossible dates fail closed");
  assert.equal(parseDateOnlyUTC("07/03/2026"), null);
  assert.equal(parseDateOnlyUTC(""), null);
  assert.equal(parseDateOnlyUTC(null), null);
});

// ── planAdrDeadlineReminders ──

test("fires at the 7/3/1/0-day thresholds with escalating priority", () => {
  for (const [due, expectedDays, expectedPriority] of [
    ["2026-07-10", 7, "high"],
    ["2026-07-06", 3, "high"],
    ["2026-07-04", 1, "critical"],
    ["2026-07-03", 0, "critical"],
  ]) {
    const plans = planAdrDeadlineReminders({ cases: [makeCase({ response_due_date: due })], todayIso: TODAY });
    assert.equal(plans.length, 1, `expected a reminder for due=${due}`);
    assert.equal(plans[0].days_left, expectedDays);
    assert.equal(plans[0].priority, expectedPriority);
    assert.equal(plans[0].user_email, "office@agency.com");
  }
});

test("stays quiet on non-threshold pre-deadline days", () => {
  for (const due of ["2026-07-09", "2026-07-08", "2026-07-05", "2026-08-01"]) {
    const plans = planAdrDeadlineReminders({ cases: [makeCase({ response_due_date: due })], todayIso: TODAY });
    assert.equal(plans.length, 0, `no reminder expected for due=${due}`);
  }
});

test("reminds daily while overdue, then stops after the overdue window", () => {
  const overdue3 = planAdrDeadlineReminders({
    cases: [makeCase({ response_due_date: "2026-06-30" })],
    todayIso: TODAY,
  });
  assert.equal(overdue3.length, 1);
  assert.equal(overdue3[0].days_left, -3);
  assert.equal(overdue3[0].priority, "critical");
  assert.match(overdue3[0].title, /overdue by 3 days/);

  const tooOld = planAdrDeadlineReminders({
    cases: [makeCase({ response_due_date: "2026-06-01" })], // 32 days overdue
    todayIso: TODAY,
  });
  assert.equal(tooOld.length, 0, `no nagging past ${MAX_OVERDUE_REMINDER_DAYS} days overdue`);
});

test("one reminder per case per calendar day", () => {
  const already = makeCase({
    response_due_date: "2026-07-03",
    deadline_reminders: { last_notified_date: TODAY, last_days_left: 0 },
  });
  assert.equal(planAdrDeadlineReminders({ cases: [already], todayIso: TODAY }).length, 0);
  const yesterday = makeCase({
    response_due_date: "2026-07-03",
    deadline_reminders: { last_notified_date: "2026-07-02", last_days_left: 1 },
  });
  assert.equal(planAdrDeadlineReminders({ cases: [yesterday], todayIso: TODAY }).length, 1);
});

test("skips closed cases, cases without a due date or owner, and bad inputs", () => {
  const cases = [
    makeCase({ status: "submitted", response_due_date: "2026-07-03" }),
    makeCase({ status: "closed", response_due_date: "2026-07-03" }),
    makeCase({ response_due_date: undefined }),
    makeCase({ response_due_date: "not-a-date" }),
    makeCase({ created_by: "", response_due_date: "2026-07-03" }),
    null,
  ];
  assert.equal(planAdrDeadlineReminders({ cases, todayIso: TODAY }).length, 0);
  assert.equal(planAdrDeadlineReminders({ cases: [makeCase()], todayIso: "garbage" }).length, 0);
});

test("all workflow statuses before submission are considered open", () => {
  for (const status of OPEN_ADR_STATUSES) {
    const plans = planAdrDeadlineReminders({
      cases: [makeCase({ status, response_due_date: "2026-07-03" })],
      todayIso: TODAY,
    });
    assert.equal(plans.length, 1, `status ${status} should be reminded`);
  }
  assert.deepEqual(REMINDER_DAYS_BEFORE, [7, 3, 1, 0]);
});

test("messages are honest about the denial consequence", () => {
  const [dueToday] = planAdrDeadlineReminders({
    cases: [makeCase({ response_due_date: "2026-07-03" })],
    todayIso: TODAY,
  });
  assert.match(dueToday.title, /due TODAY/);
  assert.match(dueToday.message, /treated as missing/);
});
