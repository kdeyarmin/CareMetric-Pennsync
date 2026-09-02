/**
 * roles.js — single source of truth for the app's three-tier role model.
 *
 * The platform distinguishes three user views:
 *
 *   1. super_admin   — the platform owner / super_admin account_type. Sees
 *                      EVERYTHING, including platform-level / system configuration
 *                      (Telnyx secrets, background jobs, AI tools, comms, agency
 *                      settings, PDGM rates).
 *   2. facility_admin — an agency administrator (role === 'admin' or
 *                      account_type === 'agency_admin'). Sees everything relative
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

/** Resolve a user to one of: 'super_admin' | 'facility_admin' | 'nurse'. */
export function getRoleView(user) {
  if (!user) return "nurse";
  if (isSuperAdmin(user)) return "super_admin";
  if (user.role === "admin" || user.account_type === "agency_admin") {
    return "facility_admin";
  }
  return "nurse";
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
  if (!user) return false;
  if (isAdminView(user)) return true;
  if (level === ACCESS.NURSING) return getStaffRole(user) === "nurse";
  if (level === ACCESS.PATIENT) return getStaffRole(user) !== "office_staff";
  return false;
}

export { isSuperAdmin, isSuperAdminEmail };