import { describe, it, expect } from "vitest";
import { formatTime } from "./formatTime.js";

describe("formatTime", () => {
  it("zero-pads the seconds component", () => {
    expect(formatTime(75)).toBe("1:15");
    expect(formatTime(5)).toBe("0:05");
    expect(formatTime(0)).toBe("0:00");
  });
  it("handles exact minutes and multi-digit minutes", () => {
    expect(formatTime(60)).toBe("1:00");
    expect(formatTime(600)).toBe("10:00");
    expect(formatTime(3599)).toBe("59:59");
  });
});
