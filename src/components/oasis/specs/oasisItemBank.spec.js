import { describe, it, expect } from "vitest";
import { OASIS_SECTIONS } from "../oasisQuestions.jsx";
import { classifyItem, itemDisclaimer, officialItemNumber } from "./verification.js";

const allItems = OASIS_SECTIONS.flatMap((section) =>
  (section.questions || []).map((q) => ({ ...q, sectionId: section.id })),
);

describe("OASIS item bank ↔ verification registry contract", () => {
  it("has items to check", () => {
    expect(allItems.length).toBeGreaterThan(20);
  });

  it("classifies every item in the bank", () => {
    for (const item of allItems) {
      const c = classifyItem(item.id);
      expect(c.level, `${item.id} must resolve to a classification`).toBeTruthy();
      expect(itemDisclaimer(item.id), `${item.id} needs a disclaimer`).toBeTruthy();
    }
  });

  it("never labels a non-current item with a CMS item number", () => {
    // The 2026-08-31 defect: three screening questions displayed M2102 / M2110 /
    // M2200 — item numbers whose CMS content is something else entirely. A nurse
    // could have carried a wrong item number into the official assessment.
    for (const item of allItems) {
      const c = classifyItem(item.id);
      // A retired item and an invented item number are as misleading as a
      // PennSync question wearing a CMS number: each sends a nurse to the
      // official assessment looking for something that is not there.
      if (!["pennsync_screening", "retired", "not_a_cms_item"].includes(c.level)) continue;
      expect(officialItemNumber(item.id)).toBeNull();
      expect(
        item.label,
        `${item.id} is not a current CMS item — its label must not display an M-number`,
      ).not.toMatch(/\bM\d{4}\b/);
      expect(item.label.toLowerCase()).toContain("pennsync screening item");
    }
  });

  it("keeps the three previously mislabelled therapy items as screening items", () => {
    for (const id of ["m2102", "m2110", "m2200"]) {
      const item = allItems.find((q) => q.id === id);
      expect(item, `${id} must still exist so stored responses keep resolving`).toBeTruthy();
      expect(classifyItem(id).level).toBe("pennsync_screening");
    }
  });

  it("marks every item the CMS source check found retired or invented", () => {
    // Verified 2026-09-01 against the published OASIS-E, E1 and E2 manuals.
    const retired = ["m0069", "m1030", "m1242", "m1730", "m1910"];
    const invented = ["m1020", "m1300", "m1350", "m1900"];
    for (const id of retired) expect(classifyItem(id).level, id).toBe("retired");
    for (const id of invented) expect(classifyItem(id).level, id).toBe("not_a_cms_item");
    // All nine must still exist: the scoring engine and stored responses key off
    // these ids, so removing them would break working data.
    for (const id of [...retired, ...invented]) {
      expect(allItems.find((q) => q.id === id), `${id} must still exist`).toBeTruthy();
    }
  });

  it("only shows an M-number on items the registry allows one for", () => {
    for (const item of allItems) {
      const shown = item.label.match(/\bM\d{4}\b/)?.[0];
      if (!shown) continue;
      expect(
        officialItemNumber(item.id),
        `${item.id} displays ${shown} but the registry does not permit a CMS item number`,
      ).toBe(shown);
    }
  });

  it("gives every item a stable id and at least one response option", () => {
    const seen = new Set();
    for (const item of allItems) {
      expect(item.id, "every item needs an id").toBeTruthy();
      expect(seen.has(item.id), `duplicate item id ${item.id}`).toBe(false);
      seen.add(item.id);
      if (item.type === "radio" || item.type === "select") {
        expect((item.options || []).length, `${item.id} needs options`).toBeGreaterThan(0);
      }
    }
  });
});
