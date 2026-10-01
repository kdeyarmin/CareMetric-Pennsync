/**
 * approverCandidates — who may be offered as a timesheet's approver.
 *
 * The list is a CORRECTNESS surface, not a security one. Whoever is picked here
 * is validated authoritatively by the submit before it reaches the row:
 *
 *   - the owned store's `contract_timesheet_submit` looks the nominee up in
 *     `pennsync_private.agency_roster(p_agency)` and refuses
 *     `PENNSYNC_TIMESHEET_APPROVER_INVALID` unless their `tenant_role` is
 *     `agency_admin` or `manager`;
 *   - the Base44 original applies the shared `withTrustedClaims` helper to the
 *     candidate row it matched, which strips a claimed privileged `account_type`
 *     back to `'user'` unless a canonical active membership says otherwise (D69).
 *
 * So a self-asserted profile label never reaches `manager_email` on either path.
 * What a too-wide list does is offer a colleague the submit will then refuse,
 * which the nurse reads as the form being broken.
 *
 * The predicate was `u.role === "admin" || u.account_type === "agency_admin" ||
 * u.is_manager === true`, read straight off the carried profile row. Two of those
 * three are fields `base44/_shared/backendHelpers.mjs` names as self-editable and
 * says "must never grant privilege" — which is why they are not the answer even
 * for a list.
 */

/**
 * The tenant roles the submit accepts as a nominee, on either backend.
 *
 * Kept as a named constant because it must stay equal to the role set in
 * `20260920360000_contract_timesheet.sql`'s Divergence 4, and a test re-derives
 * it from that file rather than trusting this comment.
 */
export const APPROVER_TENANT_ROLES = Object.freeze(['agency_admin', 'manager']);

/**
 * Whether one roster row may be offered as an approver.
 *
 * Two branches, because the two backends answer with different things and only
 * one of them has anything authoritative to offer a browser.
 */
export function mayApprove(user) {
  if (!user?.email) return false;
  // The OWNED roster projects `tenant_role` from the authority store's
  // membership, which is the same value the submit checks. So where it is
  // present it is the whole answer, and the self-editable labels are not
  // consulted at all.
  if (typeof user.tenant_role === 'string') {
    return APPROVER_TENANT_ROLES.includes(user.tenant_role);
  }
  // Base44 sends only the carried profile row and nothing authoritative, so this
  // path keeps the superset it has always offered: there is no better predicate
  // available in the browser there, and its own submit re-derives the nominee's
  // standing and refuses what does not hold up. Narrowing this half on the
  // self-editable labels would not make it more correct, only differently wrong.
  return user.role === 'admin' || user.account_type === 'agency_admin'
    || user.is_manager === true;
}

/**
 * The option list for the "Send to approver" control.
 *
 * `role` is carried through for the "(Admin)" label the form draws, and is
 * undefined on the owned path by design — D23 keeps `role` off the roster because
 * it is self-editable. `tenant_role` goes with it so a consumer that wants to
 * label the owned path has the authoritative value to do it with.
 */
export function approverOptions(users, callerEmail) {
  return (users || [])
    .filter(mayApprove)
    .filter(user => user.email !== callerEmail)
    .map(user => ({
      email: user.email,
      name: user.full_name || user.email,
      role: user.role,
      tenant_role: user.tenant_role,
    }));
}
