import { maskPhone } from "../voice/phoneUtils.js";

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
 * itself travelling. The Base44 path still sends the raw column, so both
 * readers fall back to it and mask in the browser — the same `maskPhone` the
 * panel this one is nested inside already uses.
 */

const find = (users, email) => users.find((user) => user.email === email);

/**
 * Whether a bridge cell is on file for `email`.
 *
 * `typeof === "boolean"` rather than a truthiness test on the key: the owned
 * store answers `false` for a nurse with no cell and `null` for a caller who may
 * not see it, and `false` is a real answer that `??` would discard.
 */
export function cellOnFile(users, email) {
  const user = find(users, email);
  if (typeof user?.has_personal_cell === "boolean") return user.has_personal_cell;
  return !!user?.personal_cell_e164;
}

/** The last four digits of that cell, masked, or "" when there is nothing to show. */
export function cellTail(users, email) {
  const user = find(users, email);
  if (user?.personal_cell_masked) return user.personal_cell_masked;
  return user?.personal_cell_e164 ? maskPhone(user.personal_cell_e164) : "";
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
