import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";
import StickyActionBar from "./StickyActionBar";

describe("StickyActionBar — the always-reachable primary action", () => {
  it("renders its action and its status text", () => {
    renderWithProviders(
      <StickyActionBar status="12 more characters needed">
        <button type="button">Review &amp; Complete</button>
      </StickyActionBar>,
    );
    expect(screen.getByRole("button", { name: /review & complete/i })).toBeInTheDocument();
    expect(screen.getByText("12 more characters needed")).toBeInTheDocument();
  });

  it("announces status changes without the region itself coming and going", () => {
    // Plain render: rerender must update the SAME instance, not remount it —
    // a remounted live region would not announce.
    const { container, rerender } = render(
      <StickyActionBar status={null}><button type="button">Go</button></StickyActionBar>,
    );
    const live = container.querySelector("[aria-live='polite']");
    expect(live).toBeInTheDocument();

    rerender(<StickyActionBar status="Ready to review"><button type="button">Go</button></StickyActionBar>);
    expect(container.querySelector("[aria-live='polite']")).toHaveTextContent("Ready to review");
  });

  it("pins itself clear of the mobile bottom nav", () => {
    const { container } = renderWithProviders(
      <StickyActionBar><button type="button">Go</button></StickyActionBar>,
    );
    const bar = container.firstChild;
    // Sticky only works because the shell stopped being a scroll container on
    // mobile (.overflow-x-clip-safe in index.css); without that this is inert.
    expect(bar.className).toContain("sticky");
    // Must clear MobileBottomNav (fixed, h-16) plus the iOS safe area below md.
    expect(bar.className).toContain("bottom-[calc(4rem+env(safe-area-inset-bottom)+0.5rem)]");
    expect(bar.className).toContain("md:bottom-4");
  });
});
