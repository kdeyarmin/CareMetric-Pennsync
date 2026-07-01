import { describe, it, expect } from "vitest";
import { isValidElement } from "react";
import { getAlertIcon, getSeverityColor } from "./alertPresentation.jsx";

describe("getSeverityColor", () => {
  it("maps known severities", () => {
    expect(getSeverityColor("critical")).toBe("bg-red-600 text-white");
    expect(getSeverityColor("high")).toBe("bg-orange-500 text-white");
    expect(getSeverityColor("medium")).toBe("bg-yellow-500 text-white");
    expect(getSeverityColor("low")).toBe("bg-blue-500 text-white");
  });
  it("falls back to slate for unknown severities", () => {
    expect(getSeverityColor("whatever")).toBe("bg-slate-500 text-white");
    expect(getSeverityColor(undefined)).toBe("bg-slate-500 text-white");
  });
});

describe("getAlertIcon", () => {
  it("returns a React element for a known type and for an unknown fallback", () => {
    expect(isValidElement(getAlertIcon("fall_risk"))).toBe(true);
    expect(isValidElement(getAlertIcon("not_a_type"))).toBe(true);
  });
});
