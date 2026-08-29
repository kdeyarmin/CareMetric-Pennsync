import test from "node:test";
import assert from "node:assert/strict";
import {
  estimateEpisodeMargin,
  parsePayerRatesCsv,
  payerRatesCsvTemplate,
  resolveHeader,
  matchPayerRow,
  estimatePayerEpisode,
  plannedVisitsByDiscipline,
} from "./payerRates.js";

// ── header resolution ──

test("resolves canonical headers and common aliases", () => {
  assert.equal(resolveHeader("payer_name"), "payer_name");
  assert.equal(resolveHeader("Plan Name"), "payer_name");
  assert.equal(resolveHeader("SN Rate"), "per_visit_sn");
  assert.equal(resolveHeader("per_visit_pt"), "per_visit_pt");
  assert.equal(resolveHeader("Approved SN"), "approved_sn");
  assert.equal(resolveHeader("PT visits"), "approved_pt");
  assert.equal(resolveHeader("Prior Auth"), "auth_required");
  assert.equal(resolveHeader("Mystery Column"), null);
});

// ── CSV parsing ──

test("the shipped template round-trips through the parser", () => {
  const result = parsePayerRatesCsv(payerRatesCsvTemplate());
  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.payers.length, 4);
  const aetna = result.payers.find((p) => p.payer_name === "Aetna Medicare Advantage");
  assert.equal(aetna.payer_type, "medicare_advantage");
  assert.equal(aetna.payment_model, "per_visit");
  assert.equal(aetna.per_visit_rates.SN, 165);
  assert.equal(aetna.approved_visits.SN, 10);
  assert.equal(aetna.auth_required, true);
  assert.deepEqual(aetna.match_terms, ["aetna"]);
  const highmark = result.payers.find((p) => p.payer_name === "Highmark Commercial");
  assert.equal(highmark.payment_model, "episodic");
  assert.equal(highmark.episode_rate, 2400);
});

test("parses dollar-formatted numbers and semicolon match terms", () => {
  const csv = [
    "payer_name,payment_model,episode_rate,match_terms",
    'ACME Plan,episodic,"$2,150.50",acme; acme health',
  ].join("\n");
  const r = parsePayerRatesCsv(csv);
  assert.equal(r.ok, true);
  assert.equal(r.payers[0].episode_rate, 2150.5);
  assert.deepEqual(r.payers[0].match_terms, ["acme", "acme health"]);
});

test("reports unusable rows/values without guessing", () => {
  const csv = [
    "payer_name,payer_type,payment_model,episode_rate,per_visit_sn",
    ",medicaid,per_visit,,100",
    "No Rate Episodic,commercial,episodic,,",
    "Weird,plan_of_doom,alien_model,,not-a-number",
    "Good,medicaid,per_visit,,120",
  ].join("\n");
  const r = parsePayerRatesCsv(csv);
  assert.equal(r.ok, true);
  assert.deepEqual(r.payers.map((p) => p.payer_name), ["Weird", "Good"]);
  assert.ok(r.errors.some((e) => e.includes("missing payer_name")));
  assert.ok(r.errors.some((e) => e.includes("episodic but episode_rate is missing")));
  assert.equal(r.payers[0].payer_type, "other");
  assert.equal(r.payers[0].payment_model, "per_visit");
  assert.ok(r.warnings.some((w) => w.includes('invalid per-visit SN rate "not-a-number"')));
});

test("duplicate payer names keep the first row; missing header fails closed", () => {
  const dup = parsePayerRatesCsv("payer_name,episode_rate,payment_model\nA,100,episodic\nA,999,episodic");
  assert.equal(dup.payers.length, 1);
  assert.equal(dup.payers[0].episode_rate, 100);
  assert.ok(dup.warnings.some((w) => w.includes("duplicate payer")));

  const noName = parsePayerRatesCsv("foo,bar\n1,2");
  assert.equal(noName.ok, false);
  assert.ok(noName.errors[0].includes("payer_name"));
});

// ── payer matching ──

const payers = [
  { payer_name: "Aetna Medicare Advantage", payer_type: "medicare_advantage", match_terms: ["aetna"] },
  { payer_name: "Keystone First", payer_type: "medicaid", match_terms: ["keystone", "medical assistance"] },
  { payer_name: "Highmark Commercial", payer_type: "commercial", match_terms: [] },
];

test("matches by match_terms first, then payer name, then sole payer_type", () => {
  assert.equal(matchPayerRow("Aetna Medicare PPO", "medicare_advantage", payers).matchedBy, "match_terms");
  assert.equal(matchPayerRow("PA Medical Assistance", "medicaid", payers).row.payer_name, "Keystone First");
  const byName = matchPayerRow("Highmark Commercial plan 12", "commercial", payers);
  assert.equal(byName.matchedBy, "payer_name");
  // No text hit but exactly one medicaid row → type fallback.
  const byType = matchPayerRow("State plan", "medicaid", payers);
  assert.equal(byType.matchedBy, "payer_type");
  // Ambiguous / absent → no match, never a guess.
  assert.equal(matchPayerRow("Mystery Insurance", "medicare_ffs", payers).row, null);
});

test("a generic term on another type's row never captures a classified payer", () => {
  // The shipped template's Medicare FFS row carries the generic term
  // "medicare"; an MA plan containing that word must still match ITS row.
  const withFfs = [
    { payer_name: "Medicare (traditional)", payer_type: "medicare_ffs", payment_model: "pdgm", match_terms: ["medicare"] },
    ...payers,
  ];
  const ma = matchPayerRow("Aetna Medicare Advantage PPO", "medicare_advantage", withFfs);
  assert.equal(ma.row.payer_name, "Aetna Medicare Advantage");
  assert.equal(ma.matchedBy, "match_terms");
  // Classified type with no rows of that type → no cross-type guess.
  assert.equal(matchPayerRow("United Healthcare Medicare Complete", "medicare_advantage", [withFfs[0]]).row, null);
  // Unclassified text may match any row — the LONGEST term wins, not CSV order.
  const twoTerms = [
    { payer_name: "Generic", payer_type: "other", match_terms: ["medic"] },
    { payer_name: "Specific", payer_type: "other", match_terms: ["medical assistance"] },
  ];
  assert.equal(matchPayerRow("PA medical assistance plan", "unknown", twoTerms).row.payer_name, "Specific");
});

// ── episode estimation ──

const visitPlan = {
  periods: { byDiscipline: { SN: { total: 15 }, PT: { total: 8 } } },
};

test("per-visit payers price planned visits at contracted rates", () => {
  const row = {
    payer_name: "Aetna MA",
    payment_model: "per_visit",
    per_visit_rates: { SN: 160, PT: 150 },
    approved_visits: { SN: 10, PT: 8 },
  };
  const est = estimatePayerEpisode(row, visitPlan);
  assert.equal(est.estimable, true);
  assert.equal(est.amount, 15 * 160 + 8 * 150);
  // SN planned 15 > approved 10 → over-auth flag; PT 8 = 8 → not over.
  const sn = est.authComparison.find((c) => c.discipline === "SN");
  assert.equal(sn.over, true);
  assert.equal(est.authComparison.find((c) => c.discipline === "PT").over, false);
  assert.ok(est.notes.some((n) => n.includes("SN: planned 15")));
});

test("a per-visit discipline without a rate is excluded and reported, never guessed", () => {
  const row = { payment_model: "per_visit", per_visit_rates: { SN: 160 }, approved_visits: {} };
  const est = estimatePayerEpisode(row, visitPlan);
  assert.equal(est.amount, 15 * 160);
  const pt = est.perVisitBreakdown.find((b) => b.discipline === "PT");
  assert.equal(pt.subtotal, null);
  assert.ok(est.notes.some((n) => n.includes("No contracted PT per-visit rate")));
});

test("episodic payers return the contracted rate; pdgm payers defer to calculatePDGM", () => {
  const epi = estimatePayerEpisode({ payment_model: "episodic", episode_rate: 2400, episode_length_days: 60 }, visitPlan);
  assert.equal(epi.amount, 2400);
  assert.match(epi.basis, /60-day/);

  const pdgm = estimatePayerEpisode({ payment_model: "pdgm", approved_visits: {} }, visitPlan);
  assert.equal(pdgm.estimable, false);
  assert.ok(pdgm.notes.some((n) => n.includes("PDGM")));
});

test("no configured payer row yields a clear import instruction", () => {
  const est = estimatePayerEpisode(null, visitPlan);
  assert.equal(est.estimable, false);
  assert.ok(est.notes[0].includes("PDGM Rate Settings"));
});

test("plannedVisitsByDiscipline prefers ordered periods and falls back to AI estimates", () => {
  assert.deepEqual(plannedVisitsByDiscipline(visitPlan), { SN: 15, PT: 8 });
  const ai = plannedVisitsByDiscipline({
    aiEstimates: { nursingFirst30: 5, nursingDays31to60: 3, pt: 4, ot: 0, aide: 2 },
  });
  assert.deepEqual(ai, { SN: 8, PT: 4, HHA: 2 });
  assert.deepEqual(plannedVisitsByDiscipline(null), {});
});

test("total-only orders ('PT eval + 6 visits') count toward planned visits", () => {
  const withTotalOnly = {
    periods: {
      byDiscipline: { SN: { period1: 8, period2: 7, total: 15 } },
      totalOnly: [
        { kind: "total_only", discipline: "PT", totalVisits: 6 },
        { kind: "total_only", discipline: "XX", totalVisits: 3 }, // unknown discipline ignored
      ],
    },
  };
  assert.deepEqual(plannedVisitsByDiscipline(withTotalOnly), { SN: 15, PT: 6 });
  // A plan that is ONLY total-only orders still prices those visits.
  assert.deepEqual(
    plannedVisitsByDiscipline({ periods: { byDiscipline: {}, totalOnly: [{ discipline: "PT", totalVisits: 6 }] } }),
    { PT: 6 }
  );
});

// ── episode margin ──

test("estimateEpisodeMargin prices planned visits at the agency's costs", () => {
  const m = estimateEpisodeMargin({
    revenue: 4000,
    plannedVisits: { SN: 15, PT: 8 },
    visitCosts: { SN: 95, PT: 110 },
  });
  assert.equal(m.estimable, true);
  assert.equal(m.totalCost, 15 * 95 + 8 * 110);
  assert.equal(m.margin, 4000 - m.totalCost);
  assert.equal(m.marginPct, Math.round(((4000 - m.totalCost) / 4000) * 1000) / 10);
  assert.deepEqual(m.uncosted, []);
});

test("uncosted disciplines are reported and mark the cost a floor", () => {
  const m = estimateEpisodeMargin({
    revenue: 3000,
    plannedVisits: { SN: 10, HHA: 6 },
    visitCosts: { SN: 90 },
  });
  assert.equal(m.totalCost, 900);
  assert.deepEqual(m.uncosted, ["HHA"]);
  assert.ok(m.notes.some((n) => n.includes("cost total is a floor")));
});

test("no costs entered or no revenue degrade gracefully", () => {
  const none = estimateEpisodeMargin({ revenue: 3000, plannedVisits: { SN: 10 }, visitCosts: {} });
  assert.equal(none.estimable, false);
  assert.ok(none.notes[0].includes("No per-visit costs entered"));

  const noRevenue = estimateEpisodeMargin({ revenue: null, plannedVisits: { SN: 10 }, visitCosts: { SN: 90 } });
  assert.equal(noRevenue.margin, null);
  assert.equal(noRevenue.totalCost, 900);
  assert.ok(noRevenue.notes.some((n) => n.includes("No revenue estimate")));

  const noVisits = estimateEpisodeMargin({ revenue: 3000, plannedVisits: {}, visitCosts: { SN: 90 } });
  assert.equal(noVisits.estimable, false);
});
