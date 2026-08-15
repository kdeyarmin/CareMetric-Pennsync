/**
 * Client-side agency scoping helpers.
 *
 * Entity RLS treats bare role:admin / agency_admin as platform-wide
 * (docs/HOSTED-RLS-PROOF.md §5b). Admin UIs that User.list / Patient.list must
 * filter by the caller's agency so facility admins do not render other tenants'
 * staff or patient PHI. Backend service-role functions remain the real write
 * boundary; this is defense-in-depth for the SPA.
 *
 * ## How a chart's agency is decided
 *
 * `User` carries `agency_id` / `agency_name` as first-class fields, so staff
 * scoping is a direct comparison. `Patient` has no agency field, so a chart's
 * tenancy is resolved in priority order:
 *
 *   1. EXPLICIT — the chart carries `agency_id` / `agency_name`. Authoritative:
 *      it either matches the caller's agency or it does not.
 *   2. STAFF — no agency field, but `created_by` / `assigned_nurses` names a
 *      user who IS in the roster. That user's agency decides the chart's.
 *   3. UNATTRIBUTABLE — no agency field, and no creator or assigned nurse that
 *      resolves to a known user. Bulk imports and service-account-created charts
 *      land here, as do charts whose author has since left the organization.
 *
 * Unattributable charts stay VISIBLE. Absence of attribution is not evidence of
 * another tenant, and silently hiding a chart from the clinician who needs it is
 * a worse failure in a clinical record system than an over-broad roster in a UI
 * whose real access boundary is server-side. Hiding them would also make this
 * filter destructive on any deployment whose charts predate agency tagging: a
 * service-account import leaves every row unattributable, so a strict rule
 * empties the roster the moment the first `agency_name` is assigned.
 *
 * `describePatientAgencyScope` reports how many charts sit in the unattributable
 * bucket so the gap can be surfaced as a data-quality metric and driven to zero
 * by stamping `agency_id` on the records that lack it.
 */

const norm = (value) => String(value ?? '').trim();

/** True when the caller is an agency-scoped facility admin (not platform-wide). */
export function isCallerAgencyScoped(user) {
  const agency = norm(user?.agency_name);
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
  if (caller.account_type === 'agency_admin' && !norm(caller.agency_name)) {
    return [];
  }
  if (caller.account_type === 'super_admin') return users;
  const agency = norm(caller.agency_name);
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
 * Reduce (users, caller) to what patient filtering actually needs.
 * mode 'none' → caller sees nothing (fail closed); 'all' → caller sees
 * everything (platform admin / super_admin); 'agency' → compare per chart.
 */
function resolveCallerScope(users, caller) {
  if (!caller) return { mode: 'none' };
  if (caller.account_type === 'agency_admin' && !norm(caller.agency_name)) {
    return { mode: 'none' };
  }
  if (caller.account_type === 'super_admin') return { mode: 'all' };
  const agencyName = norm(caller.agency_name);
  if (!agencyName) return { mode: 'all' };
  const roster = Array.isArray(users) ? users : [];
  return {
    mode: 'agency',
    agencyName,
    agencyId: norm(caller.agency_id),
    staff: agencyStaffEmails(roster, caller),
    known: new Set(roster.map((u) => u?.email).filter(Boolean)),
  };
}

/**
 * 'match' | 'foreign' | 'unattributable' for one chart under an 'agency' scope.
 * Only 'foreign' is ever hidden.
 */
function classifyPatient(patient, scope) {
  const chartAgencyId = norm(patient?.agency_id);
  const chartAgencyName = norm(patient?.agency_name);
  // An explicit tenancy on the chart wins, but only when it is expressed in a
  // dimension the caller also carries. A chart tagged by id against a caller
  // known only by name is not comparable, so fall through rather than guess.
  if (chartAgencyId && scope.agencyId) {
    return chartAgencyId === scope.agencyId ? 'match' : 'foreign';
  }
  if (chartAgencyName && scope.agencyName) {
    return chartAgencyName === scope.agencyName ? 'match' : 'foreign';
  }

  const linked = [
    patient?.created_by,
    ...(Array.isArray(patient?.assigned_nurses) ? patient.assigned_nurses : []),
  ].filter(Boolean);
  if (linked.some((email) => scope.staff.has(email))) return 'match';
  if (linked.some((email) => scope.known.has(email))) return 'foreign';
  return 'unattributable';
}

/**
 * Filter Patient rows to charts the caller's agency may see. Pass the FULL user
 * list — a pre-filtered roster makes every outside author look like an unknown
 * one, which collapses the 'foreign' case into 'unattributable'.
 * Same fail-closed / platform-admin rules as filterUsersByCallerAgency.
 */
export function filterPatientsByCallerAgency(patients, users, caller) {
  if (!Array.isArray(patients)) return [];
  const scope = resolveCallerScope(users, caller);
  if (scope.mode === 'none') return [];
  if (scope.mode === 'all') return patients;
  return patients.filter((p) => classifyPatient(p, scope) !== 'foreign');
}

/**
 * Counts behind filterPatientsByCallerAgency, for surfacing the scope in the UI.
 * `unattributable` is the number of visible charts that carry no tenancy signal
 * at all — the backlog to stamp with `agency_id`, and the number that a stricter
 * rule would silently hide.
 */
export function describePatientAgencyScope(patients, users, caller) {
  const rows = Array.isArray(patients) ? patients : [];
  const scope = resolveCallerScope(users, caller);
  if (scope.mode === 'none') {
    return {
      scoped: false, total: rows.length, visible: 0, hidden: rows.length, unattributable: 0,
    };
  }
  if (scope.mode === 'all') {
    return {
      scoped: false, total: rows.length, visible: rows.length, hidden: 0, unattributable: 0,
    };
  }
  let hidden = 0;
  let unattributable = 0;
  for (const patient of rows) {
    const verdict = classifyPatient(patient, scope);
    if (verdict === 'foreign') hidden += 1;
    else if (verdict === 'unattributable') unattributable += 1;
  }
  return {
    scoped: true,
    total: rows.length,
    visible: rows.length - hidden,
    hidden,
    unattributable,
  };
}
