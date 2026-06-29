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
      filter: vi.fn(async ({ patient_id }) => e.rows.filter((r) => r.patient_id === patient_id)),
      update: vi.fn(async (id, patch) => {
        const row = e.rows.find((r) => r.id === id);
        if (row) Object.assign(row, patch);
        return row;
      }),
    };
    return e;
  };
  db.Visit = makeEntity();
  db.CarePlan = makeEntity();
  db.PatientAlert = makeEntity();
  db.PendingPatientUpdate = makeEntity();
  // Representatives of the broader patient_id-linked set now reassigned on merge.
  db.OASISAssessment = makeEntity();
  db.DocumentSignature = makeEntity();
  db.Patient = makeEntity();
  return { base44: { entities: db } };
});

import { mergePatientInto, mergePatientGroup } from "./mergePatients";

beforeEach(() => {
  db.Visit.rows = [
    { id: "v1", patient_id: "dup" },
    { id: "v2", patient_id: "dup" },
    { id: "v3", patient_id: "other" },
  ];
  db.CarePlan.rows = [{ id: "cp1", patient_id: "dup" }];
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

    // Visits/care plans/pending updates for the duplicate now point at the survivor.
    expect(db.Visit.rows.filter((r) => r.patient_id === "keep").map((r) => r.id)).toEqual(["v1", "v2"]);
    expect(db.CarePlan.rows.find((r) => r.id === "cp1").patient_id).toBe("keep");
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
      Visit: 2, CarePlan: 1, PatientAlert: 0, PendingPatientUpdate: 1,
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
