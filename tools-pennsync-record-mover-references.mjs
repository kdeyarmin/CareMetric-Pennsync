/**
 * Which table a reference column points at, decided by the column's name. The verifier
 * (links and visibility) and the rollback (which parents a remaining row keeps) both ask
 * this, and asking it here means they cannot disagree about what counts as a reference.
 *
 * This module imports nothing. The verifier is written apart from the planner and the
 * loader, so nothing it imports may bring either of them in.
 *
 * A column `<name>_id` points at table `<name>`. Failing that, the prefixes below are
 * removed from the front one at a time, in this order, and the first name that is a
 * table wins, so the most specific name is preferred. `agency_id` is never a reference:
 * it holds the owned agency's id, stamped before sealing, and not the id of a row in
 * the carried `agency` table. A column whose name does not name its table (a
 * `vehicle_id` pointing at `fleet_vehicle`) is not recognised.
 */

export const REFERENCE_PREFIXES = Object.freeze(['target_', 'related_', 'parent_', 'source_', 'linked_', 'primary_', 'referring_', 'original_']);

const REFERENCE = /^([a-z][a-z0-9_]*)_id$/;

/** The table `column` points at, if it is one of `tables` (anything with `has`); otherwise null. */
export function referenceTarget(column, tables) {
  const m = REFERENCE.exec(column);
  if (!m || column === 'agency_id') return null;
  let name = m[1];
  if (tables.has(name)) return name;
  for (const prefix of REFERENCE_PREFIXES) {
    if (!name.startsWith(prefix)) continue;
    name = name.slice(prefix.length);
    if (tables.has(name)) return name;
  }
  return null;
}
