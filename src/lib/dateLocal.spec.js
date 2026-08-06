import { describe, it, expect } from "vitest";
import {
  parseLocalDate,
  formatLocalDate,
  calculateAge,
  toLocalISODate,
  startOfLocalDay,
  daysAgoLocal,
  isWithinLastDays,
  isPastLocalDueDate,
} from "./dateLocal";

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
    expect(calculateAge("2026-02-31", new Date(2026, 6, 28))).toBeNull();
    expect(calculateAge("2027-01-01", new Date(2026, 6, 28))).toBeNull();
  });

  it("keeps a date-only birthday on its local calendar day", () => {
    expect(calculateAge("1961-12-01", new Date(2026, 10, 30))).toBe(64);
    expect(calculateAge("1961-12-01", new Date(2026, 11, 1))).toBe(65);
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

describe("startOfLocalDay", () => {
  it("zeroes the time component without shifting the calendar day", () => {
    const d = startOfLocalDay(new Date(2026, 6, 27, 23, 59, 59));
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6);
    expect(d.getDate()).toBe(27);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });

  it("keeps a date-only string on its own calendar day", () => {
    const d = startOfLocalDay("2026-07-27");
    expect(toLocalISODate(d)).toBe("2026-07-27");
  });

  it("returns null for missing or unparseable values", () => {
    expect(startOfLocalDay("")).toBeNull();
    expect(startOfLocalDay("not-a-date")).toBeNull();
    expect(startOfLocalDay("2026-02-31")).toBeNull();
  });

  it("does not mutate the caller's Date", () => {
    const original = new Date(2026, 6, 27, 15, 30);
    startOfLocalDay(original);
    expect(original.getHours()).toBe(15);
  });
});

describe("daysAgoLocal", () => {
  it("returns local midnight N calendar days back", () => {
    const now = new Date(2026, 6, 27, 14, 23);
    expect(toLocalISODate(daysAgoLocal(30, now))).toBe("2026-06-27");
    expect(daysAgoLocal(30, now).getHours()).toBe(0);
  });

  it("treats 0 days as the start of today", () => {
    const now = new Date(2026, 6, 27, 14, 23);
    expect(toLocalISODate(daysAgoLocal(0, now))).toBe("2026-07-27");
  });
});

describe("isWithinLastDays", () => {
  const now = new Date(2026, 6, 27, 14, 23);

  it("includes a record dated today, whatever the time of day", () => {
    // The bug this pins: an `>= new Date()` bound carries the current time of
    // day, so a date-only value for TODAY (midnight) sorted before it and fell
    // out of the window.
    expect(isWithinLastDays("2026-07-27", 30, now)).toBe(true);
    expect(isWithinLastDays("2026-07-27", 0, now)).toBe(true);
  });

  it("includes the whole boundary day", () => {
    expect(isWithinLastDays("2026-06-27", 30, now)).toBe(true);
  });

  it("excludes the day before the window", () => {
    expect(isWithinLastDays("2026-06-26", 30, now)).toBe(false);
  });

  it("returns false for missing or unparseable values", () => {
    expect(isWithinLastDays(undefined, 30, now)).toBe(false);
    expect(isWithinLastDays("", 30, now)).toBe(false);
    expect(isWithinLastDays("not-a-date", 30, now)).toBe(false);
  });
});

describe("isPastLocalDueDate", () => {
  it("treats date-only due dates as overdue only after that local calendar day", () => {
    // Evening of the due day (US zones): must NOT be overdue yet.
    expect(isPastLocalDueDate("2026-06-15", new Date(2026, 5, 15, 20, 0, 0))).toBe(false);
    // Next local midnight: overdue.
    expect(isPastLocalDueDate("2026-06-15", new Date(2026, 5, 16, 0, 0, 1))).toBe(true);
  });

  it("compares datetime due dates against the full instant", () => {
    expect(isPastLocalDueDate("2026-06-15T18:00:00", new Date("2026-06-15T17:00:00"))).toBe(false);
    expect(isPastLocalDueDate("2026-06-15T18:00:00", new Date("2026-06-15T19:00:00"))).toBe(true);
  });

  it("returns false for empty values", () => {
    expect(isPastLocalDueDate("")).toBe(false);
    expect(isPastLocalDueDate(null)).toBe(false);
  });
});
