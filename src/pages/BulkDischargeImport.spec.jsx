import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";

const { uploadPrivateFile, invoke } = vi.hoisted(() => ({
  uploadPrivateFile: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@/api/base44Client", () => ({
  base44: {
    integrations: { Core: { UploadPrivateFile: (...args) => uploadPrivateFile(...args) } },
    functions: { invoke: (...args) => invoke(...args) },
  },
}));

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({ tenantContext: { agency_id: "agency-1" } }),
}));

import BulkDischargeImportPage from "@/pages/BulkDischargeImport";

describe("BulkDischargeImportPage", () => {
  it("presents the discharge report upload without processing anything on render", () => {
    const { container } = renderWithProviders(<BulkDischargeImportPage />);

    expect(screen.getByRole("heading", { name: "Bulk Discharge Import" }))
      .toBeInTheDocument();
    expect(screen.getByText(/Upload a discharge report to batch-match/i))
      .toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).not.toBeNull();
    expect(screen.getByText(/Click to upload discharge report/i)).toBeInTheDocument();
    expect(uploadPrivateFile).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});
