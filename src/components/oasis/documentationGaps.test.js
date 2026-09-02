import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GAP_RULES, GAP_DIRECTIONS, findDocumentationGaps, toClinicianView,
  answersWithSchema, CLINICIAN_GAP_NOTICE,
} from "./documentationGaps.js";
import {
  aggregateDocumentationGaps, compareCohortRevenue, isClosedEpisode, MIN_COHORT_FOR_RATE,
} from "./documentationGapAnalytics.js";

const V2 = "pennsync-oasis-response-v2-cms-e2";
const V1 = "pennsync-oasis-response-v1-legacy";

const v2Item = (item, code) => ({
  item_number: item, item_source: "cms_item", response_schema_id: V2,
  response_value: { code }, response_origin: "clinician_selected",
});
const v1Item = (item, response) => ({ item_number: item, response_schema_id: V1, response });
const oasis = (...items) => ({ oasis_items: items });

// ─────────────────── the structural guarantee: symmetry ────────────────────

test("every rule fires in BOTH directions — the set cannot be a one-way ratchet", () => {
  // This is the property that separates evidence-driven review from upcoding.
  // A rule set that only fires toward more dependence would raise acuity (and
  // payment) every time it spoke, whatever the surrounding comments claimed.
  assert.ok(GAP_RULES.length > 0);
  for (const rule of GAP_RULES) {
    for (const direction of GAP_DIRECTIONS) {
      const spec = rule[direction];
      assert.ok(spec, `${rule.item} has no "${direction}" rule — the set would be one-way`);
      assert.ok(spec.pattern instanceof RegExp, `${rule.item}.${direction} needs a pattern`);
      for (const schema of ["v1", "v2"]) {
        assert.ok(
          Array.isArray(spec.codes[schema]) && spec.codes[schema].length > 0,
          `${rule.item}.${direction} needs contradicting codes for ${schema}`,
        );
      }
    }
    // The two directions must contradict DIFFERENT codes, or one of them can
    // never fire.
    for (const schema of ["v1", "v2"]) {
      const more = new Set(rule.suggests_more_dependence.codes[schema]);
      const less = rule.suggests_less_dependence.codes[schema];
      assert.ok(
        less.every((c) => !more.has(c)),
        `${rule.item} (${schema}): the two directions overlap, so one can never fire`,
      );
    }
  }
});

test("both directions actually fire end-to-end", () => {
  const more = findDocumentationGaps({
    documentation: "Patient is chairfast and requires two-person assist.",
    oasis: oasis(v2Item("M1860", "1")),
  });
  assert.equal(more.length, 1);
  assert.equal(more[0].direction, "suggests_more_dependence");

  const less = findDocumentationGaps({
    documentation: "Patient ambulates independently to the mailbox.",
    oasis: oasis(v2Item("M1860", "5")),
  });
  assert.equal(less.length, 1);
  assert.equal(less[0].direction, "suggests_less_dependence");
});

// ─────────────────── evidence, not payment, is the trigger ─────────────────

test("a finding requires a verbatim quote — an unevidenced nudge never appears", () => {
  const gaps = findDocumentationGaps({
    documentation: "Patient seen at home. Vitals stable.",
    oasis: oasis(v2Item("M1860", "1")),
  });
  assert.deepEqual(gaps, []);
});

test("no finding when the record and the code agree", () => {
  assert.deepEqual(
    findDocumentationGaps({ documentation: "Patient ambulates independently.", oasis: oasis(v2Item("M1860", "0")) }),
    [],
  );
  assert.deepEqual(
    findDocumentationGaps({ documentation: "Patient is chairfast.", oasis: oasis(v2Item("M1860", "5")) }),
    [],
  );
});

test("codes are read per schema — a legacy code is not judged by v2 meanings", () => {
  const a = answersWithSchema(oasis(v2Item("M1860", "2"), v1Item("M1830", "4")));
  assert.deepEqual(a.m1860, { code: "2", schema: "v2" });
  assert.deepEqual(a.m1830, { code: "4", schema: "v1" });
  // Legacy M1860 "2" is "one-handed device"; CMS "2" is two-handed/supervision.
  // The v1 contradiction set includes "2", the v2 set does not.
  const legacy = findDocumentationGaps({ documentation: "Patient is chairfast.", oasis: oasis(v1Item("M1860", "2")) });
  assert.equal(legacy.length, 1);
  const cms = findDocumentationGaps({ documentation: "Patient is chairfast.", oasis: oasis(v2Item("M1860", "2")) });
  assert.equal(cms.length, 0);
});

test("the finding states its whole reason and asks rather than instructs", () => {
  const [g] = findDocumentationGaps({
    documentation: "Patient is chairfast.",
    oasis: oasis(v2Item("M1860", "1")),
  });
  assert.match(g.reason, /appear to describe different things/i);
  assert.match(g.question, /confirm which reflects the patient/i);
  assert.equal(g.advisory, true);
  // It must not tell the clinician which code to enter.
  assert.doesNotMatch(g.question, /\benter\b|\bchange (?:it )?to\b|\bshould be\b/i);
  assert.equal(g.suggested_code, undefined);
  assert.equal(g.recommended_score, undefined);
});

// ─────────────── the audience boundary: no money reaches a clinician ───────

const FINANCIAL_KEY = /revenue|payment|reimburs|dollar|money|uplift|case_mix|billing|rate/i;

function assertNoFinancialKey(value, path = "$") {
  if (Array.isArray(value)) return value.forEach((v, i) => assertNoFinancialKey(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      assert.ok(!FINANCIAL_KEY.test(k), `financial key "${k}" reached a clinician payload at ${path}`);
      assertNoFinancialKey(v, `${path}.${k}`);
    }
  }
}

test("no financial key can reach the clinician projection", () => {
  const gaps = findDocumentationGaps({
    documentation: "Patient is chairfast. Caregiver administers all medications.",
    oasis: oasis(v2Item("M1860", "1"), v2Item("M2020", "0")),
  });
  assert.ok(gaps.length >= 2);
  assertNoFinancialKey(toClinicianView(gaps));
});

test("the clinician projection is an ALLOW-LIST, so a future field cannot leak", () => {
  // A field added to a finding later must not appear downstream just because
  // nobody remembered to delete it.
  const contaminated = [{
    id: "x", item: "m1860", label: "M1860", direction: "suggests_more_dependence",
    recorded_code: "1", evidence: ["q"], reason: "r", question: "q", advisory: true,
    // Anything below here is what a careless future change might add.
    revenue_uplift: 412, estimated_payment: 3200, case_mix_weight: 1.4, dimension: "functional",
  }];
  const view = toClinicianView(contaminated);
  assert.equal(view[0].revenue_uplift, undefined);
  assert.equal(view[0].estimated_payment, undefined);
  assert.equal(view[0].case_mix_weight, undefined);
  assert.equal(view[0].dimension, undefined, "dimension is an admin correlation key");
  assertNoFinancialKey(view);
});

/**
 * Executable source only.
 *
 * These files DISCUSS money in their comments — explaining why they contain
 * none is the point of the comments — so a check against the raw text would
 * fail on the very prose that documents the boundary. Strings are kept: a
 * dollar figure in a user-visible string would be a real leak.
 */
function executableSource(url) {
  return readFileSync(url, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .map((line) => line.replace(/\s\/\/[^"'`]*$/, ""))
    .join("\n");
}

test("the engine module contains no payment vocabulary in its executable source", () => {
  // Not a style check: if money ever enters this module, it enters the
  // clinician path, because this is what the clinician panel renders.
  const code = executableSource(new URL("./documentationGaps.js", import.meta.url));
  for (const word of ["revenue", "reimburs", "estimated_payment", "case_mix", "uplift", "toLocaleString"]) {
    assert.ok(!code.includes(word), `"${word}" appears in the clinician-facing engine`);
  }
  // A currency-formatted value, as opposed to a template literal's `${...}`.
  assert.ok(!/\$\s*\d/.test(code), "a dollar amount appears in the clinician-facing engine");
});

test("the clinician panel reaches neither the revenue module nor a financial gate", () => {
  const code = executableSource(new URL("./DocumentationGapPanel.jsx", import.meta.url));
  assert.ok(!code.includes("documentationGapAnalytics"), "the clinician panel must not reach the revenue module");
  // A gate here would imply there is something financial to hide; the point is
  // that the data this panel receives has no financial dimension at all.
  assert.ok(!code.includes("FinancialGate"), "the clinician panel must not need a financial gate");
  assert.ok(!/\$\s*\d/.test(code), "a dollar amount appears in the clinician panel");
  assert.match(CLINICIAN_GAP_NOTICE, /does not select OASIS responses/);
});

// ─────────────── the admin side: closed episodes only ──────────────────────

test("an open episode is never analysed for revenue", () => {
  for (const ep of [
    { status: "in_progress", episode_end: "2026-07-01" },
    { status: "draft", episode_end: "2026-07-01" },
    { status: "completed" },                                  // no end date
    { status: "completed", episode_end: "2099-01-01" },        // ends in the future
    { status: "completed", episode_end: "not-a-date" },
    {},
  ]) {
    assert.equal(isClosedEpisode(ep), false, JSON.stringify(ep));
  }
  assert.equal(isClosedEpisode({ status: "completed", episode_end: "2026-07-01" }), true);
});

test("aggregate analytics refuses open episodes and says how many it dropped", () => {
  const closed = {
    status: "completed", episode_end: "2026-07-01",
    documentation: "Patient is chairfast.", oasis: oasis(v2Item("M1860", "1")),
  };
  const open = { status: "in_progress", documentation: "Patient is chairfast.", oasis: oasis(v2Item("M1860", "1")) };
  const r = aggregateDocumentationGaps([closed, open, open]);
  assert.equal(r.episodes_analysed, 1);
  assert.equal(r.episodes_excluded_open, 2);
  assert.match(r.excluded_reason, /closed episodes only/i);
});

test("cohort revenue declines to report on a cohort too small to mean anything", () => {
  const ep = (doc, code) => ({
    status: "completed", episode_end: "2026-07-01",
    documentation: doc, oasis: oasis(v2Item("M1860", code)), estimated_payment: 3000, case_mix_weight: 1.1,
  });
  const small = compareCohortRevenue([ep("Patient is chairfast.", "1"), ep("Routine visit.", "1")]);
  assert.equal(small.reportable, false);
  assert.match(small.not_reportable_reason, new RegExp(String(MIN_COHORT_FOR_RATE)));

  const big = compareCohortRevenue([
    ...Array.from({ length: MIN_COHORT_FOR_RATE }, () => ep("Patient is chairfast.", "1")),
    ...Array.from({ length: MIN_COHORT_FOR_RATE }, () => ep("Routine visit, vitals stable.", "1")),
  ]);
  assert.equal(big.reportable, true);
  assert.equal(big.with_gaps.count, MIN_COHORT_FOR_RATE);
  assert.equal(big.without_gaps.count, MIN_COHORT_FOR_RATE);
  assert.match(big.caveat, /not what recoding would earn/i);
});

test("no per-episode uplift figure is produced anywhere", () => {
  const ep = (doc) => ({
    status: "completed", episode_end: "2026-07-01", documentation: doc,
    oasis: oasis(v2Item("M1860", "1")), estimated_payment: 3000, case_mix_weight: 1.1,
  });
  const rows = Array.from({ length: MIN_COHORT_FOR_RATE * 2 }, (_, i) =>
    ep(i % 2 ? "Patient is chairfast." : "Routine visit."));
  for (const out of [aggregateDocumentationGaps(rows), compareCohortRevenue(rows)]) {
    const json = JSON.stringify(out);
    assert.ok(!/uplift/i.test(json), "an uplift figure would be a per-assessment coding target");
    assert.ok(!/patient_id|assessment_id/i.test(json), "aggregates must not name an individual record");
  }
});

test("the admin panel is gated and the clinician panel is not", () => {
  const admin = readFileSync(new URL("./DocumentationGapAdminPanel.jsx", import.meta.url), "utf8");
  assert.ok(admin.includes("FinancialGate"), "the admin panel must be gated");
  assert.ok(admin.includes("documentationGapAnalytics"), "the admin panel is where revenue lives");
});

// ─────────────── OASISUpload is not an episode ─────────────────────────────

test("uploadsToClosedEpisodes converts only FINISHED uploads", async () => {
  const { uploadsToClosedEpisodes } = await import("./documentationGapAnalytics.js");
  const up = (over) => ({ assessment_date: "2026-07-01", ...over });
  // Upload statuses are uploaded | analyzed | reviewed | archived — a
  // vocabulary that does not overlap with episode statuses at all. Passing
  // uploads straight into isClosedEpisode() classified every one as open, so
  // the admin panel reported zero analysed episodes forever.
  const rows = uploadsToClosedEpisodes([
    up({ status: "reviewed" }),
    up({ status: "archived" }),
    up({ status: "analyzed" }),   // still in flight
    up({ status: "uploaded" }),   // raw
    { status: "reviewed" },       // no assessment_date
  ]);
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.equal(isClosedEpisode(r), true, "a converted row must read as closed");
    assert.equal(r.episode_end, "2026-07-01");
  }
});

test("converted uploads actually produce analytics instead of a permanent zero", async () => {
  const { uploadsToClosedEpisodes } = await import("./documentationGapAnalytics.js");
  const uploads = [{
    status: "reviewed",
    assessment_date: "2026-07-01",
    analysis_results: { summary: "Patient is chairfast and requires two-person assist." },
    extracted_data: oasis(v2Item("M1860", "1")),
  }];
  const direct = aggregateDocumentationGaps(uploads);
  assert.equal(direct.episodes_analysed, 0, "raw uploads are not episodes");

  const converted = aggregateDocumentationGaps(uploadsToClosedEpisodes(uploads));
  assert.equal(converted.episodes_analysed, 1);
  assert.equal(converted.totals.suggests_more_dependence, 1);
});

// ─────────────── nested AI text is sanitized too ───────────────────────────

test("sanitizeAiText neutralises a code assertion nested in allowed fields", async () => {
  const { sanitizeAiText } = await import("./responseSchema/aiResponseSanitizer.js");
  // The field-level sanitiser drops code-BEARING fields. This covers the other
  // half: a model writing an answer into prose inside a field that is otherwise
  // legitimate guidance.
  const payload = {
    item_name: "M1830 — Bathing",
    questions_to_ask: ["Is the patient bathed by an aide?", "Based on that, enter code 6."],
    documentation_tips: { primary: "Record who performs the bath. M1830 = 6 applies here." },
  };
  const clean = sanitizeAiText(payload);
  assert.ok(!/enter code 6/i.test(JSON.stringify(clean)), JSON.stringify(clean));
  assert.ok(!/M1830 = 6/i.test(JSON.stringify(clean)), JSON.stringify(clean));
  assert.match(JSON.stringify(clean), /code removed/);
  // Legitimate guidance survives.
  assert.ok(clean.questions_to_ask[0].includes("bathed by an aide"));
  assert.ok(clean.documentation_tips.primary.includes("Record who performs the bath"));
});
