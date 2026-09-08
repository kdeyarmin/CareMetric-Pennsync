import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";

const { uploadFile, invoke } = vi.hoisted(() => ({
  uploadFile: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@/api/base44Client", () => ({
  base44: {
    integrations: { Core: { UploadFile: (...args) => uploadFile(...args) } },
    functions: { invoke: (...args) => invoke(...args) },
  },
}));

import BulkDischargeImportPage from "@/pages/BulkDischargeImport";

describe("BulkDischargeImportPage paused state", () => {
  it("truthfully presents the security hold without an upload control", () => {
    const { container } = renderWithProviders(<BulkDischargeImportPage />);

    expect(screen.getByRole("heading", { name: "Bulk Discharge Import" }))
      .toBeInTheDocument();
    expect(screen.getByText(/File upload and automated bulk discharge processing are temporarily unavailable/i))
      .toBeInTheDocument();
    expect(screen.getByText(/approved patient discharge workflow/i))
      .toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByText(/Click to upload discharge report/i)).toBeNull();
    expect(uploadFile).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});
