import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory backend stub. Each entity tracks filter/update calls so we can
// assert on reassignment and the archive write.
const { db } = vi.hoisted(() => ({ db: {} }));

vi.mock("@/api/base44Client", () => {
  const makeEntity = () => {
    // filter/update read `e.rows` at call time, so reassigning rows in
    // beforeEach is reflected (closing over a captured array would go stale).
    const e = {
      rows: [],
      filter: vi.fn(async (query) => {
        // Support both lookup shapes the module uses: by id (survivor
        // validation) and by patient_id (reassignment).
        if (query && "id" in query) return e.rows.filter((r) => r.id === query.id);
        return e.rows.filter((r) => r.patient_id === query?.patient_id);
      }),
      update: vi.fn(async (id, patch) => {
        const row = e.rows.find((r) => r.id === id);
        if (row) Object.assign(row, patch);
        return row;
      }),
    };
    return e;
  };
  db.Visit = makeEntity();
  db.PatientAlert = makeEntity();
  db.PendingPatientUpdate = makeEntity();
  // Representatives of the broader patient_id-linked set now reassigned on merge.
  db.OASISAssessment = makeEntity();
  db.DocumentSignature = makeEntity();
  db.Patient = makeEntity();
  return { base44: { entities: db } };
});

import fs from "node:fs";
import path from "node:path";
import {
  mergePatientInto,
  mergePatientGroup,
  buildFieldMergePatch,
  PATIENT_RELATED_ENTITIES,
} from "./mergePatients";

beforeEach(() => {
  db.Visit.rows = [
    { id: "v1", patient_id: "dup" },
    { id: "v2", patient_id: "dup" },
    { id: "v3", patient_id: "other" },
  ];
  db.PatientAlert.rows = [];
  db.PendingPatientUpdate.rows = [{ id: "pu1", patient_id: "dup" }];
  db.OASISAssessment.rows = [{ id: "oa1", patient_id: "dup" }];
  db.DocumentSignature.rows = [
    { id: "ds1", patient_id: "dup" },
    { id: "ds2", patient_id: "other" },
  ];
  db.Patient.rows = [
    { id: "keep", first_name: "John", is_archived: false, status: "active" },
    { id: "dup", first_name: "John", is_archived: false, status: "active" },
  ];
  for (const e of Object.values(db)) {
    e.filter.mockClear();
    e.update.mockClear();
  }
});

describe("mergePatientInto", () => {
  it("reassigns related records to the survivor and archives the duplicate", async () => {
    const result = await mergePatientInto("keep", "dup", { mergedBy: "admin@x.com" });

    // Visits/pending updates for the duplicate now point at the survivor.
    expect(db.Visit.rows.filter((r) => r.patient_id === "keep").map((r) => r.id)).toEqual(["v1", "v2"]);
    expect(db.PendingPatientUpdate.rows.find((r) => r.id === "pu1").patient_id).toBe("keep");
    // Other patient_id-linked clinical records (OASIS, document signatures, …) also
    // follow the patient to the survivor.
    expect(db.OASISAssessment.rows.find((r) => r.id === "oa1").patient_id).toBe("keep");
    expect(db.DocumentSignature.rows.find((r) => r.id === "ds1").patient_id).toBe("keep");
    // An unrelated visit / signature is untouched.
    expect(db.Visit.rows.find((r) => r.id === "v3").patient_id).toBe("other");
    expect(db.DocumentSignature.rows.find((r) => r.id === "ds2").patient_id).toBe("other");

    // The duplicate is soft-archived and pointed at the survivor — not deleted.
    const dup = db.Patient.rows.find((r) => r.id === "dup");
    expect(dup.is_archived).toBe(true);
    expect(dup.status).toBe("merged");
    expect(dup.merged_into_id).toBe("keep");
    expect(dup.merged_by).toBe("admin@x.com");
    expect(dup.merged_at).toBeTruthy();

    expect(result.reassigned).toEqual({
      Visit: 2, PatientAlert: 0, PendingPatientUpdate: 1,
      OASISAssessment: 1, DocumentSignature: 1,
    });
  });

  it("rejects merging a patient into itself", async () => {
    await expect(mergePatientInto("same", "same")).rejects.toThrow(/itself/i);
  });

  it("omits merged_by when no user is supplied", async () => {
    await mergePatientInto("keep", "dup");
    const dup = db.Patient.rows.find((r) => r.id === "dup");
    expect(dup.merged_by).toBeUndefined();
  });
});

describe("mergePatientGroup", () => {
  it("merges several duplicates and aggregates counts, skipping the survivor", async () => {
    db.Patient.rows.push({ id: "dup2", first_name: "John", is_archived: false, status: "active" });
    db.Visit.rows.push({ id: "v4", patient_id: "dup2" });

    const result = await mergePatientGroup("keep", ["dup", "dup2", "keep"]);

    expect(result.patientsMerged).toBe(2);
    expect(result.reassigned.Visit).toBe(3); // v1, v2 from dup + v4 from dup2
    expect(db.Patient.rows.find((r) => r.id === "dup").is_archived).toBe(true);
    expect(db.Patient.rows.find((r) => r.id === "dup2").is_archived).toBe(true);
    // The survivor was never archived.
    expect(db.Patient.rows.find((r) => r.id === "keep").is_archived).toBe(false);
  });
});

describe("survivor validation (regression)", () => {
  it("refuses to merge into a nonexistent chart", async () => {
    await expect(mergePatientInto("ghost-404", "dup")).rejects.toThrow(/not found/i);
    // Nothing moved, nothing archived.
    expect(db.Visit.rows.every((r) => r.patient_id !== "ghost-404")).toBe(true);
    expect(db.Patient.rows.find((r) => r.id === "dup").is_archived).toBe(false);
  });

  it("refuses to merge into an archived/merged chart", async () => {
    db.Patient.rows.push({ id: "gone", is_archived: true, status: "merged" });
    await expect(mergePatientInto("gone", "dup")).rejects.toThrow(/archived/i);
  });
});

describe("field-level merge (regression)", () => {
  it("the survivor inherits what it lacks; populated fields are never overwritten", async () => {
    Object.assign(db.Patient.rows.find((r) => r.id === "keep"), {
      allergies: "", date_of_birth: "", primary_diagnosis: "CHF",
      current_medications: [{ name: "Lasix" }],
    });
    Object.assign(db.Patient.rows.find((r) => r.id === "dup"), {
      allergies: "Penicillin", date_of_birth: "1950-04-15", primary_diagnosis: "COPD",
      current_medications: [{ name: "Lasix" }, { name: "Lisinopril" }],
      enhanced_notes_history: [{ entry_id: "e9", note: "old note", timestamp: "2026-01-01" }],
    });

    await mergePatientInto("keep", "dup");
    const keep = db.Patient.rows.find((r) => r.id === "keep");
    expect(keep.allergies).toBe("Penicillin");        // filled from loser
    expect(keep.date_of_birth).toBe("1950-04-15");    // filled from loser
    expect(keep.primary_diagnosis).toBe("CHF");       // winner value kept
    expect(keep.current_medications.map((m) => m.name).sort()).toEqual(["Lasix", "Lisinopril"]); // unioned
    expect(keep.enhanced_notes_history.map((e) => e.entry_id)).toContain("e9"); // history concatenated
  });

  it("buildFieldMergePatch is empty when the loser adds nothing", () => {
    const winner = { allergies: "NKDA", current_medications: [{ name: "Lasix" }] };
    const loser = { allergies: "", current_medications: [{ name: "Lasix" }] };
    expect(buildFieldMergePatch(winner, loser)).toEqual({});
  });
});

describe("entity-list parity with the schemas (regression)", () => {
  it("covers every base44 entity that carries patient_id", () => {
    // 37 patient-linked entities (CarePlan, FaceToFaceEncounter, Immunization,
    // Billing, …) were missing from the list — merged charts silently lost them.
    const entitiesDir = path.resolve("base44/entities"); // resolves against the repo root (vitest cwd)
    const withPatientId = fs.readdirSync(entitiesDir)
      .filter((f) => f.endsWith(".jsonc"))
      .filter((f) => fs.readFileSync(path.join(entitiesDir, f), "utf8").includes('"patient_id"'))
      .map((f) => f.replace(/\.jsonc$/, ""))
      .filter((name) => name !== "Patient");
    const listed = new Set(PATIENT_RELATED_ENTITIES);
    const missing = withPatientId.filter((name) => !listed.has(name));
    expect(missing).toEqual([]);
  });
});
