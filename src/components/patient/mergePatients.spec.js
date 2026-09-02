import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  mergePatientInto,
  mergePatientGroup,
  buildFieldMergePatch,
  PATIENT_MERGE_PAUSED_MESSAGE,
  PATIENT_RELATED_ENTITIES,
  SERVER_MERGE_REQUIRED_ENTITIES,
} from "./mergePatients";

describe("fail-closed browser patient merge boundary", () => {
  it("refuses a merge before any client entity can be read, reassigned, or archived", async () => {
    await expect(mergePatientInto("keep", "dup"))
      .rejects.toThrow(PATIENT_MERGE_PAUSED_MESSAGE);
  });

  it("refuses a group merge instead of partially moving its first duplicate", async () => {
    await expect(mergePatientGroup("keep", ["dup", "dup2"]))
      .rejects.toThrow(/atomic server broker/i);
  });

  it("still rejects malformed merge requests with specific errors", async () => {
    await expect(mergePatientInto("", "dup")).rejects.toThrow(/requires a primary/i);
    await expect(mergePatientInto("same", "same")).rejects.toThrow(/itself/i);
    await expect(mergePatientGroup("", ["dup"])).rejects.toThrow(/requires a survivor/i);
  });
});

describe("field-level merge planning", () => {
  it("the survivor would inherit what it lacks without overwriting populated fields", () => {
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
    expect(patch.enhanced_notes_history.map((e) => e.entry_id)).toContain("e9");
  });

  it("is empty when the loser adds nothing", () => {
    const winner = { allergies: "NKDA", current_medications: [{ name: "Lasix" }] };
    const loser = { allergies: "", current_medications: [{ name: "Lasix" }] };
    expect(buildFieldMergePatch(winner, loser)).toEqual({});
  });
});

describe("future server-broker entity-list parity", () => {
  it("covers every Base44 entity that carries patient_id", () => {
    const entitiesDir = path.resolve("base44/entities");
    const withPatientId = fs.readdirSync(entitiesDir)
      .filter((file) => file.endsWith(".jsonc"))
      .filter((file) => fs.readFileSync(path.join(entitiesDir, file), "utf8").includes('"patient_id"'))
      .map((file) => file.replace(/\.jsonc$/, ""))
      .filter((name) => name !== "Patient");
    const listed = new Set([...PATIENT_RELATED_ENTITIES, ...SERVER_MERGE_REQUIRED_ENTITIES]);
    expect(withPatientId.filter((name) => !listed.has(name))).toEqual([]);
  });
});
