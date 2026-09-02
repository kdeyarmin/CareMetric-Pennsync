// CMS source manifest for PennSync's supported OASIS-E2 item subset.
//
// WHY THIS FILE EXISTS
// Every v2 response definition in this directory must be traceable to a FINAL
// primary CMS artifact — not to PennSync's own labels, not to a draft
// instrument, and not to anybody's recollection. Before this manifest the
// repository's provenance pointed at draft artifacts (for example
// `draft-oasiseall-items-instrument-02012022.pdf`), which is how an
// "abbreviated" response list could be mistaken for the official one.
//
// Each entry records what a reviewer needs in order to re-derive the response
// set independently: the official title, the retrieval URL, publication and
// effective dates, the date PennSync retrieved it, and the SHA-256 of the exact
// bytes that were read. A definition citing a source whose hash no longer
// matches must be re-verified before it is trusted.
//
// Pure data. No React, no SDK.

/**
 * @typedef {object} CmsSource
 * @property {string} id
 * @property {string} title            Official artifact title.
 * @property {string} url              Retrieval URL (CMS.gov).
 * @property {string} published        Publication date on the artifact (ISO).
 * @property {string} effective        Date the instrument takes effect (ISO).
 * @property {string} retrieved        Date PennSync downloaded these bytes (ISO).
 * @property {string} sha256           SHA-256 of the retrieved file.
 * @property {string} kind            "all_items" | "time_point" | "change_table"
 */

/** The final OASIS-E2 artifacts PennSync's v2 definitions were read from. */
export const CMS_SOURCES = Object.freeze({
  e2_all_items_2026_04_01: Object.freeze({
    id: "e2_all_items_2026_04_01",
    title: "Final OASIS-E2 All-Item Instrument, Effective 04/01/2026",
    url: "https://www.cms.gov/files/zip/final-oasis-e2-all-item-04-01-2026.zip",
    file: "Final OASIS-E2 All-Item 04-01-2026.pdf",
    published: "2025-12-11",
    effective: "2026-04-01",
    retrieved: "2026-09-01",
    sha256: "adf0cc77889ce9a19546e7989d0bc43c56c8e46ffae168723951e90f61ffa2f6",
    zip_sha256: "2b4539e06fabe212aaad5bc8f877210918d1cf027089e5401593f79bcaca90df",
    kind: "all_items",
  }),
  e2_soc_2026_04_01: Object.freeze({
    id: "e2_soc_2026_04_01",
    title: "OASIS-E2 Start of Care Time Point Instrument, Effective 04/01/2026",
    url: "https://www.cms.gov/files/zip/final-oasis-e2-all-item-04-01-2026.zip",
    file: "OASIS-E2 SOC 04-01-2026.pdf",
    published: "2025-12-11",
    effective: "2026-04-01",
    retrieved: "2026-09-01",
    sha256: "b0856345cc5782677dd2a88653315ae34670ebe781b97c4cc46161febf22f016",
    kind: "time_point",
  }),
  e2_roc_2026_04_01: Object.freeze({
    id: "e2_roc_2026_04_01",
    title: "OASIS-E2 Resumption of Care Time Point Instrument, Effective 04/01/2026",
    url: "https://www.cms.gov/files/zip/final-oasis-e2-all-item-04-01-2026.zip",
    file: "OASIS-E2 ROC 04-01-2026.pdf",
    published: "2025-12-11",
    effective: "2026-04-01",
    retrieved: "2026-09-01",
    sha256: "cb53ab197c806ddeecd9e959cf6ca1266d61e3f7b13a22f921d0474bcc918e1c",
    kind: "time_point",
  }),
  e2_fu_2026_04_01: Object.freeze({
    id: "e2_fu_2026_04_01",
    title: "OASIS-E2 Follow-Up Time Point Instrument, Effective 04/01/2026",
    url: "https://www.cms.gov/files/zip/final-oasis-e2-all-item-04-01-2026.zip",
    file: "OASIS-E2 FU 04-01-2026.pdf",
    published: "2025-12-11",
    effective: "2026-04-01",
    retrieved: "2026-09-01",
    sha256: "33fd62c7163a764f96e3bea8c7e4a84dc6e232cfe707c2a7d37508ae0772e33c",
    kind: "time_point",
  }),
  e2_trn_2026_04_01: Object.freeze({
    id: "e2_trn_2026_04_01",
    title: "OASIS-E2 Transfer Time Point Instrument, Effective 04/01/2026",
    url: "https://www.cms.gov/files/zip/final-oasis-e2-all-item-04-01-2026.zip",
    file: "OASIS-E2 TRN 04-01-2026.pdf",
    published: "2025-12-11",
    effective: "2026-04-01",
    retrieved: "2026-09-01",
    sha256: "d7eda6ef8d4bff6cd15c0f43c11cf07fe55013aecd17240f2b04142d665b0e6e",
    kind: "time_point",
  }),
  e2_dc_2026_04_01: Object.freeze({
    id: "e2_dc_2026_04_01",
    title: "OASIS-E2 Discharge Time Point Instrument, Effective 04/01/2026",
    url: "https://www.cms.gov/files/zip/final-oasis-e2-all-item-04-01-2026.zip",
    file: "OASIS-E2 DC 04-01-2026.pdf",
    published: "2025-12-11",
    effective: "2026-04-01",
    retrieved: "2026-09-01",
    sha256: "4008e7530c3893916feffc84475e9e811d9cd889839fa5d44f9093fb00d0368f",
    kind: "time_point",
  }),
  e2_dah_2026_04_01: Object.freeze({
    id: "e2_dah_2026_04_01",
    title: "OASIS-E2 Death at Home Time Point Instrument, Effective 04/01/2026",
    url: "https://www.cms.gov/files/zip/final-oasis-e2-all-item-04-01-2026.zip",
    file: "OASIS-E2 DAH 04-01-2026.pdf",
    published: "2025-12-11",
    effective: "2026-04-01",
    retrieved: "2026-09-01",
    sha256: "558135e5a9b8e02c49a5f7706e9de6eedb91e0d5a6aadf14cb0a8d077e9ac9a8",
    kind: "time_point",
  }),
});

/** Where the reader can find the artifacts themselves. */
export const CMS_SOURCE_INDEXES = Object.freeze({
  data_sets: "https://www.cms.gov/medicare/quality/home-health/oasis-data-sets",
  user_manuals: "https://www.cms.gov/medicare/quality/home-health/oasis-user-manuals",
});

/**
 * How the v2 response sets were derived.
 *
 * Deliberately explicit about METHOD, because "we read the manual" and "we
 * transcribed the instrument option by option" are different claims and only
 * the second one supports an exact-code product decision.
 */
export const V2_DERIVATION = Object.freeze({
  derived_at: "2026-09-01",
  derived_from: "e2_all_items_2026_04_01",
  applicability_derived_from: [
    "e2_soc_2026_04_01",
    "e2_roc_2026_04_01",
    "e2_fu_2026_04_01",
    "e2_trn_2026_04_01",
    "e2_dc_2026_04_01",
    "e2_dah_2026_04_01",
  ],
  method:
    "Each item's response set was transcribed from the final OASIS-E2 All-Item instrument "
    + "(text extracted from the published PDF), code by code, preserving CMS code strings "
    + "exactly. Item applicability was derived by checking each item's presence as a real "
    + "item definition — not a skip-instruction cross-reference — in each final Time Point "
    + "instrument. No wording was reconstructed from memory and PennSync's own labels were "
    + "not used as a source.",
  limits:
    "This is a transcription of the INSTRUMENT (the item and its response options). It is "
    + "not a transcription of the OASIS-E2 Guidance Manual's coding instructions, and it "
    + "does not make PennSync the official OASIS completion or submission system.",
});

/** @param {string} id */
export function cmsSource(id) {
  return CMS_SOURCES[id] || null;
}
