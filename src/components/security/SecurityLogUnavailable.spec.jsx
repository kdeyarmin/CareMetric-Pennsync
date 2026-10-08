import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";

const { authMe, securityLogList, userActivityList, securityLogFilter } = vi.hoisted(() => ({
  authMe: vi.fn(),
  securityLogList: vi.fn(async () => []),
  userActivityList: vi.fn(async () => []),
  securityLogFilter: vi.fn(async () => []),
}));

vi.mock("@/api/base44Client", () => ({
  base44: {
    auth: { me: (...args) => authMe(...args) },
    entities: {
      SecurityLog: {
        list: (...args) => securityLogList(...args),
        filter: (...args) => securityLogFilter(...args),
      },
      UserActivity: { list: (...args) => userActivityList(...args) },
    },
    functions: { invoke: vi.fn(async () => ({ data: {} })) },
  },
}));

vi.mock("@/hooks/useAuthorizedVisits", () => ({
  useAuthorizedVisits: () => ({ isSuccess: true, data: [] }),
}));

import AIAuditAnalyzer from "./AIAuditAnalyzer";
import AuditTrailViewer from "./AuditTrailViewer";
import BreachDetectionSystem from "./BreachDetectionSystem";
import SecurityAnomalyDetector from "./SecurityAnomalyDetector";
import SecurityLogUnavailable, {
  SECURITY_LOG_READ_UNAVAILABLE_MESSAGE,
} from "./SecurityLogUnavailable";

beforeEach(() => {
  authMe.mockReset();
  securityLogList.mockClear();
  userActivityList.mockClear();
  securityLogFilter.mockClear();
});

describe("SecurityLog fail-closed UI", () => {
  it("states that unavailable history is not an all-clear result", () => {
    renderWithProviders(<SecurityLogUnavailable />);

    expect(screen.getByText("Security event history unavailable")).toBeInTheDocument();
    expect(screen.getByText(SECURITY_LOG_READ_UNAVAILABLE_MESSAGE)).toHaveTextContent(
      /No zero-event or all-clear conclusion should be inferred/,
    );
  });

  it("keeps the audit trail viewer visibly unavailable", () => {
    renderWithProviders(<AuditTrailViewer />);
    expect(screen.getByText("Security audit trail unavailable")).toBeInTheDocument();
  });
});

describe("restored security log analysis (owner decision, 2026-10-08)", () => {
  it.each([
    ["AI audit analysis", AIAuditAnalyzer, /Administrator Account Required/],
    ["breach detection", BreachDetectionSystem, /requires the administrator account/],
    ["anomaly detection", SecurityAnomalyDetector, /requires the administrator account/],
  ])("refuses %s to a non-administrator without reading the logs", async (_label, Component, message) => {
    authMe.mockResolvedValue({ id: "u1", email: "nurse@example.test", role: "user" });
    renderWithProviders(<Component />);
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(securityLogList).not.toHaveBeenCalled();
    expect(userActivityList).not.toHaveBeenCalled();
  });

  it.each([
    ["breach detection", BreachDetectionSystem],
    ["anomaly detection", SecurityAnomalyDetector],
  ])("loads both logs for the administrator account before %s runs", async (_label, Component) => {
    authMe.mockResolvedValue({ id: "a1", email: "admin@example.test", role: "admin" });
    renderWithProviders(<Component />);
    await waitFor(() => expect(securityLogList).toHaveBeenCalled());
    await waitFor(() => expect(userActivityList).toHaveBeenCalled());
  });
});
