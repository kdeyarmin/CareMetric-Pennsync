import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ROUTES } from "@/routes";
import {
  NAV_MANIFEST,
  buildPaletteEntries,
  isPageAllowedForRole,
  manifestRouteBlock,
} from "@/lib/nav.manifest";
import {
  bindTrustedTenantContext,
  clearTrustedTenantContext,
  getRoleView,
} from "@/lib/roles";

const agencyContext = (user, tenantRole) => ({
  user_id: user.id,
  user_email: user.email.toLowerCase(),
  membership_id: `membership-${user.id}`,
  membership_key: `agency-a:${user.id}`,
  membership_version: 3,
  agency_id: "agency-a",
  membership_status: "active",
  tenant_role: tenantRole,
  is_platform_owner: false,
  agency: { id: "agency-a", name: "Agency A", status: "active" },
});

const bind = (user, tenantRole) => bindTrustedTenantContext(user, agencyContext(user, tenantRole));

const nurse = { id: "nurse-1", email: "nurse@agency.test", role: "user", staff_role: "nurse" };
const admin = { id: "admin-1", email: "admin@agency.test", role: "user", staff_role: "nurse" };
const manager = { id: "manager-1", email: "manager@agency.test", role: "user", staff_role: "nurse" };
const office = { id: "office-1", email: "office@agency.test", role: "user", staff_role: "office_staff" };

const codeOnly = (path) => readFileSync(path, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "");

beforeEach(() => clearTrustedTenantContext());

describe("admin and nurse route matrix", () => {
  it("keeps every manifest page aligned between the route guard and the nav helper", () => {
    for (const [principal, tenantRole] of [
      [nurse, "clinician"],
      [admin, "agency_admin"],
      [manager, "manager"],
    ]) {
      clearTrustedTenantContext();
      const bound = bind(principal, tenantRole);
      const view = getRoleView(bound);
      for (const entry of NAV_MANIFEST) {
        const allowed = isPageAllowedForRole(entry.page, view, bound);
        expect(manifestRouteBlock(entry, bound) === null).toBe(allowed);
      }
    }
  });

  it("gives a facility admin the admin surface and withholds platform pages", () => {
    const bound = bind(admin, "agency_admin");
    const view = getRoleView(bound);
    expect(view).toBe("facility_admin");
    for (const entry of NAV_MANIFEST) {
      const allowed = isPageAllowedForRole(entry.page, view, bound);
      if (entry.superAdminOnly) expect(allowed).toBe(false);
      else expect(allowed).toBe(true);
    }
  });

  it("gives a nurse clinical work and refuses every admin-only page", () => {
    const bound = bind(nurse, "clinician");
    const view = getRoleView(bound);
    expect(view).toBe("nurse");
    const nursePages = [];
    const refused = [];
    for (const entry of NAV_MANIFEST) {
      const allowed = isPageAllowedForRole(entry.page, view, bound);
      if (entry.adminOnly) {
        expect(allowed).toBe(false);
        refused.push(entry.page);
      } else if (allowed) {
        nursePages.push(entry.page);
      }
    }
    expect(nursePages).toEqual(expect.arrayContaining([
      "Dashboard",
      "Patients",
      "PatientDetails",
      "OASISCenter",
      "ClinicalDocumentation",
      "SmartNoteAssistant",
      "Incidents",
      "Messages",
      "PhoneCenter",
      "SendFax",
      "TimeOff",
      "Timesheets",
      "LearningCenter",
      "NurseTrainingHub",
      "UserSettings",
    ]));
    expect(refused).toEqual(expect.arrayContaining([
      "UserManagement",
      "AdminOperations",
      "AdminTraining",
      "ReportsAnalytics",
      "ComplianceCenter",
      "IncidentReview",
      "DocumentHub",
      "ReferralIntake",
      "SuperAdminConfig",
      "ManagerSkillGapDashboard",
    ]));
  });

  it("lets a verified manager open skill gaps and referrals without the rest of admin", () => {
    const bound = bind(manager, "manager");
    const view = getRoleView(bound);
    expect(isPageAllowedForRole("ManagerSkillGapDashboard", view, bound)).toBe(true);
    expect(isPageAllowedForRole("ReferralIntake", view, bound)).toBe(true);
    expect(isPageAllowedForRole("AdminTraining", view, bound)).toBe(false);
    expect(isPageAllowedForRole("UserManagement", view, bound)).toBe(false);
    expect(isPageAllowedForRole("AIComplianceInServices", view, bound)).toBe(false);
    expect(isPageAllowedForRole("ReportsAnalytics", view, bound)).toBe(false);
    const route = ROUTES.find(({ name }) => name === "ManagerSkillGapDashboard");
    expect(route).toMatchObject({ adminOnly: true, managerRole: true });
    expect(manifestRouteBlock(route, bound)).toBe(null);
    const palette = buildPaletteEntries(NAV_MANIFEST, false, false, bound).map(({ page }) => page);
    expect(palette).toContain("ManagerSkillGapDashboard");
    expect(palette).not.toContain("AdminTraining");
    expect(palette).not.toContain("UserManagement");
  });

  it("does not treat office staff as managers", () => {
    const bound = bind(office, "office_staff");
    expect(manifestRouteBlock(
      NAV_MANIFEST.find((entry) => entry.page === "ManagerSkillGapDashboard"),
      bound,
    )).toBe("admin");
    expect(isPageAllowedForRole("ReferralIntake", getRoleView(bound), bound)).toBe(true);
    expect(isPageAllowedForRole("Patients", getRoleView(bound), bound)).toBe(false);
    expect(isPageAllowedForRole("OASISCenter", getRoleView(bound), bound)).toBe(false);
  });

  it("does not authorize training administration from profile fields", () => {
    for (const path of [
      "src/pages/AdminTraining.jsx",
      "src/pages/LearningCenter.jsx",
      "src/pages/ManagerSkillGapDashboard.jsx",
    ]) {
      const code = codeOnly(path);
      expect(code).not.toMatch(/training_role/);
      expect(code).not.toMatch(/account_type/);
    }
  });
});
