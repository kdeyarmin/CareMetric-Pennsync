import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/testUtils";
import PlaceholderAlert from "./PlaceholderAlert";

const TEMPLATE = [
  "• Homebound status: unable to leave home without considerable effort due to [diagnosis]",
  "• Vital signs: BP _/_, HR _, O2 _% on RA",
].join("\n");

describe("PlaceholderAlert — the template-blank trap, made visible", () => {
  it("stays out of the way when the draft has no blanks", () => {
    const { container } = renderWithProviders(
      <PlaceholderAlert note="Patient homebound due to severe dyspnea. Wound care performed." />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("counts a single blank in the singular", () => {
    renderWithProviders(<PlaceholderAlert note="Homebound due to [diagnosis]." />);
    expect(screen.getByText(/^1 unfilled blank left from a template$/)).toBeInTheDocument();
  });

  it("counts every blank, not just the lines they sit on", () => {
    // Two display lines, but five actual placeholders — the count must be the real one.
    renderWithProviders(<PlaceholderAlert note={TEMPLATE} />);
    expect(screen.getByText(/^5 unfilled blanks left from a template$/)).toBeInTheDocument();
  });

  it("says review is blocked, so the hard block is no longer a surprise", () => {
    renderWithProviders(<PlaceholderAlert note={TEMPLATE} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/can't go to review until they're gone/i);
  });

  it("names the lines that need filling in", () => {
    renderWithProviders(<PlaceholderAlert note={TEMPLATE} />);
    expect(screen.getByText(/Homebound status:/)).toBeInTheDocument();
    expect(screen.getByText("[diagnosis]")).toBeInTheDocument();
    expect(screen.getByText(/Vital signs:/)).toBeInTheDocument();
  });

  it("offers to walk the nurse to the next blank", async () => {
    const onJump = vi.fn();
    renderWithProviders(<PlaceholderAlert note={TEMPLATE} onJump={onJump} />);
    await userEvent.click(screen.getByRole("button", { name: /fill next blank/i }));
    expect(onJump).toHaveBeenCalledTimes(1);
  });

  it("omits the jump button when no handler is wired", () => {
    renderWithProviders(<PlaceholderAlert note={TEMPLATE} />);
    expect(screen.queryByRole("button", { name: /fill next blank/i })).not.toBeInTheDocument();
  });
});
