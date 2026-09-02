import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/testUtils";
import CollapsibleSection, { openOnDesktop } from "./CollapsibleSection";

describe("CollapsibleSection — Step 1 supporting sections", () => {
  it("shows its content when open and hides it when collapsed", async () => {
    renderWithProviders(
      <CollapsibleSection title="Vital Signs" defaultOpen>
        <p>Blood pressure</p>
      </CollapsibleSection>,
    );
    expect(screen.getByText("Blood pressure")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /vital signs/i }));
    expect(screen.queryByText("Blood pressure")).not.toBeInTheDocument();
  });

  it("starts collapsed when asked, and opens on click", async () => {
    renderWithProviders(
      <CollapsibleSection title="Medicare compliance checks" defaultOpen={false}>
        <p>Homebound status</p>
      </CollapsibleSection>,
    );
    expect(screen.queryByText("Homebound status")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /medicare compliance checks/i }));
    expect(screen.getByText("Homebound status")).toBeInTheDocument();
  });

  it("keeps the section's status visible while collapsed, so nothing hides silently", () => {
    renderWithProviders(
      <CollapsibleSection title="Vital Signs" badge="2 of 7 recorded" summary="BP not recorded" defaultOpen={false}>
        <p>hidden</p>
      </CollapsibleSection>,
    );
    const trigger = screen.getByRole("button", { name: /vital signs/i });
    expect(trigger).toHaveTextContent(/2 of 7 recorded/);
    expect(trigger).toHaveTextContent(/BP not recorded/);
  });
});

describe("openOnDesktop", () => {
  const original = window.matchMedia;
  afterEach(() => { window.matchMedia = original; });

  it("expands where there is room", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    expect(openOnDesktop()).toBe(true);
  });

  it("collapses on a phone, so the editor is not pushed off screen", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    expect(openOnDesktop()).toBe(false);
  });

  it("defaults to expanded where matchMedia is unavailable", () => {
    window.matchMedia = undefined;
    expect(openOnDesktop()).toBe(true);
  });
});

describe("CollapsibleSection — defaults that depend on late-arriving data", () => {
  it("opens when its default flips true after the data loads", () => {
    const { rerender } = render(
      <CollapsibleSection title="Facility requirements" defaultOpen={false}>
        <p>Document SpO2 every visit</p>
      </CollapsibleSection>,
    );
    expect(screen.queryByText(/document spo2/i)).not.toBeInTheDocument();

    rerender(
      <CollapsibleSection title="Facility requirements" defaultOpen>
        <p>Document SpO2 every visit</p>
      </CollapsibleSection>,
    );
    expect(screen.getByText(/document spo2/i)).toBeInTheDocument();
  });

  it("respects a section the nurse collapsed by hand", async () => {
    const { rerender } = render(
      <CollapsibleSection title="Facility requirements" defaultOpen>
        <p>Document SpO2 every visit</p>
      </CollapsibleSection>,
    );
    await userEvent.click(screen.getByRole("button", { name: /facility requirements/i }));
    expect(screen.queryByText(/document spo2/i)).not.toBeInTheDocument();

    // A re-render with the same (still true) default must not undo that.
    rerender(
      <CollapsibleSection title="Facility requirements" defaultOpen>
        <p>Document SpO2 every visit</p>
      </CollapsibleSection>,
    );
    expect(screen.queryByText(/document spo2/i)).not.toBeInTheDocument();
  });
});
