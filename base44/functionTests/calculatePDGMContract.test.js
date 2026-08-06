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

test("a $0.00 corrected-revenue delta reports 0, not null", async () => {
  const handler = await loadHandler();
  const { json } = await call(handler, {
    pdgmData: BASE_PDGM,
    correctedPdgmData: { ...BASE_PDGM },
  });
  assert.equal(json.revenueDifference, 0);
  assert.equal(json.percentageIncrease, 0);
  assert.ok(json.financialImpact, "financialImpact must be present when a correction was computed");
  assert.equal(json.financialImpact.perEpisode, 0);
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
