import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock the chart backend so we can assert what gets written ──────────────────
const visitCreate = vi.fn(async (p) => ({ id: "visit-1", ...p }));
const visitUpdate = vi.fn(async () => ({}));
const patientGet = vi.fn(async () => ({ enhanced_notes_history: [] }));
const patientUpdate = vi.fn(async () => ({}));
const noteConvCreate = vi.fn(async () => ({}));
const auditCreate = vi.fn(async () => ({ id: "audit-1" }));
const auditUpdate = vi.fn(async () => ({}));
const addToSyncQueue = vi.fn(async () => {});

vi.mock("@/api/base44Client", () => ({
  base44: {
    entities: {
      Visit: { create: (...a) => visitCreate(...a), update: (...a) => visitUpdate(...a) },
      Patient: { get: (...a) => patientGet(...a), update: (...a) => patientUpdate(...a) },
      NoteConversion: { create: (...a) => noteConvCreate(...a) },
      ComplianceAudit: { create: (...a) => auditCreate(...a), update: (...a) => auditUpdate(...a) },
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/utils/activityLogger", () => ({ logActivity: vi.fn(), ActivityActions: { NOTE_ENHANCED: "NOTE_ENHANCED" } }));
// Isolate from the (separately tested) pure compliance helpers.
vi.mock("@/components/smartNote/compliance/coverageScore", () => ({ deriveStructuredVisitFields: () => ({}), toNoteConversionFields: (x) => x }));
vi.mock("@/components/smartNote/compliance/reportingFields", () => ({ buildVisitReportingFields: () => ({}), buildAuditFields: () => ({ status: "ok" }) }));
vi.mock("@/lib/indexedDB", () => ({ addToSyncQueue: (...a) => addToSyncQueue(...a) }));

import { persistVisitNote } from "./persistVisitNote";

const baseResult = {
  finalNote: "Final note text", coverageScore: 88, draftScore: 50,
  presence: {}, answeredIds: [], confirmedNegativeIds: [], answers: {},
  chartFindings: [], sustainedTrends: [],
};
const currentUser = { email: "nurse@example.com" };
const baseArgs = {
  result: baseResult, patientId: "p1", visitDate: "2026-06-21",
  visitType: "routine_visit", roughNote: "rough", currentUser,
};

function setOnline(value) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true });
}

describe("persistVisitNote", () => {
  beforeEach(() => { vi.clearAllMocks(); setOnline(true); });
  afterEach(() => setOnline(true));

  it("returns null when required inputs are missing", async () => {
    expect(await persistVisitNote({ ...baseArgs, patientId: "" })).toBeNull();
    expect(await persistVisitNote({ ...baseArgs, result: null })).toBeNull();
    expect(visitCreate).not.toHaveBeenCalled();
  });

  it("creates a visit (with vitals) and the compliance records on a fresh save", async () => {
    const out = await persistVisitNote({ ...baseArgs, vitals: { heart_rate: 80 } });
    expect(out).toMatchObject({ mode: "create", visitId: "visit-1", auditId: "audit-1" });
    expect(visitCreate).toHaveBeenCalledTimes(1);
    expect(visitCreate.mock.calls[0][0]).toMatchObject({
      patient_id: "p1", visit_type: "routine_visit", nurse_notes: "Final note text",
      vital_signs: { heart_rate: 80 },
    });
    expect(noteConvCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(visitUpdate).not.toHaveBeenCalled();
  });

  it("completes an existing (deep-linked) visit instead of creating a duplicate", async () => {
    const out = await persistVisitNote({ ...baseArgs, existingVisitId: "visit-sched", vitals: { heart_rate: 70 } });
    expect(out).toMatchObject({ mode: "create", visitId: "visit-sched", auditId: "audit-1" });
    expect(visitUpdate).toHaveBeenCalledWith("visit-sched", expect.objectContaining({ status: "completed", vital_signs: { heart_rate: 70 } }));
    expect(visitCreate).not.toHaveBeenCalled();
    // Per-documentation records still created, tied to the completed visit.
    expect(noteConvCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate.mock.calls[0][0]).toMatchObject({ visit_id: "visit-sched" });
  });

  it("updates the same visit (with vitals) on a re-save, never duplicating", async () => {
    const out = await persistVisitNote({ ...baseArgs, savedVisitId: "visit-9", savedAuditId: "audit-9", vitals: { temperature: 99 } });
    expect(out).toMatchObject({ mode: "update", visitId: "visit-9" });
    expect(visitUpdate).toHaveBeenCalledWith("visit-9", expect.objectContaining({ vital_signs: { temperature: 99 } }));
    expect(auditUpdate).toHaveBeenCalledWith("audit-9", expect.anything());
    expect(visitCreate).not.toHaveBeenCalled();
  });

  it("queues an offline visit (with vitals + audit meta) when offline", async () => {
    setOnline(false);
    const out = await persistVisitNote({ ...baseArgs, vitals: { pain_level: 3 } });
    expect(out).toMatchObject({ mode: "offline", visitId: null });
    expect(addToSyncQueue).toHaveBeenCalledTimes(1);
    const [action, payload] = addToSyncQueue.mock.calls[0];
    expect(action).toBe("CREATE_VISIT");
    expect(payload.vital_signs).toEqual({ pain_level: 3 });
    expect(payload.__audit).toBeTruthy();
    expect(visitCreate).not.toHaveBeenCalled();
  });
});
