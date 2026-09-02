// OASIS-E spec metadata — SUPERSEDED (by OASIS-E1 on 2025-01-01, then E2).
//
// Retained so an assessment completed under OASIS-E resolves to the instrument
// in force at the time rather than being re-read under a later version.
//
// This module holds METADATA AND PROVENANCE ONLY. It deliberately does NOT
// contain a reconstructed CMS item bank: the repository does not carry the
// authoritative OASIS-E instrument, and inventing item titles or response sets
// would be a fabrication of regulatory content — the one thing this layer exists
// to prevent.
//
// PennSync's internal screening items live in `oasisQuestions.jsx` and are
// classified against this metadata by `../verification.js`.

/** @typedef {{ id: string, label: string, effective_date: string, retired_date: string|null, source: string, source_url: string, completeness: string, notes: string }} OasisSpecMeta */

/** @type {OasisSpecMeta} */
export const OASIS_E_SPEC = Object.freeze({
  id: "oasis-e",
  label: "OASIS-E",
  effective_date: "2023-01-01",
  // Superseded when OASIS-E1 took effect. Leaving this null had OASIS-E
  // resolving as the current instrument two versions after it stopped being one.
  retired_date: "2025-01-01",
  source: "CMS OASIS-E Manual (Updated January 1, 2024)",
  source_url: "https://www.cms.gov/files/document/oasis-emanual2024-update.pdf",
  // The single most important field in this module.
  completeness: "partial",
  notes:
    "PennSync does not contain the authoritative CMS OASIS instrument. Its internal item "
    + "set is an abbreviated screening set used for review and education only. Item wording, "
    + "response sets and applicability must be confirmed against the official assessment in "
    + "the agency's EMR before any response is entered or submitted.",
});
