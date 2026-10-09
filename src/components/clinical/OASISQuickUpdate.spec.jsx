import { beforeEach, describe, it, expect, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";

const { listAuthorizedOASISAssessments, saveOfficialResponses, entityCall, auth } = vi.hoisted(() => ({
  listAuthorizedOASISAssessments: vi.fn(),
  saveOfficialResponses: vi.fn(),
  entityCall: vi.fn(),
  auth: { current: null },
}));

// Any direct entity call or function invocation fails the test: history reads
// through the authorized summary broker and saves through the one adapter.
vi.mock("@/api/base44Client", () => ({
  base44: {
    entities: new Proxy({}, { get: (_t, entity) => new Proxy({}, { get: (_u, op) => (...args) => entityCall(entity, op, ...args) }) }),
    functions: { invoke: (...args) => entityCall("functions", "invoke", ...args) },
  },
}));
vi.mock("@/functions/readAuthorizedOASISAssessments", () => ({ listAuthorizedOASISAssessments }));
vi.mock("@/components/oasis/responseSchema/oasisWriteAdapter.js", () => ({ saveOfficialResponses }));
vi.mock("@/functions/manageAuthorizedReferral", () => ({
  listAuthorizedReferrals: vi.fn(async () => ({ referrals: [] })),
  updateAuthorizedReferral: vi.fn(),
}));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => auth.current }));
// A native select stands in for the Radix one so the assessment type can be chosen in jsdom.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }) => (
    <select aria-label="Assessment Type" value={value} onChange={(event) => onValueChange(event.target.value)}>
      <option value="">Select…</option>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }) => <>{children}</>,
  SelectItem: ({ value, children }) => <option value={value}>{children}</option>,
}));

import OASISQuickUpdate from "./OASISQuickUpdate";

describe("OASISQuickUpdate", () => {
  const patient = { id: "p1", full_name: "Test Patient" };

  beforeEach(() => {
    vi.clearAllMocks();
    auth.current = { user: { id: "u1", email: "rn@example.com" }, tenantContext: { agency_id: "ag1" } };
    listAuthorizedOASISAssessments.mockResolvedValue({
      assessments: [{ id: "oa1", visit_type: "Start of Care", assessment_date: "2026-10-01", status: "completed", completion_percentage: 100 }],
    });
    saveOfficialResponses.mockResolvedValue({ ok: true, created: true, assessment: { id: "oa2" } });
  });

  it("asks for a patient before anything loads", () => {
    renderWithProviders(<OASISQuickUpdate />);
    expect(screen.getByText(/Select a patient to record a quick OASIS update/i)).toBeInTheDocument();
    expect(listAuthorizedOASISAssessments).not.toHaveBeenCalled();
  });

  it("reads recent assessments as response-free summaries for the bound agency", async () => {
    renderWithProviders(<OASISQuickUpdate patient={patient} />);
    expect(await screen.findByText("Recent Assessments")).toBeInTheDocument();
    expect(listAuthorizedOASISAssessments).toHaveBeenCalledWith({
      agencyId: "ag1", patientId: "p1", purpose: "summary", limit: 5,
    });
    expect(entityCall).not.toHaveBeenCalled();
  });

  it("saves CMS-aligned selections as a draft through the one adapter, for the bound agency", async () => {
    renderWithProviders(<OASISQuickUpdate patient={patient} />);
    const save = screen.getByRole("button", { name: /Save as Draft/i });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Assessment Type"), { target: { value: "Start of Care" } });
    const radios = await screen.findAllByRole("radio");
    fireEvent.click(radios[0]);
    await waitFor(() => expect(save).not.toBeDisabled());
    fireEvent.click(save);

    await waitFor(() => expect(saveOfficialResponses).toHaveBeenCalledTimes(1));
    const [args] = saveOfficialResponses.mock.calls[0];
    expect(args.agencyId).toBe("ag1");
    expect(args.assessment).toEqual(expect.objectContaining({ patient_id: "p1", visit_type: "Start of Care", status: "draft" }));
    expect(args.selections.length).toBe(1);
    expect(["m1830_cms_e2", "m1840_cms_e2", "m1860_cms_e2", "m1870_cms_e2"]).toContain(args.selections[0].definitionId);
    expect(entityCall).not.toHaveBeenCalled();
  });

  it("cannot save without an agency bound to the session, whatever the profile says", () => {
    auth.current = { user: { id: "u1", email: "rn@example.com", agency_id: "ag1" }, tenantContext: null };
    renderWithProviders(<OASISQuickUpdate patient={patient} />);
    fireEvent.change(screen.getByLabelText("Assessment Type"), { target: { value: "Start of Care" } });
    expect(screen.getByRole("button", { name: /Save as Draft/i })).toBeDisabled();
    expect(listAuthorizedOASISAssessments).not.toHaveBeenCalled();
  });
});
