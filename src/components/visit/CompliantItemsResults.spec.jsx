import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";
import CompliantItemsResults from "./CompliantItemsResults";

const ITEMS = [
  { oasis_item: "M1800 Grooming", category: "Functional", evidence: "grooms independently" },
  { oasis_item: "M2020 Oral Meds", category: "Medication" }, // no evidence
];

describe("CompliantItemsResults", () => {
  it("renders each compliant item with its category and optional evidence", () => {
    renderWithProviders(<CompliantItemsResults items={ITEMS} />);
    expect(screen.getByText("M1800 Grooming")).toBeInTheDocument();
    expect(screen.getByText("Functional")).toBeInTheDocument();
    expect(screen.getByText(/grooms independently/)).toBeInTheDocument();
    expect(screen.getByText("M2020 Oral Meds")).toBeInTheDocument();
    expect(screen.getByText("Medication")).toBeInTheDocument();
  });

  it("renders nothing when there are no items", () => {
    const { container } = renderWithProviders(<CompliantItemsResults items={null} />);
    expect(container.firstChild).toBeNull();
  });
});
