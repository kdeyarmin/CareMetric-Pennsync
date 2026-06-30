import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";

// Hoisted so the vi.mock factory (which Vitest hoists above imports) can close
// over them.
const { carePlanCreate, PATIENT } = vi.hoisted(() => ({
  carePlanCreate: vi.fn(async () => ({ id: "cp-1" })),
  PATIENT: { id: "p1", first_name: "Jane", last_name: "Doe", primary_diagnosis: "CHF" },
}));

vi.mock("@/api/base44Client", () => {
  const arr = async () => [];
  const obj = async () => ({});
  const generic = new Proxy({}, { get: (_t, m) => (m === "get" || m === "create" || m === "update" ? obj : arr) });
  const entities = new Proxy({}, {
    get(_t, name) {
      if (name === "Patient") return { list: async () => [PATIENT], get: async () => PATIENT, update: async () => ({}) };
      if (name === "CarePlan") return { filter: async () => [], create: carePlanCreate };
      return generic;
    },
  });
  return { base44: { entities, auth: { me: async () => ({}) }, functions: {}, integrations: {} } };
});

import SmartOASISAssessment from "./SmartOASISAssessment";

async function selectPatient() {
  fireEvent.click(screen.getByRole("button", { name: /select patient/i }));
  fireEvent.click(await screen.findByText(/jane doe/i));
}

describe("SmartOASISAssessment — care-plan consistency guard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("blocks an ambulation goal for a bedfast patient until the nurse overrides", async () => {
    renderWithProviders(<SmartOASISAssessment />);
    await selectPatient();

    // Document the patient as bedfast (M1860 = 5). This makes the deterministic
    // engine surface a high-severity Fall Prevention suggestion whose interventions
    // (incl. "Ambulation Safety Teaching", fp-3) are auto-selected.
    const bedfast = await screen.findByText(/unable to ambulate; bedfast/i);
    fireEvent.click(bedfast.closest("label") || bedfast);

    // The Add-to-care-plan CTA appears with the auto-selected interventions.
    const addBtn = await screen.findByRole("button", { name: /add .*intervention.* to care plan/i });
    await waitFor(() => expect(addBtn).toBeEnabled());
    fireEvent.click(addBtn);

    // The guard intercepts: an ambulation goal contradicts the bedfast finding, so
    // the conflict banner shows and NOTHING is written to the chart yet.
    expect(await screen.findByText(/care-plan consistency check/i)).toBeInTheDocument();
    // The guard flags every contradicting goal (ambulation AND balance) — match
    // the conflict message, which is unique to the banner (the intervention NAMES
    // also appear in the suggestion list).
    expect(screen.getAllByText(/non-ambulatory or bedfast/i).length).toBeGreaterThan(0);
    expect(carePlanCreate).not.toHaveBeenCalled();

    // The nurse can still proceed deliberately via "Add anyway".
    fireEvent.click(screen.getByRole("button", { name: /add anyway/i }));
    await waitFor(() => expect(carePlanCreate).toHaveBeenCalled());
  });
});
