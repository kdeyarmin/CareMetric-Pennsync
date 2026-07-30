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
const addToSyncQueue = vi.fn(async () => {});
const upsertCreateVisitInSyncQueue = vi.fn(async () => {});

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
vi.mock("@/lib/indexedDB", () => ({
  addToSyncQueue: (...a) => addToSyncQueue(...a),
  upsertCreateVisitInSyncQueue: (...a) => upsertCreateVisitInSyncQueue(...a),
}));

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

  it("queues an offline visit (with vitals + audit + history + noteConversion meta) when offline", async () => {
    setOnline(false);
    const out = await persistVisitNote({ ...baseArgs, vitals: { pain_level: 3 } });
    expect(out).toMatchObject({ mode: "offline", visitId: null });
    expect(out.offlineClientRequestId).toBeTruthy();
    expect(upsertCreateVisitInSyncQueue).toHaveBeenCalledTimes(1);
    expect(addToSyncQueue).not.toHaveBeenCalled();
    const payload = upsertCreateVisitInSyncQueue.mock.calls[0][0];
    expect(payload.client_request_id).toBe(out.offlineClientRequestId);
    expect(payload.vital_signs).toEqual({ pain_level: 3 });
    expect(payload.__audit).toBeTruthy();
    expect(payload.grounding_pending).toBe(true);
    expect(payload.__audit.status).toBe("pending_review");
    expect(payload.__history).toMatchObject({ mode: "append", patient_id: "p1" });
    expect(payload.__history.entry.entry_id).toBeTruthy();
    expect(payload.__noteConversion).toBeTruthy();
    expect(visitCreate).not.toHaveBeenCalled();
    expect(functionsInvoke).not.toHaveBeenCalled();
  });

  it("reuses offlineClientRequestId on still-offline re-save so the queue collapses", async () => {
    setOnline(false);
    const first = await persistVisitNote({ ...baseArgs, vitals: { pain_level: 2 } });
    expect(first.offlineClientRequestId).toBeTruthy();
    const key = first.offlineClientRequestId;

    const second = await persistVisitNote({
      ...baseArgs,
      vitals: { pain_level: 5 },
      offlineClientRequestId: key,
      result: { ...baseResult, finalNote: "Edited final note" },
    });
    expect(second.offlineClientRequestId).toBe(key);
    expect(upsertCreateVisitInSyncQueue).toHaveBeenCalledTimes(2);
    expect(upsertCreateVisitInSyncQueue.mock.calls[0][0].client_request_id).toBe(key);
    expect(upsertCreateVisitInSyncQueue.mock.calls[1][0].client_request_id).toBe(key);
    expect(upsertCreateVisitInSyncQueue.mock.calls[1][0].nurse_notes).toBe("Edited final note");
    expect(upsertCreateVisitInSyncQueue.mock.calls[1][0].vital_signs).toEqual({ pain_level: 5 });
    expect(addToSyncQueue).not.toHaveBeenCalled();
  });

  it("queues UPDATE_VISIT (not a duplicate CREATE) when offline re-saving an existing visit", async () => {
    setOnline(false);
    const out = await persistVisitNote({ ...baseArgs, savedVisitId: "visit-9", savedAuditId: "audit-9", vitals: { temperature: 99 } });
    expect(out).toMatchObject({ mode: "offline", visitId: "visit-9", auditId: "audit-9" });
    expect(addToSyncQueue).toHaveBeenCalledTimes(1);
    expect(upsertCreateVisitInSyncQueue).not.toHaveBeenCalled();
    const [action, payload] = addToSyncQueue.mock.calls[0];
    expect(action).toBe("UPDATE_VISIT");
    expect(payload.visit_id).toBe("visit-9");
    expect(payload.vital_signs).toEqual({ temperature: 99 });
    expect(payload.__audit).toBeTruthy();
    expect(payload.__history).toMatchObject({ mode: "update" });
    expect(payload.__history.entry.visit_id).toBe("visit-9");
    expect(visitCreate).not.toHaveBeenCalled();
  });

  it("queues UPDATE_VISIT (status completed) when offline documenting a deep-linked scheduled visit", async () => {
    setOnline(false);
    const out = await persistVisitNote({ ...baseArgs, existingVisitId: "visit-sched" });
    expect(out).toMatchObject({ mode: "offline", visitId: "visit-sched" });
    const [action, payload] = addToSyncQueue.mock.calls[0];
    expect(action).toBe("UPDATE_VISIT");
    expect(payload.visit_id).toBe("visit-sched");
    expect(payload.status).toBe("completed");
    expect(visitCreate).not.toHaveBeenCalled();
  });

  it("online re-save with offlineClientRequestId updates the drained visit instead of creating", async () => {
    visitFilter.mockResolvedValueOnce([{ id: "visit-drained" }]);
    auditFilter.mockResolvedValueOnce([{ id: "audit-drained" }]);
    const out = await persistVisitNote({
      ...baseArgs,
      offlineClientRequestId: "rq-offline-1",
      vitals: { pain_level: 4 },
    });
    expect(out).toMatchObject({ mode: "update", visitId: "visit-drained", auditId: "audit-drained" });
    expect(visitFilter).toHaveBeenCalledWith({ client_request_id: "rq-offline-1" });
    expect(visitUpdate).toHaveBeenCalledWith("visit-drained", expect.objectContaining({
      nurse_notes: "Final note text", vital_signs: { pain_level: 4 }, grounding_pending: false,
    }));
    expect(auditUpdate).toHaveBeenCalledWith("audit-drained", expect.anything());
    expect(visitCreate).not.toHaveBeenCalled();
    expect(functionsInvoke).toHaveBeenCalledWith("appendPatientNoteHistory", expect.objectContaining({
      mode: "update", entry: expect.objectContaining({ visit_id: "visit-drained" }),
    }));
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
