import { maskPhone } from "../voice/phoneUtils.js";

/**
 * rosterTelecom — what a roster row says about a staff member's personal cell,
 * read the same way by every screen that asks.
 *
 * TWO RESPONSE SHAPES REACH THESE SCREENS AND THEY ANSWER DIFFERENT QUESTIONS.
 * Base44 sends the raw `personal_cell_e164` column. The owned roster sends
 * `has_personal_cell` and `personal_cell_masked` instead and NO
 * `personal_cell_e164` under any name
 * (`20260920720000_roster_phone_provisioned.sql`), so a screen that tests the
 * raw key directly does not degrade on the owned path — it inverts. Every user
 * reads as having no cell, which is the opposite of the truth for exactly the
 * people who are provisioned.
 *
 * WHY THIS IS ITS OWN MODULE RATHER THAN TWO MORE EXPORTS OF
 * `numberPoolAssign.js`. Those helpers existed, took `(users, email)`, and were
 * named for the one panel that had that pair in hand. Three other consumers
 * wanted the same two questions about a row they already held, could not use a
 * lookup-by-email signature, and so kept reading the raw column — `has_personal_cell`
 * had one reader and `personal_cell_e164` had four. A predicate several screens
 * ask for, living under one screen's name and in one screen's argument shape, is
 * a duplication waiting to be written; it was written here as a silent inversion
 * rather than as a copy, which is harder to see. `numberPoolAssign` now
 * delegates, so there is one answer and the email lookup is the only thing that
 * is still that panel's.
 */

/**
 * Whether a personal cell is on file for this roster row.
 *
 * `typeof === "boolean"` rather than a truthiness test on the key: the owned
 * store answers `false` for somebody with no cell and `null` for a caller who
 * may not see it, and `false` is a real answer that `??` or `||` would discard
 * and send to the raw-column fallback — which on that path is always absent, so
 * the discarded `false` and an unreadable `null` would both come back `false`
 * and nothing would distinguish them. A caller needing that distinction should
 * read `has_personal_cell` itself; this answers the question the screens ask,
 * which is whether to show the row as provisioned.
 */
export function hasPersonalCell(user) {
  if (typeof user?.has_personal_cell === "boolean") return user.has_personal_cell;
  return !!user?.personal_cell_e164;
}

/**
 * The last four digits of that cell, masked, or "" when there is nothing to show.
 *
 * The owned store's `personal_cell_masked` is already the display form, so it is
 * returned as it arrives. On the Base44 shape the browser masks the raw column
 * with the same `maskPhone` the panels used before this module existed, so the
 * digits a screen prints do not change on either path.
 */
export function personalCellTail(user) {
  if (user?.personal_cell_masked) return user.personal_cell_masked;
  return user?.personal_cell_e164 ? maskPhone(user.personal_cell_e164) : "";
}
