import { describe, it, expect, vi, beforeEach } from "vitest";

const { invoke, entityAccess } = vi.hoisted(() => ({ invoke: vi.fn(), entityAccess: vi.fn() }));

vi.mock("@/api/base44Client", () => ({
  base44: {
    functions: { invoke },
    // Any entity access from the merge boundary is a test failure: Patient and
    // its linked tables are service-only and must move through the broker.
    entities: new Proxy({}, { get: (_t, name) => entityAccess(name) }),
  },
}));

import {
  mergePatientInto,
  mergePatientGroup,
  buildFieldMergePatch,
  MERGE_PATCH_FIELDS,
  PATIENT_MERGES_PAUSED,
  PatientMergeIncompleteError,
  scanDuplicatePatients,
} from "./mergePatients";

const complete = (overrides = {}) => ({
  data: {
    success: true,
    complete: true,
    keep_id: "keep",
    merged_ids: ["dup"],
    incomplete: [],
    fields_merged: ["allergies"],
    reassigned: { "Visit.patient_id": 3, "OASISFeedback.patient_id": 1, "OASISFeedback.actual_patient_id": 1 },
    ...overrides,
  },
});

describe("browser patient merge boundary", () => {
  beforeEach(() => {
    invoke.mockReset();
    entityAccess.mockReset();
  });

  it("is enabled and merges through the deduplicatePatients broker only", async () => {
    expect(PATIENT_MERGES_PAUSED).toBe(false);
    invoke.mockResolvedValueOnce(complete());
    const outcome = await mergePatientInto("keep", "dup", { agencyId: "agency-a" });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("deduplicatePatients", {
      action: "merge",
      keep_id: "keep",
      duplicate_ids: ["dup"],
      agency_id: "agency-a",
    });
    expect(outcome.patientsMerged).toBe(1);
    // Per-field counts roll up per entity for the UI.
    expect(outcome.reassigned).toEqual({ Visit: 3, OASISFeedback: 2 });
    expect(outcome.fieldsMerged).toEqual(["allergies"]);
    expect(entityAccess).not.toHaveBeenCalled();
  });

  it("sends a whole group in one call, deduplicated and without the survivor", async () => {
    invoke.mockResolvedValueOnce(complete({ merged_ids: ["d1", "d2"] }));
    const outcome = await mergePatientGroup("keep", ["d1", "keep", "d2", "d1", ""]);
    expect(invoke).toHaveBeenCalledWith("deduplicatePatients", {
      action: "merge",
      keep_id: "keep",
      duplicate_ids: ["d1", "d2"],
    });
    expect(outcome.patientsMerged).toBe(2);
  });

  it("forwards a field patch only when it names something", async () => {
    invoke.mockResolvedValue(complete());
    await mergePatientInto("keep", "dup", { fieldPatch: {} });
    expect(invoke.mock.calls[0][1]).not.toHaveProperty("field_patch");
    await mergePatientInto("keep", "dup", { fieldPatch: { allergies: "NKDA" } });
    expect(invoke.mock.calls[1][1].field_patch).toEqual({ allergies: "NKDA" });
  });

  it("rejects a merge the broker could not finish, carrying its report for a retry", async () => {
    const partial = {
      complete: false,
      merged_ids: [],
      incomplete: [{ duplicate_id: "dup", failed: { "Visit.patient_id": 1 }, pending: [] }],
    };
    invoke.mockResolvedValueOnce({ data: partial });
    const error = await mergePatientInto("keep", "dup").catch((caught) => caught);
    expect(error).toBeInstanceOf(PatientMergeIncompleteError);
    expect(error.result).toEqual(partial);
    expect(error.message).toMatch(/run the merge again/i);
  });

  it("propagates a broker refusal", async () => {
    invoke.mockRejectedValueOnce(new Error("Request failed with status code 403"));
    await expect(mergePatientInto("keep", "dup")).rejects.toThrow(/403/);
  });

  it("still rejects malformed merge requests before any call", async () => {
    await expect(mergePatientInto("", "dup")).rejects.toThrow(/requires a primary/i);
    await expect(mergePatientInto("same", "same")).rejects.toThrow(/itself/i);
    await expect(mergePatientGroup("", ["dup"])).rejects.toThrow(/requires a survivor/i);
    await expect(mergePatientGroup("keep", Array.from({ length: 26 }, (_, i) => `d${i}`)))
      .rejects.toThrow(/at most 25/);
    expect(await mergePatientGroup("keep", ["keep"])).toEqual({
      patientsMerged: 0, reassigned: {}, fieldsMerged: [], result: null,
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("previews a server scan without merging", async () => {
    invoke.mockResolvedValueOnce({ data: { dry_run: true, details: [] } });
    expect(await scanDuplicatePatients()).toEqual({ dry_run: true, details: [] });
    expect(invoke).toHaveBeenCalledWith("deduplicatePatients", { action: "scan" });
  });
});

describe("field-level merge planning", () => {
  it("the survivor inherits what it lacks without overwriting populated fields", () => {
    const winner = {
      allergies: "",
      date_of_birth: "",
      primary_diagnosis: "CHF",
      current_medications: [{ name: "Lasix" }],
    };
    const loser = {
      allergies: "Penicillin",
      date_of_birth: "1950-04-15",
      primary_diagnosis: "COPD",
      current_medications: [{ name: "Lasix" }, { name: "Lisinopril" }],
      enhanced_notes_history: [{ entry_id: "e9", note: "old note", timestamp: "2026-01-01" }],
    };

    const patch = buildFieldMergePatch(winner, loser);
    expect(patch.allergies).toBe("Penicillin");
    expect(patch.date_of_birth).toBe("1950-04-15");
    expect(patch.primary_diagnosis).toBeUndefined();
    expect(patch.current_medications.map((m) => m.name).sort()).toEqual(["Lasix", "Lisinopril"]);
    // The legacy embedded notes array is read-only by schema; note revisions
    // move as PatientNoteHistoryEntry copies on the server instead.
    expect(patch).not.toHaveProperty("enhanced_notes_history");
  });

  it("is empty when the loser adds nothing", () => {
    const winner = { allergies: "NKDA", current_medications: [{ name: "Lasix" }] };
    const loser = { allergies: "", current_medications: [{ name: "Lasix" }] };
    expect(buildFieldMergePatch(winner, loser)).toEqual({});
  });

  it("only ever plans fields on the broker's allowlist", () => {
    const everything = Object.fromEntries(
      ["id", "agency_id", "created_by_user_id", "status", "is_archived", "merged_into_id",
        "assigned_nurses", "enhanced_notes_history", ...MERGE_PATCH_FIELDS]
        .map((field) => [field, field.endsWith("s") ? ["x"] : "x"]),
    );
    const planned = Object.keys(buildFieldMergePatch({}, everything));
    expect(planned.every((field) => MERGE_PATCH_FIELDS.includes(field))).toBe(true);
    expect(planned).not.toContain("agency_id");
    expect(planned).not.toContain("merged_into_id");
  });
});
