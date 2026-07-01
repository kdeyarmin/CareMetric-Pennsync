import { describe, it, expect } from "vitest";
import { escapeHtml } from "./escapeHtml.js";

describe("escapeHtml", () => {
  it("escapes all five HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x" data-y='z'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; data-y=&#39;z&#39;&gt;&amp;&lt;/a&gt;"
    );
  });

  it("escapes ampersands before other entities (no double-escaping)", () => {
    expect(escapeHtml("a & b < c")).toBe("a &amp; b &lt; c");
  });

  it("coerces null/undefined to an empty string", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });

  it("coerces non-string values via String()", () => {
    expect(escapeHtml(42)).toBe("42");
  });

  it("leaves safe text unchanged", () => {
    expect(escapeHtml("Plain text 123")).toBe("Plain text 123");
  });
});
