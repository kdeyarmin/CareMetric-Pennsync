// OASIS reference layer — versioned, provenance-bearing, and honest about what
// PennSync has and has not verified.
//
// WHY THIS EXISTS
// PennSync is NOT the official OASIS completion or submission system. The agency
// completes and submits OASIS in its EMR / iQIES; PennSync only helps staff
// review, understand and cross-check what they entered there.
//
// The internal item set (`oasisQuestions.jsx`) grew organically and is an
// ABBREVIATED screening set, not the CMS instrument. An audit on 2026-08-31
// found three items carrying official CMS item numbers attached to the wrong
// content, and several items whose response lists are shortened versions of the
// official response sets. Presenting either as the official item risks a nurse
// carrying a wrong item number or response into the legal record.
//
// The fix is NOT to invent the CMS specification — the repository does not
// contain the authoritative OASIS-E/E1 instrument, and fabricating it would be
// far worse than an abbreviated set. Instead this layer:
//
//   1. records, per item, whether PennSync has VERIFIED the item's title and
//      response set against an authoritative CMS source;
//   2. records the version the internal set is patterned after, with effective
//      dates, so a retired definition cannot be used silently;
//   3. gives the UI a deterministic way to say "this is a PennSync screening
//      item, confirm the official wording and response in your EMR".
//
// Pure data + pure functions. No React, no SDK — unit-testable offline.

export { OASIS_E_SPEC } from "./e/index.js";
export { OASIS_E1_SPEC } from "./e1/index.js";
export { OASIS_E2_SPEC } from "./e2/index.js";
export {
  ACTIVE_OASIS_SPEC,
  KNOWN_OASIS_SPECS,
  getOasisSpec,
  resolveSpecForDate,
} from "./registry.js";
export {
  ITEM_VERIFICATION,
  VERIFICATION_LEVELS,
  cmsItemsOnly,
  itemSourceFor,
  sourceCheckStatus,
  classifyItem,
  describeVerification,
  isOfficialCmsItem,
  itemDisclaimer,
  officialItemNumber,
} from "./verification.js";
