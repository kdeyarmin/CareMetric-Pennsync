import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";

const { authMe, functionInvoke, entityRead, entityWrite, llm, manageOASISRecords } = vi.hoisted(() => ({
  authMe: vi.fn(),
  functionInvoke: vi.fn(),
  entityRead: vi.fn(),
  entityWrite: vi.fn(),
  llm: vi.fn(),
  manageOASISRecords: vi.fn(),
}));

vi.mock("@/api/base44Client", () => ({
  base44: {
    auth: { me: authMe },
    functions: { invoke: functionInvoke },
    integrations: { Core: new Proxy({}, { get: () => llm }) },
    entities: new Proxy({}, {
      get: () => ({
        list: entityRead, filter: entityRead, get: entityRead,
        create: entityWrite, update: entityWrite, delete: entityWrite, bulkCreate: entityWrite,
      }),
    }),
  },
}));

vi.mock("@/lib/invokeLLM", () => ({ invokeLLM: llm, invokeLLMWithFile: llm }));
vi.mock("@/functions/manageOASISRecords", async (importOriginal) => ({
  ...(await importOriginal()),
  manageOASISRecords,
}));
vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", email: "rn@example.com" }, tenantContext: { agency_id: "ag1" } }),
}));
vi.mock("@/hooks/useScopedPatients", () => ({
  useScopedPatients: () => ({ data: [{ id: "p1", first_name: "Ada", last_name: "Lovelace" }], isLoading: false }),
}));

const SAVED = {
  id: "up1",
  analysis_id: "an-1",
  patient_id: "p1",
  patient_name: "Ada Lovelace",
  file_name: "ada-soc.pdf",
  assessment_type: "SOC",
  created_date: "2026-10-01T10:00:00.000Z",
  scores: { accuracy: 88, compliance: 91, overall: 90 },
  analysis_results: { accuracy_score: 88, compliance_score: 91, overall_score: 90 },
};

describe("OASISAnalyzer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMe.mockResolvedValue({ id: "u1", email: "rn@example.com", role: "user" });
    functionInvoke.mockImplementation(async (name) => (
      name === "listOASISUploads" ? { data: { uploads: [SAVED] } } : { data: {} }
    ));
  });

  it("opens on the upload step and lists saved analyses only through listOASISUploads", async () => {
    const { default: OASISAnalyzer } = await import("@/components/hub-tabs/OASISAnalyzer");
    renderWithProviders(<OASISAnalyzer />);

    await waitFor(() => expect(functionInvoke).toHaveBeenCalledWith(
      "listOASISUploads", expect.objectContaining({ limit: 50 }),
    ));
    expect(screen.queryByText(/OASIS Analyzer Off/)).not.toBeInTheDocument();
    // Nothing is read or written straight from an entity, and no model runs
    // before a document is analyzed.
    expect(entityRead).not.toHaveBeenCalled();
    expect(entityWrite).not.toHaveBeenCalled();
    expect(llm).not.toHaveBeenCalled();
    expect(manageOASISRecords).not.toHaveBeenCalled();
    for (const [name] of functionInvoke.mock.calls) expect(name).toBe("listOASISUploads");
  });
});
