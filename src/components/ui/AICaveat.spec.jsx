import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AICaveat from "./AICaveat";

describe("AICaveat", () => {
  it("renders the default verify-before-clinical-use label", () => {
    render(<AICaveat />);
    expect(screen.getByText(/AI-generated — verify before clinical use/i)).toBeInTheDocument();
  });

  it("appends a generated timestamp when given a valid date", () => {
    render(<AICaveat generatedAt={new Date("2026-03-01T12:00:00Z")} />);
    // "generated <n>" (the timestamp) — distinct from the "AI-generated" label.
    expect(screen.getByText(/generated \d/i)).toBeInTheDocument();
  });

  it("omits the timestamp when generatedAt is missing or invalid", () => {
    const { rerender } = render(<AICaveat />);
    expect(screen.queryByText(/generated \d/i)).not.toBeInTheDocument();
    rerender(<AICaveat generatedAt="not-a-date" />);
    expect(screen.queryByText(/generated \d/i)).not.toBeInTheDocument();
  });

  it("supports a custom label", () => {
    render(<AICaveat label="Draft only" />);
    expect(screen.getByText("Draft only")).toBeInTheDocument();
  });
});
