import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), download: vi.fn() }));
vi.mock("@/api/base44Client", () => ({
  base44: { functions: { fetch: (...args) => mocks.fetch(...args) } },
}));
vi.mock("@/lib/downloadBlob", () => ({
  downloadAuthorityBoundBlob: (...args) => mocks.download(...args),
}));

import AgencyComprehensiveReport from "./AgencyComprehensiveReport";

describe("AgencyComprehensiveReport", () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
    mocks.download.mockReset();
  });

  it("asks the server for one agency's PDF and downloads the bytes it returns", async () => {
    mocks.fetch.mockResolvedValue(new Response(new Uint8Array([37, 80, 68, 70]), {
      status: 200,
      headers: { "content-type": "application/pdf" },
    }));
    renderWithProviders(<AgencyComprehensiveReport agencyId="agency-1" />);
    fireEvent.click(screen.getByRole("button", { name: /download agency pdf report/i }));
    expect(await screen.findByRole("status")).toHaveTextContent("Report downloaded.");
    const [name, init] = mocks.fetch.mock.calls[0];
    expect(name).toBe("generateComprehensiveReport");
    expect(JSON.parse(init.body)).toEqual({ reportType: "comprehensive", dateRange: 30, agency_id: "agency-1" });
    const [blob, filename] = mocks.download.mock.calls[0];
    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBe(4);
    expect(filename).toMatch(/^pennsync-agency-report-\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it("shows the server's refusal and downloads nothing", async () => {
    mocks.fetch.mockResolvedValue(Response.json(
      { error: "Agency administrator or manager access required" },
      { status: 403 },
    ));
    renderWithProviders(<AgencyComprehensiveReport agencyId="agency-1" />);
    fireEvent.click(screen.getByRole("button", { name: /download agency pdf report/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Agency administrator or manager access required");
    expect(mocks.download).not.toHaveBeenCalled();
  });
});
