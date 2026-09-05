import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";
import AIAuditAnalyzer from "./AIAuditAnalyzer";
import AuditTrailViewer from "./AuditTrailViewer";
import BreachDetectionSystem from "./BreachDetectionSystem";
import SecurityAnomalyDetector from "./SecurityAnomalyDetector";
import SecurityAuditScheduler from "./SecurityAuditScheduler";
import SecurityLogUnavailable, {
  SECURITY_LOG_READ_UNAVAILABLE_MESSAGE,
} from "./SecurityLogUnavailable";

describe("SecurityLog fail-closed UI", () => {
  it("states that unavailable history is not an all-clear result", () => {
    renderWithProviders(<SecurityLogUnavailable />);

    expect(screen.getByText("Security event history unavailable")).toBeInTheDocument();
    expect(screen.getByText(SECURITY_LOG_READ_UNAVAILABLE_MESSAGE)).toHaveTextContent(
      /No zero-event or all-clear conclusion should be inferred/,
    );
  });

  it.each([
    ["AI security-log analysis unavailable", AIAuditAnalyzer],
    ["Security audit trail unavailable", AuditTrailViewer],
    ["Security breach analysis unavailable", BreachDetectionSystem],
    ["Security anomaly analysis unavailable", SecurityAnomalyDetector],
    ["Security audit history unavailable", SecurityAuditScheduler],
  ])("keeps %s visibly unavailable", (title, Component) => {
    renderWithProviders(<Component />);

    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByText(SECURITY_LOG_READ_UNAVAILABLE_MESSAGE)).toBeInTheDocument();
  });
});
