import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock the chart backend so we can assert what gets written ──────────────────
const visitCreate = vi.fn(async (p) => ({ id: "visit-1", ...p }));
const visitUpdate = vi.fn(async () => ({}));
const visitFilter = vi.fn(async () => []);
const noteConvCreate = vi.fn(async () => ({}));
const auditCreate = vi.fn(async () => ({ id: "audit-1" }));
const auditUpdate = vi.fn(async () => ({}));
const auditFilter = vi.fn(async () => []);
const defaultInvoke = async (name, payload) => (
  name === "createAuthorizedVisit"
    ? { data: { created: true, visit: { id: "visit-1", ...payload } } }
    : name === "updateAuthorizedVisit"
      ? {
          data: {
            updated: true,
            action: payload.action,
            visit: { id: payload.visit_id, patient_id: "p1", agency_id: "agency-1" },
          },
        }
      : { data: { success: true } }
);
const functionsInvoke = vi.fn(defaultInvoke);

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

import { persistVisitNote, createVisitSaveProgress, OfflineSaveError, PartialVisitSaveError } from "./persistVisitNote";

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
  beforeEach(() => {
    vi.clearAllMocks();
    functionsInvoke.mockReset().mockImplementation(defaultInvoke);
    noteConvCreate.mockReset().mockResolvedValue({});
    auditCreate.mockReset().mockResolvedValue({ id: 'audit-1' });
    auditUpdate.mockReset().mockResolvedValue({});
    setOnline(true);
    visitFilter.mockResolvedValue([]);
    auditFilter.mockResolvedValue([]);
  });
  afterEach(() => setOnline(true));

  it("returns null when required inputs are missing", async () => {
    expect(await persistVisitNote({ ...baseArgs, patientId: "" })).toBeNull();
    expect(await persistVisitNote({ ...baseArgs, result: null })).toBeNull();
    expect(visitCreate).not.toHaveBeenCalled();
  });

  it("creates a visit (with vitals) and the compliance records on a fresh save", async () => {
    const out = await persistVisitNote({ ...baseArgs, vitals: { heart_rate: 80 } });
    expect(out).toMatchObject({ mode: "create", visitId: "visit-1", auditId: "audit-1" });
    expect(visitCreate).not.toHaveBeenCalled();
    expect(functionsInvoke).toHaveBeenCalledWith("createAuthorizedVisit", expect.objectContaining({
      patient_id: "p1", visit_type: "routine_visit", nurse_notes: "Final note text",
      vital_signs: { heart_rate: 80 },
      grounding_pending: false,
    }));
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
    expect(functionsInvoke).toHaveBeenCalledWith("updateAuthorizedVisit", expect.objectContaining({
      action: "save_documentation",
      visit_id: "visit-sched",
      patient_id: "p1",
      status: "completed",
      vital_signs: { heart_rate: 70 },
    }));
    const updatePayload = functionsInvoke.mock.calls.find(([name]) => name === "updateAuthorizedVisit")[1];
    expect(updatePayload).not.toHaveProperty("visit_date");
    expect(updatePayload).not.toHaveProperty("visit_type");
    expect(visitUpdate).not.toHaveBeenCalled();
    expect(visitCreate).not.toHaveBeenCalled();
    expect(noteConvCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate.mock.calls[0][0]).toMatchObject({ visit_id: "visit-sched" });
  });

  it("updates the same visit (with vitals) on a re-save, never duplicating", async () => {
    const out = await persistVisitNote({ ...baseArgs, savedVisitId: "visit-9", savedAuditId: "audit-9", vitals: { temperature: 99 } });
    expect(out).toMatchObject({ mode: "update", visitId: "visit-9" });
    expect(functionsInvoke).toHaveBeenCalledWith("updateAuthorizedVisit", expect.objectContaining({
      action: "save_documentation",
      visit_id: "visit-9",
      patient_id: "p1",
      vital_signs: { temperature: 99 },
    }));
    expect(visitUpdate).not.toHaveBeenCalled();
    expect(auditUpdate).toHaveBeenCalledWith("audit-9", expect.anything());
    expect(visitCreate).not.toHaveBeenCalled();
    expect(functionsInvoke).toHaveBeenCalledWith("appendPatientNoteHistory", expect.objectContaining({
      patient_id: "p1", mode: "update",
      entry: expect.objectContaining({ visit_id: "visit-9", note: "Final note text" }),
    }));
  });

  it("commits the Visit revision before appending its immutable history event", async () => {
    let releaseVisitUpdate;
    functionsInvoke.mockImplementationOnce((name, payload) => new Promise((resolve) => {
      expect(name).toBe("updateAuthorizedVisit");
      releaseVisitUpdate = () => resolve({
        data: {
          updated: true,
          action: payload.action,
          visit: { id: payload.visit_id, patient_id: "p1", agency_id: "agency-1" },
        },
      });
    }));

    const pending = persistVisitNote({
      ...baseArgs,
      savedVisitId: "visit-9",
      savedAuditId: "audit-9",
    });
    await vi.waitFor(() => expect(releaseVisitUpdate).toBeTypeOf("function"));
    expect(functionsInvoke.mock.calls.map(([name]) => name))
      .toEqual(["updateAuthorizedVisit"]);

    releaseVisitUpdate();
    await pending;
    expect(functionsInvoke.mock.calls.map(([name]) => name))
      .toEqual(["updateAuthorizedVisit", "appendPatientNoteHistory"]);
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
  it('retains the confirmed Visit and finishes only the failed supporting stage on retry', async () => {
    const saveProgress = createVisitSaveProgress();
    auditCreate.mockRejectedValueOnce(new Error('provider details must stay private'));
    let failure;
    try { await persistVisitNote({ ...baseArgs, saveProgress }); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(PartialVisitSaveError);
    expect(failure).toMatchObject({ visitId: 'visit-1', auditId: null, pendingRecords: ['audit'] });
    expect(failure.message).not.toContain('provider details');
    expect(saveProgress).toMatchObject({ visitId: 'visit-1', noteConversionSaved: true });

    const out = await persistVisitNote({ ...baseArgs, savedVisitId: failure.visitId, saveProgress });
    expect(out).toMatchObject({ mode: 'create', visitId: 'visit-1', auditId: 'audit-1' });
    expect(functionsInvoke.mock.calls.filter(([name]) => name === 'createAuthorizedVisit')).toHaveLength(1);
    expect(functionsInvoke.mock.calls.filter(([name]) => name === 'appendPatientNoteHistory')).toHaveLength(1);
    expect(functionsInvoke.mock.calls.filter(([name]) => name === 'updateAuthorizedVisit')).toHaveLength(0);
    expect(noteConvCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledTimes(2);
  });

  it('waits for a late audit confirmation after another supporting write fails', async () => {
    const saveProgress = createVisitSaveProgress();
    let resolveAudit;
    auditCreate.mockImplementationOnce(() => new Promise((resolve) => { resolveAudit = resolve; }));
    noteConvCreate.mockRejectedValueOnce(new Error('conversion unavailable'));
    let settled = false;
    const pending = persistVisitNote({ ...baseArgs, saveProgress }).catch((error) => {
      settled = true;
      return error;
    });
    await vi.waitFor(() => expect(resolveAudit).toBeTypeOf('function'));
    expect(settled).toBe(false);
    expect(saveProgress.visitId).toBe('visit-1');
    resolveAudit({ id: 'late-audit' });
    const error = await pending;
    expect(error).toMatchObject({ auditId: 'late-audit', pendingRecords: ['conversion'] });
    await persistVisitNote({ ...baseArgs, saveProgress });
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditUpdate).not.toHaveBeenCalled();
    expect(noteConvCreate).toHaveBeenCalledTimes(2);
  });

  it('replays the exact creation identity and body after an unknown response, then applies edits', async () => {
    const saveProgress = createVisitSaveProgress();
    const committed = new Map();
    let loseResponse = true;
    functionsInvoke.mockImplementation(async (name, payload) => {
      if (name !== 'createAuthorizedVisit') return defaultInvoke(name, payload);
      if (!committed.has(payload.client_request_id)) {
        committed.set(payload.client_request_id, structuredClone(payload));
      }
      expect(payload).toEqual(committed.get(payload.client_request_id));
      if (loseResponse) { loseResponse = false; throw new Error('Response was lost'); }
      return { data: { created: false, visit: { id: 'visit-1', ...payload } } };
    });
    await expect(persistVisitNote({ ...baseArgs, saveProgress })).rejects.toThrow('Response was lost');
    expect(auditCreate).not.toHaveBeenCalled();
    const editedResult = { ...baseResult, finalNote: 'Updated final note text' };
    await persistVisitNote({ ...baseArgs, result: editedResult, saveProgress });
    expect(committed.size).toBe(1);
    const creates = functionsInvoke.mock.calls.filter(([name]) => name === 'createAuthorizedVisit');
    expect(creates).toHaveLength(2);
    expect(creates[0][1].client_request_id).toBe(saveProgress.clientRequestId);
    expect(creates[1][1]).toEqual(creates[0][1]);
    expect(functionsInvoke).toHaveBeenCalledWith('updateAuthorizedVisit', expect.objectContaining({
      visit_id: 'visit-1', nurse_notes: 'Updated final note text',
    }));
    expect(functionsInvoke).toHaveBeenCalledWith('appendPatientNoteHistory', expect.objectContaining({
      clinical_notes: 'Updated final note text',
    }));
  });

  it('refreshes confirmed supporting records when the nurse edits a partially saved note', async () => {
    const saveProgress = createVisitSaveProgress();
    noteConvCreate.mockRejectedValueOnce(new Error('conversion unavailable'));
    await expect(persistVisitNote({ ...baseArgs, saveProgress })).rejects.toBeInstanceOf(PartialVisitSaveError);
    await persistVisitNote({
      ...baseArgs, saveProgress,
      result: { ...baseResult, finalNote: 'Edited note', coverageScore: 95, acknowledgment: {
        acknowledged: true, justification: 'Reviewed updated finding', finding_ids: ['finding-1'],
      } },
    });
    expect(functionsInvoke.mock.calls.filter(([name]) => name === 'createAuthorizedVisit')).toHaveLength(1);
    expect(functionsInvoke.mock.calls.filter(([name]) => name === 'appendPatientNoteHistory')).toHaveLength(2);
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditUpdate).toHaveBeenCalledWith('audit-1', expect.objectContaining({
      acknowledgment: expect.objectContaining({ justification: 'Reviewed updated finding' }),
    }));
  });

  it('reports the existing Visit when an update during recovery fails', async () => {
    const saveProgress = createVisitSaveProgress();
    auditCreate.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(persistVisitNote({ ...baseArgs, saveProgress })).rejects.toBeInstanceOf(PartialVisitSaveError);
    functionsInvoke.mockImplementationOnce(async () => { throw new Error('update unavailable'); });
    await expect(persistVisitNote({
      ...baseArgs, saveProgress, result: { ...baseResult, finalNote: 'Edited note' },
    })).rejects.toMatchObject({ visitId: 'visit-1', pendingRecords: ['documentation'] });
    expect(functionsInvoke.mock.calls.filter(([name]) => name === 'createAuthorizedVisit')).toHaveLength(1);
  });

  it('does not permit concurrent saves with the same in-memory receipt', async () => {
    const saveProgress = createVisitSaveProgress();
    let finishCreate;
    functionsInvoke.mockImplementationOnce((name, payload) => new Promise((resolve) => {
      finishCreate = () => resolve(defaultInvoke(name, payload));
    }));
    const first = persistVisitNote({ ...baseArgs, saveProgress });
    await vi.waitFor(() => expect(finishCreate).toBeTypeOf('function'));
    await expect(persistVisitNote({ ...baseArgs, saveProgress })).rejects.toThrow('already being saved');
    finishCreate();
    await first;
    expect(functionsInvoke.mock.calls.filter(([name]) => name === 'createAuthorizedVisit')).toHaveLength(1);
  });

  it('rejects a receipt reused for another patient before issuing any writes', async () => {
    const saveProgress = createVisitSaveProgress();
    functionsInvoke.mockRejectedValueOnce(new Error('response lost'));
    await expect(persistVisitNote({ ...baseArgs, saveProgress })).rejects.toThrow('response lost');
    functionsInvoke.mockClear();
    await expect(persistVisitNote({ ...baseArgs, patientId: 'other-patient', saveProgress }))
      .rejects.toThrow('another patient or account');
    expect(functionsInvoke).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it.each([
    { patientId: 'other-patient' },
    { currentUser: { email: 'another-nurse@example.com' } },
    { savedVisitId: 'other-visit' },
  ])('never attaches an old Visit identity to a mismatched save context: %j', async (change) => {
    const saveProgress = createVisitSaveProgress();
    await persistVisitNote({ ...baseArgs, saveProgress });
    vi.clearAllMocks();
    let error;
    try { await persistVisitNote({ ...baseArgs, ...change, saveProgress }); } catch (caught) { error = caught; }
    expect(error.message).toMatch(/another.*Reopen the note/);
    expect(error).not.toBeInstanceOf(PartialVisitSaveError);
    expect(error).not.toHaveProperty('visitId');
    expect(error).not.toHaveProperty('auditId');
    expect(functionsInvoke).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

});
