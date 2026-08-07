/**
 * Client-side agency scoping helpers.
 *
 * Entity RLS treats bare role:admin / agency_admin as platform-wide
 * (docs/HOSTED-RLS-PROOF.md §5b). Admin UIs that User.list / Patient.list must
 * filter by the caller's agency so facility admins do not render other tenants'
 * staff or patient PHI. Backend service-role functions remain the real write
 * boundary; this is defense-in-depth for the SPA.
 */

/** True when the caller is an agency-scoped facility admin (not platform-wide). */
export function isCallerAgencyScoped(user) {
  const agency = String(user?.agency_name || '').trim();
  return (
    user?.account_type !== 'super_admin'
    && !!agency
    && (user?.account_type === 'agency_admin' || user?.role === 'admin')
  );
}

/**
 * Filter User rows to the caller's agency.
 * - Missing caller → [] (fail closed while auth loads).
 * - agency_admin without agency_name → [] (fail closed).
 * - super_admin → unfiltered (even if they have an agency_name).
 * - Any other caller with agency_name → same-agency users only.
 * - Platform admin (role:admin, no agency) → unfiltered.
 */
export function filterUsersByCallerAgency(users, caller) {
  if (!Array.isArray(users)) return [];
  if (!caller) return [];
  if (caller.account_type === 'agency_admin' && !String(caller.agency_name || '').trim()) {
    return [];
  }
  if (caller.account_type === 'super_admin') return users;
  const agency = String(caller.agency_name || '').trim();
  if (!agency) return users;
  return users.filter((u) => u?.agency_name === agency);
}

/** Email set for staff in the caller's agency (empty when fail-closed). */
export function agencyStaffEmails(users, caller) {
  return new Set(
    filterUsersByCallerAgency(users, caller)
      .map((u) => u?.email)
      .filter(Boolean),
  );
}

/**
 * Filter Patient rows to charts whose created_by / assigned_nurses intersect
 * the caller's agency staff emails. Pass the full user list (or pre-filtered).
 * Same fail-closed / platform-admin rules as filterUsersByCallerAgency.
 */
export function filterPatientsByCallerAgency(patients, users, caller) {
  if (!Array.isArray(patients)) return [];
  if (!caller) return [];
  if (caller.account_type === 'agency_admin' && !String(caller.agency_name || '').trim()) {
    return [];
  }
  if (caller.account_type === 'super_admin') return patients;
  const agency = String(caller.agency_name || '').trim();
  if (!agency) return patients;
  const emails = agencyStaffEmails(users, caller);
  return patients.filter((p) =>
    (p?.created_by && emails.has(p.created_by))
    || (Array.isArray(p?.assigned_nurses) && p.assigned_nurses.some((e) => emails.has(e))),
  );
}
