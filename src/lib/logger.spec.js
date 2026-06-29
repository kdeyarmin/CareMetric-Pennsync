import { describe, it, expect, vi, afterEach } from "vitest";
import { logger, setErrorReporter } from "./logger.js";

afterEach(() => {
  setErrorReporter(null);
  vi.restoreAllMocks();
});

describe("logger", () => {
  it("forwards error() and warn() to the console", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    logger.error("boom", { id: 1 });
    logger.warn("careful");

    expect(errSpy).toHaveBeenCalledWith("boom", { id: 1 });
    expect(warnSpy).toHaveBeenCalledWith("careful");
  });

  it("invokes a registered error reporter for error() and warn()", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const reporter = vi.fn();
    setErrorReporter(reporter);

    logger.error("boom", 42);
    logger.warn("hmm");

    expect(reporter).toHaveBeenCalledTimes(2);
    expect(reporter).toHaveBeenNthCalledWith(1, "error", ["boom", 42]);
    expect(reporter).toHaveBeenNthCalledWith(2, "warn", ["hmm"]);
  });

  it("does not call a reporter for debug/info", () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    const reporter = vi.fn();
    setErrorReporter(reporter);

    logger.debug("trace");
    logger.info("note");

    expect(reporter).not.toHaveBeenCalled();
  });

  it("swallows a throwing reporter so the caller is unaffected", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setErrorReporter(() => {
      throw new Error("sink down");
    });

    expect(() => logger.error("still works")).not.toThrow();
  });

  it("setErrorReporter(null) clears the seam", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reporter = vi.fn();
    setErrorReporter(reporter);
    setErrorReporter(null);

    logger.error("no sink");

    expect(reporter).not.toHaveBeenCalled();
  });
});
