import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyPayer,
  parseVisitFrequencies,
  collectOrderedFrequencies,
  computePeriodBreakdown,
  lupaBand,
  buildVisitPlan,
  normalizeAiEstimates,
  formatOrder,
  LUPA_THRESHOLD_MIN,
  LUPA_THRESHOLD_MAX,
} from "./visitPlanEstimator.js";

// ── payer classification ──

test("bare Medicare classifies as traditional FFS", () => {
  const r = classifyPayer({ demographics: { insurance_primary: "Medicare Part A & B" } });
  assert.equal(r.payer, "medicare_ffs");
  assert.equal(r.evidence, "Medicare Part A & B");
});

test("Medicare + Advantage markers classify as Medicare Advantage", () => {
  assert.equal(classifyPayer({ demographics: { insurance_primary: "Medicare Advantage" } }).payer, "medicare_advantage");
  assert.equal(classifyPayer({ demographics: { insurance_primary: "Humana Gold Plus Medicare HMO" } }).payer, "medicare_advantage");
  assert.equal(classifyPayer({ demographics: { insurance_primary: "UPMC for Life (Medicare)" } }).payer, "medicare_advantage");
  assert.equal(classifyPayer({ demographics: { insurance_primary: "Aetna Medicare PPO" } }).payer, "medicare_advantage");
});

test("named plan WITHOUT medicare classifies as commercial", () => {
  assert.equal(classifyPayer({ demographics: { insurance_primary: "Highmark BCBS PPO" } }).payer, "commercial");
  assert.equal(classifyPayer({ demographics: { insurance_primary: "Aetna" } }).payer, "commercial");
});

test("Medicaid / Medical Assistance classifies as medicaid", () => {
  assert.equal(classifyPayer({ demographics: { insurance_primary: "PA Medical Assistance" } }).payer, "medicaid");
  assert.equal(classifyPayer({ demographics: { insurance_primary: "Medicaid" } }).payer, "medicaid");
});

test("missing or unrecognized insurance classifies as unknown", () => {
  assert.equal(classifyPayer({}).payer, "unknown");
  assert.equal(classifyPayer(null).payer, "unknown");
  assert.equal(classifyPayer({ demographics: { insurance_primary: "self pay pending" } }).payer, "unknown");
});

test("classifyPayer unwraps the Referral entity extracted_data shape", () => {
  const r = classifyPayer({ extracted_data: { demographics: { insurance_primary: "Medicare" } } });
  assert.equal(r.payer, "medicare_ffs");
});

// ── frequency parsing ──

test("parses the classic tapering shorthand sequence with discipline", () => {
  const parsed = parseVisitFrequencies("SN 3w2, 2w2, 1w5");
  assert.equal(parsed.length, 3);
  assert.deepEqual(
    parsed.map((p) => [p.discipline, p.perWeek, p.weeks]),
    [["SN", 3, 2], ["SN", 2, 2], ["SN", 1, 5]]
  );
});

test("parses verbose frequency with duration", () => {
  const [a] = parseVisitFrequencies("PT 2x/week x 4 weeks");
  assert.deepEqual([a.discipline, a.perWeek, a.weeks], ["PT", 2, 4]);
  const [b] = parseVisitFrequencies("OT 3 times per week for 2 weeks");
  assert.deepEqual([b.discipline, b.perWeek, b.weeks], ["OT", 3, 2]);
  const [c] = parseVisitFrequencies("Speech therapy 2 visits per week for 6 weeks");
  assert.deepEqual([c.discipline, c.perWeek, c.weeks], ["ST", 2, 6]);
});

test("verbose order is one claim, not a verbose plus a total_only", () => {
  const parsed = parseVisitFrequencies("SN 2 visits per week for 6 weeks");
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].kind, "verbose");
});

test("parses daily orders with day and week durations", () => {
  const [days] = parseVisitFrequencies("SN daily x 14 days");
  assert.equal(days.perWeek, 7);
  assert.equal(days.weeks, 2);
  const [weeks] = parseVisitFrequencies("SN daily x 3 weeks");
  assert.equal(weeks.perWeek, 7);
  assert.equal(weeks.weeks, 3);
});

test("rate-only orders (no duration) are open-ended", () => {
  const [biw] = parseVisitFrequencies("PT BIW");
  assert.deepEqual([biw.discipline, biw.perWeek, biw.weeks], ["PT", 2, null]);
  const [tiw] = parseVisitFrequencies("SN TIW");
  assert.deepEqual([tiw.perWeek, tiw.weeks], [3, null]);
  const [weekly] = parseVisitFrequencies("MSW weekly");
  assert.deepEqual([weekly.discipline, weekly.perWeek, weekly.weeks], ["MSW", 1, null]);
  const [rate] = parseVisitFrequencies("SN 2x/week");
  assert.deepEqual([rate.perWeek, rate.weeks], [2, null]);
});

test("total-only orders carry no weekly structure", () => {
  const [t] = parseVisitFrequencies("PT eval + 6 visits");
  assert.equal(t.kind, "total_only");
  assert.equal(t.totalVisits, 6);
});

test("'St.' (Saint) in facility names is not the ST discipline", () => {
  const parsed = parseVisitFrequencies("Discharged from St. Mary's; SN 3w2");
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].discipline, "SN");
});

test("frequency with no preceding discipline is Unspecified", () => {
  const [p] = parseVisitFrequencies("3w2 ordered");
  assert.equal(p.discipline, "Unspecified");
});

test("empty or code-free text parses to no orders", () => {
  assert.deepEqual(parseVisitFrequencies(""), []);
  assert.deepEqual(parseVisitFrequencies(null), []);
  assert.deepEqual(parseVisitFrequencies("wound care to sacrum with daily dressing changes by caregiver"), []);
});

test("collectOrderedFrequencies dedupes the same order across fields", () => {
  const { orders, sources } = collectOrderedFrequencies({
    skilled_needs: { frequency_duration: "SN 3w2, 2w7", services_ordered: ["SN 3w2, 2w7"] },
  });
  assert.equal(orders.length, 2);
  assert.deepEqual(sources, ["skilled_needs.frequency_duration"]);
});

test("collectOrderedFrequencies reads the quick-scan shape", () => {
  const { orders } = collectOrderedFrequencies({
    skilled_nursing_needs: ["SN 2w4"],
    therapy_requirements: ["PT 2x/week x 4 weeks"],
  });
  assert.deepEqual(orders.map((o) => o.discipline), ["SN", "PT"]);
});

// ── 30-day period math ──

test("splits a tapering plan across the two 30-day periods with proration", () => {
  // SN 3w2, 2w2, 1w5 → weeks 1-2: 3/wk, 3-4: 2/wk, 5-9: 1/wk (15 total).
  const { orders } = collectOrderedFrequencies({ skilled_needs: { frequency_duration: "SN 3w2, 2w2, 1w5" } });
  const p = computePeriodBreakdown(orders);
  // Period 1 = 6 + 4 + 2 days of week 5 (2/7 ≈ 0.29) → floor 10.
  assert.equal(p.period1, 10);
  // Period 2 = the remaining 4.71 → floor 4.
  assert.equal(p.period2, 4);
  assert.equal(p.beyond60, 0);
  assert.equal(p.complete, true);
  assert.equal(p.byDiscipline.SN.total, 15);
});

test("disciplines run on independent calendars from SOC", () => {
  const { orders } = collectOrderedFrequencies({
    skilled_needs: { frequency_duration: "SN 2w4; PT 2w4" },
  });
  const p = computePeriodBreakdown(orders);
  // Both disciplines fully inside days 1-28 → all in period 1.
  assert.equal(p.period1, 16);
  assert.equal(p.period2, 0);
  assert.equal(p.byDiscipline.SN.period1, 8);
  assert.equal(p.byDiscipline.PT.period1, 8);
});

test("orders past day 60 count as beyond60; period counts floor conservatively", () => {
  // SN 1w10 = 1/wk for 70 days → 30/7 ≈ 4.29 per period, 1.43 past day 60.
  // Periods FLOOR (under-counting is the safe direction for LUPA banding).
  const { orders } = collectOrderedFrequencies({ skilled_needs: { frequency_duration: "SN 1w10" } });
  const p = computePeriodBreakdown(orders);
  assert.equal(p.period1, 4);
  assert.equal(p.period2, 4);
  assert.equal(p.beyond60, 1);
  assert.equal(p.byDiscipline.SN.total, 10);
});

test("open-ended and total-only orders mark the breakdown incomplete", () => {
  const { orders } = collectOrderedFrequencies({
    skilled_needs: { frequency_duration: "SN BIW; PT eval + 6 visits" },
  });
  const p = computePeriodBreakdown(orders);
  assert.equal(p.complete, false);
  assert.equal(p.openEnded.length, 1);
  assert.equal(p.totalOnly.length, 1);
});

// ── LUPA banding ──

test("LUPA bands: below_all, in_band, clears_all", () => {
  assert.equal(lupaBand(0).band, "below_all");
  assert.equal(lupaBand(1).band, "below_all");
  assert.equal(lupaBand(LUPA_THRESHOLD_MIN).band, "in_band");
  assert.equal(lupaBand(5).band, "in_band");
  assert.equal(lupaBand(LUPA_THRESHOLD_MAX).band, "clears_all");
  assert.equal(lupaBand(12).band, "clears_all");
});

// ── plan assembly ──

const medicareReferral = {
  demographics: { insurance_primary: "Medicare" },
  skilled_needs: { frequency_duration: "SN 3w2, 2w2, 1w5" },
};

test("buildVisitPlan: Medicare FFS with ordered frequencies gets LUPA banding per period", () => {
  const plan = buildVisitPlan(medicareReferral);
  assert.equal(plan.payer.payer, "medicare_ffs");
  assert.equal(plan.hasOrderedFrequencies, true);
  assert.equal(plan.usingAiEstimates, false);
  assert.equal(plan.lupa.length, 2);
  assert.equal(plan.lupa[0].band, "clears_all"); // 10 visits
  assert.equal(plan.lupa[1].band, "in_band"); // 4 visits
  // The in-band period surfaces an action.
  assert.ok(plan.actions.some((a) => a.includes("Period 2")));
});

test("buildVisitPlan: ordered frequencies take precedence over AI estimates", () => {
  const plan = buildVisitPlan(medicareReferral, { nursing_visits_first_30_days: 99 });
  assert.equal(plan.usingAiEstimates, false);
  assert.equal(plan.lupa[0].visits, 10);
  assert.equal(plan.lupa[0].estimate, false);
});

test("buildVisitPlan: AI estimates fill in when nothing is ordered, labeled as estimates", () => {
  const plan = buildVisitPlan(
    { demographics: { insurance_primary: "Medicare" } },
    { nursing_visits_first_30_days: 5, nursing_visits_days_31_60: 3, pt_visits: 4, ot_visits: 0, confidence: "medium" }
  );
  assert.equal(plan.hasOrderedFrequencies, false);
  assert.equal(plan.usingAiEstimates, true);
  // p1 = 5 + (4+0)/2 = 7 → clears; p2 = 3 + 2 = 5 → in_band, flagged estimate.
  assert.equal(plan.lupa[0].visits, 7);
  assert.equal(plan.lupa[0].estimate, true);
  assert.equal(plan.lupa[1].visits, 5);
  assert.equal(plan.lupa[1].band, "in_band");
  assert.ok(plan.actions.some((a) => a.includes("AI planning estimates")));
});

test("buildVisitPlan: Medicare Advantage gets auth actions and no LUPA banding", () => {
  const plan = buildVisitPlan({
    demographics: { insurance_primary: "Aetna Medicare Advantage" },
    skilled_needs: { frequency_duration: "SN 2w4" },
  });
  assert.equal(plan.lupa, null);
  assert.ok(plan.actions.some((a) => a.toLowerCase().includes("authorization")));
  assert.ok(plan.strategy.some((s) => s.includes("PRIOR AUTHORIZATION")));
});

test("buildVisitPlan: unknown payer asks for payer identification", () => {
  const plan = buildVisitPlan({});
  assert.equal(plan.payer.payer, "unknown");
  assert.ok(plan.actions.some((a) => a.includes("Identify and verify the payer")));
  assert.ok(plan.actions.some((a) => a.includes("obtain ordered frequencies")));
});

test("normalizeAiEstimates rejects junk and clamps to rounded non-negatives", () => {
  assert.equal(normalizeAiEstimates(null), null);
  assert.equal(normalizeAiEstimates({}), null);
  assert.equal(normalizeAiEstimates({ nursing_visits_first_30_days: -2 }), null);
  const ok = normalizeAiEstimates({ nursing_visits_first_30_days: 4.6, confidence: "bogus" });
  assert.equal(ok.nursingFirst30, 5);
  assert.equal(ok.confidence, null);
});

test("formatOrder renders each order kind", () => {
  assert.equal(formatOrder({ kind: "shorthand", perWeek: 3, weeks: 2 }), "3/wk × 2 wks");
  assert.equal(formatOrder({ kind: "rate_only", perWeek: 2, weeks: null }), "2/wk (duration not ordered)");
  assert.equal(formatOrder({ kind: "total_only", totalVisits: 6 }), "6 visits (no weekly structure)");
});
