import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";
import FunctionalPhrasesPanel from "./FunctionalPhrasesPanel";

const FUNCTIONAL = {
  bathing: {
    allPhrases: ["Patient needs moderate assist with bathing.", "Uses a shower chair."],
    assistLevel: ["moderate assist"],
  },
  dressing: { allPhrases: [] },
  ambulation: { allPhrases: ["Ambulates 50 feet with a walker."] },
  transfer: { allPhrases: [] },
  toileting: { allPhrases: [] },
  grooming: { allPhrases: [] },
  eating: { allPhrases: [] },
  medications: { allPhrases: [] },
};

describe("FunctionalPhrasesPanel — compact", () => {
  it("renders the six core ADL tiles with phrase counts", () => {
    renderWithProviders(<FunctionalPhrasesPanel functional={FUNCTIONAL} variant="compact" />);
    for (const label of ["Bathing", "Dressing", "Ambulation", "Transfers", "Toileting", "Grooming"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("2 phrases")).toBeInTheDocument(); // bathing
    expect(screen.getByText("1 phrases")).toBeInTheDocument(); // ambulation
  });
});

describe("FunctionalPhrasesPanel — expanded", () => {
  it("renders eight domains with OASIS item codes, sample phrases, and assist levels", () => {
    renderWithProviders(<FunctionalPhrasesPanel functional={FUNCTIONAL} variant="expanded" />);
    expect(screen.getByText("ADL/IADL Functional Phrases")).toBeInTheDocument();
    expect(screen.getByText("Bathing (M1830)")).toBeInTheDocument();
    expect(screen.getByText("Medications (M2020)")).toBeInTheDocument();
    // OASIS item-code chips
    expect(screen.getByText("M1830")).toBeInTheDocument();
    expect(screen.getByText("GG0130E")).toBeInTheDocument();
    expect(screen.getByText("GG0170")).toBeInTheDocument();
    // sample phrase + assist level from the bathing domain
    expect(screen.getByText(/Patient needs moderate assist with bathing/)).toBeInTheDocument();
    expect(screen.getByText("Assist Levels Found:")).toBeInTheDocument();
    expect(screen.getByText("moderate assist")).toBeInTheDocument(); // the assist-level badge
  });
});

describe("FunctionalPhrasesPanel — guards", () => {
  it("renders nothing without functional data", () => {
    const { container } = renderWithProviders(<FunctionalPhrasesPanel functional={null} />);
    expect(container.firstChild).toBeNull();
  });
});
