import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";
import SecurityDocumentation from "./SecurityDocumentation";

describe("SecurityDocumentation audit claims", () => {
  it("presents audit controls as unverified rather than an all-clear", () => {
    renderWithProviders(<SecurityDocumentation />);

    expect(screen.getByText("Verification unavailable")).toBeInTheDocument();
    expect(screen.getByText("Coverage is not attested by this view")).toBeInTheDocument();
    expect(screen.getByText("Control inventory — not a compliance certification")).toBeInTheDocument();
    expect(screen.getByText(/No all-clear or HIPAA compliance conclusion/)).toBeInTheDocument();
    expect(screen.queryByText("✓ Complete Audit Trail")).not.toBeInTheDocument();
    expect(screen.queryByText("All security-relevant actions are logged:")).not.toBeInTheDocument();
  });
});
