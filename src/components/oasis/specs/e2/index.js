// OASIS-E2 spec metadata — the version currently in effect.
//
// Verified against the CMS OASIS-E2 Manual (Effective April 1, 2026), title page
// and Chapter 1 §1.4.1, retrieved 2026-09-01 from
// https://www.cms.gov/files/document/oasis-e2-draft-508-11-14-25.pdf
//
// METADATA AND PROVENANCE ONLY — this module still does NOT reproduce the CMS
// item bank. What it now carries that it could not before is a checked
// effective date and a real source citation.

/** @typedef {import("../e/index.js").OasisSpecMeta} OasisSpecMeta */

/** @type {OasisSpecMeta} */
export const OASIS_E2_SPEC = Object.freeze({
  id: "oasis-e2",
  label: "OASIS-E2",
  effective_date: "2026-04-01",
  retired_date: null,
  source: "CMS OASIS-E2 Manual (Effective April 1, 2026)",
  source_url: "https://www.cms.gov/files/document/oasis-e2-draft-508-11-14-25.pdf",
  completeness: "partial",
  notes:
    "PennSync does not contain the authoritative CMS OASIS instrument. Its internal item set is "
    + "an abbreviated screening set used for review and education only, and a source check on "
    + "2026-09-01 found several of its item numbers retired or absent from every published CMS "
    + "manual (see specs/verification.js). Item wording, response sets and applicability must be "
    + "confirmed against the official assessment in the agency's EMR before any response is "
    + "entered or submitted.",
});
