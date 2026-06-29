import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";
import VagueDocumentationResults from "./VagueDocumentationResults";

const ITEM = {
  oasis_item: "M1840 Toileting",
  current_language: "patient needs some help",
  problem: "Not specific about assist level",
  cms_requirement: "Document discrete assist level",
  improved_language: "Requires moderate assist for toilet transfers",
};

describe("VagueDocumentationResults", () => {
  it("renders the vague-language fields", () => {
    renderWithProviders(<VagueDocumentationResults items={[ITEM]} onQuickFix={vi.fn()} />);
    expect(screen.getByText("M1840 Toileting")).toBeInTheDocument();
    expect(screen.getByText(/patient needs some help/)).toBeInTheDocument();
    expect(screen.getByText("Not specific about assist level")).toBeInTheDocument();
    expect(screen.getByText(/Requires moderate assist for toilet transfers/)).toBeInTheDocument();
  });

  it("calls onQuickFix with the requirement and improved language", () => {
    const onQuickFix = vi.fn();
    renderWithProviders(<VagueDocumentationResults items={[ITEM]} onQuickFix={onQuickFix} />);
    fireEvent.click(screen.getByRole("button", { name: /Insert Improved Language/ }));
    expect(onQuickFix).toHaveBeenCalledWith(
      "Document discrete assist level",
      "Requires moderate assist for toilet transfers",
    );
  });

  it("falls back to the problem text when there is no cms_requirement", () => {
    const onQuickFix = vi.fn();
    renderWithProviders(
      <VagueDocumentationResults items={[{ ...ITEM, cms_requirement: undefined }]} onQuickFix={onQuickFix} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Insert Improved Language/ }));
    expect(onQuickFix).toHaveBeenCalledWith(
      "Not specific about assist level",
      "Requires moderate assist for toilet transfers",
    );
  });

  it("renders nothing when there are no items", () => {
    const { container } = renderWithProviders(<VagueDocumentationResults items={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
