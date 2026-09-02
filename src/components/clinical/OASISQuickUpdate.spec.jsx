import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";

// Use the shared Base44 stub (every entity call resolves empty). The factory is
// hoisted, so it can't close over module imports — pull the helper in via a
// dynamic import inside the async factory instead.
vi.mock("@/api/base44Client", async () => {
  const { makeBase44Stub } = await import("@/test/testUtils");
  return { base44: makeBase44Stub() };
});

import OASISQuickUpdate from "./OASISQuickUpdate";

describe("OASISQuickUpdate", () => {
  const patient = { id: "p1", full_name: "Test Patient" };

  it("renders the fail-closed pause notice", async () => {
    renderWithProviders(<OASISQuickUpdate patient={patient} />);
    expect(await screen.findByText("OASIS Quick Update Paused")).toBeInTheDocument();
    expect(screen.getByText(/pending verified OASIS-E definitions and tenant-scoped assessment access/i)).toBeInTheDocument();
    expect(screen.getByText(/No assessment history, response scale, clinical note, or draft write is loaded/i)).toBeInTheDocument();
  });

  it("does not render assessment entry controls or actions", () => {
    renderWithProviders(<OASISQuickUpdate patient={patient} />);
    expect(screen.queryByLabelText(/Assessment Type/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Clinical Note/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/M1860|M1830|M1810|M1850|M1845|M1242/)).not.toBeInTheDocument();
    expect(screen.queryByText("Recent Assessments")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save as Draft/i })).not.toBeInTheDocument();
  });
});
