/**
 * approverCandidates — who may be offered as an approver, on either backend.
 *
 * Two screens ask this question and they asked it with the same wrong predicate,
 * byte for byte: the timesheet's "Send to approver" control and the leave
 * request's. This module is the one home for it, so that a correction to one is a
 * correction to both — which is the thing that did not happen the first time.
 *
 * EACH SCREEN MOVES TO IT IN ITS OWN CHANGE, and they are independent
 * capabilities with no ordering between them, so either may land first. A reader
 * who finds one screen still carrying the inline predicate is looking at a
 * migration that is not finished yet, not at one that was missed — and this
 * paragraph is written to be true at every point in between rather than only at
 * the end, since the alternative is a module that documents a state no commit
 * has ever been in.
 *
 * The list is a CORRECTNESS surface, not a security one. Whoever is picked here
 * is validated authoritatively by the submit before it reaches the row, and both
 * submits accept the same two tenant roles through different helpers:
 *
 *   - `contract_timesheet_submit` looks the nominee up in
 *     `pennsync_private.agency_roster(p_agency)` and refuses
 *     `PENNSYNC_TIMESHEET_APPROVER_INVALID` unless their `tenant_role` is
 *     `agency_admin` or `manager`;
 *   - `contract_time_off_submit` looks them up in
 *     `pennsync_private.agency_colleague(p_agency, p_manager_email)` and refuses
 *     `PENNSYNC_TIME_OFF_APPROVER_INVALID` on the same two roles;
 *   - the Base44 originals apply the shared `withTrustedClaims` helper to the
 *     candidate row they matched, which strips a claimed privileged
 *     `account_type` back to `'user'` unless a canonical active membership says
 *     otherwise (D69).
 *
 * So a self-asserted profile label never reaches `manager_email` on any path.
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
 * The tenant roles both submits accept as a nominee, on either backend.
 *
 * Kept as a named constant because it must stay equal to the role set in
 * `20260920360000_contract_timesheet.sql` and `20260920230000_contract_time_off.sql`,
 * and a test re-derives it from both files rather than trusting this comment. The
 * two are independent declarations in SQL; nothing in the store makes them move
 * together, so the test is what would notice if one did.
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
  // membership, which is the same value both submits check. So where it is
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
 * The option list for a "Send to approver" control.
 *
 * `role` is carried through for the "(Admin)" label the forms draw, and is
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

/**
 * Which approver address a form should hold, once the list is known.
 *
 * BOTH forms pre-select `currentUser.manager_email` — a self-editable profile
 * field — and both then submit whatever they hold. The Select renders its
 * PLACEHOLDER for a value matching no item, so a stale address makes the control
 * look unset while still travelling with the request, and the contract refuses
 * `PENNSYNC_TIMESHEET_APPROVER_INVALID` or `PENNSYNC_TIME_OFF_APPROVER_INVALID`
 * naming somebody the employee never picked. That is the same "the form is
 * broken" reading the list itself was corrected to stop, surviving in the field
 * the list feeds — so the reconciliation lives here beside the list rather than
 * being written out twice, which is how the predicate above came to be
 * duplicated in the first place.
 *
 * AN EMPTY LIST IS NOT AN AUTHORITY TO CLEAR ANYTHING, and that is the whole of
 * why this is not a one-line filter. Empty means the query has not resolved, or
 * the roster read is not permitted for this caller and the screen is falling back
 * to routing to administrators. Only a list with entries in it says who may
 * approve, so an empty one leaves every value exactly as it found it.
 *
 * @param {{ current?: string, offered?: Array<{ email?: string, [key: string]: unknown }>,
 *   fallback?: string }} input
 * @returns {string} the address the form should hold
 */
export function reconcileApprover({ current = '', offered = [], fallback = '' } = {}) {
  const emails = new Set((offered || []).map(option => option?.email).filter(Boolean));
  if (emails.size === 0) return current || fallback;
  if (current) return emails.has(current) ? current : '';
  return emails.has(fallback) ? fallback : '';
}
