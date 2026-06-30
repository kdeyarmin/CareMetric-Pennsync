/**
 * Unit tests for the nav active-state helpers (navActivePage / isNavItemActive).
 *
 * These guard the "you are here" behavior: a sub/detail page must keep its
 * parent sidebar section highlighted instead of leaving the nav with no active
 * indicator. Cases are derived from real NAV_MANIFEST entries so a manifest
 * change that breaks a parent chain fails here.
 */
import { describe, it, expect } from "vitest";
// nav.manifest and routes are mutually dependent; routes loads first in the app
// (App.jsx -> routes -> nav.manifest). Import it first here so the circular
// module graph initializes in the same order as production.
import "@/routes";
import { navActivePage, isNavItemActive, NAV_MAP } from "@/lib/nav.manifest";

describe("navActivePage", () => {
  it("returns a top-level sidebar page as itself", () => {
    expect(navActivePage("Patients")).toBe("Patients");
    expect(navActivePage("Dashboard")).toBe("Dashboard");
  });

  it("resolves a sub-page to its nearest sidebar ancestor", () => {
    // PatientDetails -> breadcrumbParent Patients (a sidebar item)
    expect(navActivePage("PatientDetails")).toBe("Patients");
    // PatientAlerts / PatientRecordDashboard also hang under Patients
    expect(navActivePage("PatientAlerts")).toBe("Patients");
    // AgencyAnalytics -> ReportsAnalytics (sidebar)
    expect(navActivePage("AgencyAnalytics")).toBe("ReportsAnalytics");
    // UserGuides -> Help (sidebar Tools)
    expect(navActivePage("UserGuides")).toBe("Help");
  });

  it("walks more than one hop to find a sidebar ancestor", () => {
    // AdminTrainingAnalytics -> AdminTraining (category null) -> AdminOperations (sidebar)
    expect(navActivePage("AdminTrainingAnalytics")).toBe("AdminOperations");
  });

  it("returns null for an unknown page", () => {
    expect(navActivePage("NotARealPage")).toBeNull();
  });

  it("never loops on a cyclic parent chain", () => {
    const cyclic = {
      A: { page: "A", category: null, breadcrumbParent: "B" },
      B: { page: "B", category: null, breadcrumbParent: "A" },
    };
    expect(navActivePage("A", cyclic)).toBeNull();
  });
});

describe("isNavItemActive", () => {
  it("matches a page exactly", () => {
    expect(isNavItemActive("Patients", "Patients")).toBe(true);
    expect(isNavItemActive("Messages", "Patients")).toBe(false);
  });

  it("highlights the parent sidebar item while on a sub-page", () => {
    expect(isNavItemActive("PatientDetails", "Patients")).toBe(true);
    expect(isNavItemActive("PatientDetails", "Messages")).toBe(false);
  });

  it("still lights a non-sidebar shortcut on its own page (bottom-nav Notes)", () => {
    // SmartNoteAssistant has category: null but is the bottom-nav "Notes" target.
    expect(NAV_MAP.SmartNoteAssistant.category).toBeNull();
    expect(isNavItemActive("SmartNoteAssistant", "SmartNoteAssistant")).toBe(true);
  });

  it("highlights at most one sidebar item for a given page", () => {
    const sidebarPages = Object.values(NAV_MAP)
      .filter((e) => e.category)
      .map((e) => e.page);
    const lit = sidebarPages.filter((p) => isNavItemActive("PatientDetails", p));
    expect(lit).toEqual(["Patients"]);
  });

  it("is falsy for a null/empty candidate", () => {
    expect(isNavItemActive("Patients", null)).toBe(false);
  });
});
