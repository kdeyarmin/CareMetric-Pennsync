import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock the chart backend so we can assert what gets written ──────────────────
const visitCreate = vi.fn(async (p) => ({ id: "visit-1", ...p }));
const visitUpdate = vi.fn(async () => ({}));
const noteConvCreate = vi.fn(async () => ({}));
const auditCreate = vi.fn(async () => ({ id: "audit-1" }));
const auditUpdate = vi.fn(async () => ({}));
const functionsInvoke = vi.fn(async () => ({ data: { success: true } }));
const addToSyncQueue = vi.fn(async () => {});
const upsertCreateVisitInSyncQueue = vi.fn(async () => {});

vi.mock("@/api/base44Client", () => ({
  base44: {
    entities: {
      Visit: { create: (...a) => visitCreate(...a), update: (...a) => visitUpdate(...a) },
      NoteConversion: { create: (...a) => noteConvCreate(...a) },
      ComplianceAudit: { create: (...a) => auditCreate(...a), update: (...a) => auditUpdate(...a) },
    },
    functions: { invoke: (...a) => functionsInvoke(...a) },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/utils/activityLogger", () => ({ logActivity: vi.fn(), ActivityActions: { NOTE_ENHANCED: "NOTE_ENHANCED" } }));
// Isolate from the (separately tested) pure compliance helpers.
vi.mock("@/components/smartNote/compliance/coverageScore", () => ({ deriveStructuredVisitFields: () => ({}), toNoteConversionFields: (x) => x }));
vi.mock("@/components/smartNote/compliance/reportingFields", () => ({ buildVisitReportingFields: () => ({}), buildAuditFields: () => ({ status: "ok" }) }));
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
      // Online save → grounding ran; the record is not flagged pending.
      grounding_pending: false,
    });
    expect(noteConvCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(visitUpdate).not.toHaveBeenCalled();
    // The note-history entry is appended via the atomic backend function (a
    // client-side read-modify-write lost entries on concurrent saves).
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
    // The re-save updates THIS visit's history entry (matched by visit_id
    // server-side), never blindly the last array element.
    expect(functionsInvoke).toHaveBeenCalledWith("appendPatientNoteHistory", expect.objectContaining({
      patient_id: "p1", mode: "update",
      entry: expect.objectContaining({ visit_id: "visit-9", note: "Final note text" }),
    }));
  });

  it("queues an offline visit (with vitals + audit meta) when offline", async () => {
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
    // Offline → grounding was deferred: the queued visit is flagged pending and
    // the audit is forced to pending_review (not the coverage-derived status).
    expect(payload.grounding_pending).toBe(true);
    expect(payload.__audit.status).toBe("pending_review");
    expect(visitCreate).not.toHaveBeenCalled();
    // Offline saves never reach the history-append function — the queue drain
    // handles the server writes on reconnect.
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
    // Both enqueues carry the same idempotency key — upsertCreateVisitInSyncQueue
    // replaces the prior payload so the drain creates one visit with the edit.
    expect(upsertCreateVisitInSyncQueue.mock.calls[0][0].client_request_id).toBe(key);
    expect(upsertCreateVisitInSyncQueue.mock.calls[1][0].client_request_id).toBe(key);
    expect(upsertCreateVisitInSyncQueue.mock.calls[1][0].nurse_notes).toBe("Edited final note");
    expect(upsertCreateVisitInSyncQueue.mock.calls[1][0].vital_signs).toEqual({ pain_level: 5 });
    // No plain addToSyncQueue CREATE path — that would leave two queue items.
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
    // An existing visit is updated in place — no CREATE_VISIT.
    expect(visitCreate).not.toHaveBeenCalled();
  });

  it("queues UPDATE_VISIT (status completed) when offline documenting a deep-linked scheduled visit", async () => {
    setOnline(false);
    const out = await persistVisitNote({ ...baseArgs, existingVisitId: "visit-sched" });
    expect(out).toMatchObject({ mode: "offline", visitId: "visit-sched" });
    const [action, payload] = addToSyncQueue.mock.calls[0];
    expect(action).toBe("UPDATE_VISIT");
    expect(payload.visit_id).toBe("visit-sched");
    // The queued update closes the scheduled visit so it stops triggering overdue alerts.
    expect(payload.status).toBe("completed");
    expect(visitCreate).not.toHaveBeenCalled();
  });
});
