import { beforeEach, describe, it, expect } from "vitest";
// nav.manifest and routes form a (pre-existing) import cycle that resolves only
// when routes.jsx is the entry — the order the real app loads them (App.jsx).
// Import routes first so importing nav.manifest below doesn't see an undefined
// NAV_MANIFEST mid-evaluation.
import "@/routes";
import {
  getStaffRole,
  isClinicalUser,
  canViewPatients,
  canAccessLevel,
  ACCESS,
  userRoleLabel,
  staffRoleLabel,
  getRoleView,
  isAdminView,
  bindTrustedTenantContext,
  clearTrustedTenantContext,
  getTrustedTenantContext,
  getTenantAuthorityKey,
} from "@/lib/roles";
import { isPageAllowedForRole } from "@/lib/nav.manifest";

// Representative users across the staff-discipline axis. `legacy` has no
// staff_role (every pre-existing account) and must behave exactly like a nurse so
// the feature never silently removes access from someone already in the system.
const nurse = { role: "user", staff_role: "nurse" };
const office = { role: "user", staff_role: "office_staff" };
const social = { role: "user", staff_role: "social_worker" };
const spiritual = { role: "user", staff_role: "spiritual_care" };
const admin = { role: "admin" };
const legacy = { role: "user" };

const agencyAdminContext = (user, tenantRole = "agency_admin") => ({
  user_id: user.id,
  user_email: user.email.toLowerCase(),
  membership_id: "membership-a",
  membership_key: `agency-a:${user.id}`,
  membership_version: 2,
  agency_id: "agency-a",
  membership_status: "active",
  tenant_role: tenantRole,
  is_platform_owner: false,
  agency: { id: "agency-a", name: "Agency A", status: "active" },
});

beforeEach(() => clearTrustedTenantContext());

describe("admin role trust boundary", () => {
  it("does not elevate self-mutable account_type values", () => {
    for (const account_type of ["agency_admin", "super_admin"]) {
      const spoofed = { role: "user", account_type };
      expect(getRoleView(spoofed)).toBe("nurse");
      expect(isAdminView(spoofed)).toBe(false);
    }
    expect(getRoleView(admin)).toBe("nurse");
    expect(isAdminView(admin)).toBe(false);
  });

  it("elevates only an exact service-validated active agency-admin binding", () => {
    const raw = { id: "user-a", email: "Admin@Agency.test", role: "user" };
    const context = agencyAdminContext(raw);
    const bound = bindTrustedTenantContext(raw, context);
    expect(bound).not.toBe(raw);
    expect(getTrustedTenantContext(bound)).toMatchObject(context);
    expect(getRoleView(bound)).toBe("facility_admin");
    expect(isAdminView(bound)).toBe(true);
    // A later SDK re-fetch returns a fresh object for the same authenticated
    // principal; it must receive the same UI role for route/page consistency.
    expect(getRoleView({ ...raw })).toBe("facility_admin");
    expect(getRoleView({ ...raw, id: "user-b" })).toBe("nurse");
    expect(getRoleView({ ...raw, email: "other@agency.test" })).toBe("nurse");
    expect(getTenantAuthorityKey(bound)).toContain('"agency-a"');

    clearTrustedTenantContext();
    expect(getRoleView({ ...raw })).toBe("nurse");
    expect(getRoleView(bound)).toBe("nurse");
    expect(getTenantAuthorityKey(bound)).toBeNull();
  });

  it("requires tenant context even for the protected built-in admin role", () => {
    const raw = { id: "user-admin", email: "built-in@agency.test", role: "admin" };
    expect(getRoleView(raw)).toBe("nurse");
    const bound = bindTrustedTenantContext(raw, agencyAdminContext(raw, "manager"));
    expect(getRoleView(bound)).toBe("facility_admin");
    expect(isAdminView({ ...raw })).toBe(true);
  });

  it("fails closed for mismatched, inactive, or JSON-spoofed tenant context", () => {
    const raw = {
      id: "user-a",
      email: "admin@agency.test",
      role: "user",
      tenant_role: "agency_admin",
      membership_status: "active",
    };
    const mismatch = bindTrustedTenantContext(raw, {
      user_id: "user-b",
      user_email: "admin@agency.test",
      membership_status: "active",
      tenant_role: "agency_admin",
      is_platform_owner: false,
    });
    const inactive = bindTrustedTenantContext(raw, {
      user_id: "user-a",
      user_email: "admin@agency.test",
      membership_status: "revoked",
      tenant_role: "agency_admin",
      is_platform_owner: false,
    });
    expect(getRoleView(raw)).toBe("nurse");
    expect(getRoleView(mismatch)).toBe("nurse");
    expect(getRoleView(inactive)).toBe("nurse");
  });

  it("binds only a membership-free, agency-free platform-owner context", () => {
    const raw = { id: "owner-a", email: "owner@example.test", role: "admin" };
    const exactOwnerContext = {
      user_id: raw.id,
      user_email: raw.email,
      membership_id: null,
      membership_key: null,
      membership_version: null,
      agency_id: null,
      membership_status: null,
      tenant_role: "platform_owner",
      is_platform_owner: true,
      agency: null,
    };

    const bound = bindTrustedTenantContext(raw, exactOwnerContext);
    expect(getTrustedTenantContext(bound)).toEqual(exactOwnerContext);
    expect(getTenantAuthorityKey(bound)).not.toBeNull();

    const rejected = bindTrustedTenantContext(raw, {
      ...exactOwnerContext,
      agency_id: "agency-a",
      agency: { id: "agency-a", name: "Agency A", status: "active" },
    });
    expect(getTrustedTenantContext(rejected)).toBeNull();
    expect(getTenantAuthorityKey(rejected)).toBeNull();
  });
});

describe("getStaffRole", () => {
  it("defaults unknown/unset to nurse (backward compatible)", () => {
    expect(getStaffRole(legacy)).toBe("nurse");
    expect(getStaffRole(null)).toBe("nurse");
    expect(getStaffRole({ staff_role: "bogus" })).toBe("nurse");
  });
  it("resolves explicit staff roles", () => {
    expect(getStaffRole(office)).toBe("office_staff");
    expect(getStaffRole(social)).toBe("social_worker");
    expect(getStaffRole(spiritual)).toBe("spiritual_care");
  });
});

describe("isClinicalUser — sees nursing tools (OASIS, notes, care plans)", () => {
  it("is true for nurses, admins, and legacy (no staff_role) users", () => {
    expect(isClinicalUser(nurse)).toBe(true);
    expect(isClinicalUser(admin)).toBe(true);
    expect(isClinicalUser(legacy)).toBe(true);
  });
  it("is false for office / social work / spiritual care", () => {
    expect(isClinicalUser(office)).toBe(false);
    expect(isClinicalUser(social)).toBe(false);
    expect(isClinicalUser(spiritual)).toBe(false);
  });
  it("fails closed for a not-yet-loaded (falsy) user", () => {
    expect(isClinicalUser(null)).toBe(false);
    expect(isClinicalUser(undefined)).toBe(false);
  });
});

describe("canViewPatients — everyone except office staff", () => {
  it("allows nurse, social worker, spiritual care, admin", () => {
    expect(canViewPatients(nurse)).toBe(true);
    expect(canViewPatients(social)).toBe(true);
    expect(canViewPatients(spiritual)).toBe(true);
    expect(canViewPatients(admin)).toBe(true);
  });
  it("blocks office staff", () => {
    expect(canViewPatients(office)).toBe(false);
  });
  it("fails closed for a not-yet-loaded (falsy) user", () => {
    expect(canViewPatients(null)).toBe(false);
  });
});

describe("canAccessLevel — the shared per-page gate", () => {
  it("general (or unset) is open to everyone", () => {
    for (const u of [nurse, office, social, spiritual, admin]) {
      expect(canAccessLevel(u, ACCESS.GENERAL)).toBe(true);
      expect(canAccessLevel(u, undefined)).toBe(true);
    }
  });
  it("nursing is nurse + admin only", () => {
    expect(canAccessLevel(nurse, ACCESS.NURSING)).toBe(true);
    expect(canAccessLevel(admin, ACCESS.NURSING)).toBe(true);
    expect(canAccessLevel(social, ACCESS.NURSING)).toBe(false);
    expect(canAccessLevel(spiritual, ACCESS.NURSING)).toBe(false);
    expect(canAccessLevel(office, ACCESS.NURSING)).toBe(false);
  });
  it("patient excludes office staff", () => {
    expect(canAccessLevel(nurse, ACCESS.PATIENT)).toBe(true);
    expect(canAccessLevel(social, ACCESS.PATIENT)).toBe(true);
    expect(canAccessLevel(spiritual, ACCESS.PATIENT)).toBe(true);
    expect(canAccessLevel(admin, ACCESS.PATIENT)).toBe(true);
    expect(canAccessLevel(office, ACCESS.PATIENT)).toBe(false);
  });
  it("fails closed for a falsy user (non-general) and unknown levels", () => {
    expect(canAccessLevel(null, ACCESS.GENERAL)).toBe(true);
    expect(canAccessLevel(null, ACCESS.PATIENT)).toBe(false);
    expect(canAccessLevel(null, ACCESS.NURSING)).toBe(false);
    expect(canAccessLevel(nurse, "made_up_level")).toBe(false);
    expect(canAccessLevel(admin, "made_up_level")).toBe(false);
  });
});

describe("userRoleLabel / staffRoleLabel", () => {
  it("shows discipline for staff and admin tier for admins", () => {
    expect(userRoleLabel(social)).toBe("Social Worker");
    expect(userRoleLabel(office)).toBe("Office Staff");
    expect(userRoleLabel(nurse)).toBe("Nurse");
    const authorizedAdmin = { id: "user-admin", email: "admin@agency.test", role: "admin" };
    bindTrustedTenantContext(authorizedAdmin, agencyAdminContext(authorizedAdmin));
    expect(userRoleLabel(authorizedAdmin)).toBe("Admin");
    expect(userRoleLabel({ role: "manager" })).toBe("Manager");
  });
  it("staffRoleLabel falls back gracefully", () => {
    expect(staffRoleLabel("spiritual_care")).toBe("Spiritual Care");
    expect(staffRoleLabel(undefined)).toBe("Nurse");
  });
});

describe("isPageAllowedForRole — URL-level route guard", () => {
  it("blocks office staff from patient + nursing pages but allows general", () => {
    expect(isPageAllowedForRole("OASISCenter", "nurse", office)).toBe(false);
    expect(isPageAllowedForRole("Patients", "nurse", office)).toBe(false);
    expect(isPageAllowedForRole("LearningCenter", "nurse", office)).toBe(true);
    expect(isPageAllowedForRole("TimeOff", "nurse", office)).toBe(true);
    expect(isPageAllowedForRole("Messages", "nurse", office)).toBe(true);
  });
  it("lets social worker view patients but not nursing tools", () => {
    expect(isPageAllowedForRole("Patients", "nurse", social)).toBe(true);
    expect(isPageAllowedForRole("Telehealth", "nurse", social)).toBe(true);
    expect(isPageAllowedForRole("OASISCenter", "nurse", social)).toBe(false);
    expect(isPageAllowedForRole("ClinicalDocumentation", "nurse", social)).toBe(false);
    expect(isPageAllowedForRole("CarePlanManagement", "nurse", social)).toBe(false);
  });
  it("lets nurses reach clinical pages", () => {
    expect(isPageAllowedForRole("OASISCenter", "nurse", nurse)).toBe(true);
    expect(isPageAllowedForRole("Patients", "nurse", nurse)).toBe(true);
    expect(isPageAllowedForRole("SmartNoteAssistant", "nurse", nurse)).toBe(true);
  });
  it("still blocks non-admins from admin pages", () => {
    expect(isPageAllowedForRole("UserManagement", "nurse", nurse)).toBe(false);
    expect(isPageAllowedForRole("SuperAdminConfig", "facility_admin", admin)).toBe(false);
  });
  it("admins reach every clinical page", () => {
    expect(isPageAllowedForRole("OASISCenter", "super_admin", admin)).toBe(true);
    expect(isPageAllowedForRole("Patients", "facility_admin", admin)).toBe(true);
  });
});
