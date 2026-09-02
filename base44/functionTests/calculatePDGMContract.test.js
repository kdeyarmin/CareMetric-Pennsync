import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transpileTs } from "../../tools-transpile-ts.mjs";
import { DEFAULT_PDGM_RATES } from "../../src/components/pdgm/pdgmRates.js";

/**
 * Behavioral contract tests for the PDGM billing engine (calculatePDGM).
 *
 * Same harness convention as telnyxContract.test.js: transpile the entry,
 * capture its Deno.serve handler, and run it against an injected Base44
 * client — so the assertions run against the REAL payment math, not a copy.
 * (Table parity with the frontend is guarded separately by
 * src/components/pdgm/pdgmRatesParity.test.js.)
 */
async function loadHandler({ agencySettings = [], rateRows = [] } = {}) {
  let src = await readFile(new URL("../functions/calculatePDGM/entry.ts", import.meta.url), "utf8");
  src = src.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    "const createClientFromRequest = globalThis.__pdgmMakeClient;",
  );
  const js = transpileTs(src).outputText;
  const tmp = join(tmpdir(), `pdgmctr_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(tmp, js);

  let handler;
  globalThis.Deno = { serve: (h) => { handler = h; }, env: { get: () => undefined } };
  globalThis.__pdgmMakeClient = () => ({
    auth: { me: async () => ({ id: "u1", role: "admin", account_type: "agency_admin" }) },
    asServiceRole: {
      entities: {
        AgencySettings: { list: async () => agencySettings },
        PDGMRateConfig: { list: async () => rateRows },
      },
    },
  });
  try {
    await import(pathToFileURL(tmp).href);
  } finally {
    await unlink(tmp).catch(() => {});
  }
  return handler;
}

async function call(handler, body) {
  const res = await handler(
    new Request("http://local/calculatePDGM", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: await res.json() };
}

const BASE_PDGM = {
  primary_diagnosis_code: "I50.9",
  primary_diagnosis: "Heart failure",
  admission_source: "community",
  episode_timing: "early",
  functional_scores: {},
};

const LABOR_SHARE = DEFAULT_PDGM_RATES.laborShare; // CY2026: 0.749
const BASE_RATE = DEFAULT_PDGM_RATES.basePaymentRate;

test("wage index adjusts only the labor share of the base payment", async () => {
  const handler = await loadHandler();
  const { status, json } = await call(handler, { pdgmData: BASE_PDGM, wageIndex: 1.2 });
  assert.equal(status, 200);
  const expected = Math.round(BASE_RATE * (LABOR_SHARE * 1.2 + (1 - LABOR_SHARE)) * 100) / 100;
  assert.equal(json.original.adjustedBasePayment, expected);
  assert.equal(json.wageIndexApplied, 1.2);
});

test("an explicit caller wage index wins over the agency's saved one", async () => {
  const handler = await loadHandler({ agencySettings: [{ wage_index: 1.3 }] });
  const explicit = await call(handler, { pdgmData: BASE_PDGM, wageIndex: 1.0 });
  assert.equal(explicit.json.wageIndexApplied, 1.0);
  assert.equal(explicit.json.original.adjustedBasePayment, BASE_RATE);
});

test("with no caller value the agency wage index applies, then 1.0", async () => {
  const withAgency = await loadHandler({ agencySettings: [{ wage_index: 1.3 }] });
  assert.equal((await call(withAgency, { pdgmData: BASE_PDGM })).json.wageIndexApplied, 1.3);
  const without = await loadHandler();
  assert.equal((await call(without, { pdgmData: BASE_PDGM })).json.wageIndexApplied, 1.0);
});

test("M1000 codes 5 (SNF transition) and 6 (psychiatric) validate as institutional", async () => {
  const handler = await loadHandler();
  for (const code of ["5", "6"]) {
    const { json } = await call(handler, {
      pdgmData: { ...BASE_PDGM, m1000_from_where_admitted: code },
    });
    const mismatch = json.dataValidation.discrepancies.find((d) => d.type === "admission_source_mismatch");
    assert.ok(mismatch, `M1000=${code} should flag community as a mismatch`);
    assert.equal(mismatch.expected, "institutional");
  }
});

test("day 30 since SOC (start of the second 30-day period) validates as late", async () => {
  const handler = await loadHandler();
  const { json } = await call(handler, {
    pdgmData: { ...BASE_PDGM, soc_date: "2026-06-01", assessment_date: "2026-07-01" },
  });
  assert.equal(json.dataValidation.daysSinceSoc, 30);
  assert.equal(json.dataValidation.validatedEpisodeTiming, "late");
});

test("free-text source/timing normalize onto real PDGM buckets with a warning", async () => {
  // Regression: "Inpatient Hospital"/"02" used to build the lookup key
  // "inpatient hospital_02", miss every rate table, and silently price the
  // period at community_early.
  const handler = await loadHandler();
  const { json } = await call(handler, {
    pdgmData: { ...BASE_PDGM, admission_source: "Inpatient Hospital", episode_timing: "02" },
  });
  const group = json.original.clinicalGroup;
  const expectedWeight = DEFAULT_PDGM_RATES.clinicalGroupWeights[group].institutional_late;
  assert.equal(json.original.clinicalWeight, Math.round(expectedWeight * 10000) / 10000);
  assert.equal(json.original.inputWarnings.length, 2);
});

test("M1000 free-text/annotated values validate as institutional", async () => {
  // The extraction prompt emits "the checked code(s) or the facility type
  // text" — a bare equality check on the whole string classified all of these
  // as community (false discrepancies + community-priced corrections).
  const handler = await loadHandler();
  for (const value of ["5 - IRF", "02", "LTCH", "Inpatient rehabilitation facility", "6 - Inpatient psych"]) {
    const { json } = await call(handler, {
      pdgmData: { ...BASE_PDGM, m1000_from_where_admitted: value },
    });
    assert.equal(json.dataValidation.validatedAdmissionSource, "institutional", `M1000=${JSON.stringify(value)}`);
  }
  // And genuinely-community values must stay community. CMS's own response-1
  // wording carries the word "inpatient", so OR-ing the keyword scan with the
  // M1000 code priced these community admissions as institutional.
  for (const value of [
    "1",
    "1 - Community",
    "Community (non-institutional)",
    "1 - Community (no inpatient facility discharge within the past 14 days)",
    "01 - Community, not admitted to an inpatient facility in the past 14 days",
  ]) {
    const { json } = await call(handler, {
      pdgmData: { ...BASE_PDGM, m1000_from_where_admitted: value },
    });
    assert.equal(json.dataValidation.validatedAdmissionSource, "community", `M1000=${JSON.stringify(value)}`);
  }
});

test("episode-timing day count uses calendar days (mixed formats and DST safe)", async () => {
  const handler = await loadHandler();
  // Mixed formats: US local-parsed SOC vs ISO date-only assessment. A raw
  // millisecond floor undercounted this to 29 and validated day 31 as early.
  const mixed = await call(handler, {
    pdgmData: { ...BASE_PDGM, soc_date: "01/01/2025", assessment_date: "2025-01-31" },
  });
  assert.equal(mixed.json.dataValidation.daysSinceSoc, 30);
  assert.equal(mixed.json.dataValidation.validatedEpisodeTiming, "late");
  // Spring-forward DST window (US zones): 03/01 -> 03/31 is 30 calendar days.
  const dst = await call(handler, {
    pdgmData: { ...BASE_PDGM, soc_date: "03/01/2025", assessment_date: "03/31/2025" },
  });
  assert.equal(dst.json.dataValidation.daysSinceSoc, 30);
  assert.equal(dst.json.dataValidation.validatedEpisodeTiming, "late");
});

test("valid ICD-10-CM codes with 7th-character extensions are not flagged invalid", async () => {
  const handler = await loadHandler();
  for (const code of ["S72.001A", "T84.011A", "M1A.0111", "C4A.51", "Z3A.32"]) {
    const { json } = await call(handler, {
      pdgmData: { ...BASE_PDGM, primary_diagnosis_code: code },
    });
    const bad = json.dataValidation.discrepancies.find((d) => d.type === "invalid_diagnosis_code_format");
    assert.equal(bad, undefined, `${code} must validate as a legal ICD-10-CM format`);
  }
  const invalid = await call(handler, {
    pdgmData: { ...BASE_PDGM, primary_diagnosis_code: "123.45" },
  });
  assert.ok(invalid.json.dataValidation.discrepancies.find((d) => d.type === "invalid_diagnosis_code_format"));
});

test("an INCOMPLETE comparison reports null, never a confident $0 change", async () => {
  // This test used to assert the opposite shape: that a $0.00 delta reports 0
  // rather than null, so a genuine no-change result was distinguishable from an
  // absent one. That concern still stands — it has simply inverted.
  //
  // Both sides are now incomplete (the functional input carries no verified
  // response schema), so both payments are null. `null - null` coerces to 0,
  // which would render as a confident "$0 change" — the one reading that looks
  // like a verified answer when nothing was computed at all.
  //
  // A genuine-zero case cannot be constructed today: PDGM cannot complete while
  // M1800/M1810/M1820/M1850 have no CMS-verified response set. When they do,
  // restore a complete-input case asserting 0 is reported as 0.
  const handler = await loadHandler();
  const { json } = await call(handler, {
    pdgmData: BASE_PDGM,
    correctedPdgmData: { ...BASE_PDGM },
  });
  assert.equal(json.revenueDifference, null, "an unavailable delta must not read as 0");
  assert.equal(json.percentageIncrease, null);
  assert.ok(!json.financialImpact, "no financial impact may be presented from incomplete inputs");
});

test("a malformed stored rate override cannot clobber a rate subtree", async () => {
  // Mirrors the frontend deepMergeNumbers guards: a scalar stored where an
  // object belongs (and vice versa) must fall back to the defaults instead of
  // blanking the subtree and pricing with the 1.0 fallback.
  const handler = await loadHandler({
    rateRows: [{
      rates: {
        clinicalGroupWeights: { MMTA_Cardiac_Circulatory: 2 }, // scalar over object
        functionalThresholds: { community_early: 5 },          // scalar over object
      },
    }],
  });
  const { status, json } = await call(handler, { pdgmData: BASE_PDGM });
  assert.equal(status, 200);
  const expectedWeight = DEFAULT_PDGM_RATES.clinicalGroupWeights.MMTA_Cardiac_Circulatory.community_early;
  assert.equal(json.original.clinicalWeight, Math.round(expectedWeight * 10000) / 10000);
});

// ── response-schema gating on the functional input ──────────────────────────

/**
 * The functional score drives the case-mix weight and therefore the payment.
 * It is computed from OASIS response CODES, and a code only means something
 * once you know which response set it came from. These tests pin the refusal:
 * without verified, clinician-selected CMS-aligned input there is no functional
 * level to report, and the calculation must say so rather than quietly costing
 * the period at "functional low".
 */

const V2_SCHEMA = "pennsync-oasis-response-v2-cms-e2";

const VERIFIED_FUNCTIONAL = {
  response_schema_id: V2_SCHEMA,
  response_origin: "clinician_selected",
  m1800_grooming: "1",
  m1810_dress_upper: "1",
  m1820_dress_lower: "1",
  m1830_bathing: "2",
  m1840_toilet_transfer: "1",
  m1850_transferring: "1",
  m1860_ambulation: "2",
};

test("PDGM is incomplete when the functional input states no response schema", async () => {
  const handler = await loadHandler();
  const { status, json } = await call(handler, {
    pdgmData: { ...BASE_PDGM, functional_scores: { m1830_bathing: "2", m1860_ambulation: "2" } },
  });
  assert.equal(status, 200);
  const r = json.original ?? json;
  assert.equal(r.incomplete, true);
  assert.equal(r.reason, "functional_input_not_verifiable");
  // The refusal must not become a cheap answer.
  assert.equal(r.functionalLevel, null);
  assert.equal(r.functionalPoints, null);
  assert.equal(r.caseMixWeight, null);
  assert.equal(r.totalPayment, null);
  assert.ok(r.missing.some((m) => /response schema/i.test(m)), JSON.stringify(r.missing));
});

test("an ENTIRELY EMPTY functional input is incomplete, never functional-low", async () => {
  const handler = await loadHandler();
  const { json } = await call(handler, { pdgmData: BASE_PDGM });
  const r = json.original ?? json;
  assert.equal(r.incomplete, true);
  assert.notEqual(r.functionalLevel, "low", "missing values must not become the cheapest level");
  assert.equal(r.totalPayment, null);
});

test("a legacy response schema on the functional input is refused", async () => {
  const handler = await loadHandler();
  const { json } = await call(handler, {
    pdgmData: {
      ...BASE_PDGM,
      functional_scores: { ...VERIFIED_FUNCTIONAL, response_schema_id: "pennsync-oasis-response-v1-legacy" },
    },
  });
  const r = json.original ?? json;
  assert.equal(r.incomplete, true);
  assert.ok(r.missing.some((m) => /not the CMS-aligned v2 set/i.test(m)), JSON.stringify(r.missing));
});

test("an AI-originated functional input is refused", async () => {
  const handler = await loadHandler();
  const { json } = await call(handler, {
    pdgmData: { ...BASE_PDGM, functional_scores: { ...VERIFIED_FUNCTIONAL, response_origin: "ai_suggested" } },
  });
  const r = json.original ?? json;
  assert.equal(r.incomplete, true);
  assert.ok(r.missing.some((m) => /clinician/i.test(m)), JSON.stringify(r.missing));
});

test("the PennSync hospitalization-risk tier can never stand in for an official item", async () => {
  const handler = await loadHandler();
  const { json } = await call(handler, {
    pdgmData: {
      ...BASE_PDGM,
      functional_scores: { ...VERIFIED_FUNCTIONAL, ps_hospitalization_risk_tier: "high" },
    },
  });
  const r = json.original ?? json;
  assert.equal(r.incomplete, true);
  assert.ok(
    r.missing.some((m) => /ps_hospitalization_risk_tier/.test(m)),
    `the screening tier must be named as a refusal — got ${JSON.stringify(r.missing)}`,
  );
});

test("items with no CMS-verified response set are named, so the gap is visible", async () => {
  // M1800/M1810/M1820/M1850 were outside the CMS-alignment cutover, so PennSync
  // holds no verified response set for them. The functional score is therefore
  // not computable today — which is reported, not papered over.
  const handler = await loadHandler();
  const { json } = await call(handler, {
    pdgmData: { ...BASE_PDGM, functional_scores: VERIFIED_FUNCTIONAL },
  });
  const r = json.original ?? json;
  assert.equal(r.incomplete, true);
  for (const item of ["M1800", "M1810", "M1820", "M1850"]) {
    assert.ok(
      r.missing.some((m) => m.includes(item) && /no CMS-verified response set/i.test(m)),
      `${item} should be named as lacking a verified response set — got ${JSON.stringify(r.missing)}`,
    );
  }
  // The items that DO have one are not listed as missing.
  for (const item of ["M1830", "M1840", "M1860"]) {
    assert.ok(
      !r.missing.some((m) => m.includes(item) && /no CMS-verified response set/i.test(m)),
      `${item} has a verified response set and must not be listed`,
    );
  }
});

test("an incomplete result still reports the payment-independent facts it did establish", async () => {
  const handler = await loadHandler();
  const { json } = await call(handler, { pdgmData: BASE_PDGM, wageIndex: 1.2 });
  const r = json.original ?? json;
  assert.equal(r.incomplete, true);
  // Wage/base math is independent of the functional level, so it is still shown
  // — the caller can see how far the calculation got.
  assert.equal(r.wageIndex, 1.2);
  assert.equal(r.adjustedBasePayment, Math.round(BASE_RATE * (LABOR_SHARE * 1.2 + (1 - LABOR_SHARE)) * 100) / 100);
  assert.equal(r.clinicalGroup, "MMTA_Cardiac_Circulatory");
  assert.match(r.message, /does not determine PDGM/i);
});
