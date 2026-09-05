/**
 * roles.js — single source of truth for the app's three-tier role model.
 *
 * The platform distinguishes three user views:
 *
 *   1. super_admin   — the protected Base44 admin role plus configured platform
 *                      owner email. Sees
 *                      EVERYTHING, including platform-level / system configuration
 *                      (Telnyx secrets, background jobs, AI tools, comms, agency
 *                      settings, PDGM rates).
 *   2. facility_admin — an agency administrator established either by the
 *                      protected Base44 admin role or an active, service-owned
 *                      AgencyMembership with tenant_role === 'agency_admin'.
 *                      Sees everything relative
 *                      to THEIR facility — clinical work plus analytics, reporting,
 *                      compliance, user management — but NOT the platform-level
 *                      system configuration reserved for the super admin.
 *   3. nurse         — every other clinical user. Sees only clinical information
 *                      (patients, care plans, OASIS, notes, communication,
 *                      learning) — no analytics, reporting, or administration.
 *
 * This builds on lib/superAdmin.js (which owns the owner-email + super_admin
 * detection) and centralizes the facility-admin vs nurse split so the sidebar,
 * command palette, routes, and route guards all agree.
 *
 * A second, orthogonal staff_role axis controls discipline-specific surfaces for
 * non-admin users. Existing users default to nurse so adopting the field never
 * removes access from legacy accounts.
 */

import { isSuperAdmin, isSuperAdminEmail } from "@/lib/superAdmin";

// UI authorization context must never come from a string property carried by
// the mutable User record. AuthContext validates getMyTenantContext's exact
// service-owned response and binds it to the current authenticated principal.
// The singleton also lets the many legacy `base44.auth.me()` readers resolve
// the same UI role even though the SDK returns a fresh object. This is only a
// navigation compatibility layer; backend functions and entity RLS remain the
// authorization boundary.
let activeTrustedPrincipal = null;
const TRUSTED_TENANT_ROLES = new Set([
  "agency_admin",
  "manager",
  "clinician",
  "office_staff",
  "social_worker",
  "spiritual_care",
]);

const exactIdentifier = (value) => (
  typeof value === "string"
  && value.length > 0
  && value.length <= 200
  && value.trim() === value
  && !value.startsWith("$")
);

const canonicalEmail = (value) => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized && normalized.includes("@") && !/\s/.test(normalized)
    ? normalized
    : null;
};

const validTenantContextForUser = (user, tenantContext) => {
  if (!tenantContext || typeof tenantContext !== "object" || Array.isArray(tenantContext)) {
    return false;
  }
  const userEmail = canonicalEmail(user?.email);
  const contextEmail = canonicalEmail(tenantContext.user_email);
  if (!exactIdentifier(user?.id)
    || tenantContext.user_id !== user.id
    || !userEmail
    || contextEmail !== userEmail
    || tenantContext.user_email !== contextEmail) {
    return false;
  }

  if (tenantContext.is_platform_owner === true) {
    return tenantContext.membership_id === null
      && tenantContext.membership_key === null
      && tenantContext.membership_version === null
      && tenantContext.tenant_role === "platform_owner"
      && tenantContext.membership_status === null
      && tenantContext.agency_id === null
      && tenantContext.agency === null;
  }

  return tenantContext.is_platform_owner === false
    && exactIdentifier(tenantContext.membership_id)
    && exactIdentifier(tenantContext.agency_id)
    && tenantContext.membership_key === `${tenantContext.agency_id}:${user.id}`
    && Number.isSafeInteger(tenantContext.membership_version)
    && tenantContext.membership_version >= 1
    && TRUSTED_TENANT_ROLES.has(tenantContext.tenant_role)
    && tenantContext.membership_status === "active"
    && tenantContext.agency?.id === tenantContext.agency_id
    && ["active", "trial"].includes(tenantContext.agency?.status);
};

/**
 * Return a fresh user view associated with a validated, in-memory tenant context.
 * Invalid or mismatched context is ignored, preserving least-privilege nurse
 * navigation. Backend functions and entity RLS remain the real boundary.
 */
export function bindTrustedTenantContext(user, tenantContext) {
  // There can be only one authenticated principal in this SPA. Clear the old
  // binding synchronously before considering a replacement so a failed tenant
  // lookup or account switch always demotes rather than retaining stale access.
  activeTrustedPrincipal = null;
  if (!user || typeof user !== "object" || Array.isArray(user)) return user;
  const boundUser = { ...user };
  const userEmail = canonicalEmail(user.email);
  if (
    userEmail
    && validTenantContextForUser(user, tenantContext)
  ) {
    const frozenContext = Object.freeze({
      ...tenantContext,
      agency: tenantContext.agency ? Object.freeze({ ...tenantContext.agency }) : null,
    });
    activeTrustedPrincipal = Object.freeze({
      userId: user.id,
      userEmail,
      context: frozenContext,
    });
  }
  return boundUser;
}

/** Clear the current session's UI tenant binding on logout/account changes. */
export function clearTrustedTenantContext() {
  activeTrustedPrincipal = null;
}

/** Read the validated context bound to this exact authenticated principal. */
export function getTrustedTenantContext(user) {
  if (!user || typeof user !== "object" || Array.isArray(user)) return null;
  const email = canonicalEmail(user.email);
  return activeTrustedPrincipal
    && user.id === activeTrustedPrincipal.userId
    && email === activeTrustedPrincipal.userEmail
    ? activeTrustedPrincipal.context
    : null;
}

/** Resolve a user to one of: 'super_admin' | 'facility_admin' | 'nurse'. */
export function getRoleView(user) {
  if (!user) return "nurse";
  const tenantContext = getTrustedTenantContext(user);
  // A built-in role/email is necessary corroboration for the protected owner,
  // but it is not sufficient tenant authority on its own. AuthContext must also
  // bind the freshly validated, membership-free owner context. Likewise, an
  // ordinary built-in admin receives no facility navigation until one exact
  // active tenant context is bound.
  if (
    tenantContext?.is_platform_owner === true
    && tenantContext.tenant_role === "platform_owner"
    && isSuperAdmin(user)
  ) {
    return "super_admin";
  }
  if (
    tenantContext?.membership_status === "active"
    && tenantContext.is_platform_owner === false
    && (tenantContext.tenant_role === "agency_admin" || user.role === "admin")
  ) {
    return "facility_admin";
  }
  return "nurse";
}

/**
 * Stable identity for the currently bound protected subtree. Any membership,
 * role, agency, owner, or principal change produces a new key so React can
 * discard tenant-specific component state instead of reusing it across scopes.
 */
export function getTenantAuthorityKey(user) {
  const tenantContext = getTrustedTenantContext(user);
  const email = canonicalEmail(user?.email);
  if (!tenantContext || !email) return null;
  return JSON.stringify([
    user.id,
    email,
    tenantContext.agency_id,
    tenantContext.membership_id,
    tenantContext.membership_version,
    tenantContext.tenant_role,
    tenantContext.is_platform_owner,
  ]);
}

/** True for the platform super admin only. */
export function isSuperAdminView(user) {
  return getRoleView(user) === "super_admin";
}

/**
 * True for any administrator surface (facility admin OR super admin). This is the
 * "isAdmin" gate the app already used — both admin tiers see the admin sections;
 * super-admin-only pages are gated separately via `isSuperAdminView`.
 */
export function isAdminView(user) {
  const view = getRoleView(user);
  return view === "super_admin" || view === "facility_admin";
}

export function isNurseView(user) {
  return getRoleView(user) === "nurse";
}

export const STAFF_ROLES = ["nurse", "office_staff", "social_worker", "spiritual_care"];

export const STAFF_ROLE_OPTIONS = [
  { value: "nurse", label: "Nurse", description: "RN/LPN clinical staff — full patient care, OASIS, clinical notes, and care plans.", clinical: true, nursing: true },
  { value: "office_staff", label: "Office Staff", description: "Back-office / administrative staff — learning, PTO, messaging, and resources.", clinical: false, nursing: false },
  { value: "social_worker", label: "Social Worker", description: "Care-team member — can view patients and records; no nursing documentation tools.", clinical: true, nursing: false },
  { value: "spiritual_care", label: "Spiritual Care", description: "Chaplain / spiritual care — can view patients and records; no nursing documentation tools.", clinical: true, nursing: false },
];

export function staffRoleLabel(value) {
  return STAFF_ROLE_OPTIONS.find((option) => option.value === value)?.label || value || "Nurse";
}

export function getStaffRole(user) {
  const role = user?.staff_role;
  return STAFF_ROLES.includes(role) ? role : "nurse";
}

export function userRoleLabel(user) {
  if (!user) return "User";
  const view = getRoleView(user);
  if (view === "super_admin") return "Super Admin";
  if (view === "facility_admin") return "Admin";
  if (user.role === "manager") return "Manager";
  return staffRoleLabel(getStaffRole(user));
}

export function isClinicalUser(user) {
  if (!user) return false;
  return isAdminView(user) || getStaffRole(user) === "nurse";
}

export function canViewPatients(user) {
  if (!user) return false;
  if (isAdminView(user)) return true;
  return getStaffRole(user) !== "office_staff";
}

export const ACCESS = { GENERAL: "general", PATIENT: "patient", NURSING: "nursing" };

export function canAccessLevel(user, level) {
  if (!level || level === ACCESS.GENERAL) return true;
  if (level !== ACCESS.PATIENT && level !== ACCESS.NURSING) return false;
  if (!user) return false;
  if (isAdminView(user)) return true;
  if (level === ACCESS.NURSING) return getStaffRole(user) === "nurse";
  if (level === ACCESS.PATIENT) return getStaffRole(user) !== "office_staff";
  return false;
}

export { isSuperAdmin, isSuperAdminEmail };
