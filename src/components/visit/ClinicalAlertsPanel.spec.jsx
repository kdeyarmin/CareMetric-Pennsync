import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";
import ClinicalAlertsPanel from "./ClinicalAlertsPanel";

// Shape mirrors buildClinicalAlerts() output (see oasisScrubberData.jsx).
const ALERTS = [
  {
    type: "wound",
    severity: "high",
    title: "Wound Care Best Practices",
    guideline: "Document weekly measurements and staging.",
    cmsReference: "M1306-M1342 Integumentary Status",
    actions: ["Measure wound weekly", "Document staging", "Assess infection", "Review pressure"],
    revenueNote: "Supports MMTA-03 clinical group.",
  },
  {
    type: "cognitive",
    severity: "medium",
    title: "Cognitive Assessment Requirements",
    guideline: "Administer BIMS or CAM at SOC/ROC.",
    cmsReference: "M1700-M1740 Cognitive Status",
    actions: ["Perform BIMS screening"],
    // no revenueNote
  },
];

describe("ClinicalAlertsPanel", () => {
  it("renders nothing when there are no alerts", () => {
    const { container } = renderWithProviders(<ClinicalAlertsPanel alerts={[]} />);
    expect(container.firstChild).toBeNull();
    const { container: c2 } = renderWithProviders(<ClinicalAlertsPanel />);
    expect(c2.firstChild).toBeNull();
  });

  it("compact variant shows titles, count, guideline, CMS ref, revenue note, and caps actions at 3", () => {
    renderWithProviders(<ClinicalAlertsPanel alerts={ALERTS} variant="compact" />);
    expect(screen.getByText("Clinical Decision Support")).toBeInTheDocument();
    expect(screen.getByText(/2 active alerts/)).toBeInTheDocument();
    expect(screen.getByText("Wound Care Best Practices")).toBeInTheDocument();
    expect(screen.getByText("Document weekly measurements and staging.")).toBeInTheDocument();
    expect(screen.getByText(/M1306-M1342/)).toBeInTheDocument();
    expect(screen.getByText(/Supports MMTA-03/)).toBeInTheDocument();
    // first three actions shown, the fourth is dropped in the compact preview
    expect(screen.getByText(/Measure wound weekly/)).toBeInTheDocument();
    expect(screen.getByText(/Document staging/)).toBeInTheDocument();
    expect(screen.getByText(/Assess infection/)).toBeInTheDocument();
    expect(screen.queryByText(/Review pressure/)).toBeNull();
  });

  it("expanded variant shows the full header, all actions, and the footer note", () => {
    renderWithProviders(<ClinicalAlertsPanel alerts={ALERTS} variant="expanded" />);
    expect(screen.getByText(/AI Clinical Decision Support \(2\)/)).toBeInTheDocument();
    // all four actions of the first alert are listed (not capped)
    expect(screen.getByText(/Review pressure/)).toBeInTheDocument();
    expect(screen.getByText(/These evidence-based alerts are triggered/)).toBeInTheDocument();
    expect(screen.getByText(/high priority/)).toBeInTheDocument();
    expect(screen.getByText(/medium priority/)).toBeInTheDocument();
  });

  it("invokes onViewReference when a reference button is clicked (both variants)", () => {
    const onViewReference = vi.fn();
    const { unmount } = renderWithProviders(
      <ClinicalAlertsPanel alerts={ALERTS} variant="compact" onViewReference={onViewReference} />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: /Details/i })[0]);
    expect(onViewReference).toHaveBeenCalledTimes(1);
    unmount();

    renderWithProviders(
      <ClinicalAlertsPanel alerts={ALERTS} variant="expanded" onViewReference={onViewReference} />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: /View CMS Guidance/i })[0]);
    expect(onViewReference).toHaveBeenCalledTimes(2);
  });
});
