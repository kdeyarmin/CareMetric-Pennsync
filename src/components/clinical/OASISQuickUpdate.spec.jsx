import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";

// Inline Base44 stub (vi.mock is hoisted, so it can't reference imports).
// Every entity call resolves empty; the component only reads recent assessments.
vi.mock("@/api/base44Client", () => {
  const arr = async () => [];
  const obj = async () => ({});
  const entityStub = new Proxy({}, {
    get: (_t, p) => {
      if (p === "then") return undefined;
      if (p === "get" || p === "create" || p === "update") return obj;
      return arr;
    },
  });
  return { base44: { entities: new Proxy({}, { get: () => entityStub }), auth: { me: async () => ({}) } } };
});

import OASISQuickUpdate from "./OASISQuickUpdate";

describe("OASISQuickUpdate", () => {
  const patient = { id: "p1", full_name: "Test Patient" };

  it("renders the quick-entry form with the per-item OASIS functional fields", async () => {
    renderWithProviders(<OASISQuickUpdate patient={patient} />);
    expect(await screen.findByText("OASIS Quick Update")).toBeInTheDocument();
    // Fields are driven by oasisScales (each labelled with its OASIS-E M-number).
    expect(screen.getByText("Ambulation (M1860)")).toBeInTheDocument();
    expect(screen.getByText("Bathing (M1830)")).toBeInTheDocument();
    expect(screen.getByText("Dressing Upper (M1810)")).toBeInTheDocument();
    expect(screen.getByText("Transferring (M1850)")).toBeInTheDocument();
    expect(screen.getByText("Toileting (M1845)")).toBeInTheDocument();
    expect(screen.getByText("Pain Frequency (M1242)")).toBeInTheDocument();
  });

  it("requires an assessment type before the draft can be saved", async () => {
    renderWithProviders(<OASISQuickUpdate patient={patient} />);
    const save = await screen.findByRole("button", { name: /Save as Draft/i });
    // No assessment type selected and no changes → save is disabled.
    expect(save).toBeDisabled();
  });
});
