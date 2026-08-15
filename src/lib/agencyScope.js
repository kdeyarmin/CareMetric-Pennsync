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
 * Filter rows that carry a staff email — timesheets, payroll profiles, anything
 * keyed to an employee — to the caller's agency. `emailOf` pulls the staff email
 * off a row.
 *
 * Same fail-closed / platform-admin rules as filterUsersByCallerAgency, which is
 * the whole point of it existing: hand-rolled copies of this shape recomputed
 * `isCallerAgencyScoped` inline and then returned the UNFILTERED rows whenever
 * it came out false. That reads as "this caller is not agency-scoped, so show
 * everything", but it also catches an agency_admin whose agency_name is blank —
 * the one case that has to fail closed rather than open.
 */
export function filterRowsByStaffAgency(rows, users, caller, emailOf) {
  if (!Array.isArray(rows)) return [];
  if (!caller) return [];
  if (caller.account_type === 'agency_admin' && !norm(caller.agency_name)) {
    return [];
  }
  if (caller.account_type === 'super_admin') return rows;
  if (!norm(caller.agency_name)) return rows;
  const emails = agencyStaffEmails(users, caller);
  return rows.filter((row) => emails.has(emailOf(row)));
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
 * 'match' | 'foreign' | 'unattributable' for one row under an 'agency' scope.
 * `linked` is every staff email the row is attributed to. Only 'foreign' is ever
 * hidden — see the module header for why absence of attribution is not evidence
 * of another tenant.
 */
function classifyRow(row, scope, linked) {
  const rowAgencyId = norm(row?.agency_id);
  const rowAgencyName = norm(row?.agency_name);
  // An explicit tenancy on the row wins, but only when it is expressed in a
  // dimension the caller also carries. A row tagged by id against a caller
  // known only by name is not comparable, so fall through rather than guess.
  if (rowAgencyId && scope.agencyId) {
    return rowAgencyId === scope.agencyId ? 'match' : 'foreign';
  }
  if (rowAgencyName && scope.agencyName) {
    return rowAgencyName === scope.agencyName ? 'match' : 'foreign';
  }

  const emails = linked.filter(Boolean);
  if (emails.some((email) => scope.staff.has(email))) return 'match';
  if (emails.some((email) => scope.known.has(email))) return 'foreign';
  return 'unattributable';
}

function classifyPatient(patient, scope) {
  return classifyRow(patient, scope, [
    patient?.created_by,
    ...(Array.isArray(patient?.assigned_nurses) ? patient.assigned_nurses : []),
  ]);
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
 * Filter clinical records — Visit, Incident, OASISAssessment, CarePlan,
 * PatientAlert, Document — by the agency of whoever authored them. `authorOf`
 * pulls the authoring staff email off a row; it defaults to `created_by`, which
 * every one of those entities carries.
 *
 * Deliberately NOT filterRowsByStaffAgency. That one drops any row whose owner
 * is not a CURRENT staff member, which is right for a timesheet — it has to
 * belong to a current employee — and wrong for a clinical record. On live data
 * 17 of 198 visits were authored by a nurse who has since left the roster; the
 * strict rule deletes their charting from every view. Clinical records get the
 * same three-way rule as patients: only a record positively attributed to
 * ANOTHER agency's staff is hidden.
 */
export function filterRecordsByAuthorAgency(rows, users, caller, authorOf = (row) => row?.created_by) {
  if (!Array.isArray(rows)) return [];
  const scope = resolveCallerScope(users, caller);
  if (scope.mode === 'none') return [];
  if (scope.mode === 'all') return rows;
  return rows.filter((row) => classifyRow(row, scope, [authorOf(row)]) !== 'foreign');
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
