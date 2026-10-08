import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { renderWithProviders } from "@/test/testUtils";

const { uploadFile, uploadPrivateFile, invoke, auth } = vi.hoisted(() => ({
  uploadFile: vi.fn(),
  uploadPrivateFile: vi.fn(),
  invoke: vi.fn(),
  auth: { tenantContext: null },
}));

vi.mock("@/api/base44Client", () => ({
  base44: {
    integrations: {
      Core: {
        UploadFile: (...args) => uploadFile(...args),
        UploadPrivateFile: (...args) => uploadPrivateFile(...args),
      },
    },
    functions: { invoke: (...args) => invoke(...args) },
  },
}));

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => auth,
}));

vi.mock("sonner", () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

import DischargeReportUploader from "@/components/admin/DischargeReportUploader";

beforeEach(() => {
  uploadFile.mockReset();
  uploadPrivateFile.mockReset();
  invoke.mockReset();
  auth.tenantContext = null;
});

describe("DischargeReportUploader", () => {
  it("offers no upload until the caller's agency is known", () => {
    const { container } = renderWithProviders(<DischargeReportUploader />);
    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    expect(input).toBeDisabled();
    expect(screen.getByText(/Select your agency first/i)).toBeInTheDocument();
    expect(uploadPrivateFile).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("stores the report privately and processes it within the caller's agency", async () => {
    auth.tenantContext = { agency_id: "agency-1" };
    uploadPrivateFile.mockResolvedValue({ file_uri: "private/discharge.pdf" });
    invoke.mockResolvedValue({
      data: {
        success: true,
        total_processed: 1,
        discharged_count: 1,
        files_closed: 1,
        not_found: 0,
        discharged_patients: [{ name: "Ada Lovelace", mrn: "M1", discharge_date: "2026-10-01" }],
        not_found_patients: [],
        ambiguous_patients: [],
        errors: [],
      },
    });

    const { container } = renderWithProviders(<DischargeReportUploader />);
    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeDisabled();
    const file = new File(["%PDF"], "discharges.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(uploadPrivateFile).toHaveBeenCalledWith({ file });
    expect(invoke).toHaveBeenCalledWith("processDischargeReport", {
      file_uri: "private/discharge.pdf",
      agency_id: "agency-1",
    });
    expect(uploadFile).not.toHaveBeenCalled();
    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
  });

  it("never uses a public upload for a discharge report", () => {
    const source = readFileSync("src/components/admin/DischargeReportUploader.jsx", "utf8");
    expect(source).toMatch(/Core\.UploadPrivateFile/);
    expect(source).not.toMatch(/Core\.UploadFile\b/);
    expect(source).not.toMatch(/file_url/);
  });
});
