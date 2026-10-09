import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";

const { invoke, listPatients, auth } = vi.hoisted(() => ({
  invoke: vi.fn(),
  listPatients: vi.fn(),
  auth: { user: null },
}));

vi.mock("@/api/base44Client", () => ({
  base44: { functions: { invoke: (...args) => invoke(...args) } },
}));

vi.mock("@/functions/listAuthorizedPatients", () => ({
  listAuthorizedPatients: (...args) => listPatients(...args),
}));

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => auth,
}));

vi.mock("@/components/messaging/ScheduleSendDialog", () => ({
  default: () => null,
}));

import PatientContactActions from "./PatientContactActions";

beforeEach(() => {
  invoke.mockReset();
  listPatients.mockReset();
  auth.user = { id: "nurse-1", email: "nurse@a.test", work_phone_number: "+12155550100", personal_cell_e164: "+12155550199" };
  listPatients.mockResolvedValue({ patients: [{ id: "p1", phone: "(215) 555-1234" }] });
});

describe("PatientContactActions (released 2026-10-08)", () => {
  it("takes the number from the contact read purpose for this chart only", async () => {
    renderWithProviders(<PatientContactActions patientId="p1" agencyId="agency-a" />);
    expect(await screen.findByText(/Patient number:/)).toBeInTheDocument();
    expect(listPatients).toHaveBeenCalledWith({ agencyId: "agency-a", mode: "ids", purpose: "contact", patientIds: ["p1"] });
  });

  it("texts through sendSms and calls through startMaskedCall, naming the chart", async () => {
    invoke.mockResolvedValue({ data: { success: true } });
    renderWithProviders(<PatientContactActions patientId="p1" agencyId="agency-a" />);
    await screen.findByText(/Patient number:/);

    fireEvent.change(screen.getByLabelText("Text the patient"), { target: { value: "  See you at 3  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send now" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("sendSms", {
      to_number: "+12155551234",
      body: "See you at 3",
      patient_id: "p1",
    }));
    expect(await screen.findByRole("status")).toHaveTextContent("Text sent from your agency line.");

    fireEvent.click(screen.getByRole("button", { name: "Call through work number" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("startMaskedCall", { patient_id: "p1" }));
  });

  it("shows the server's refusal, such as missing consent, as the outcome", async () => {
    const refusal = Object.assign(new Error("Request failed with status code 403"), {
      response: { status: 403, data: { error: "This patient has not consented to texts from this line." } },
    });
    invoke.mockRejectedValue(refusal);
    renderWithProviders(<PatientContactActions patientId="p1" agencyId="agency-a" />);
    await screen.findByText(/Patient number:/);

    fireEvent.change(screen.getByLabelText("Text the patient"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send now" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This patient has not consented to texts from this line.");
  });

  it("disables both actions when the chart's contact details cannot be read", async () => {
    listPatients.mockRejectedValue(new Error("Forbidden"));
    renderWithProviders(<PatientContactActions patientId="p1" agencyId="agency-a" />);

    expect(await screen.findByText("Forbidden")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Call through work number" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send now" })).toBeDisabled();
    expect(invoke).not.toHaveBeenCalled();
  });
});
