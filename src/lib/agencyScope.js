/**
 * Client-side agency scoping helpers.
 *
 * The caller's mutable User fields are not tenant authority. AuthContext binds
 * one exact, service-validated tenant context to the authenticated principal;
 * these helpers consume only that in-memory context. A missing, mismatched, or
 * incomplete binding fails closed and a regular active membership is scoped to
 * its exact agency. The membership-free platform owner has no selected tenant,
 * so patient/roster helpers also fail closed until a reviewed owner agency
 * selector and purpose-bound brokers exist. Backend brokers and entity RLS
 * remain the real authorization boundary; this is defense-in-depth for the SPA.
 *
 * ## How a chart's agency is decided
 *
 * Staff rows may carry `agency_id` / `agency_name`, but the caller's agency id
 * and canonical name always come from the trusted context. A chart's tenancy is
 * resolved in priority order:
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

import { getTrustedTenantContext } from '@/lib/roles';

const norm = (value) => String(value ?? '').trim();

function trustedCallerScope(user) {
  const context = getTrustedTenantContext(user);
  if (!context) return { mode: 'none' };
  if (context.is_platform_owner === true && context.tenant_role === 'platform_owner') {
    return { mode: 'none' };
  }
  const agencyId = norm(context.agency_id);
  const agencyName = norm(context.agency?.name);
  if (
    context.is_platform_owner !== false
    || context.membership_status !== 'active'
    || !agencyId
    || !agencyName
  ) {
    return { mode: 'none' };
  }
  return { mode: 'agency', agencyId, agencyName };
}

/** True when the caller has an exact trusted regular-tenant binding. */
export function isCallerAgencyScoped(user) {
  return trustedCallerScope(user).mode === 'agency';
}

/**
 * Filter User rows using only the caller's trusted tenant context.
 * - Missing, mismatched, or incomplete binding → [] (fail closed).
 * - Membership-free platform-owner binding → [] until an agency is selected
 *   through a reviewed owner workflow.
 * - Exact active regular binding → same-agency users only.
 * Raw `role`, `account_type`, `agency_id`, and `agency_name` fields on the User
 * object cannot widen or switch the scope.
 */
export function filterUsersByCallerAgency(users, caller) {
  if (!Array.isArray(users)) return [];
  const scope = trustedCallerScope(caller);
  if (scope.mode === 'none') return [];
  return users.filter((user) => {
    const userAgencyId = norm(user?.agency_id);
    if (userAgencyId) return userAgencyId === scope.agencyId;
    return norm(user?.agency_name) === scope.agencyName;
  });
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
 * Same fail-closed rules as filterUsersByCallerAgency, which is
 * the whole point of it existing: hand-rolled copies of this shape recomputed
 * `isCallerAgencyScoped` inline and then returned the UNFILTERED rows whenever
 * it came out false. That reads as "this caller is not agency-scoped, so show
 * everything", but it also catches missing or stale tenant authority — exactly
 * the cases that have to fail closed rather than open.
 */
export function filterRowsByStaffAgency(rows, users, caller, emailOf) {
  if (!Array.isArray(rows)) return [];
  const scope = trustedCallerScope(caller);
  if (scope.mode === 'none') return [];
  const emails = agencyStaffEmails(users, caller);
  return rows.filter((row) => emails.has(emailOf(row)));
}

/**
 * Reduce (users, caller) to what patient filtering actually needs.
 * mode 'none' → caller sees nothing (fail closed); 'agency' → compare per chart.
 */
function resolveCallerScope(users, caller) {
  const trusted = trustedCallerScope(caller);
  if (trusted.mode !== 'agency') return trusted;
  const roster = Array.isArray(users) ? users : [];
  return {
    mode: 'agency',
    agencyName: trusted.agencyName,
    agencyId: trusted.agencyId,
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
  // An explicit tenancy on the row wins. Trusted regular contexts carry both
  // an agency id and canonical name; legacy rows may still carry only one.
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
 * Same fail-closed rules as filterUsersByCallerAgency.
 */
export function filterPatientsByCallerAgency(patients, users, caller) {
  if (!Array.isArray(patients)) return [];
  const scope = resolveCallerScope(users, caller);
  if (scope.mode === 'none') return [];
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
