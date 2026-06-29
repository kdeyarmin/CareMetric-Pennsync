import { isAdminLike } from "@/lib/superAdmin";

/**
 * Application permission helpers — small, reusable predicates for "who may see
 * what", kept in one place so a policy change happens once.
 */

/**
 * canViewFinancials — single source of truth for who may see FINANCIAL data:
 * dollar amounts, PDGM revenue/payment estimates, reimbursement, billing, and
 * revenue-optimization figures.
 *
 * Clinical staff (nurses/clinicians — the default `role: 'user'`) must NOT see
 * financials. Visibility is restricted to administrators (the agency `admin`
 * role, `agency_admin` / `super_admin` account types, or the platform owner).
 *
 * Defined in terms of isAdminLike so it stays in sync with the rest of the
 * app's admin gating, but named separately and centralized so a future
 * dedicated billing/finance role can be granted access in ONE place without
 * revisiting every call site.
 */
export function canViewFinancials(user) {
  return isAdminLike(user);
}
