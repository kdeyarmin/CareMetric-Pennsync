import { describe, it, expect } from "vitest";
import { CLINICAL_GROUPS, caseMixKey } from "./pdgmGrouper.js";
import {
  parseCaseMixWeightsCsv,
  parseCsvRows,
  CsvParseError,
  EXPECTED_GROUP_COUNT,
} from "./caseMixWeightsLoader.js";

const HEADER = "Clinical Group,Admission Source,Timing,Functional Level,Comorbidity Adjustment,Case-Mix Weight,HIPPS,LUPA Threshold";

describe("parseCsvRows", () => {
  it("handles quoted fields with commas and escaped quotes", () => {
    const rows = parseCsvRows('a,"b,c","d""e"\n1,2,3\n');
    expect(rows).toEqual([["a", "b,c", 'd"e'], ["1", "2", "3"]]);
  });
  it("drops fully blank lines", () => {
    expect(parseCsvRows("a,b\n\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("throws CsvParseError on an unterminated quoted field", () => {
    expect(() => parseCsvRows('a,"unclosed\n1,2\n')).toThrow(CsvParseError);
  });
});

describe("parseCaseMixWeightsCsv — happy path", () => {
  it("maps a row to the engine's caseMixKey + weight, carrying HIPPS/LUPA", () => {
    const csv = `${HEADER}\nMMTA - Cardiac and Circulatory,Community,Early,Medium,Low,1.0234,1AA11,4`;
    const res = parseCaseMixWeightsCsv(csv, { strict: false, year: 2026 });
    const key = caseMixKey({
      timing: "early", admissionSource: "community",
      clinicalGroup: "MMTA - Cardiac and Circulatory",
      functionalLevel: "medium", comorbidityLevel: "low",
    });
    expect(res.caseMixTable[key]).toEqual({ weight: 1.0234, hipps: "1AA11", lupaThreshold: 4 });
    expect(res.lupaThresholds[key]).toBe(4);
    expect(res.meta.year).toBe(2026);
    expect(res.meta.rowsParsed).toBe(1);
  });

  it("accepts CMS-style label variants (e.g. 'No Comorbidity Adjustment', 'Institutional')", () => {
    const csv = `${HEADER}\nWound,Institutional,Late,High,No Comorbidity Adjustment,1.5,3EC31,`;
    const res = parseCaseMixWeightsCsv(csv, { strict: false });
    const key = caseMixKey({ timing: "late", admissionSource: "institutional", clinicalGroup: "Wound", functionalLevel: "high", comorbidityLevel: "none" });
    expect(res.caseMixTable[key]?.weight).toBe(1.5);
  });

  it("resolves the official CMS clinical-group labels (Neuro/Stroke, Wounds (Post-Op & Skin/Non-Surgical))", () => {
    const csv =
      `${HEADER}\n` +
      `"Neuro/Stroke Rehabilitation",Community,Early,Low,None,1.2,x,\n` +
      `"Wounds (Post-Op & Skin/Non-Surgical)",Community,Early,Low,None,1.3,x,`;
    const res = parseCaseMixWeightsCsv(csv, { strict: false });
    const neuroKey = caseMixKey({ timing: "early", admissionSource: "community", clinicalGroup: "Neuro Rehabilitation", functionalLevel: "low", comorbidityLevel: "none" });
    const woundKey = caseMixKey({ timing: "early", admissionSource: "community", clinicalGroup: "Wound", functionalLevel: "low", comorbidityLevel: "none" });
    expect(res.caseMixTable[neuroKey]?.weight).toBe(1.2);
    expect(res.caseMixTable[woundKey]?.weight).toBe(1.3);
  });
});

describe("parseCaseMixWeightsCsv — malformed CSV", () => {
  it("returns ok:false with a dedicated error for an unterminated quoted field", () => {
    const csv = `${HEADER}\n"Wound,Community,Early,Low,None,1.1,x,`; // missing closing quote
    const res = parseCaseMixWeightsCsv(csv, { strict: false });
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/unterminated quoted field/i);
    expect(Object.keys(res.caseMixTable)).toHaveLength(0);
  });
});

describe("parseCaseMixWeightsCsv — validation never guesses", () => {
  it("flags an unknown clinical group and does not load the row", () => {
    const csv = `${HEADER}\nNot A Group,Community,Early,Low,None,1.1,x,`;
    const res = parseCaseMixWeightsCsv(csv, { strict: false });
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/clinical group/i);
    expect(Object.keys(res.caseMixTable)).toHaveLength(0);
  });

  it("flags an implausible weight", () => {
    const csv = `${HEADER}\nWound,Community,Early,Low,None,99,x,`;
    const res = parseCaseMixWeightsCsv(csv, { strict: false });
    expect(res.errors.join(" ")).toMatch(/outside plausible range/);
  });

  it("flags a bad enum value", () => {
    const csv = `${HEADER}\nWound,Community,Sometime,Low,None,1.1,x,`;
    const res = parseCaseMixWeightsCsv(csv, { strict: false });
    expect(res.errors.join(" ")).toMatch(/timing/);
  });

  it("rejects a missing required column", () => {
    const csv = "Clinical Group,Timing,Case-Mix Weight\nWound,Early,1.1";
    const res = parseCaseMixWeightsCsv(csv);
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/Missing required column/);
  });

  it("rejects a duplicate payment group", () => {
    const row = "Wound,Community,Early,Low,None,1.1,x,";
    const res = parseCaseMixWeightsCsv(`${HEADER}\n${row}\n${row}`, { strict: false });
    expect(res.errors.join(" ")).toMatch(/duplicate payment group/);
  });

  it("in strict mode, an incomplete table is an error", () => {
    const csv = `${HEADER}\nWound,Community,Early,Low,None,1.1,x,`;
    const res = parseCaseMixWeightsCsv(csv, { strict: true });
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/Incomplete table/);
  });
});

describe("parseCaseMixWeightsCsv — full 432-group table", () => {
  // Build a synthetic but structurally-complete table (placeholder weights) to
  // prove the loader accepts a full, well-formed file and counts 432 groups.
  it("accepts all 432 payment groups (strict) and reports completeness", () => {
    const timings = ["Early", "Late"];
    const admissions = ["Community", "Institutional"];
    const functionals = ["Low", "Medium", "High"];
    const comorbidities = ["None", "Low", "High"];
    const lines = [HEADER];
    let w = 0.5;
    for (const g of CLINICAL_GROUPS)
      for (const t of timings)
        for (const a of admissions)
          for (const f of functionals)
            for (const c of comorbidities) {
              w = Math.round((w + 0.0017) * 10000) / 10000; // vary, stay in-range
              // Quote the clinical group: two official names contain commas, so a
              // real CSV export quotes them (and the loader's parser handles it).
              lines.push(`"${g}",${a},${t},${f},${c},${w.toFixed(4)},HIPPS,3`);
            }
    const csv = lines.join("\n");
    const res = parseCaseMixWeightsCsv(csv, { strict: true, year: 2026 });
    expect(res.ok).toBe(true);
    expect(res.errors).toHaveLength(0);
    expect(res.meta.groups).toBe(EXPECTED_GROUP_COUNT);
    expect(EXPECTED_GROUP_COUNT).toBe(432);
    expect(Object.keys(res.caseMixTable)).toHaveLength(432);
  });
});
