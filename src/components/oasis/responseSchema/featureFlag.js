// Feature gate for v2 OASIS response entry.
//
// SCOPE — read this before wiring anything to it.
// This flag gates NEW v2 WRITES only. It does not gate:
//   * P0 containment (AI/output/analytics), which is unconditional;
//   * reading either schema, which must keep working at every flag state;
//   * the refusal of legacy writes, which is permanent.
//
// Rollback therefore means "stop new v2 writes", never "resume legacy writes"
// and never "down-convert v2 rows".
//
// WHERE THE FLAGS LIVE, AND WHY IT MATTERS THAT THIS FILE AGREES
// Both are FLAT boolean fields on an `AgencySettings` row — the same entity and
// the same two field names the protected backend path reads. They are not
// members of a nested `feature_access`/`features` bag: no entity in this app
// defines one. A gate that reads a field the schema does not define is not a
// gate; it answers the same way forever, and which way depends on how it was
// written. Reading a nested bag here would have made `canWriteV2Responses()`
// permanently false (the feature could never be turned on) and
// `writesAreKilled()` permanently false — an incident kill switch that cannot
// fire, which is the failure direction that actually costs something.
//
// THE SERVER IS THE ENFORCING GATE. `saveOasisResponses` re-checks both fields
// against the caller's own agency and refuses independently. These functions
// exist so the UI can say why before a round trip, not to be trusted.

/** AgencySettings field: rollout flag for CMS-aligned entry. Default OFF. */
export const OASIS_RESPONSE_SCHEMA_V2_FLAG = "oasis_response_schema_v2_enabled";

/**
 * Whether an agency may create NEW v2 official responses.
 *
 * Strict `=== true`: an absent row, an absent field, or a truthy non-boolean
 * (`"false"` is truthy) all mean not enabled.
 *
 * @param {{ oasis_response_schema_v2_enabled?: boolean } | null | undefined} settings
 *   the caller's AgencySettings row, via `fetchCallerAgencySettings()`
 */
export function canWriteV2Responses(settings) {
  if (!settings || typeof settings !== "object") return false;
  return settings[OASIS_RESPONSE_SCHEMA_V2_FLAG] === true;
}

/**
 * A hard stop on ALL new official OASIS response writes, independent of the
 * feature flag. Exists so an incident can be contained without a deploy.
 */
export const OASIS_WRITE_KILL_SWITCH = "oasis_response_writes_disabled";

/**
 * @param {{ oasis_response_writes_disabled?: boolean } | null | undefined} settings
 *   the caller's AgencySettings row
 */
export function writesAreKilled(settings) {
  if (!settings || typeof settings !== "object") return false;
  return settings[OASIS_WRITE_KILL_SWITCH] === true;
}

/** Reading never depends on the flag. Stated as a function so callers can't forget. */
export function canReadSchema() {
  return true;
}
