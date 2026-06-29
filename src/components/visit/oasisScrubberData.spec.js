import { describe, it, expect } from "vitest";
import {
  getRiskColor,
  getImpactBadge,
  buildFunctionalPhrases,
  buildClinicalAlerts,
} from "./oasisScrubberData";

// A clinicalIndicators fixture with nothing detected. Tests override individual
// indicators. Sub-fields (heartFailure/complications/intensity) are only read
// when the corresponding `detected` is true, but they're included for realism.
const noIndicators = () => ({
  woundPresent: { detected: false },
  cardiacIssues: { detected: false, heartFailure: [] },
  diabetic: { detected: false, complications: [] },
  fallRisk: { detected: false },
  cognitiveIssues: { detected: false },
  oxygenUse: { detected: false },
  painMentioned: { detected: false, intensity: [] },
});

describe("getRiskColor", () => {
  it("maps each known risk level and falls back to slate", () => {
    expect(getRiskColor("low")).toContain("green");
    expect(getRiskColor("medium")).toContain("yellow");
    expect(getRiskColor("high")).toContain("orange");
    expect(getRiskColor("critical")).toContain("red");
    expect(getRiskColor(undefined)).toContain("slate");
    expect(getRiskColor("nonsense")).toContain("slate");
  });
});

describe("getImpactBadge", () => {
  it("maps each known impact level and falls back to slate", () => {
    expect(getImpactBadge("high")).toBe("bg-red-500");
    expect(getImpactBadge("medium")).toBe("bg-yellow-500");
    expect(getImpactBadge("low")).toBe("bg-blue-500");
    expect(getImpactBadge("other")).toBe("bg-slate-500");
  });
});

describe("buildFunctionalPhrases", () => {
  const ADL_DOMAINS = [
    "bathing",
    "dressing",
    "ambulation",
    "transfer",
    "toileting",
    "grooming",
    "eating",
    "medications",
  ];

  it("always returns every ADL/IADL domain with array fields", () => {
    const result = buildFunctionalPhrases("");
    for (const domain of ADL_DOMAINS) {
      expect(result[domain]).toBeDefined();
      expect(Array.isArray(result[domain].allPhrases)).toBe(true);
    }
  });

  it("captures sentences into the relevant domain", () => {
    const narrative =
      "Patient requires moderate assist with shower. She ambulates 50 feet with a walker. Blood glucose checked before meals.";
    const result = buildFunctionalPhrases(narrative);
    expect(result.bathing.allPhrases.join(" ")).toMatch(/shower/i);
    expect(result.ambulation.allPhrases.join(" ")).toMatch(/ambulate|walker/i);
  });
});

describe("buildClinicalAlerts", () => {
  it("returns no alerts when nothing is detected", () => {
    expect(buildClinicalAlerts(noIndicators())).toEqual([]);
  });

  it("emits a high-severity wound alert", () => {
    const ind = noIndicators();
    ind.woundPresent.detected = true;
    const alerts = buildClinicalAlerts(ind);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: "wound", severity: "high" });
  });

  it("escalates cardiac severity/title when heart failure is present", () => {
    const withHF = noIndicators();
    withHF.cardiacIssues = { detected: true, heartFailure: ["HFrEF"] };
    expect(buildClinicalAlerts(withHF)[0]).toMatchObject({
      type: "cardiac",
      severity: "high",
      title: "Heart Failure Management",
    });

    const withoutHF = noIndicators();
    withoutHF.cardiacIssues = { detected: true, heartFailure: [] };
    expect(buildClinicalAlerts(withoutHF)[0]).toMatchObject({
      type: "cardiac",
      severity: "medium",
      title: "Cardiac Monitoring",
    });
  });

  it("escalates diabetes severity when complications are present", () => {
    const complicated = noIndicators();
    complicated.diabetic = { detected: true, complications: ["neuropathy"] };
    expect(buildClinicalAlerts(complicated)[0].severity).toBe("high");

    const uncomplicated = noIndicators();
    uncomplicated.diabetic = { detected: true, complications: [] };
    expect(buildClinicalAlerts(uncomplicated)[0].severity).toBe("medium");
  });

  it("emits fall-risk, cognitive, and oxygen alerts at their fixed severities", () => {
    const fall = noIndicators();
    fall.fallRisk.detected = true;
    expect(buildClinicalAlerts(fall)[0]).toMatchObject({ type: "fall_risk", severity: "high" });

    const cog = noIndicators();
    cog.cognitiveIssues.detected = true;
    expect(buildClinicalAlerts(cog)[0]).toMatchObject({ type: "cognitive", severity: "medium" });

    const o2 = noIndicators();
    o2.oxygenUse.detected = true;
    expect(buildClinicalAlerts(o2)[0]).toMatchObject({ type: "respiratory", severity: "medium" });
  });

  it("emits a pain alert only when pain is detected without a documented intensity", () => {
    const noIntensity = noIndicators();
    noIntensity.painMentioned = { detected: true, intensity: [] };
    expect(buildClinicalAlerts(noIntensity).some((a) => a.type === "pain")).toBe(true);

    const withIntensity = noIndicators();
    withIntensity.painMentioned = { detected: true, intensity: ["7/10"] };
    expect(buildClinicalAlerts(withIntensity).some((a) => a.type === "pain")).toBe(false);
  });

  it("accumulates multiple alerts when several indicators fire", () => {
    const ind = noIndicators();
    ind.woundPresent.detected = true;
    ind.fallRisk.detected = true;
    ind.oxygenUse.detected = true;
    const types = buildClinicalAlerts(ind).map((a) => a.type);
    expect(types).toEqual(["wound", "fall_risk", "respiratory"]);
  });
});
