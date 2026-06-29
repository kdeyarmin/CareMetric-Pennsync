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

/** True for the clinical-only nurse view. */
export function isNurseView(user) {
  return getRoleView(user) === "nurse";
}

export { isSuperAdmin, isSuperAdminEmail };