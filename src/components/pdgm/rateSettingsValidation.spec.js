import { describe, it, expect } from "vitest";
import { DEFAULT_PDGM_RATES } from "./pdgmRates.js";
import {
  validateRateNumbers,
  validateIcdMappings,
  RATE_CELL_MIN,
  RATE_CELL_MAX,
} from "./rateSettingsValidation.js";

describe("validateRateNumbers", () => {
  it("passes the built-in defaults and an empty override", () => {
    expect(validateRateNumbers(DEFAULT_PDGM_RATES)).toEqual([]);
    expect(validateRateNumbers({})).toEqual([]);
    expect(validateRateNumbers(null)).toEqual([]);
  });

  it("rejects a base rate outside an order of magnitude of the default, with a specific message", () => {
    const low = validateRateNumbers({ basePaymentRate: 200 });
    expect(low).toHaveLength(1);
    expect(low[0]).toMatch(/Base 30-day payment rate \$200\.00/);
    expect(low[0]).toMatch(/order of magnitude/);

    const high = validateRateNumbers({ basePaymentRate: 30000 });
    expect(high).toHaveLength(1);
    expect(high[0]).toMatch(/\$30000\.00/);

    expect(validateRateNumbers({ basePaymentRate: -5 })).toHaveLength(1);
    // Within a factor of 10 either way is accepted.
    expect(validateRateNumbers({ basePaymentRate: 250 })).toEqual([]);
    expect(validateRateNumbers({ basePaymentRate: 19000 })).toEqual([]);
  });

  it("rejects a labor share entered as a percentage instead of a fraction", () => {
    const pct = validateRateNumbers({ laborShare: 74.9 });
    expect(pct).toHaveLength(1);
    expect(pct[0]).toMatch(/Labor-related share 74\.9/);
    expect(pct[0]).toMatch(/fraction between 0 and 1/);

    expect(validateRateNumbers({ laborShare: 0 })).toHaveLength(1);
    expect(validateRateNumbers({ laborShare: -0.5 })).toHaveLength(1);
    expect(validateRateNumbers({ laborShare: 0.749 })).toEqual([]);
    expect(validateRateNumbers({ laborShare: 1 })).toEqual([]);
  });

  it(`rejects weight/multiplier cells outside the sane ${RATE_CELL_MIN}–${RATE_CELL_MAX} range, naming the cell`, () => {
    const errors = validateRateNumbers({
      clinicalGroupWeights: { MMTA_Wounds: { community_early: 12 } },
      functionalMultipliers: { community_early: { low: 0.05 } },
      comorbidityMultipliers: { community_late: { high: 1.05 } }, // fine
    });
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/case-mix weights: MMTA_Wounds × community_early is 12/);
    expect(errors[1]).toMatch(/Functional-level multipliers: community_early × low is 0\.05/);
  });

  it("rejects functional thresholds that are negative or inverted (low >= high)", () => {
    const errors = validateRateNumbers({
      functionalThresholds: {
        community_early: { low: 18, high: 9 },
        community_late: { low: -2, high: 16 },
        institutional_early: { low: 10, high: 20 }, // fine
      },
    });
    expect(errors.join(" ")).toMatch(/community_early low cutoff \(18\) must be below the high cutoff \(9\)/);
    expect(errors.join(" ")).toMatch(/community_late low is -2/);
    expect(errors).toHaveLength(2);
  });
});

describe("validateIcdMappings", () => {
  const weighted = ["MMTA_Wounds", "MMTA_Cardiac_Circulatory"];

  it("passes clean, distinct mappings to weighted groups", () => {
    const res = validateIcdMappings(
      [
        { prefix: "I50", group: "MMTA_Cardiac_Circulatory" },
        { prefix: "L89", group: "MMTA_Wounds" },
        // Prefix shadowing (I vs I50) is intentional longest-prefix behavior, not a collision.
        { prefix: "I", group: "MMTA_Cardiac_Circulatory" },
      ],
      weighted,
    );
    expect(res.errors).toEqual([]);
    expect(res.warnings).toEqual([]);
  });

  it("flags the same prefix mapped to different groups as a blocking collision", () => {
    const res = validateIcdMappings(
      [
        { prefix: "I50", group: "MMTA_Cardiac_Circulatory" },
        { prefix: "i50.", group: "MMTA_Wounds" }, // normalizes to the same prefix
      ],
      weighted,
    );
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toMatch(/Prefix I50 is mapped to 2 different clinical groups \(rows 1, 2\)/);
  });

  it("flags identical duplicate rows as a warning only (they collapse on save)", () => {
    const res = validateIcdMappings(
      [
        { prefix: "L89", group: "MMTA_Wounds" },
        { prefix: "L89", group: "MMTA_Wounds" },
      ],
      weighted,
    );
    expect(res.errors).toEqual([]);
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]).toMatch(/Prefix L89 appears 2 times/);
  });

  it("flags a mapping to a clinical group that has no case-mix weight", () => {
    const res = validateIcdMappings([{ prefix: "Z99", group: "Retired_Group" }], weighted);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toMatch(/"Retired_Group", which has no case-mix weight/);
  });

  it("warns about incomplete rows that would silently drop on save", () => {
    const res = validateIcdMappings(
      [
        { prefix: "", group: "MMTA_Wounds" },
        { prefix: "K21", group: "" },
      ],
      weighted,
    );
    expect(res.errors).toEqual([]);
    expect(res.warnings).toHaveLength(2);
    expect(res.warnings[0]).toMatch(/Row 1 has no ICD-10 prefix/);
    expect(res.warnings[1]).toMatch(/Row 2 \(prefix K21\) has no clinical group/);
  });
});
