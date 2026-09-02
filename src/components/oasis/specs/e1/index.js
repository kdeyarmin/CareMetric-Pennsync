// OASIS-E1 spec metadata — superseded by OASIS-E2 on 2026-04-01.
//
// Verified against the CMS OASIS-E1 Manual (Effective January 1, 2025), title
// page, retrieved 2026-09-01 from
// https://www.cms.gov/files/document/draft-oasis-e1-manual-04-28-2024.pdf
//
// Retained so an assessment completed under E1 resolves to the instrument that
// was actually in force at the time, rather than being re-interpreted under E2.

/** @typedef {import("../e/index.js").OasisSpecMeta} OasisSpecMeta */

/** @type {OasisSpecMeta} */
export const OASIS_E1_SPEC = Object.freeze({
  id: "oasis-e1",
  label: "OASIS-E1",
  effective_date: "2025-01-01",
  retired_date: "2026-04-01",
  source: "CMS OASIS-E1 Manual (Effective January 1, 2025)",
  source_url: "https://www.cms.gov/files/document/draft-oasis-e1-manual-04-28-2024.pdf",
  completeness: "partial",
  notes:
    "Superseded by OASIS-E2 on 2026-04-01. PennSync does not contain the authoritative CMS "
    + "instrument for this version either.",
});
