import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";

const { authMe, securityLogList, userActivityList, securityLogFilter, functionInvoke } = vi.hoisted(() => ({
  authMe: vi.fn(),
  securityLogList: vi.fn(async () => []),
  userActivityList: vi.fn(async () => []),
  securityLogFilter: vi.fn(async () => []),
  functionInvoke: vi.fn(async () => ({ data: {} })),
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
    functions: { invoke: (...args) => functionInvoke(...args) },
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
  securityLogList.mockReset();
  securityLogList.mockResolvedValue([]);
  userActivityList.mockClear();
  securityLogFilter.mockClear();
  functionInvoke.mockReset();
  functionInvoke.mockResolvedValue({ data: {} });
});

describe("SecurityLog fail-closed UI", () => {
  it("states that unavailable history is not an all-clear result", () => {
    renderWithProviders(<SecurityLogUnavailable />);

    expect(screen.getByText("Security event history unavailable")).toBeInTheDocument();
    expect(screen.getByText(SECURITY_LOG_READ_UNAVAILABLE_MESSAGE)).toHaveTextContent(
      /No zero-event or all-clear conclusion should be inferred/,
    );
  });

});

describe("restored audit trail (owner decision, 2026-10-08)", () => {
  it("reads activity through the scoped report and the security log only for the administrator", async () => {
    authMe.mockResolvedValue({ id: "a1", email: "admin@example.test", role: "admin" });
    functionInvoke.mockResolvedValue({ data: {
      success: true, scope: "platform", truncated: false, row_limit: 5000, members: [],
      activity: [{ id: "act-1", created_date: new Date().toISOString(), user_email: "nurse@example.test", action: "login" }],
    } });
    securityLogList.mockResolvedValue([
      { id: "sec-1", timestamp: new Date().toISOString(), user_email: "nurse@example.test", action: "FAILED_LOGIN" },
    ]);
    renderWithProviders(<AuditTrailViewer filterType="security" />);
    await waitFor(() => expect(securityLogList).toHaveBeenCalledWith("-timestamp", 500));
    expect(functionInvoke).toHaveBeenCalledWith("getUserActivityLog", { mode: "report", days: 7 });
    expect(await screen.findByText("FAILED LOGIN")).toBeInTheDocument();
    expect(userActivityList).not.toHaveBeenCalled();
  });

  it("never reads the security log for an agency administrator, and says so", async () => {
    authMe.mockResolvedValue({ id: "u2", email: "facility@example.test", role: "user" });
    functionInvoke.mockResolvedValue({ data: {
      success: true, scope: "agency", truncated: false, row_limit: 5000, members: [], activity: [],
    } });
    renderWithProviders(<AuditTrailViewer filterType="security" />);
    expect(await screen.findByText(/readable by the administrator account only/)).toBeInTheDocument();
    await waitFor(() => expect(functionInvoke).toHaveBeenCalledWith("getUserActivityLog", { mode: "report", days: 7 }));
    expect(securityLogList).not.toHaveBeenCalled();
    expect(userActivityList).not.toHaveBeenCalled();
  });

  it("reports a refused activity report as unavailable, not as zero events", async () => {
    authMe.mockResolvedValue({ id: "u3", email: "nurse@example.test", role: "user" });
    functionInvoke.mockResolvedValue({ data: { error: "Administrator access required." } });
    renderWithProviders(<AuditTrailViewer filterType="all" />);
    expect(await screen.findByText("Audit trail unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Total Events")).not.toBeInTheDocument();
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
