import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";
import IncompleteAssessmentsResults from "./IncompleteAssessmentsResults";

const ITEMS = [
  {
    oasis_item: "M1840 Toileting",
    current_documentation: "patient toilets",
    issue: "Lacks level of assistance",
    guidance: "Document specific assist level",
    example: "Requires moderate assist to toilet",
  },
];

describe("IncompleteAssessmentsResults", () => {
  it("renders the item with current documentation, issue, guidance, and example", () => {
    renderWithProviders(<IncompleteAssessmentsResults items={ITEMS} />);
    expect(screen.getByText("M1840 Toileting")).toBeInTheDocument();
    expect(screen.getByText(/patient toilets/)).toBeInTheDocument();
    expect(screen.getByText(/Lacks level of assistance/)).toBeInTheDocument();
    expect(screen.getByText(/Document specific assist level/)).toBeInTheDocument();
    expect(screen.getByText(/Requires moderate assist to toilet/)).toBeInTheDocument();
  });

  it("renders nothing when there are no items", () => {
    const { container } = renderWithProviders(<IncompleteAssessmentsResults items={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
