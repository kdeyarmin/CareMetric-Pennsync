import test from "node:test";
import assert from "node:assert/strict";
import {
  computeTurnaround,
  buildAgingBoard,
  rollupTimelyInitiation,
  toTimelyInitiationKPIs,
  markStartOfCareCompleted,
  AGING_BUCKET,
  TIMELY_INITIATION_DAYS,
} from "./intakeToSocTracker.js";

const ASOF = "2026-07-01";

// ── turnaround ──

test("SOC within 2 days of referral is timely", () => {
  const t = computeTurnaround({ referral_date: "2026-06-20", soc_date: "2026-06-22" });
  assert.equal(t.completed, true);
  assert.equal(t.turnaround_days, 2);
  assert.equal(t.timely, true);
  assert.equal(t.status, "timely");
});

test("SOC more than 2 days after referral (and after ordered date) is late", () => {
  const t = computeTurnaround({ referral_date: "2026-06-20", estimated_start_date: "2026-06-21", soc_date: "2026-06-27" });
  assert.equal(t.turnaround_days, 7);
  assert.equal(t.timely, false);
  assert.equal(t.status, "late");
});

test("SOC on the physician-specified date is timely even if >2 days from referral", () => {
  const t = computeTurnaround({ referral_date: "2026-06-20", estimated_start_date: "2026-06-26", soc_date: "2026-06-26" });
  assert.equal(t.turnaround_days, 6);
  assert.equal(t.timely, true); // within ordered-SOC window
});

test("first_visit_date is used when soc_date is absent", () => {
  const t = computeTurnaround({ referral_date: "2026-06-20", first_visit_date: "2026-06-21" });
  assert.equal(t.turnaround_days, 1);
  assert.equal(t.timely, true);
});

// ── open aging ──

test("open referral <2 days old is on_track", () => {
  const t = computeTurnaround({ referral_date: "2026-06-30", status: "ready_for_admission" }, { asOf: ASOF });
  assert.equal(t.open, true);
  assert.equal(t.age_days, 1);
  assert.equal(t.aging_bucket, AGING_BUCKET.ON_TRACK);
});

test("open referral exactly 2 days old is due_soon", () => {
  const t = computeTurnaround({ referral_date: "2026-06-29", status: "ready_for_admission" }, { asOf: ASOF });
  assert.equal(t.aging_bucket, AGING_BUCKET.DUE_SOON);
});

test("open referral more than 2 days old is overdue", () => {
  const t = computeTurnaround({ referral_date: "2026-06-25", status: "pending" }, { asOf: ASOF });
  assert.equal(t.age_days, 6);
  assert.equal(t.aging_bucket, AGING_BUCKET.OVERDUE);
});

test("a declined referral is closed, not open (off the aging board)", () => {
  const t = computeTurnaround({ referral_date: "2026-06-01", status: "declined" }, { asOf: ASOF });
  assert.equal(t.open, false);
  assert.equal(t.status, "closed");
  assert.equal(t.aging_bucket, null);
});

// ── aging board ──

test("buildAgingBoard buckets open referrals and sorts overdue oldest-first", () => {
  const board = buildAgingBoard(
    [
      { id: "a", referral_date: "2026-06-30", status: "ready_for_admission" }, // on_track (1d)
      { id: "b", referral_date: "2026-06-20", status: "pending" }, // overdue (11d)
      { id: "c", referral_date: "2026-06-25", status: "processing" }, // overdue (6d)
      { id: "d", referral_date: "2026-06-10", soc_date: "2026-06-11" }, // completed → excluded
      { id: "e", referral_date: "2026-05-01", status: "declined" }, // closed → excluded
    ],
    { asOf: ASOF },
  );
  assert.equal(board.total_open, 3);
  assert.equal(board.counts.overdue, 2);
  assert.equal(board.counts.on_track, 1);
  assert.deepEqual(board.buckets.overdue.map((r) => r.id), ["b", "c"]); // oldest first
  assert.equal(board.oldest_age_days, 11);
});

// ── rollup + KPIs ──

test("rollupTimelyInitiation computes the measure rate and average turnaround", () => {
  const referrals = [
    { referral_date: "2026-06-01", soc_date: "2026-06-02" }, // timely, 1d
    { referral_date: "2026-06-01", soc_date: "2026-06-03" }, // timely, 2d
    { referral_date: "2026-06-01", estimated_start_date: "2026-06-02", soc_date: "2026-06-08" }, // late, 7d
    { referral_date: "2026-06-01", status: "pending" }, // open → excluded
  ];
  const rollup = rollupTimelyInitiation(referrals, { asOf: ASOF });
  assert.equal(rollup.denominator, 3);
  assert.equal(rollup.numerator, 2);
  assert.equal(rollup.rate, 66.7);
  assert.equal(rollup.average_turnaround_days, 3.3); // (1+2+7)/3 = 3.33 → 3.3
});

test("toTimelyInitiationKPIs emits a quality measure and an operational KPI", () => {
  const rollup = rollupTimelyInitiation(
    [
      { referral_date: "2026-06-01", soc_date: "2026-06-02" },
      { referral_date: "2026-06-01", soc_date: "2026-06-09" },
    ],
    { asOf: ASOF },
  );
  const kpis = toTimelyInitiationKPIs(rollup, { periodStart: "2026-06-01", periodEnd: "2026-06-30" });
  const quality = kpis.find((k) => k.metric_category === "quality");
  const operational = kpis.find((k) => k.metric_category === "operational");
  assert.ok(quality && operational);
  assert.equal(quality.metric_name, "Timely Initiation of Care");
  assert.equal(quality.unit, "%");
  assert.equal(operational.unit, "days");
});

// ── state transition ──

test("markStartOfCareCompleted closes the intake→SOC clock", () => {
  const update = markStartOfCareCompleted({ id: "r1" }, { socDate: "2026-06-22", by: "nurse@x.com" });
  assert.equal(update.status, "soc_completed");
  assert.equal(update.soc_date, "2026-06-22");
  assert.equal(update.first_visit_date, "2026-06-22");
  assert.equal(update.soc_completed_by, "nurse@x.com");
});

test("TIMELY_INITIATION_DAYS is the CMS 2-day window", () => {
  assert.equal(TIMELY_INITIATION_DAYS, 2);
});

// ── Regression: calendar-day turnaround + unknown status (2026-07 review) ───

test("a datetime SOC on calendar day 2 is timely (no ms rounding)", () => {
  const t = computeTurnaround({ referral_date: "2026-07-20", soc_date: "2026-07-22T14:30:00Z", status: "soc_completed" });
  assert.equal(t.turnaround_days, 2);
  assert.equal(t.timely, true);
  assert.equal(t.status, "timely");
});

test("a completed referral with no dates reports status 'unknown', not 'timely'", () => {
  const t = computeTurnaround({ soc_date: "2026-07-22", status: "soc_completed" });
  assert.equal(t.timely, null);
  assert.equal(t.status, "unknown");
});
