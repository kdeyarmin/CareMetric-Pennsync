import { describe, it, expect } from "vitest";
import { severityBadgeClass, severitySolidClass } from "./severityStyles.js";

describe("severityBadgeClass", () => {
  it("maps the four known levels to light badge classes", () => {
    expect(severityBadgeClass("critical")).toBe("bg-red-100 text-red-800 border-red-300");
    expect(severityBadgeClass("high")).toBe("bg-orange-100 text-orange-800 border-orange-300");
    expect(severityBadgeClass("medium")).toBe("bg-yellow-100 text-yellow-800 border-yellow-300");
    expect(severityBadgeClass("low")).toBe("bg-blue-100 text-blue-800 border-blue-300");
  });
  it("falls back to neutral slate for unknown levels", () => {
    expect(severityBadgeClass("info")).toBe("bg-slate-100 text-slate-800 border-slate-300");
    expect(severityBadgeClass(undefined)).toBe("bg-slate-100 text-slate-800 border-slate-300");
  });
});

describe("severitySolidClass", () => {
  it("maps the four known levels to solid pill classes", () => {
    expect(severitySolidClass("critical")).toBe("bg-red-600 text-white");
    expect(severitySolidClass("high")).toBe("bg-orange-500 text-white");
    expect(severitySolidClass("medium")).toBe("bg-yellow-500 text-white");
    expect(severitySolidClass("low")).toBe("bg-blue-500 text-white");
  });
  it("falls back to neutral slate for unknown levels", () => {
    expect(severitySolidClass("whatever")).toBe("bg-slate-500 text-white");
  });
});
