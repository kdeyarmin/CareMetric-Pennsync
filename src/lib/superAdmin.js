/**
 * superAdmin — single source of truth for who the platform super administrator
 * is and the helpers used to gate the super-admin-only surfaces (the Telnyx
 * integration configuration page).
 *
 * Super-admin authorization requires BOTH the protected Base44 `role ===
 * "admin"` value and the configured owner email. `account_type` and all other
 * custom User fields are self-mutable through auth.updateMe and are never
 * accepted as authorization evidence.
 *
 * This is the single source of truth for the owner email on the FRONTEND and is
 * only a UI gate. Sensitive backend functions independently require the same
 * protected role plus the backend `SUPER_ADMIN_EMAIL` setting. Both settings
 * fail closed when absent.
 */

/**
 * The platform owner email used for the email-based super-admin override.
 *
 * OPT-IN: configured via the build-time env var `VITE_SUPER_ADMIN_EMAIL`. When
 * unset there is NO hard-coded owner email and no user is treated as super
 * admin by the frontend. This avoids baking an identifier into the build and
 * removes the unintended privilege path where a missing env var would still
 * treat a specific email as super admin.
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
 * True when `user` is the platform super admin. Both signals are protected:
 * Base44's built-in admin role and the configured owner email. Custom User
 * fields such as account_type are writable by the current user via updateMe and
 * must never grant privilege.
 */
export function isSuperAdmin(user) {
  if (!user) return false;
  return user.role === "admin" && isSuperAdminEmail(user.email);
}

/**
 * True for any administrator surface. Base44 protects the built-in role from
 * updateMe; account_type and the other custom User fields are self-mutable.
 */
export function isAdminLike(user) {
  if (!user) return false;
  return user.role === "admin";
}
