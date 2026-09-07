import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";

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

import DischargeReportUploader from "@/components/admin/DischargeReportUploader";

describe("DischargeReportUploader paused state", () => {
  it("blocks file selection before any upload or discharge-processing call", () => {
    const { container } = render(<DischargeReportUploader />);

    expect(screen.getByText(/Discharge Report Upload Temporarily Unavailable/i))
      .toBeInTheDocument();
    expect(screen.getByText(/No file is uploaded from this screen/i))
      .toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByRole("button", { name: /upload|process/i })).toBeNull();
    expect(uploadFile).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("contains no dormant browser upload or backend invocation path", () => {
    const source = readFileSync(
      "src/components/admin/DischargeReportUploader.jsx",
      "utf8",
    );

    expect(source).not.toMatch(/base44Client|Core\.UploadFile|functions\.invoke/);
    expect(source).not.toMatch(/type=["']file["']/);
    expect(uploadFile).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});
