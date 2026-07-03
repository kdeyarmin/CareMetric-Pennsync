import { describe, it, expect } from "vitest";
import { CLINICAL_GROUPS, caseMixKey } from "./pdgmGrouper.js";
import { DEFAULT_PDGM_RATES } from "./pdgmRates.js";
import { parseCaseMixWeightsCsv } from "./caseMixWeightsLoader.js";
import {
  RATES_KEY_TO_CMS_GROUP,
  buildStoredWeightTable,
  storedWeightTableRows,
  reconcileScenario,
} from "./caseMixReconciliation.js";

describe("RATES_KEY_TO_CMS_GROUP", () => {
  it("maps only real pdgmRates keys onto the 12 official CMS clinical groups", () => {
    const ratesKeys = new Set(Object.keys(DEFAULT_PDGM_RATES.clinicalGroupWeights));
    for (const [key, cmsGroup] of Object.entries(RATES_KEY_TO_CMS_GROUP)) {
      expect(ratesKeys.has(key), `unknown pdgmRates key ${key}`).toBe(true);
      expect(CLINICAL_GROUPS.includes(cmsGroup), `unknown CMS group ${cmsGroup}`).toBe(true);
    }
  });

  it("has no entry for MMTA_Medication_Management (no CMS counterpart — never guessed)", () => {
    expect(RATES_KEY_TO_CMS_GROUP.MMTA_Medication_Management).toBeUndefined();
  });
});

describe("buildStoredWeightTable", () => {
  const HEADER = "Clinical Group,Admission Source,Timing,Functional Level,Comorbidity Adjustment,Case-Mix Weight,HIPPS,LUPA Threshold";

  it("returns null for a failed parse (a partial table is never stored)", () => {
    expect(buildStoredWeightTable(null)).toBeNull();
    const bad = parseCaseMixWeightsCsv(`${HEADER}\nNot A Group,Community,Early,Low,None,1.1,x,`, { strict: false });
    expect(bad.ok).toBe(false);
    expect(buildStoredWeightTable(bad)).toBeNull();
  });

  it("wraps a successful parse with metadata and the grouper-shaped rows", () => {
    const parsed = parseCaseMixWeightsCsv(`${HEADER}\nWound,Community,Early,Low,None,1.25,1CA11,4`, { strict: false });
    expect(parsed.ok).toBe(true);
    const stored = buildStoredWeightTable(parsed, { year: 2026, source: "weights.csv", uploadedBy: "admin@agency.test" });
    expect(stored.payment_year).toBe("2026");
    expect(stored.source).toBe("weights.csv");
    expect(stored.uploaded_by_email).toBe("admin@agency.test");
    expect(stored.groups).toBe(1);
    expect(typeof stored.uploaded_at).toBe("string");
    const key = caseMixKey({ timing: "early", admissionSource: "community", clinicalGroup: "Wound", functionalLevel: "low", comorbidityLevel: "none" });
    expect(stored.rows[key]).toEqual({ weight: 1.25, hipps: "1CA11", lupaThreshold: 4 });
  });
});

describe("storedWeightTableRows", () => {
  it("returns rows only for a usable stored table", () => {
    expect(storedWeightTableRows(null)).toBeNull();
    expect(storedWeightTableRows({})).toBeNull();
    expect(storedWeightTableRows({ rows: {} })).toBeNull();
    expect(storedWeightTableRows({ rows: [] })).toBeNull();
    const rows = { "early|community|Wound|low|none": { weight: 1.2 } };
    expect(storedWeightTableRows({ rows })).toBe(rows);
  });
});

describe("reconcileScenario", () => {
  const woundKey = caseMixKey({
    timing: "early", admissionSource: "community",
    clinicalGroup: "Wound", functionalLevel: "low", comorbidityLevel: "none",
  });
  const stored = {
    payment_year: "2026",
    rows: { [woundKey]: { weight: 1.2345, hipps: "1CA11", lupaThreshold: 4 } },
  };
  const scenario = {
    clinicalGroup: "MMTA_Wounds", admissionSource: "community", timing: "early",
    functionalLevel: "low", comorbidityLevel: "none",
  };

  it("reports unavailable without a stored table", () => {
    const r = reconcileScenario(scenario, null);
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/no stored CMS case-mix weight table/);
  });

  it("resolves the pdgmRates group key to the CMS group and returns HIPPS/weight/LUPA", () => {
    const r = reconcileScenario(scenario, stored);
    expect(r).toEqual({ available: true, cmsGroup: "Wound", hipps: "1CA11", weight: 1.2345, lupaThreshold: 4 });
  });

  it("maps MMTA_Skin_Non_Surgical to the CMS Wound group (the official label covers skin/non-surgical)", () => {
    const r = reconcileScenario({ ...scenario, clinicalGroup: "MMTA_Skin_Non_Surgical" }, stored);
    expect(r.available).toBe(true);
    expect(r.cmsGroup).toBe("Wound");
  });

  it("reports a group with no CMS counterpart instead of guessing", () => {
    const r = reconcileScenario({ ...scenario, clinicalGroup: "MMTA_Medication_Management" }, stored);
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/no CMS clinical-group counterpart/);
  });

  it("reports a combination missing from the table instead of guessing", () => {
    const r = reconcileScenario({ ...scenario, functionalLevel: "high" }, stored);
    expect(r.available).toBe(false);
    expect(r.cmsGroup).toBe("Wound");
    expect(r.reason).toMatch(/combination not found/);
    expect(r.reason).toContain("early|community|Wound|high|none");
  });

  it("omits a non-numeric LUPA threshold rather than fabricating one", () => {
    const noLupa = { rows: { [woundKey]: { weight: 1.1 } } };
    const r = reconcileScenario(scenario, noLupa);
    expect(r.available).toBe(true);
    expect(r.lupaThreshold).toBeNull();
    expect(r.hipps).toBeNull();
  });
});
