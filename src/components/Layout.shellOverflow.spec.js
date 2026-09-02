import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Guards the shell against silently disabling `position: sticky`.
 *
 * `overflow-x: hidden` on one axis computes the OTHER axis to `overflow-y: auto`,
 * which makes that element a scroll container — and therefore the sticky
 * positioning ancestor for everything inside it. Both shell elements are
 * auto-height below `md` (`min-h-screen`), so such a container never actually
 * scrolls and every `position: sticky` descendant silently stops pinning.
 *
 * This is invisible to unit tests (jsdom computes no layout) and invisible on
 * desktop (at `md` and up <main> has a real `h-screen overflow-y-auto`, so it
 * scrolls and sticky works). It reached production once and was reintroduced
 * mid-fix by patching only one of the two elements. Hence a source-level guard.
 *
 * `overflow-x: clip` clips identically without creating a scroll container.
 */
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("app shell — must not become a sticky-breaking scroll container", () => {
  const layout = read("./Layout.jsx");

  // The two shell elements wrapping every page: the flex wrapper and <main>.
  const shellLines = layout
    .split("\n")
    .filter((l) => /className=/.test(l) && /min-h-screen/.test(l) && /flex-1|flex w-full/.test(l));

  it("finds both shell elements, so this guard cannot silently match nothing", () => {
    expect(shellLines).toHaveLength(2);
  });

  it("clips horizontal overflow without creating a scroll container", () => {
    for (const line of shellLines) {
      expect(line).toContain("overflow-x-clip-safe");
      expect(line).not.toMatch(/overflow-x-hidden/);
    }
  });

  it("keeps the mobile stylesheet rule on clip too", () => {
    // An unlayered `main, .main-content` rule beats @layer components, so this
    // one overrides the class above on phones if it regresses to `hidden`.
    const css = read("../index.css");
    const rule = css.match(/main,\s*\.main-content\s*\{[^}]*\}/);
    expect(rule, "the mobile main/.main-content rule").not.toBeNull();
    expect(rule[0]).toContain("overflow-x: clip");
    expect(rule[0]).not.toMatch(/overflow-x:\s*hidden/);
  });

  it("defines the clip-safe utility it depends on", () => {
    expect(read("../index.css")).toMatch(/\.overflow-x-clip-safe\s*\{\s*overflow-x:\s*clip/);
  });
});
