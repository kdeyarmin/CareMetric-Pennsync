import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { downloadCsv } from "./downloadCsv.js";

describe("downloadCsv", () => {
  let clickSpy;
  let created;

  beforeEach(() => {
    created = [];
    clickSpy = vi.fn();
    // jsdom lacks URL.createObjectURL / revokeObjectURL
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag) => {
      const el = realCreate(tag);
      if (tag === "a") {
        el.click = clickSpy;
        created.push(el);
      }
      return el;
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("builds a text/csv blob, sets the filename, and triggers a click", () => {
    downloadCsv("report.csv", "a,b\n1,2");
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const blob = URL.createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe("text/csv;charset=utf-8;");
    expect(created[0].download).toBe("report.csv");
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock");
  });

  it("swallows errors instead of throwing out of a click handler", () => {
    URL.createObjectURL = vi.fn(() => {
      throw new Error("blocked");
    });
    expect(() => downloadCsv("x.csv", "a")).not.toThrow();
  });
});
