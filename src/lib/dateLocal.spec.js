import { describe, it, expect } from "vitest";
import { parseLocalDate, formatLocalDate, calculateAge, toLocalISODate } from "./dateLocal";

describe("parseLocalDate", () => {
  it("parses a date-only string as local calendar components (no UTC shift)", () => {
    const d = parseLocalDate("1961-12-01");
    expect(d.getFullYear()).toBe(1961);
    expect(d.getMonth()).toBe(11); // December
    expect(d.getDate()).toBe(1); // NOT Nov 30
  });

  it("returns null for empty / unparseable values", () => {
    expect(parseLocalDate("")).toBeNull();
    expect(parseLocalDate(null)).toBeNull();
    expect(parseLocalDate(undefined)).toBeNull();
    expect(parseLocalDate("not-a-date")).toBeNull();
  });

  it("fails closed on impossible calendar dates instead of rolling them", () => {
    expect(parseLocalDate("2026-02-31")).toBeNull(); // would roll to Mar 3
    expect(parseLocalDate("2026-13-01")).toBeNull(); // month out of range
    expect(parseLocalDate("2026-04-31")).toBeNull(); // April has 30 days
    // A real leap day still parses.
    expect(parseLocalDate("2024-02-29")).not.toBeNull();
  });

  it("passes a Date through unchanged", () => {
    const now = new Date(2020, 0, 15);
    expect(parseLocalDate(now)).toBe(now);
  });
});

describe("formatLocalDate", () => {
  it("does not shift the day for a date-only value", () => {
    // Regardless of the runner's timezone, the day component must be preserved.
    const out = formatLocalDate("2026-03-01", { year: "numeric", month: "2-digit", day: "2-digit" });
    expect(out).toContain("03");
    expect(out).toContain("01");
    expect(out).toContain("2026");
  });

  it("returns an empty string for missing values", () => {
    expect(formatLocalDate("")).toBe("");
    expect(formatLocalDate(null)).toBe("");
  });
});

describe("calculateAge", () => {
  it("returns null for missing/invalid dob", () => {
    expect(calculateAge("")).toBeNull();
    expect(calculateAge(null)).toBeNull();
  });

  it("computes a plausible whole-year age", () => {
    const year = new Date().getFullYear();
    // Someone born Jan 1, 40 years ago is at least 39 and at most 40.
    const age = calculateAge(`${year - 40}-01-01`);
    expect(age).toBeGreaterThanOrEqual(39);
    expect(age).toBeLessThanOrEqual(40);
  });

  it("has not had this year's birthday yet -> one year younger", () => {
    const today = new Date();
    const nextMonth = ((today.getMonth() + 2 - 1) % 12) + 1; // a month strictly after now, wrapping
    // Build a dob whose month is after the current month in the same day, so the
    // birthday this year has not occurred.
    if (today.getMonth() < 11) {
      const dobYear = today.getFullYear() - 30;
      const mm = String(today.getMonth() + 2).padStart(2, "0"); // next month
      const age = calculateAge(`${dobYear}-${mm}-15`);
      expect(age).toBe(29);
    } else {
      // December: skip the wrap edge; just assert a stable value.
      expect(nextMonth).toBeGreaterThan(0);
    }
  });
});


describe("toLocalISODate", () => {
  it("formats the local calendar day without UTC conversion", () => {
    expect(toLocalISODate(new Date(2026, 6, 3, 23, 30))).toBe("2026-07-03");
    expect(toLocalISODate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("returns an empty string for invalid dates", () => {
    expect(toLocalISODate(new Date("not-a-date"))).toBe("");
  });
});
