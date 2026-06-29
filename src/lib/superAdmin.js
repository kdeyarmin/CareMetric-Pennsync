/**
 * superAdmin — single source of truth for who the platform super administrator
 * is and the helpers used to gate the super-admin-only surfaces (the Telnyx
 * integration configuration page).
 *
 * The super admin is identified two ways, and EITHER is sufficient:
 *   1. The designated super-admin email below (the platform owner). This makes
 *      the account self-bootstrapping — the very first time the owner signs in,
 *      the Super Admin page promotes their account (see ensureSuperAdmin).
 *   2. account_type === 'super_admin' on the User record (what the rest of the
 *      app — Learning Center, skill dashboards — already keys off of).
 *
 * This is the single source of truth for the owner email on the FRONTEND. The
 * Base44 backend functions (ensureSuperAdmin, saveTelnyxSecret, etc.) run
 * as standalone Deno modules that can't import this file, so each mirrors the
 * same literal; keep them in sync when changing the owner.
 */

/**
 * The platform owner email used for the email-based super-admin override.
 *
 * OPT-IN: configured via the build-time env var `VITE_SUPER_ADMIN_EMAIL`. When
 * unset there is NO hard-coded owner email — super-admin is then determined
 * solely by `account_type === 'super_admin'` (see isSuperAdmin). This avoids
 * baking an identifier into the build and removes the unintended privilege path
 * where a missing env var would still treat a specific email as super admin.
 * Normalized (trimmed + lower-cased) for case-insensitive comparison.
 */
export const SUPER_ADMIN_EMAIL = (
  import.meta.env?.VITE_SUPER_ADMIN_EMAIL || ""
)
  .trim()
  .toLowerCase();

/**
 * Case/whitespace-insensitive email match against the configured super admin.
 * Returns false when no owner email is configured, so an empty override can
 * never match (including a user with no email).
 */
export function isSuperAdminEmail(email) {
  if (!SUPER_ADMIN_EMAIL) return false;
  return String(email || "").trim().toLowerCase() === SUPER_ADMIN_EMAIL;
}

/**
 * True when `user` is the platform super admin — either by designated email or
 * by an explicit super_admin account_type.
 */
export function isSuperAdmin(user) {
  if (!user) return false;
  return isSuperAdminEmail(user.email) || user.account_type === "super_admin";
}

/**
 * True for any administrator surface (the agency `admin` role, an agency_admin
 * or super_admin account_type, or the designated super admin). Mirrors the
 * ad-hoc checks already used across the app, in one reusable place.
 */
export function isAdminLike(user) {
  if (!user) return false;
  return (
    user.role === "admin" ||
    user.account_type === "agency_admin" ||
    user.account_type === "super_admin" ||
    isSuperAdminEmail(user.email)
  );
}
