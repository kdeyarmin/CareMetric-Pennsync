import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { downloadCsv } from "./downloadCsv.js";

describe("downloadCsv", () => {
  let clickSpy;
  let created;
  // jsdom lacks URL.createObjectURL / revokeObjectURL; save whatever was there
  // (usually undefined) so we can restore it and not leak stubs into other tests.
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    created = [];
    clickSpy = vi.fn();
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

  afterEach(() => {
    vi.restoreAllMocks();
    // vi.restoreAllMocks only reverts vi.spyOn mocks, not the direct global
    // assignments above — restore those explicitly so the suite stays order-independent.
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it("builds a text/csv blob, sets the filename, triggers a click, and returns true", () => {
    const ok = downloadCsv("report.csv", "a,b\n1,2");
    expect(ok).toBe(true);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const blob = URL.createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe("text/csv;charset=utf-8;");
    expect(created[0].download).toBe("report.csv");
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock");
  });

  it("on failure: does not throw, returns false, and calls onError", () => {
    const boom = new Error("blocked");
    URL.createObjectURL = vi.fn(() => {
      throw boom;
    });
    const onError = vi.fn();
    let result;
    expect(() => {
      result = downloadCsv("x.csv", "a", { onError });
    }).not.toThrow();
    expect(result).toBe(false);
    expect(onError).toHaveBeenCalledWith(boom);
  });

  it("failure without an onError callback still does not throw", () => {
    URL.createObjectURL = vi.fn(() => {
      throw new Error("blocked");
    });
    expect(() => downloadCsv("x.csv", "a")).not.toThrow();
  });
});
