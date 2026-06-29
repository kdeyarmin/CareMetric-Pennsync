import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";
import { AlertTriangle } from "lucide-react";
import CollapsibleResultHeader from "./CollapsibleResultHeader";

function renderHeader(props = {}) {
  return renderWithProviders(
    <CollapsibleResultHeader
      name="mismatches"
      icon={AlertTriangle}
      color="navy"
      title="🔍 OASIS vs Narrative Mismatches"
      count={3}
      subtitle="Uploaded OASIS scores don't match clinical documentation"
      isExpanded={false}
      onToggle={vi.fn()}
      {...props}
    />,
  );
}

describe("CollapsibleResultHeader", () => {
  it("renders the title with its count and the subtitle", () => {
    renderHeader();
    expect(screen.getByText(/🔍 OASIS vs Narrative Mismatches \(3\)/)).toBeInTheDocument();
    expect(
      screen.getByText("Uploaded OASIS scores don't match clinical documentation"),
    ).toBeInTheDocument();
  });

  it("calls onToggle with the category name when the bar is clicked", () => {
    const onToggle = vi.fn();
    renderHeader({ onToggle });
    fireEvent.click(screen.getByText(/OASIS vs Narrative Mismatches/));
    expect(onToggle).toHaveBeenCalledWith("mismatches");
  });

  it("applies the color palette's classes (verified for two colors)", () => {
    const { container, unmount } = renderHeader({ color: "navy" });
    expect(container.querySelector(".bg-navy-50")).not.toBeNull();
    unmount();
    const { container: c2 } = renderHeader({ color: "green" });
    expect(c2.querySelector(".bg-green-50")).not.toBeNull();
  });

  it("falls back to the navy palette for an unknown color", () => {
    const { container } = renderHeader({ color: "chartreuse" });
    expect(container.querySelector(".bg-navy-50")).not.toBeNull();
  });
});
