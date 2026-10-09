import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/api/base44Client", () => ({
  base44: { functions: { invoke: (...args) => invoke(...args) } },
}));

vi.mock("@/lib/agencySettings", () => ({
  fetchCallerAgencySettings: async () => null,
}));

import SmsThreadView from "./SmsThreadView";

const now = new Date().toISOString();
const failedText = {
  id: "sms_failed", direction: "outbound", status: "failed", body: "Your visit is at 10",
  created_date: now, failure_reason: "Telnyx API error: HTTP 429, code 10011: Too many requests",
};

function renderThread(messages) {
  return renderWithProviders(
    <SmsThreadView
      thread={{ threadId: "+12155550100|+13125550182", messages }}
      otherPartyLabel="Pat Patient"
      otherPartyNumber="+13125550182"
      patientId="patient_1"
      currentUser={{ email: "nurse@a.test" }}
      optedOut={false}
    />,
  );
}

beforeEach(() => {
  // jsdom has no layout, so no scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
  invoke.mockReset();
  invoke.mockResolvedValue({ data: { success: true, status: "queued" } });
});

describe("SmsThreadView", () => {
  it("resends a failed text naming the row it replaces, so the redrive retires it", async () => {
    renderThread([failedText]);
    fireEvent.click(screen.getByRole("button", { name: /resend/i }));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(invoke).toHaveBeenCalledWith("sendSms", {
      to_number: "+13125550182",
      body: "Your visit is at 10",
      patient_id: "patient_1",
      resend_of: "sms_failed",
    });
  });

  it("offers no second Resend for a text that was already resent", () => {
    renderThread([{ ...failedText, superseded_by: "client_2" }]);
    expect(screen.queryByRole("button", { name: /resend/i })).not.toBeInTheDocument();
    expect(screen.getByText("Resent")).toBeInTheDocument();
  });
});
