import { describe, it, expect } from "vitest";
import { safePercent } from "./safePercent.js";

describe("safePercent", () => {
  it("computes a rounded percentage for normal inputs", () => {
    expect(safePercent(1, 2)).toBe(50);
    expect(safePercent(1, 3)).toBe(33);
    expect(safePercent(2, 3)).toBe(67);
    expect(safePercent(5, 5)).toBe(100);
    expect(safePercent(0, 5)).toBe(0);
  });

  it("returns 0 instead of NaN when the denominator is zero or missing", () => {
    expect(safePercent(0, 0)).toBe(0);
    expect(safePercent(3, 0)).toBe(0);
    expect(safePercent(1, undefined)).toBe(0);
    expect(safePercent(1, null)).toBe(0);
    expect(safePercent(1, NaN)).toBe(0);
  });

  it("returns 0 for negative denominators and non-finite numerators", () => {
    expect(safePercent(1, -4)).toBe(0);
    expect(safePercent(NaN, 4)).toBe(0);
    expect(safePercent(Infinity, 4)).toBe(0);
  });

  it("can return a raw (unrounded) value when round is false", () => {
    expect(safePercent(1, 3, { round: false })).toBeCloseTo(33.333, 2);
    expect(safePercent(1, 0, { round: false })).toBe(0);
  });

  it("never yields NaN or Infinity across edge cases", () => {
    for (const [n, d] of [[0, 0], [1, 0], [5, 0], [NaN, NaN], [1, -1]]) {
      const result = safePercent(n, d);
      expect(Number.isFinite(result)).toBe(true);
    }
  });
});
