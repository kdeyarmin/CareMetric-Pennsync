import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";
import AuditDefenseSummary from "./AuditDefenseSummary";

const SUMMARY = {
  strongest_documentation: ["Wound measurements fully staged"],
  weakest_documentation: ["Vague bathing assist level"],
  recommended_priority_fixes: ["Document specific bathing assistance"],
};

describe("AuditDefenseSummary", () => {
  it("renders the heading and representative fields", () => {
    renderWithProviders(<AuditDefenseSummary summary={SUMMARY} />);
    expect(screen.getByText("Audit Defense Summary")).toBeInTheDocument();
    expect(screen.getByText(/Wound measurements fully staged/)).toBeInTheDocument();
    expect(screen.getByText("High-Risk Audit Scenarios")).toBeInTheDocument();
    expect(screen.getByText("Pre-Audit Checklist")).toBeInTheDocument();
    // Appears in both the Priority Fixes list and the checklist.
    expect(screen.getAllByText("Document specific bathing assistance").length).toBeGreaterThan(0);
  });

  it("calls onQuickFix with the fix and the related issue's improved language", () => {
    const onQuickFix = vi.fn();
    renderWithProviders(
      <AuditDefenseSummary
        summary={SUMMARY}
        criticalMissing={[{ example: "Requires moderate assist for bathing" }]}
        onQuickFix={onQuickFix}
        onCopy={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Apply Fix/ }));
    expect(onQuickFix).toHaveBeenCalledWith(
      "Document specific bathing assistance",
      "Requires moderate assist for bathing",
    );
  });

  it("does not call onQuickFix when there is no related issue", () => {
    const onQuickFix = vi.fn();
    renderWithProviders(
      <AuditDefenseSummary summary={SUMMARY} onQuickFix={onQuickFix} onCopy={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Apply Fix/ }));
    expect(onQuickFix).not.toHaveBeenCalled();
  });

  it("calls onCopy with the fix and a checklist key when copying", () => {
    const onCopy = vi.fn();
    renderWithProviders(
      <AuditDefenseSummary summary={SUMMARY} onQuickFix={vi.fn()} onCopy={onCopy} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy checklist item" }));
    expect(onCopy).toHaveBeenCalledWith("Document specific bathing assistance", "checklist-0");
  });

  it("renders nothing when there is no summary", () => {
    const { container } = renderWithProviders(<AuditDefenseSummary summary={null} />);
    expect(container.firstChild).toBeNull();
  });
});
