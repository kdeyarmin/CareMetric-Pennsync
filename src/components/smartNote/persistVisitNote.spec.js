import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock the chart backend so we can assert what gets written ──────────────────
const visitCreate = vi.fn(async (p) => ({ id: "visit-1", ...p }));
const visitUpdate = vi.fn(async () => ({}));
const visitFilter = vi.fn(async () => []);
const noteConvCreate = vi.fn(async () => ({}));
const auditCreate = vi.fn(async () => ({ id: "audit-1" }));
const auditUpdate = vi.fn(async () => ({}));
const auditFilter = vi.fn(async () => []);
const functionsInvoke = vi.fn(async () => ({ data: { success: true } }));

vi.mock("@/api/base44Client", () => ({
  base44: {
    entities: {
      Visit: {
        create: (...a) => visitCreate(...a),
        update: (...a) => visitUpdate(...a),
        filter: (...a) => visitFilter(...a),
      },
      NoteConversion: { create: (...a) => noteConvCreate(...a) },
      ComplianceAudit: {
        create: (...a) => auditCreate(...a),
        update: (...a) => auditUpdate(...a),
        filter: (...a) => auditFilter(...a),
      },
    },
    functions: { invoke: (...a) => functionsInvoke(...a) },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/utils/activityLogger", () => ({ logActivity: vi.fn(), ActivityActions: { NOTE_ENHANCED: "NOTE_ENHANCED" } }));
// Isolate from the (separately tested) pure compliance helpers.
vi.mock("@/components/smartNote/compliance/coverageScore", () => ({
  deriveStructuredVisitFields: () => ({}),
  toNoteConversionFields: (x) => ({ quality_score: x.coverageScore, patient_id: x.patientId }),
}));
vi.mock("@/components/smartNote/compliance/reportingFields", () => ({
  buildVisitReportingFields: () => ({}),
  buildAuditFields: ({ acknowledgment }) => ({ status: "ok", acknowledgment: acknowledgment || undefined }),
}));

import { persistVisitNote, OfflineSaveError } from "./persistVisitNote";

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
  beforeEach(() => { vi.clearAllMocks(); setOnline(true); visitFilter.mockResolvedValue([]); auditFilter.mockResolvedValue([]); });
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
      grounding_pending: false,
    });
    expect(noteConvCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(visitUpdate).not.toHaveBeenCalled();
    expect(functionsInvoke).toHaveBeenCalledWith("appendPatientNoteHistory", expect.objectContaining({
      patient_id: "p1", mode: "append", clinical_notes: "Final note text",
      entry: expect.objectContaining({ visit_id: "visit-1", note: "Final note text" }),
    }));
  });

  it("completes an existing (deep-linked) visit instead of creating a duplicate", async () => {
    const out = await persistVisitNote({ ...baseArgs, existingVisitId: "visit-sched", vitals: { heart_rate: 70 } });
    expect(out).toMatchObject({ mode: "create", visitId: "visit-sched", auditId: "audit-1" });
    expect(visitUpdate).toHaveBeenCalledWith("visit-sched", expect.objectContaining({ status: "completed", vital_signs: { heart_rate: 70 } }));
    expect(visitCreate).not.toHaveBeenCalled();
    expect(noteConvCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate.mock.calls[0][0]).toMatchObject({ visit_id: "visit-sched" });
  });

  it("updates the same visit (with vitals) on a re-save, never duplicating", async () => {
    const out = await persistVisitNote({ ...baseArgs, savedVisitId: "visit-9", savedAuditId: "audit-9", vitals: { temperature: 99 } });
    expect(out).toMatchObject({ mode: "update", visitId: "visit-9" });
    expect(visitUpdate).toHaveBeenCalledWith("visit-9", expect.objectContaining({ vital_signs: { temperature: 99 } }));
    expect(auditUpdate).toHaveBeenCalledWith("audit-9", expect.anything());
    expect(visitCreate).not.toHaveBeenCalled();
    expect(functionsInvoke).toHaveBeenCalledWith("appendPatientNoteHistory", expect.objectContaining({
      patient_id: "p1", mode: "update",
      entry: expect.objectContaining({ visit_id: "visit-9", note: "Final note text" }),
    }));
  });

  it("refuses to save with no connection, writing nothing", async () => {
    // Offline mode was removed: there is no local queue, so the only safe answer
    // is to refuse BEFORE any write and let the caller keep the note on screen.
    setOnline(false);
    await expect(persistVisitNote({ ...baseArgs, vitals: { bp: "120/80" } })).rejects.toThrow(OfflineSaveError);
    expect(visitCreate).not.toHaveBeenCalled();
    expect(visitUpdate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
    expect(noteConvCreate).not.toHaveBeenCalled();
    expect(functionsInvoke).not.toHaveBeenCalled();
  });

  it("refuses an offline re-save of an existing visit without touching the chart", async () => {
    setOnline(false);
    await expect(
      persistVisitNote({ ...baseArgs, savedVisitId: "visit-9", savedAuditId: "audit-9" }),
    ).rejects.toThrow(OfflineSaveError);
    expect(visitUpdate).not.toHaveBeenCalled();
    expect(auditUpdate).not.toHaveBeenCalled();
  });

  it("carries a recognizable code so callers can report it as a connection problem", async () => {
    setOnline(false);
    await expect(persistVisitNote(baseArgs)).rejects.toMatchObject({ code: "OFFLINE_SAVE_BLOCKED" });
  });

  it("stamps facility acknowledgment onto the compliance audit fields", async () => {
    await persistVisitNote({
      ...baseArgs,
      facilityAcknowledgment: {
        acknowledged: true,
        unmet_requirements: ["spo2_on_o2"],
        justification: "Confirmed with RT",
      },
    });
    expect(auditCreate).toHaveBeenCalledTimes(1);
    const auditArg = auditCreate.mock.calls[0][0];
    expect(auditArg.acknowledgment).toMatchObject({
      acknowledged_by: "nurse@example.com",
      justification: expect.stringContaining("Confirmed with RT"),
      finding_ids: expect.arrayContaining(["facility:spo2_on_o2"]),
    });
  });
});
