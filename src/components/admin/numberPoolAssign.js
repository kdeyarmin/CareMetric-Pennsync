import { hasPersonalCell, personalCellTail } from "./rosterTelecom.js";

/**
 * numberPoolAssign — what NumberPoolPanel reads about a nurse's bridge cell, and
 * what it sends back when a number is assigned.
 *
 * Extracted from the panel because all three are pure and the third one decides
 * whether a nurse's stored mobile number survives an assignment. That is not a
 * property anybody should have to read a JSX closure to check.
 *
 * The roster no longer carries the full personal cell
 * (`20260920720000_roster_phone_provisioned.sql`). It answers
 * `has_personal_cell` and `personal_cell_masked` instead, so the panel can say
 * whether a cell is on file and show its last four digits without the number
 * itself travelling.
 *
 * Both of those answers now come from `rosterTelecom.js`, which three other
 * screens read too. What stays here is the EMAIL LOOKUP, which is this panel's
 * own: it holds a pool row naming a nurse by address and has to find them in a
 * roster it fetched separately. The two-shape reading underneath is not this
 * panel's and was the reason the other three consumers could not share it.
 */

const find = (users, email) => users.find((user) => user.email === email);

/**
 * Whether a bridge cell is on file for `email`.
 *
 * The two-shape reading is `rosterTelecom.hasPersonalCell`; this adds only the
 * lookup by address.
 */
export function cellOnFile(users, email) {
  return hasPersonalCell(find(users, email));
}

/** The last four digits of that cell, masked, or "" when there is nothing to show. */
export function cellTail(users, email) {
  return personalCellTail(find(users, email));
}

/**
 * The `managePhoneNumberPool` assign payload.
 *
 * `personal_cell_e164` is OMITTED when the field is blank, which is what keeps a
 * nurse's existing number: the handler's assign does `if (cellNum)
 * update.personal_cell_e164 = cellNum`, so an absent key leaves the stored value
 * alone. A key carrying a blank string would not — it would fail the handler's
 * own validation — and a key carrying a MASK would fail it too, with a 400 that
 * breaks reassignment for every nurse who already has a cell on file. Which is
 * why the panel's input starts empty rather than pre-filled with either.
 */
export function assignPayload({ id, email, cell }) {
  const entered = typeof cell === "string" ? cell.trim() : "";
  return {
    action: "assign",
    id,
    target_user_email: email,
    ...(entered ? { personal_cell_e164: entered } : {}),
  };
}

/**
 * The one-line description of a Telnyx number-search result in the "Find & buy"
 * dialog: where the number is and what it costs, from the fields
 * searchPurchaseTelnyxNumbers returns (Telnyx's region_information and
 * cost_information). Empty when the search returned neither, so the panel
 * shows the number alone, as it did before these fields existed.
 */
export function searchResultDetail(result) {
  const place = [result?.locality || result?.rate_center, result?.region].filter(Boolean).join(", ");
  const symbol = result?.currency === "USD" ? "$" : "";
  const suffix = symbol || !result?.currency ? "" : ` ${result.currency}`;
  const costs = [];
  if (result?.monthly_cost) costs.push(`${symbol}${result.monthly_cost}${suffix}/mo`);
  if (result?.upfront_cost && Number(result.upfront_cost) > 0) costs.push(`${symbol}${result.upfront_cost}${suffix} upfront`);
  return [place, costs.join(" + ")].filter(Boolean).join(" · ");
}
