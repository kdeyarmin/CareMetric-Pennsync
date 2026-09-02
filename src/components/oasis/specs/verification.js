// Per-item verification registry for PennSync's internal OASIS screening set.
//
// THE PROBLEM THIS SOLVES
// An audit of `oasisQuestions.jsx` on 2026-08-31 found items presenting official
// CMS item numbers with content that does not belong to those items, and items
// whose response lists are shortened versions of the official response sets. A
// nurse reading "M2200 — Speech-Language Pathology" could carry that item number
// into the official assessment. The repository even contradicted itself:
// `AIProactiveOASISAssistant.jsx` describes M2102 as "Types and Sources of
// Assistance" while `oasisQuestions.jsx` labelled it "Physical Therapy".
//
// THE FIX, AND WHAT IT DELIBERATELY IS NOT
// PennSync does not hold the authoritative CMS instrument, so this registry does
// NOT invent correct titles or response sets — that would replace one fabrication
// with another. It records, per item, WHAT PENNSYNC KNOWS:
//
//   verified            — title and response set confirmed against a CMS source.
//   abbreviated         — a real CMS item, but PennSync's response list is a
//                         SHORTENED screening version. Usable to prompt a review;
//                         never usable as the official response set.
//   unverified          — a real CMS item number whose PennSync wording has not
//                         been confirmed against a CMS source.
//   pennsync_screening  — NOT a CMS item. A PennSync-internal screening question.
//                         It must never display an official item number.
//
// Nothing here is graded by an LLM. The classification is data and the UI
// consequences are deterministic.
//
// SOURCE CHECK (2026-09-01) — WHAT IT FOUND
// The item numbers below were checked against the published CMS manuals:
//   OASIS-E  (Updated 01/01/2024) https://www.cms.gov/files/document/oasis-emanual2024-update.pdf
//   OASIS-E1 (Effective 01/01/2025) https://www.cms.gov/files/document/draft-oasis-e1-manual-04-28-2024.pdf
//   OASIS-E2 (Effective 04/01/2026) https://www.cms.gov/files/document/oasis-e2-draft-508-11-14-25.pdf
//
// It found considerably more wrong than the three therapy items already demoted:
//   - FIVE item numbers appear in NO manual at all: M1020, M1300, M1350, M1900,
//     M2110. Primary Diagnosis is M1021 (M1023 is Other Diagnoses); Prior
//     Functioning is GG0100.
//   - FOUR were real but are retired from the current instrument: M1030, M1242,
//     M1730 ("Depression Screening — Removed"), M1910 ("Falls Risk Assessment
//     — Removed"). Depression is now D0150/D0160; falls are J1800/J1900; pain
//     is J0510/J0520/J0530.
//   - M2200 (Therapy Need) was removed per CMS-1780-F, confirming the earlier
//     demotion.
//   - M0069 was "Gender", NOT "Prognosis" as PennSync labelled it, and is
//     replaced by A0810 Sex in OASIS-E2. Wrong meaning AND retired.
//
// THREE DIFFERENT QUESTIONS, DELIBERATELY SEPARATE
//   source_verified_*        — FACTUAL: does this item number exist in the
//                              current CMS manual, and what is its title?
//                              A lookup. DONE (2026-09-01).
//   classification_signed_*  — Is the LEVEL below (verified / retired /
//                              not_a_cms_item / …) the right one, given that
//                              source check? A determination that follows from
//                              the evidence. SIGNED OFF — see below.
//   reviewed_by/at           — CLINICAL: is PennSync's *use* of this item
//                              appropriate, and is an abbreviated response set
//                              safe as a screening prompt? A judgement about
//                              patient care. NOT done, and not mine to make.
//
// WHO MAY WRITE THE THIRD ONE
// `reviewed_by` means a NAMED HUMAN confirmed this. An automated check must
// never write to it — doing so would make the product assert something untrue
// to a future auditor, the exact failure this layer exists to prevent. It is
// written only when a person actually signs off, and `review_source` records
// what their sign-off did and did not cover, so the record is never read as
// broader than the review behind it.
//
// Signed 2026-09-01 by Kevin Deyarmin. `review_source` states plainly that
// RESPONSE OPTIONS were not individually verified against the CMS manual — the
// known gap inside the attestation.
//
// RESPONSE-SET READ (2026-09-01) — WHAT IT FOUND
// The sign-off above states plainly that RESPONSE OPTIONS were not individually
// verified. That caveat has since been closed, and it turned out to be carrying
// most of the weight.
//
// The guidance manual states response codes as prose coding instructions rather
// than a parseable list, which is why the first check stopped at titles. CMS
// publishes the response sets separately, in the OASIS-E2 All Items instrument
// (12/11/2025). Every PennSync item present there was read against it option by
// option — code set, code order, and the MEANING of each option's text.
//
// Of the 24 items with an official response set to compare against:
//   -  1 reproduces it faithfully (M1800).
//   -  5 use the same codes in the same order with looser wording (M1700,
//      M1810, M1820, M1845, M1850).
//   - 18 have at least one code that means something DIFFERENT on the official
//      assessment, or a different answer shape entirely.
//
// A matching code SET is not a matching response set, and that is the trap this
// read exists to close. M1340's codes are {0,1,2} exactly as CMS has them — and
// PennSync's 2 is "Yes, infected" where the CMS 2 is "known but not observable".
// M2020's codes 1 and 2 are transposed against CMS. M2010's 0 means "not
// applicable" where the CMS 0 means "No, education was not provided". M1860's
// scale is offset by one from code 1 onward. A nurse reading a code off a
// PennSync screen and typing it into the same-numbered item in the EMR would
// enter the wrong response in each of those cases.
//
// WHAT WAS DELIBERATELY NOT DONE
// The option lists were NOT rewritten to the CMS wording. Stored assessments key
// off these values, and re-labelling code 2 of M2020 would silently change the
// meaning of every M2020 answer already recorded — changing clinician-entered
// facts after the fact. The divergence is instead recorded as data
// (`response_set`), and `mayCarryResponseToEmr()` makes the consequence
// deterministic. `oasisScales.js` and `oasisScoringEngine.js` mirror these same
// scales, so the app remains internally consistent with itself; what it is not
// is a reproduction of the CMS instrument.
//
// This does not overturn the clinical sign-off, it bounds it. Signing that an
// option list is usable as a SCREENING PROMPT is a different claim from saying
// it is the CMS response set, and only the first was ever made.
//
// CLINICAL SIGN-OFF IS TRACKED, NOT ASSUMED
// A classification is only as good as the person who made it. Every entry
// therefore carries its own review provenance:
//
//   reviewed_by     — who confirmed it ("" = nobody yet)
//   reviewed_at     — when (ISO date, "" = never)
//   review_source   — what authoritative document was checked against
//
// An entry with no `reviewed_by` has been CLASSIFIED but not SIGNED OFF, and
// `pendingClinicalReview()` lists exactly those. This matters because the
// classifications shipped in this file were derived from internal evidence (the
// repository contradicting itself on M2102, PDGM discontinuing M2200) and from
// the app's own canonical scale table — not from a qualified OASIS reviewer
// reading the CMS instrument. Until one does, the product must be able to say
// so, and `buildClinicalReviewWorksheet()` produces the artifact they need.

import { ACTIVE_OASIS_SPEC } from "./registry.js";

import { V2_DEFINITIONS } from "../responseSchema/v2CmsE2.js";
import { V1_LEGACY_DEFINITIONS } from "../responseSchema/v1Legacy.js";
/** @type {ReadonlyArray<string>} */
export const VERIFICATION_LEVELS = Object.freeze([
  "verified",
  "abbreviated",
  "unverified",
  // Was a real CMS item, but is NOT in the instrument currently in effect.
  // Distinct from `not_a_cms_item`: a nurse may legitimately remember it.
  "retired",
  // The item number appears in NO published CMS manual that PennSync checked.
  "not_a_cms_item",
  // Not a CMS item and never claimed to be — a PennSync-authored question.
  "pennsync_screening",
]);

/**
 * The registry. Keyed by the internal item id used in `oasisQuestions.jsx`.
 *
 * `official_item` is the CMS item number PennSync may display. It is null for a
 * PennSync screening item — the whole point of the classification.
 */
export const ITEM_VERIFICATION = Object.freeze({
  // -- Item numbers that appear in NO published CMS manual -----------------
  m1020: {
    level: "not_a_cms_item",
    response_set: "not_applicable",
    response_set_note:
      "Not in the CMS instrument now in effect, so there is no official response set to compare against.",
    official_item: null,
    note:
      "This item number appears in no published CMS OASIS manual PennSync checked (E, E1, E2). Primary Diagnosis is M1021 in every manual checked (M1023 is Other Diagnoses).",
    reviewed_by: "Kevin Deyarmin (kdeyarmin@comcast.net)",
    reviewed_at: "2026-09-01",
    review_source:
      "Product-owner sign-off. Covers PennSync's USE of each item: for a current CMS item, that this form's response options are acceptable as a screening prompt; for a retired or non-CMS item, that the question is still worth asking internally. Item numbers and titles were verified against the CMS OASIS-E/E1/E2 manuals; RESPONSE OPTIONS WERE NOT individually verified against the manual.",    classification_signed_off_by: "PennSync CMS source check",
    classification_signed_off_at: "2026-09-01",
    classification_basis: "Item number and title checked against the published CMS OASIS-E, E1 and E2 manuals.",

    source_verified_at: "2026-09-01",
    source_verified_against: "CMS OASIS-E2 Manual (Effective 04/01/2026), Chapter 3",
  },
  m1300: {
    level: "not_a_cms_item",
    response_set: "not_applicable",
    response_set_note:
      "Not in the CMS instrument now in effect, so there is no official response set to compare against.",
    official_item: null,
    note:
      "This item number appears in no published CMS OASIS manual PennSync checked (E, E1, E2).",
    reviewed_by: "Kevin Deyarmin (kdeyarmin@comcast.net)",
    reviewed_at: "2026-09-01",
    review_source:
      "Product-owner sign-off. Covers PennSync's USE of each item: for a current CMS item, that this form's response options are acceptable as a screening prompt; for a retired or non-CMS item, that the question is still worth asking internally. Item numbers and titles were verified against the CMS OASIS-E/E1/E2 manuals; RESPONSE OPTIONS WERE NOT individually verified against the manual.",    classification_signed_off_by: "PennSync CMS source check",
    classification_signed_off_at: "2026-09-01",
    classification_basis: "Item number and title checked against the published CMS OASIS-E, E1 and E2 manuals.",

    source_verified_at: "2026-09-01",
    source_verified_against: "CMS OASIS-E2 Manual (Effective 04/01/2026), Chapter 3",
  },
  m1350: {
    level: "not_a_cms_item",
    response_set: "not_applicable",
    response_set_note:
      "Not in the CMS instrument now in effect, so there is no official response set to compare against.",
    official_item: null,
    note:
      "This item number appears in no published CMS OASIS manual PennSync checked (E, E1, E2).",
    reviewed_by: "Kevin Deyarmin (kdeyarmin@comcast.net)",
    reviewed_at: "2026-09-01",
    review_source:
      "Product-owner sign-off. Covers PennSync's USE of each item: for a current CMS item, that this form's response options are acceptable as a screening prompt; for a retired or non-CMS item, that the question is still worth asking internally. Item numbers and titles were verified against the CMS OASIS-E/E1/E2 manuals; RESPONSE OPTIONS WERE NOT individually verified against the manual.",    classification_signed_off_by: "PennSync CMS source check",
    classification_signed_off_at: "2026-09-01",
    classification_basis: "Item number and title checked against the published CMS OASIS-E, E1 and E2 manuals.",

    source_verified_at: "2026-09-01",
    source_verified_against: "CMS OASIS-E2 Manual (Effective 04/01/2026), Chapter 3",
  },
  m1900: {
    level: "not_a_cms_item",
    response_set: "not_applicable",
    response_set_note:
      "Not in the CMS instrument now in effect, so there is no official response set to compare against.",
    official_item: null,
    note:
      "This item number appears in no published CMS OASIS manual PennSync checked (E, E1, E2). Prior Functioning is GG0100.",
    reviewed_by: "Kevin Deyarmin (kdeyarmin@comcast.net)",
    reviewed_at: "2026-09-01",
    review_source:
      "Product-owner sign-off. Covers PennSync's USE of each item: for a current CMS item, that this form's response options are acceptable as a screening prompt; for a retired or non-CMS item, that the question is still worth asking internally. Item numbers and titles were verified against the CMS OASIS-E/E1/E2 manuals; RESPONSE OPTIONS WERE NOT individually verified against the manual.",    classification_signed_off_by: "PennSync CMS source check",
    classification_signed_off_at: "2026-09-01",
    classification_basis: "Item number and title checked against the published CMS OASIS-E, E1 and E2 manuals.",

    source_verified_at: "2026-09-01",
    source_verified_against: "CMS OASIS-E2 Manual (Effective 04/01/2026), Chapter 3",
  },

  // -- Real CMS items, retired from the instrument now in effect -----------
  m1030: {
    level: "retired",
    response_set: "not_applicable",
    response_set_note:
      "Not in the CMS instrument now in effect, so there is no official response set to compare against.",
    official_item: null,
    former_item: "M1030",
    official_title: "Therapies the patient receives at home",
    note:
      "Retired from the OASIS instrument currently in effect. Present in OASIS-E; absent from E1 and E2. "
      + "Do not enter this on the official assessment; PennSync keeps the question only as an "
      + "internal screening prompt.",
    reviewed_by: "Kevin Deyarmin (kdeyarmin@comcast.net)",
    reviewed_at: "2026-09-01",
    review_source:
      "Product-owner sign-off. Covers PennSync's USE of each item: for a current CMS item, that this form's response options are acceptable as a screening prompt; for a retired or non-CMS item, that the question is still worth asking internally. Item numbers and titles were verified against the CMS OASIS-E/E1/E2 manuals; RESPONSE OPTIONS WERE NOT individually verified against the manual.",    classification_signed_off_by: "PennSync CMS source check",
    classification_signed_off_at: "2026-09-01",
    classification_basis: "Item number and title checked against the published CMS OASIS-E, E1 and E2 manuals.",

    source_verified_at: "2026-09-01",
    source_verified_against: "CMS OASIS-E2 Manual (Effective 04/01/2026), Chapter 3",
  },
  m1242: {
    level: "retired",
    response_set: "not_applicable",
    response_set_note:
      "Not in the CMS instrument now in effect, so there is no official response set to compare against.",
    official_item: null,
    former_item: "M1242",
    official_title: "Frequency of Pain Interfering with activity or movement",
    note:
      "Retired from the OASIS instrument currently in effect. Present in OASIS-E; absent from E1 and E2. Pain is now J0510/J0520/J0530. "
      + "Do not enter this on the official assessment; PennSync keeps the question only as an "
      + "internal screening prompt.",
    reviewed_by: "Kevin Deyarmin (kdeyarmin@comcast.net)",
    reviewed_at: "2026-09-01",
    review_source:
      "Product-owner sign-off. Covers PennSync's USE of each item: for a current CMS item, that this form's response options are acceptable as a screening prompt; for a retired or non-CMS item, that the question is still worth asking internally. Item numbers and titles were verified against the CMS OASIS-E/E1/E2 manuals; RESPONSE OPTIONS WERE NOT individually verified against the manual.",    classification_signed_off_by: "PennSync CMS source check",
    classification_signed_off_at: "2026-09-01",
    classification_basis: "Item number and title checked against the published CMS OASIS-E, E1 and E2 manuals.",

    source_verified_at: "2026-09-01",
    source_verified_against: "CMS OASIS-E2 Manual (Effective 04/01/2026), Chapter 3",
  },
  m1730: {
    level: "retired",
    response_set: "not_applicable",
    response_set_note:
      "Not in the CMS instrument now in effect, so there is no official response set to compare against.",
    official_item: null,
    former_item: "M1730",
    official_title: "Depression Screening",
    note:
      "Retired from the OASIS instrument currently in effect. The OASIS-E manual lists this item as Removed; absent from E1 and E2. Depression is now D0150/D0160 (PHQ). "
      + "Do not enter this on the official assessment; PennSync keeps the question only as an "
      + "internal screening prompt.",
    reviewed_by: "Kevin Deyarmin (kdeyarmin@comcast.net)",
    reviewed_at: "2026-09-01",
    review_source:
      "Product-owner sign-off. Covers PennSync's USE of each item: for a current CMS item, that this form's response options are acceptable as a screening prompt; for a retired or non-CMS item, that the question is still worth asking internally. Item numbers and titles were verified against the CMS OASIS-E/E1/E2 manuals; RESPONSE OPTIONS WERE NOT individually verified against the manual.",    classification_signed_off_by: "PennSync CMS source check",
    classification_signed_off_at: "2026-09-01",
    classification_basis: "Item number and title checked against the published CMS OASIS-E, E1 and E2 manuals.",

    source_verified_at: "2026-09-01",
    source_verified_against: "CMS OASIS-E2 Manual (Effective 04/01/2026), Chapter 3",
  },
  m1910: {
    level: "retired",
    response_set: "not_applicable",
    response_set_note:
      "Not in the CMS instrument now in effect, so there is no official response set to compare against.",
    official_item: null,
    former_item: "M1910",
    official_title: "Falls Risk Assessment",
    note:
      "Retired from the OASIS instrument currently in effect. The OASIS-E manual lists this item as Removed; absent from E1 and E2. Falls are now J1800/J1900. "
      + "Do not enter this on the official assessment; PennSync keeps the question only as an "
      + "internal screening prompt.",
    reviewed_by: "Kevin Deyarmin (kdeyarmin@comcast.net)",
    reviewed_at: "2026-09-01",
    review_source:
      "Product-owner sign-off. Covers PennSync's USE of each item: for a current CMS item, that this form's response options are acceptable as a screening prompt; for a retired or non-CMS item, that the question is still worth asking internally. Item numbers and titles were verified against the CMS OASIS-E/E1/E2 manuals; RESPONSE OPTIONS WERE NOT individually verified against the manual.",    classification_signed_off_by: "PennSync CMS source check",
    classification_signed_off_at: "2026-09-01",
    classification_basis: "Item number and title checked against the published CMS OASIS-E, E1 and E2 manuals.",

    source_verified_at: "2026-09-01",
    source_verified_against: "CMS OASIS-E2 Manual (Effective 04/01/2026), Chapter 3",
  },
  m0069: {
    level: "retired",
    response_set: "not_applicable",
    response_set_note:
      "Not in the CMS instrument now in effect, so there is no official response set to compare against.",
    official_item: null,
    former_item: "M0069",
    official_title: "Gender",
    note:
      "Retired from the OASIS instrument currently in effect. Replaced by A0810 Sex in OASIS-E2 (Appendix D, Table D1). PennSync labelled it Prognosis, which was never its meaning. "
      + "Do not enter this on the official assessment; PennSync keeps the question only as an "
      + "internal screening prompt.",
    reviewed_by: "Kevin Deyarmin (kdeyarmin@comcast.net)",
    reviewed_at: "2026-09-01",
    review_source:
      "Product-owner sign-off. Covers PennSync's USE of each item: for a current CMS item, that this form's response options are acceptable as a screening prompt; for a retired or non-CMS item, that the question is still worth asking internally. Item numbers and titles were verified against the CMS OASIS-E/E1/E2 manuals; RESPONSE OPTIONS WERE NOT individually verified against the manual.",    classification_signed_off_by: "PennSync CMS source check",
    classification_signed_off_at: "2026-09-01",
    classification_basis: "Item number and title checked against the published CMS OASIS-E, E1 and E2 manuals.",

    source_verified_at: "2026-09-01",
    source_verified_against: "CMS OASIS-E2 Manual (Effective 04/01/2026), Chapter 3",
  },

  // -- PennSync screening questions (never CMS items) ----------------------
  m2102: {
    level: "pennsync_screening",
    response_set: "not_applicable",
    response_set_note:
      "PennSync's question (physical therapy need) is not the CMS item, so there is no response set to compare. The CMS M2102 is 'Types and Sources of Assistance', coded 0-4 per sub-item — confirming this item's pennsync_screening classification.",
    official_item: null,
    pennsync_item: "PS-THERAPY-PT",
    note:
      "Not a CMS OASIS item. Previously mislabelled as M2102 - the source check confirms M2102 is Types and Sources of Assistance, not a physical-therapy need question.",
    reviewed_by: "Kevin Deyarmin (kdeyarmin@comcast.net)",
    reviewed_at: "2026-09-01",
    review_source:
      "Product-owner sign-off. Covers PennSync's USE of each item: for a current CMS item, that this form's response options are acceptable as a screening prompt; for a retired or non-CMS item, that the question is still worth asking internally. Item numbers and titles were verified against the CMS OASIS-E/E1/E2 manuals; RESPONSE OPTIONS WERE NOT individually verified against the manual.",    classification_signed_off_by: "PennSync CMS source check",
    classification_signed_off_at: "2026-09-01",
    classification_basis: "Item number and title checked against the published CMS OASIS-E, E1 and E2 manuals.",

    source_verified_at: "2026-09-01",
    source_verified_against: "CMS OASIS-E2 Manual (Effective 04/01/2026), Chapter 3",
  },
  m2110: {
    level: "pennsync_screening",
    response_set: "not_applicable",
    response_set_note:
      "Not in the CMS instrument now in effect, so there is no official response set to compare against.",
    official_item: null,
    pennsync_item: "PS-THERAPY-OT",
    note:
      "Not a CMS OASIS item. M2110 appears in none of OASIS-E, E1 or E2.",
    reviewed_by: "Kevin Deyarmin (kdeyarmin@comcast.net)",
    reviewed_at: "2026-09-01",
    review_source:
      "Product-owner sign-off. Covers PennSync's USE of each item: for a current CMS item, that this form's response options are acceptable as a screening prompt; for a retired or non-CMS item, that the question is still worth asking internally. Item numbers and titles were verified against the CMS OASIS-E/E1/E2 manuals; RESPONSE OPTIONS WERE NOT individually verified against the manual.",    classification_signed_off_by: "PennSync CMS source check",
    classification_signed_off_at: "2026-09-01",
    classification_basis: "Item number and title checked against the published CMS OASIS-E, E1 and E2 manuals.",

    source_verified_at: "2026-09-01",
    source_verified_against: "CMS OASIS-E2 Manual (Effective 04/01/2026), Chapter 3",
  },
  m2200: {
    level: "pennsync_screening",
    response_set: "not_applicable",
    response_set_note:
      "Not in the CMS instrument now in effect, so there is no official response set to compare against.",
    official_item: null,
    pennsync_item: "PS-THERAPY-SLP",
    note:
      "Not a CMS OASIS item. M2200 was Therapy Need and was removed per CMS-1780-F (OASIS-E2 Chapter 1: two items are removed, M0110 and M2200).",
    reviewed_by: "Kevin Deyarmin (kdeyarmin@comcast.net)",
    reviewed_at: "2026-09-01",
    review_source:
      "Product-owner sign-off. Covers PennSync's USE of each item: for a current CMS item, that this form's response options are acceptable as a screening prompt; for a retired or non-CMS item, that the question is still worth asking internally. Item numbers and titles were verified against the CMS OASIS-E/E1/E2 manuals; RESPONSE OPTIONS WERE NOT individually verified against the manual.",    classification_signed_off_by: "PennSync CMS source check",
    classification_signed_off_at: "2026-09-01",
    classification_basis: "Item number and title checked against the published CMS OASIS-E, E1 and E2 manuals.",

    source_verified_at: "2026-09-01",
    source_verified_against: "CMS OASIS-E2 Manual (Effective 04/01/2026), Chapter 3",
  },

  // -- Current CMS item whose response list PennSync abbreviates -----------
  m2420: {
    level: "abbreviated",
    response_set: "conflicts",
    response_set_note:
      "PennSync uses the pre-OASIS-D discharge-disposition list. In the current instrument, 2 is 'remained in the community with skilled services from a Medicare Certified HHA', 3 is 'transferred to a non-institutional hospice' and 4 is 'moved to a geographic location not served by this agency'. PennSync's 2, 3 and 4 (hospital, rehab facility, nursing home) name different destinations under the same codes, and its 5 is not a valid response.",
    official_item: "M2420",
    official_title: "Discharge Disposition",
    note:
      "A current CMS item, but PennSync's response list is a shortened screening version "
      + "and does not reproduce the official response set. Confirm the disposition response in your EMR.",
    reviewed_by: "Kevin Deyarmin (kdeyarmin@comcast.net)",
    reviewed_at: "2026-09-01",
    review_source:
      "Product-owner sign-off. Covers PennSync's USE of each item: for a current CMS item, that this form's response options are acceptable as a screening prompt; for a retired or non-CMS item, that the question is still worth asking internally. Item numbers and titles were verified against the CMS OASIS-E/E1/E2 manuals; RESPONSE OPTIONS WERE NOT individually verified against the manual.",    classification_signed_off_by: "PennSync CMS source check",
    classification_signed_off_at: "2026-09-01",
    classification_basis: "Item number and title checked against the published CMS OASIS-E, E1 and E2 manuals.",

    source_verified_at: "2026-09-01",
    source_verified_against: "CMS OASIS-E2 Manual (Effective 04/01/2026), Chapter 3",
  },

  // -- Item number and title confirmed against the current CMS manual ------
  m1100: {
    level: "verified",
    response_set: "conflicts",
    response_set_note:
      "CMS M1100 is a 3x5 grid (living arrangement x availability of assistance) with codes 01-15. PennSync offers four options whose printed codes 01-04 name different cells than CMS: PennSync's '01 — lives alone, no assistance' is CMS 05, and its '03 — lives with others, no assistance' is CMS 10. There is no congregate-living option at all.",
    official_item: "M1100",
    official_title: "Patient Living Situation",
    reviewed_by: "Kevin Deyarmin (kdeyarmin@comcast.net)",
    reviewed_at: "2026-09-01",
    review_source:
      "Product-owner sign-off. Covers PennSync's USE of each item: for a current CMS item, that this form's response options are acceptable as a screening prompt; for a retired or non-CMS item, that the question is still worth asking internally. Item numbers and titles were verified against the CMS OASIS-E/E1/E2 manuals; RESPONSE OPTIONS WERE NOT individually verified against the manual.",    classification_signed_off_by: "PennSync CMS source check",
    classification_signed_off_at: "2026-09-01",
    classification_basis: "Item number and title checked against the published CMS OASIS-E, E1 and E2 manuals.",

    source_verified_at: "2026-09-01",
    source_verified_against: "CMS OASIS-E2 Manual (Effective 04/01/2026), Chapter 3",
  },
  m1740: {
    level: "verified",
    response_set: "conflicts",
    response_set_note:
      "CMS M1740 is check-all-that-apply with codes 1-7 where 7 is 'None of the above'. PennSync is single-select 0-4 where 0 is 'None'. The answer shape differs, code 0 is not a valid M1740 response, and CMS 5 and 6 are absent.",
    official_item: "M1740",
    official_title: "Cognitive, behavioral, and psychiatric symptoms",
    reviewed_by: "Kevin Deyarmin (kdeyarmin@comcast.net)",
    reviewed_at: "2026-09-01",
    review_source:
      "Product-owner sign-off. Covers PennSync's USE of each item: for a current CMS item, that this form's response options are acceptable as a screening prompt; for a retired or non-CMS item, that the question is still worth asking internally. Item numbers and titles were verified against the CMS OASIS-E/E1/E2 manuals; RESPONSE OPTIONS WERE NOT individually verified against the manual.",    classification_signed_off_by: "PennSync CMS source check",
    classification_signed_off_at: "2026-09-01",
    classification_basis: "Item number and title checked against the published CMS OASIS-E, E1 and E2 manuals.",

    source_verified_at: "2026-09-01",
    source_verified_against: "CMS OASIS-E2 Manual (Effective 04/01/2026), Chapter 3",
  },
  m1700: {
    level: "verified",
    response_set: "abbreviated",
    response_set_note:
      "Codes 0-4 are in CMS order with the same anchors, but each label drops the qualifier that defines the code — CMS 1 applies only 'under stressful or unfamiliar conditions', which PennSync's 'Requires prompting (cues) to focus' does not say.",
    official_item: "M1700",
    official_title: "Cognitive Functioning",
    reviewed_by: "Kevin Deyarmin (kdeyarmin@comcast.net)",
    reviewed_at: "2026-09-01",
    review_source:
      "Product-owner sign-off. Covers PennSync's USE of each item: for a current CMS item, that this form's response options are acceptable as a screening prompt; for a retired or non-CMS item, that the question is still worth asking internally. Item numbers and titles were verified against the CMS OASIS-E/E1/E2 manuals; RESPONSE OPTIONS WERE NOT individually verified against the manual.",    classification_signed_off_by: "PennSync CMS source check",
    classification_signed_off_at: "2026-09-01",
    classification_basis: "Item number and title checked against the published CMS OASIS-E, E1 and E2 manuals.",

    source_verified_at: "2026-09-01",
    source_verified_against: "CMS OASIS-E2 Manual (Effective 04/01/2026), Chapter 3",
  },
  m1400: {
    level: "verified",
    response_set: "conflicts",
    response_set_note:
      "Codes 0-4 align with CMS except code 3, which PennSync labels 'with minimal exertion at rest'. CMS 3 is minimal exertion or agitation and explicitly excludes rest; rest is code 4. PennSync's 3 and 4 are also not distinguishable from each other.",
    official_item: "M1400",
    official_title: "When is the patient dyspneic or noticeably Short of Breath?",
    reviewed_by: "Kevin Deyarmin (kdeyarmin@comcast.net)",
    reviewed_at: "2026-09-01",
    review_source:
      "Product-owner sign-off. Covers PennSync's USE of each item: for a current CMS item, that this form's response options are acceptable as a screening prompt; for a retired or non-CMS item, that the question is still worth asking internally. Item numbers and titles were verified against the CMS OASIS-E/E1/E2 manuals; RESPONSE OPTIONS WERE NOT individually verified against the manual.",    classification_signed_off_by: "PennSync CMS source check",
    classification_signed_off_at: "2026-09-01",
    classification_basis: "Item number and title checked against the published CMS OASIS-E, E1 and E2 manuals.",

    source_verified_at: "2026-09-01",
    source_verified_against: "CMS OASIS-E2 Manual (Effective 04/01/2026), Chapter 3",
  },
  m1340: {
    level: "verified",
    response_set: "conflicts",
    response_set_note:
      "The code set {0,1,2} is identical to CMS but code 2 is not: CMS 2 is 'surgical wound known but not observable due to non-removable dressing/device', while PennSync's 2 is 'Yes — infected/complications'. Infection status is not part of M1340.",
    official_item: "M1340",
    official_title: "Does this patient have a Surgical Wound?",
    reviewed_by: "Kevin Deyarmin (kdeyarmin@comcast.net)",
    reviewed_at: "2026-09-01",
    review_source:
      "Product-owner sign-off. Covers PennSync's USE of each item: for a current CMS item, that this form's response options are acceptable as a screening prompt; for a retired or non-CMS item, that the question is still worth asking internally. Item numbers and titles were verified against the CMS OASIS-E/E1/E2 manuals; RESPONSE OPTIONS WERE NOT individually verified against the manual.",    classification_signed_off_by: "PennSync CMS source check",
    classification_signed_off_at: "2026-09-01",
    classification_basis: "Item number and title checked against the published CMS OASIS-E, E1 and E2 manuals.",

    source_verified_at: "2026-09-01",
    source_verified_against: "CMS OASIS-E2 Manual (Effective 04/01/2026), Chapter 3",
  },
  m1306: {
    level: "verified",
    response_set: "conflicts",
    response_set_note:
      "Codes 0-1 match, but the question does not. CMS asks about an unhealed pressure ulcer/injury at Stage 2 or higher or unstageable, explicitly EXCLUDING Stage 1; PennSync asks about one 'at any stage', so a Stage 1 injury is coded 1 here and 0 on the official assessment.",
    official_item: "M1306",
    official_title: "Unhealed Pressure Ulcer/Injury at Stage 2 or Higher",
    reviewed_by: "Kevin Deyarmin (kdeyarmin@comcast.net)",
    reviewed_at: "2026-09-01",
    review_source:
      "Product-owner sign-off. Covers PennSync's USE of each item: for a current CMS item, that this form's response options are acceptable as a screening prompt; for a retired or non-CMS item, that the question is still worth asking internally. Item numbers and titles were verified against the CMS OASIS-E/E1/E2 manuals; RESPONSE OPTIONS WERE NOT individually verified against the manual.",    classification_signed_off_by: "PennSync CMS source check",
    classification_signed_off_at: "2026-09-01",
    classification_basis: "Item number and title checked against the published CMS OASIS-E, E1 and E2 manuals.",

    source_verified_at: "2026-09-01",
    source_verified_against: "CMS OASIS-E2 Manual (Effective 04/01/2026), Chapter 3",
  },
  m1800: {
    level: "verified",
    response_set: "matches",
    response_set_note:
      "Codes 0-3 correspond to the CMS response set in both order and meaning.",
    official_item: "M1800",
    official_title: "Grooming",
    reviewed_by: "Kevin Deyarmin (kdeyarmin@comcast.net)",
    reviewed_at: "2026-09-01",
    review_source:
      "Product-owner sign-off. Covers PennSync's USE of each item: for a current CMS item, that this form's response options are acceptable as a screening prompt; for a retired or non-CMS item, that the question is still worth asking internally. Item numbers and titles were verified against the CMS OASIS-E/E1/E2 manuals; RESPONSE OPTIONS WERE NOT individually verified against the manual.",    classification_signed_off_by: "PennSync CMS source check",
    classification_signed_off_at: "2026-09-01",
    classification_basis: "Item number and title checked against the published CMS OASIS-E, E1 and E2 manuals.",

    source_verified_at: "2026-09-01",
    source_verified_against: "CMS OASIS-E2 Manual (Effective 04/01/2026), Chapter 3",
  },
  m1810: {
    level: "verified",
    response_set: "abbreviated",
    response_set_note:
      "Codes 0-3 are in CMS order. Code 1 is worded as 'minor difficulty or helper makes adaptations' where CMS says 'if clothing is laid out or handed to the patient' — a different coding trigger for the same code.",
    official_item: "M1810",
    official_title: "Current Ability to Dress Upper Body",
    reviewed_by: "Kevin Deyarmin (kdeyarmin@comcast.net)",
    reviewed_at: "2026-09-01",
    review_source:
      "Product-owner sign-off. Covers PennSync's USE of each item: for a current CMS item, that this form's response options are acceptable as a screening prompt; for a retired or non-CMS item, that the question is still worth asking internally. Item numbers and titles were verified against the CMS OASIS-E/E1/E2 manuals; RESPONSE OPTIONS WERE NOT individually verified against the manual.",    classification_signed_off_by: "PennSync CMS source check",
    classification_signed_off_at: "2026-09-01",
    classification_basis: "Item number and title checked against the published CMS OASIS-E, E1 and E2 manuals.",

    source_verified_at: "2026-09-01",
    source_verified_against: "CMS OASIS-E2 Manual (Effective 04/01/2026), Chapter 3",
  },
  m1820: {
    level: "verified",
    response_set: "abbreviated",
    response_set_note:
      "Codes 0-3 are in CMS order. Code 1 is worded as 'minor difficulty or helper makes adaptations' where CMS says 'if clothing and shoes are laid out or handed to the patient'.",
    official_item: "M1820",
    official_title: "Current Ability to Dress Lower Body",
    reviewed_by: "Kevin Deyarmin (kdeyarmin@comcast.net)",
    reviewed_at: "2026-09-01",
    review_source:
      "Product-owner sign-off. Covers PennSync's USE of each item: for a current CMS item, that this form's response options are acceptable as a screening prompt; for a retired or non-CMS item, that the question is still worth asking internally. Item numbers and titles were verified against the CMS OASIS-E/E1/E2 manuals; RESPONSE OPTIONS WERE NOT individually verified against the manual.",    classification_signed_off_by: "PennSync CMS source check",
    classification_signed_off_at: "2026-09-01",
    classification_basis: "Item number and title checked against the published CMS OASIS-E, E1 and E2 manuals.",

    source_verified_at: "2026-09-01",
    source_verified_against: "CMS OASIS-E2 Manual (Effective 04/01/2026), Chapter 3",
  },
  m2001: {
    level: "verified",
    response_set: "conflicts",
    response_set_note:
      "PennSync merges two CMS items: its code 1 and code 2 split 'issues found' by whether the physician was contacted, which is CMS M2003 (Medication Follow-up), a separate item. Code 2 is not a valid M2001 response, and CMS code 9 (NA — patient is not taking any medications) is absent.",
    official_item: "M2001",
    official_title: "Drug Regimen Review",
    reviewed_by: "Kevin Deyarmin (kdeyarmin@comcast.net)",
    reviewed_at: "2026-09-01",
    review_source:
      "Product-owner sign-off. Covers PennSync's USE of each item: for a current CMS item, that this form's response options are acceptable as a screening prompt; for a retired or non-CMS item, that the question is still worth asking internally. Item numbers and titles were verified against the CMS OASIS-E/E1/E2 manuals; RESPONSE OPTIONS WERE NOT individually verified against the manual.",    classification_signed_off_by: "PennSync CMS source check",
    classification_signed_off_at: "2026-09-01",
    classification_basis: "Item number and title checked against the published CMS OASIS-E, E1 and E2 manuals.",

    source_verified_at: "2026-09-01",
    source_verified_against: "CMS OASIS-E2 Manual (Effective 04/01/2026), Chapter 3",
  },
  m2010: {
    level: "verified",
    response_set: "conflicts",
    response_set_note:
      "The codes are remapped against CMS, and one of them inverts. PennSync 0 is 'not applicable — no high-risk drugs', which is CMS NA; PennSync 2 is 'education not completed', which is CMS 0 ('No'). Entering PennSync's 0 as an M2010 response would record that education was NOT provided.",
    official_item: "M2010",
    official_title: "Patient/Caregiver High-Risk Drug Education",
    reviewed_by: "Kevin Deyarmin (kdeyarmin@comcast.net)",
    reviewed_at: "2026-09-01",
    review_source:
      "Product-owner sign-off. Covers PennSync's USE of each item: for a current CMS item, that this form's response options are acceptable as a screening prompt; for a retired or non-CMS item, that the question is still worth asking internally. Item numbers and titles were verified against the CMS OASIS-E/E1/E2 manuals; RESPONSE OPTIONS WERE NOT individually verified against the manual.",    classification_signed_off_by: "PennSync CMS source check",
    classification_signed_off_at: "2026-09-01",
    classification_basis: "Item number and title checked against the published CMS OASIS-E, E1 and E2 manuals.",

    source_verified_at: "2026-09-01",
    source_verified_against: "CMS OASIS-E2 Manual (Effective 04/01/2026), Chapter 3",
  },
  m2020: {
    level: "verified",
    response_set: "conflicts",
    response_set_note:
      "Codes 1 and 2 are transposed relative to CMS. CMS 1 is 'if individual dosages are prepared in advance'; CMS 2 is 'if given reminders'. PennSync's 1 is 'if given daily reminders' and its 2 is 'only if medication is prepared'. CMS NA (no oral medications prescribed) is also absent.",
    official_item: "M2020",
    official_title: "Management of Oral Medications",
    reviewed_by: "Kevin Deyarmin (kdeyarmin@comcast.net)",
    reviewed_at: "2026-09-01",
    review_source:
      "Product-owner sign-off. Covers PennSync's USE of each item: for a current CMS item, that this form's response options are acceptable as a screening prompt; for a retired or non-CMS item, that the question is still worth asking internally. Item numbers and titles were verified against the CMS OASIS-E/E1/E2 manuals; RESPONSE OPTIONS WERE NOT individually verified against the manual.",    classification_signed_off_by: "PennSync CMS source check",
    classification_signed_off_at: "2026-09-01",
    classification_basis: "Item number and title checked against the published CMS OASIS-E, E1 and E2 manuals.",

    source_verified_at: "2026-09-01",
    source_verified_against: "CMS OASIS-E2 Manual (Effective 04/01/2026), Chapter 3",
  },
  m1830: {
    level: "verified",
    response_set: "conflicts",
    response_set_note:
      "PennSync uses a graduated person-assistance scale, not the CMS shower/tub scale. CMS 1 is 'with the use of devices, able to bathe independently'; PennSync's 1 is 'minimal person assistance'. PennSync's 5 ('refused') and 6 ('unable to rate — artificial opening') are not M1830 responses at all; CMS 6 is 'bathed totally by another person'.",
    official_item: "M1830",
    official_title: "Bathing",
    reviewed_by: "Kevin Deyarmin (kdeyarmin@comcast.net)",
    reviewed_at: "2026-09-01",
    review_source:
      "Product-owner sign-off. Covers PennSync's USE of each item: for a current CMS item, that this form's response options are acceptable as a screening prompt; for a retired or non-CMS item, that the question is still worth asking internally. Item numbers and titles were verified against the CMS OASIS-E/E1/E2 manuals; RESPONSE OPTIONS WERE NOT individually verified against the manual.",    classification_signed_off_by: "PennSync CMS source check",
    classification_signed_off_at: "2026-09-01",
    classification_basis: "Item number and title checked against the published CMS OASIS-E, E1 and E2 manuals.",

    source_verified_at: "2026-09-01",
    source_verified_against: "CMS OASIS-E2 Manual (Effective 04/01/2026), Chapter 3",
  },
  m1840: {
    level: "verified",
    response_set: "conflicts",
    response_set_note:
      "PennSync's codes 2 and 3 use the bear-weight/pivot language of CMS M1850 (Transferring), not M1840. CMS M1840 codes by where the patient can toilet: 2 is 'unable to get to the toilet but able to use a bedside commode', 3 is 'able to use a bedpan/urinal independently', 4 is 'totally dependent in toileting'.",
    official_item: "M1840",
    official_title: "Toilet Transferring",
    reviewed_by: "Kevin Deyarmin (kdeyarmin@comcast.net)",
    reviewed_at: "2026-09-01",
    review_source:
      "Product-owner sign-off. Covers PennSync's USE of each item: for a current CMS item, that this form's response options are acceptable as a screening prompt; for a retired or non-CMS item, that the question is still worth asking internally. Item numbers and titles were verified against the CMS OASIS-E/E1/E2 manuals; RESPONSE OPTIONS WERE NOT individually verified against the manual.",    classification_signed_off_by: "PennSync CMS source check",
    classification_signed_off_at: "2026-09-01",
    classification_basis: "Item number and title checked against the published CMS OASIS-E, E1 and E2 manuals.",

    source_verified_at: "2026-09-01",
    source_verified_against: "CMS OASIS-E2 Manual (Effective 04/01/2026), Chapter 3",
  },
  m1845: {
    level: "verified",
    response_set: "abbreviated",
    response_set_note:
      "Codes 0-3 are in CMS order. Code 1 is worded as 'devices/difficulty' where CMS says 'if supplies/implements are laid out for the patient'.",
    official_item: "M1845",
    official_title: "Toileting Hygiene",
    reviewed_by: "Kevin Deyarmin (kdeyarmin@comcast.net)",
    reviewed_at: "2026-09-01",
    review_source:
      "Product-owner sign-off. Covers PennSync's USE of each item: for a current CMS item, that this form's response options are acceptable as a screening prompt; for a retired or non-CMS item, that the question is still worth asking internally. Item numbers and titles were verified against the CMS OASIS-E/E1/E2 manuals; RESPONSE OPTIONS WERE NOT individually verified against the manual.",    classification_signed_off_by: "PennSync CMS source check",
    classification_signed_off_at: "2026-09-01",
    classification_basis: "Item number and title checked against the published CMS OASIS-E, E1 and E2 manuals.",

    source_verified_at: "2026-09-01",
    source_verified_against: "CMS OASIS-E2 Manual (Effective 04/01/2026), Chapter 3",
  },
  m1850: {
    level: "verified",
    response_set: "abbreviated",
    response_set_note:
      "Codes 0-5 are in CMS order with the same anchors. Code 1 drops 'or with use of an assistive device', so a device-using patient may be coded 0 here and 1 on the official assessment.",
    official_item: "M1850",
    official_title: "Transferring",
    reviewed_by: "Kevin Deyarmin (kdeyarmin@comcast.net)",
    reviewed_at: "2026-09-01",
    review_source:
      "Product-owner sign-off. Covers PennSync's USE of each item: for a current CMS item, that this form's response options are acceptable as a screening prompt; for a retired or non-CMS item, that the question is still worth asking internally. Item numbers and titles were verified against the CMS OASIS-E/E1/E2 manuals; RESPONSE OPTIONS WERE NOT individually verified against the manual.",    classification_signed_off_by: "PennSync CMS source check",
    classification_signed_off_at: "2026-09-01",
    classification_basis: "Item number and title checked against the published CMS OASIS-E, E1 and E2 manuals.",

    source_verified_at: "2026-09-01",
    source_verified_against: "CMS OASIS-E2 Manual (Effective 04/01/2026), Chapter 3",
  },
  m1860: {
    level: "verified",
    response_set: "conflicts",
    response_set_note:
      "PennSync's scale is offset by one from code 1 onward. It inserts '1 — with minor difficulty on uneven surfaces', which is not a CMS response, pushing one-handed device to 2 (CMS 1), two-handed device to 3 (CMS 2) and supervision to 4 (CMS 3). CMS 5 (chairfast, unable to wheel self) has no PennSync equivalent.",
    official_item: "M1860",
    official_title: "Ambulation/Locomotion",
    reviewed_by: "Kevin Deyarmin (kdeyarmin@comcast.net)",
    reviewed_at: "2026-09-01",
    review_source:
      "Product-owner sign-off. Covers PennSync's USE of each item: for a current CMS item, that this form's response options are acceptable as a screening prompt; for a retired or non-CMS item, that the question is still worth asking internally. Item numbers and titles were verified against the CMS OASIS-E/E1/E2 manuals; RESPONSE OPTIONS WERE NOT individually verified against the manual.",    classification_signed_off_by: "PennSync CMS source check",
    classification_signed_off_at: "2026-09-01",
    classification_basis: "Item number and title checked against the published CMS OASIS-E, E1 and E2 manuals.",

    source_verified_at: "2026-09-01",
    source_verified_against: "CMS OASIS-E2 Manual (Effective 04/01/2026), Chapter 3",
  },
  m1870: {
    level: "verified",
    response_set: "conflicts",
    response_set_note:
      "Codes 0-2 align. PennSync's 3 is 'totally dependent on another person'; CMS 3 is 'takes nutrients orally AND receives supplemental nutrients by nasogastric tube or gastrostomy'. CMS 4 and 5 (tube-fed, and unable to take nutrients by either route) are absent, so a tube-fed patient cannot be coded.",
    official_item: "M1870",
    official_title: "Feeding or Eating",
    reviewed_by: "Kevin Deyarmin (kdeyarmin@comcast.net)",
    reviewed_at: "2026-09-01",
    review_source:
      "Product-owner sign-off. Covers PennSync's USE of each item: for a current CMS item, that this form's response options are acceptable as a screening prompt; for a retired or non-CMS item, that the question is still worth asking internally. Item numbers and titles were verified against the CMS OASIS-E/E1/E2 manuals; RESPONSE OPTIONS WERE NOT individually verified against the manual.",    classification_signed_off_by: "PennSync CMS source check",
    classification_signed_off_at: "2026-09-01",
    classification_basis: "Item number and title checked against the published CMS OASIS-E, E1 and E2 manuals.",

    source_verified_at: "2026-09-01",
    source_verified_against: "CMS OASIS-E2 Manual (Effective 04/01/2026), Chapter 3",
  },
  m1033: {
    level: "verified",
    response_set: "conflicts",
    response_set_note:
      "CMS M1033 is check-all-that-apply across ten named risk factors (1-10, where 10 is 'None of the above'). PennSync is a single-select three-tier rating (low/medium/high). No PennSync answer maps to a valid M1033 response.",
    official_item: "M1033",
    official_title: "Risk of Hospitalization",
    reviewed_by: "Kevin Deyarmin (kdeyarmin@comcast.net)",
    reviewed_at: "2026-09-01",
    review_source:
      "Product-owner sign-off. Covers PennSync's USE of each item: for a current CMS item, that this form's response options are acceptable as a screening prompt; for a retired or non-CMS item, that the question is still worth asking internally. Item numbers and titles were verified against the CMS OASIS-E/E1/E2 manuals; RESPONSE OPTIONS WERE NOT individually verified against the manual.",    classification_signed_off_by: "PennSync CMS source check",
    classification_signed_off_at: "2026-09-01",
    classification_basis: "Item number and title checked against the published CMS OASIS-E, E1 and E2 manuals.",

    source_verified_at: "2026-09-01",
    source_verified_against: "CMS OASIS-E2 Manual (Effective 04/01/2026), Chapter 3",
  },
  m1610: {
    level: "verified",
    response_set: "conflicts",
    response_set_note:
      "PennSync uses a frequency-graded incontinence scale that is not the current M1610. CMS M1610 has three responses: 0 no incontinence or catheter, 1 incontinent, 2 requires a urinary catheter. PennSync's 2 is 'during day/night; daily pads required' — incontinence, where CMS 2 means a catheter — and its 3 and 4 are not M1610 responses.",
    official_item: "M1610",
    official_title: "Urinary Incontinence or Urinary Catheter Presence",
    reviewed_by: "Kevin Deyarmin (kdeyarmin@comcast.net)",
    reviewed_at: "2026-09-01",
    review_source:
      "Product-owner sign-off. Covers PennSync's USE of each item: for a current CMS item, that this form's response options are acceptable as a screening prompt; for a retired or non-CMS item, that the question is still worth asking internally. Item numbers and titles were verified against the CMS OASIS-E/E1/E2 manuals; RESPONSE OPTIONS WERE NOT individually verified against the manual.",    classification_signed_off_by: "PennSync CMS source check",
    classification_signed_off_at: "2026-09-01",
    classification_basis: "Item number and title checked against the published CMS OASIS-E, E1 and E2 manuals.",

    source_verified_at: "2026-09-01",
    source_verified_against: "CMS OASIS-E2 Manual (Effective 04/01/2026), Chapter 3",
  },
  m1620: {
    level: "verified",
    response_set: "conflicts",
    response_set_note:
      "Codes 1-3 align. PennSync's 4 ('daily or more often') merges CMS 4 (on a daily basis) and CMS 5 (more often than once daily), and its 5 is 'patient has ostomy', which is CMS NA rather than code 5. CMS UK is absent.",
    official_item: "M1620",
    official_title: "Bowel Incontinence Frequency",
    reviewed_by: "Kevin Deyarmin (kdeyarmin@comcast.net)",
    reviewed_at: "2026-09-01",
    review_source:
      "Product-owner sign-off. Covers PennSync's USE of each item: for a current CMS item, that this form's response options are acceptable as a screening prompt; for a retired or non-CMS item, that the question is still worth asking internally. Item numbers and titles were verified against the CMS OASIS-E/E1/E2 manuals; RESPONSE OPTIONS WERE NOT individually verified against the manual.",    classification_signed_off_by: "PennSync CMS source check",
    classification_signed_off_at: "2026-09-01",
    classification_basis: "Item number and title checked against the published CMS OASIS-E, E1 and E2 manuals.",

    source_verified_at: "2026-09-01",
    source_verified_against: "CMS OASIS-E2 Manual (Effective 04/01/2026), Chapter 3",
  },
  m1630: {
    level: "verified",
    response_set: "conflicts",
    response_set_note:
      "PennSync codes the patient's independence with the ostomy; CMS M1630 codes whether the ostomy was related to an inpatient stay or necessitated a change in regimen within the last 14 days. CMS 1 and 2 turn on that relationship, not on how much help the patient needs.",
    official_item: "M1630",
    official_title: "Ostomy for Bowel Elimination",
    reviewed_by: "Kevin Deyarmin (kdeyarmin@comcast.net)",
    reviewed_at: "2026-09-01",
    review_source:
      "Product-owner sign-off. Covers PennSync's USE of each item: for a current CMS item, that this form's response options are acceptable as a screening prompt; for a retired or non-CMS item, that the question is still worth asking internally. Item numbers and titles were verified against the CMS OASIS-E/E1/E2 manuals; RESPONSE OPTIONS WERE NOT individually verified against the manual.",    classification_signed_off_by: "PennSync CMS source check",
    classification_signed_off_at: "2026-09-01",
    classification_basis: "Item number and title checked against the published CMS OASIS-E, E1 and E2 manuals.",

    source_verified_at: "2026-09-01",
    source_verified_against: "CMS OASIS-E2 Manual (Effective 04/01/2026), Chapter 3",
  },
  m2401: {
    level: "verified",
    response_set: "conflicts",
    response_set_note:
      "PennSync asks a single question about medication interventions. CMS M2401 is a grid of separate rows — falls prevention, depression, pain, pressure ulcer prevention and treatment — each coded 0/1/NA. Medication intervention is CMS M2003/M2005, not M2401.",
    official_item: "M2401",
    official_title: "Intervention Synopsis",
    reviewed_by: "Kevin Deyarmin (kdeyarmin@comcast.net)",
    reviewed_at: "2026-09-01",
    review_source:
      "Product-owner sign-off. Covers PennSync's USE of each item: for a current CMS item, that this form's response options are acceptable as a screening prompt; for a retired or non-CMS item, that the question is still worth asking internally. Item numbers and titles were verified against the CMS OASIS-E/E1/E2 manuals; RESPONSE OPTIONS WERE NOT individually verified against the manual.",    classification_signed_off_by: "PennSync CMS source check",
    classification_signed_off_at: "2026-09-01",
    classification_basis: "Item number and title checked against the published CMS OASIS-E, E1 and E2 manuals.",

    source_verified_at: "2026-09-01",
    source_verified_against: "CMS OASIS-E2 Manual (Effective 04/01/2026), Chapter 3",
  },
});

/**
 * Classification for an item id. Anything not in the registry is treated as
 * `unverified` — fail-closed, so a newly added item cannot present itself as
 * confirmed CMS content simply by being absent from the table.
 *
 * @param {string} itemId
 */
export function classifyItem(itemId) {
  const key = String(itemId || "").toLowerCase();
  const entry = ITEM_VERIFICATION[key];
  if (entry) {
    return {
      id: key,
      level: entry.level,
      officialItem: entry.official_item ?? null,
      pennsyncItem: entry.pennsync_item ?? null,
      note: entry.note || "",
      evidence: entry.evidence || "",
      officialTitle: entry.official_title || "",
      formerItem: entry.former_item || null,
      // FACTUAL source check (does the number exist, what is its title) — kept
      // separate from clinical sign-off below, which is a judgement.
      sourceVerifiedAt: entry.source_verified_at || "",
      sourceVerifiedAgainst: entry.source_verified_against || "",
      sourceVerified: !!entry.source_verified_at,
      // The classification (which level applies) IS signed off; the clinical
      // question (is PennSync's use of the item appropriate) is not.
      classificationSignedOffBy: entry.classification_signed_off_by || "",
      classificationSignedOffAt: entry.classification_signed_off_at || "",
      classificationBasis: entry.classification_basis || "",
      classificationSignedOff: !!entry.classification_signed_off_by,
      // Response OPTIONS: the verdict from the item-by-item read of the CMS
      // instrument. `responseSetVerified` is true ONLY for a faithful
      // reproduction, so it stays false for `abbreviated` and `conflicts`.
      responseSet: entry.response_set || "unchecked",
      responseSetNote: entry.response_set_note || "",
      responseSetVerified: entry.response_set === "matches",
      responseSetConflicts: entry.response_set === "conflicts",
      // Review provenance travels with the classification so no caller can
      // present a classification as signed off when nobody has signed it off.
      reviewedBy: entry.reviewed_by || "",
      reviewedAt: entry.reviewed_at || "",
      reviewSource: entry.review_source || "",
      clinicallyReviewed: !!entry.reviewed_by,
      spec: ACTIVE_OASIS_SPEC.id,
    };
  }
  return {
    id: key,
    level: "unverified",
    evidence: "",
    officialTitle: "",
    formerItem: null,
    sourceVerifiedAt: "",
    sourceVerifiedAgainst: "",
    sourceVerified: false,
    classificationSignedOffBy: "",
    classificationSignedOffAt: "",
    classificationBasis: "",
    classificationSignedOff: false,
    // Fail closed: an unregistered item has not been read against the manual,
    // so it is neither verified nor cleared of conflicting with CMS.
    responseSet: "unchecked",
    responseSetNote: "",
    responseSetVerified: false,
    responseSetConflicts: false,
    reviewedBy: "",
    reviewedAt: "",
    reviewSource: "",
    clinicallyReviewed: false,
    // An unregistered item may still be a genuine CMS item; PennSync just has
    // not confirmed its wording. The item number is derived from the id rather
    // than asserted as verified.
    officialItem: /^m\d{4}$/.test(key) ? key.toUpperCase() : null,
    pennsyncItem: null,
    note: "PennSync has not verified this item's wording or response set against a CMS source.",
    spec: ACTIVE_OASIS_SPEC.id,
  };
}

/** True only when PennSync may present the item as an official CMS item. */
export function isOfficialCmsItem(itemId) {
  const level = classifyItem(itemId).level;
  return !["pennsync_screening", "retired", "not_a_cms_item"].includes(level);
}

/**
 * The item number a screen may display, or null.
 * A PennSync screening item returns null — it must never wear a CMS number.
 */
export function officialItemNumber(itemId) {
  const c = classifyItem(itemId);
  // A retired item, an invented number and a PennSync question must never be
  // shown wearing a CMS item number: each would send a nurse to the official
  // assessment looking for something that is not there.
  const NO_NUMBER = ["pennsync_screening", "retired", "not_a_cms_item"];
  return NO_NUMBER.includes(c.level) ? null : c.officialItem;
}

/** @type {ReadonlyArray<string>} */
export const RESPONSE_SET_VERDICTS = Object.freeze([
  // PennSync's option list reproduces the CMS response set in order and meaning.
  "matches",
  // Same codes in the same order, but the wording is looser than the manual's,
  // so a borderline patient could be coded differently on the two forms.
  "abbreviated",
  // At least one PennSync code carries a DIFFERENT meaning than the same CMS
  // code, or the answer shape differs (single-select against check-all). The
  // code cannot be carried across.
  "conflicts",
  // No official response set to compare: the number is not in the current
  // instrument, or PennSync's question is a different question.
  "not_applicable",
  // Not yet read against the manual. Fail-closed default.
  "unchecked",
]);

/** What the response-set read was carried out against. */
export const RESPONSE_SET_CHECK = Object.freeze({
  checked_at: "2026-09-01",
  checked_against:
    "CMS OASIS-E2 All Items instrument (Effective 04/01/2026), published 12/11/2025",
  method:
    "Every PennSync item present in the instrument was read against it option by option — "
    + "code set, code order and the meaning of each option's text. The earlier source check "
    + "compared item numbers and titles only.",
});

/**
 * Whether a response recorded in PennSync may be carried into the EMR as this
 * item's official code.
 *
 * This is the question the read was for. `officialItemNumber()` answers "may we
 * print M1340 next to this question"; this answers "may the nurse type the code
 * they picked here into M1340 over there". They are not the same: M1340's code
 * set is identical to CMS's, and its code 2 still means something else.
 *
 * Deterministic — a lookup, not a judgement.
 */
export function mayCarryResponseToEmr(itemId) {
  const c = classifyItem(itemId);
  if (!isOfficialCmsItem(itemId)) return false;
  return c.responseSet === "matches";
}

const RESPONSE_SET_CAVEATS = {
  matches: "",
  abbreviated:
    "PennSync's answer choices for this item are worded more loosely than the CMS response "
    + "set. Re-read the official wording in your EMR before choosing a code there.",
  conflicts:
    "Do not carry this code into your EMR. PennSync's answer choices for this item do not "
    + "match the CMS response set — at least one code means something different on the "
    + "official assessment. Answer the item again from the wording in your EMR.",
  not_applicable: "",
  unchecked:
    "PennSync has not read this item's answer choices against the CMS instrument. Do not "
    + "assume the code matches; answer the item from the wording in your EMR.",
};

/**
 * The deterministic caveat about an item's ANSWER CHOICES, or "" when there is
 * nothing to warn about. Separate from `itemDisclaimer()`, which is about the
 * item's identity, so a screen can place them independently.
 */
export function responseSetCaveat(itemId) {
  const c = classifyItem(itemId);
  return RESPONSE_SET_CAVEATS[c.responseSet] ?? RESPONSE_SET_CAVEATS.unchecked;
}

/** Every registry item whose answer choices conflict with the CMS response set. */
export function conflictingResponseSets() {
  return Object.keys(ITEM_VERIFICATION)
    .map(classifyItem)
    .filter((c) => c.responseSetConflicts)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Counts for a status surface. */
export function responseSetStatus(itemIds) {
  const ids = Array.isArray(itemIds) && itemIds.length
    ? [...new Set(itemIds.map((i) => String(i || "").toLowerCase()).filter(Boolean))]
    : Object.keys(ITEM_VERIFICATION);
  const tally = { matches: 0, abbreviated: 0, conflicts: 0, not_applicable: 0, unchecked: 0 };
  for (const id of ids) {
    const v = classifyItem(id).responseSet;
    tally[v] = (tally[v] ?? 0) + 1;
  }
  const comparable = tally.matches + tally.abbreviated + tally.conflicts;
  return {
    ...tally,
    total: ids.length,
    comparable,
    statement: comparable === 0
      ? "No PennSync item in this set has an official CMS response set to compare against."
      : `Of ${comparable} items with an official CMS response set, ${tally.matches} `
        + `${tally.matches === 1 ? "reproduces" : "reproduce"} it, ${tally.abbreviated} `
        + `${tally.abbreviated === 1 ? "uses" : "use"} looser wording for the same codes, and `
        + `${tally.conflicts} ${tally.conflicts === 1 ? "has" : "have"} at least one code that means `
        + "something different on the official assessment. Answer those items from the wording in "
        + "your EMR rather than copying the code.",
  };
}

const DISCLAIMERS = {
  verified:
    "Review this against your patient assessment and enter the response on the official "
    + "assessment in your EMR.",
  abbreviated:
    "PennSync's response list for this item is abbreviated and may not match the official CMS "
    + "response set. Confirm the wording and response in your EMR.",
  unverified:
    "PennSync has not verified this item's wording or response set against a CMS source. "
    + "Confirm both in your EMR before entering a response.",
  pennsync_screening:
    "PennSync screening question — not an official CMS OASIS item. Use it to prompt review; "
    + "enter official responses in your EMR.",
  retired:
    "This item is NOT in the OASIS instrument currently in effect — it was retired. PennSync keeps "
    + "the question as an internal prompt only. Do not enter it on the official assessment; use the "
    + "current item in your EMR.",
  not_a_cms_item:
    "This item number appears in no published CMS OASIS manual. Treat the question as a PennSync "
    + "prompt only and enter official responses in your EMR.",
};

/**
 * The deterministic caveat a screen must show for an item — its identity, plus
 * the answer-choice warning when there is one. A screen that shows only this
 * still cannot mislead a nurse about either dimension.
 */
export function itemDisclaimer(itemId) {
  const base = DISCLAIMERS[classifyItem(itemId).level] || DISCLAIMERS.unverified;
  const caveat = responseSetCaveat(itemId);
  return caveat ? `${base} ${caveat}` : base;
}

/**
 * Short human label for the classification, for a badge.
 *
 * A conflicting response set OVERRIDES the identity badge. M1340 is a genuine,
 * current CMS item with the right title, so its level is `verified` — but a
 * green "Verified item" badge next to answer choices whose code 2 means
 * something else on the official assessment is the exact reassurance a nurse
 * must not be given.
 */
export function describeVerification(itemId) {
  const c = classifyItem(itemId);
  if (c.responseSetConflicts) {
    return { label: "Answer choices differ from CMS", tone: "destructive" };
  }
  const level = c.level;
  return {
    verified: { label: "Verified item", tone: "success" },
    abbreviated: { label: "Abbreviated response set", tone: "warning" },
    unverified: { label: "Unverified wording", tone: "warning" },
    retired: { label: "Retired CMS item", tone: "destructive" },
    not_a_cms_item: { label: "Not a CMS item", tone: "destructive" },
    pennsync_screening: { label: "PennSync screening item", tone: "info" },
  }[level];
}

// ── Clinical sign-off ──────────────────────────────────────────────────────
// The classifications above were derived from internal evidence and from the
// app's own canonical scale table — not from a qualified OASIS reviewer reading
// the CMS instrument. These helpers make that gap visible and closable rather
// than leaving it in a document nobody opens.

/** True only when a named human has signed the item's classification off. */
export function isClinicallyReviewed(itemId) {
  return classifyItem(itemId).clinicallyReviewed;
}

/**
 * Every registry item awaiting clinical sign-off.
 *
 * `itemIds` optionally scopes the check to a caller's own item bank, so an item
 * NOT in the registry is reported too — an unregistered item is `unverified` and
 * therefore the most in need of review, and would otherwise be invisible here.
 *
 * @param {string[]} [itemIds]
 * @returns {Array<{ id: string, level: string, officialItem: string|null, note: string }>}
 */
export function pendingClinicalReview(itemIds) {
  const ids = Array.isArray(itemIds) && itemIds.length
    ? [...new Set(itemIds.map((i) => String(i || "").toLowerCase()).filter(Boolean))]
    : Object.keys(ITEM_VERIFICATION);
  return ids
    .map(classifyItem)
    .filter((c) => !c.clinicallyReviewed)
    .sort((a, b) => VERIFICATION_LEVELS.indexOf(a.level) - VERIFICATION_LEVELS.indexOf(b.level)
      || a.id.localeCompare(b.id));
}

/**
 * Summary for a status surface.
 * @param {string[]} [itemIds]
 */
export function clinicalReviewStatus(itemIds) {
  const ids = Array.isArray(itemIds) && itemIds.length
    ? [...new Set(itemIds.map((i) => String(i || "").toLowerCase()).filter(Boolean))]
    : Object.keys(ITEM_VERIFICATION);
  const pending = pendingClinicalReview(ids);
  return {
    total: ids.length,
    pending: pending.length,
    reviewed: ids.length - pending.length,
    // The one sentence a screen must be able to show.
    statement: pending.length === 0
      ? "Every OASIS item in PennSync's internal set has been signed off by a named clinical reviewer."
      : `Item numbers, titles and response sets are checked against the CMS manual. What `
        + `remains for ${pending.length} of ${ids.length} items is the CLINICAL question: whether `
        + "PennSync's use of the item is appropriate, and whether its response options are safe as "
        + "a screening prompt. Confirm both in your EMR.",
    complete: pending.length === 0,
  };
}

/**
 * Build the worksheet a qualified OASIS reviewer fills in.
 *
 * Deterministic Markdown so it can be committed, diffed and re-generated. Each
 * row states what PennSync currently claims, the evidence behind it (where there
 * is any), and leaves the reviewer's confirmation and CMS citation blank —
 * PennSync must not pre-fill a conclusion it wants.
 *
 * @param {Array<{ id: string, label?: string }>} items the caller's item bank
 * @param {{ specLabel?: string, generatedAt?: string }} [options]
 * @returns {string} Markdown
 */
/**
 * The cutover disposition for an item, from the response-schema registry.
 *
 * Read from the registry rather than restated here, so the worksheet a reviewer
 * signs cannot disagree with what the app actually does.
 *
 * @param {string} itemId
 */
export function cutoverDispositionFor(itemId) {
  const number = officialItemNumber(itemId) || String(itemId || "").toUpperCase();
  const v2 = Object.values(V2_DEFINITIONS).find((d) => d.item_number === number);
  if (v2) {
    return { disposition: "align_to_cms", definitionId: v2.definition_id, note: v2.migration_rationale };
  }
  const demoted = V2_SCREENING_FOR_LEGACY[String(itemId || "").toLowerCase()];
  if (demoted) {
    const d = V2_DEFINITIONS[demoted];
    return { disposition: "pennsync_only_screening", definitionId: demoted, note: d.migration_rationale };
  }
  if (V1_LEGACY_DEFINITIONS[String(itemId || "").toLowerCase()]) {
    return { disposition: "frozen_legacy_only", definitionId: null, note: "Frozen in v1 for historical display only." };
  }
  return { disposition: "out_of_scope", definitionId: null, note: "Not part of the CMS-alignment cutover." };
}

/** The three legacy M-numbers demoted to PennSync screening prompts. */
const V2_SCREENING_FOR_LEGACY = Object.freeze({
  m1033: "ps_hospitalization_risk_tier",
  m1610: "ps_urinary_incontinence_frequency",
  m1630: "ps_ostomy_self_management",
});

export function buildClinicalReviewWorksheet(items, { specLabel = ACTIVE_OASIS_SPEC.label, generatedAt = "" } = {}) {
  const rows = (Array.isArray(items) ? items : [])
    .filter((i) => i && i.id)
    .map((i) => ({ ...classifyItem(i.id), label: i.label || "" }));

  const header = [
    `# PennSync OASIS item review worksheet (${specLabel})`,
    "",
    generatedAt ? `Generated: ${generatedAt}` : "",
    "",
    "PennSync does **not** contain the authoritative CMS OASIS instrument. The",
    "classifications below were derived from internal evidence and from the app's own",
    "canonical scale table, **not** from a qualified reviewer reading the CMS manual.",
    "",
    "**The classification column is already signed off** against the CMS manuals (item number",
    "and title), and the \"Answer choices vs CMS\" column records a later read of each item's",
    "response set against the CMS OASIS-E2 All Items instrument. You are not being asked to",
    "re-do either. What is open is ONE clinical question per row, in the \"Clinical question\"",
    "column.",
    "",
    "Answer-choice key:",
    "",
    "- `matches` — PennSync's options reproduce the CMS response set in order and meaning",
    "- `abbreviated` — same codes in the same order, looser wording than the manual",
    "- `conflicts` — at least one code means something DIFFERENT on the official assessment,",
    "  or the answer shape differs. Do not carry the code across.",
    "- `not_applicable` — no official response set to compare against",
    "",
    "Leave a row blank if you did not review it — an unreviewed row is a more useful record",
    "than a guessed one.",
    "",
    "Classification key:",
    "",
    "- `verified` — title and response set confirmed against a CMS source",
    "- `abbreviated` — a real CMS item whose PennSync response list is shortened",
    "- `unverified` — a real CMS item number whose PennSync wording is unconfirmed",
    "- `retired` — was a real CMS item, but is not in the instrument now in effect",
    "- `not_a_cms_item` — the number appears in no published CMS manual",
    "- `pennsync_screening` — not a CMS item; must never display an item number",
    "",
    "PennSync's own source check (2026-09-01) against the published OASIS-E, E1 and E2",
    "manuals is recorded in the \"Source check\" column. That check is FACTUAL — does the",
    "item number exist, and what is its title. It is **not** a clinical sign-off, which is",
    "what the reviewer columns are for.",
    "",
    "Cutover disposition key (from the response-schema registry — see",
    "`src/components/oasis/responseSchema/`):",
    "",
    "- `align_to_cms` — a v2 definition transcribed from the final CMS OASIS-E2 instrument",
    "- `pennsync_only_screening` — kept as a PennSync screening prompt under a non-M identifier",
    "- `frozen_legacy_only` — readable in the frozen v1 set; never carryable, exportable or scorable",
    "- `out_of_scope` — not part of this cutover; stays fail-closed until separately reviewed",
    "",
    "**Source verification, product disposition and clinical review are SEPARATE approvals.**",
    "Every v2 definition is `source_verification: verified_against_final_cms_source` and",
    "`clinical_review: pending_named_sme_review`. Kevin Deyarmin's 2026-09-01 sign-off",
    "explicitly excluded individual response-option verification and is **not** option-level",
    "CMS approval.",
    "",
    "| PennSync id | Item number shown | PennSync label | Classification (signed off) | Answer choices vs CMS | Cutover disposition | v2 definition id | Source check / note | Clinical question outstanding | Reviewer: answer | Reviewer initials / date |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ].filter((line, i, arr) => !(line === "" && arr[i - 1] === "")).join("\n");

  const body = rows.map((r) => [
    "",
    `\`${r.id}\``,
    r.officialItem || "— (none)",
    (r.label || "").replace(/\|/g, "\\|"),
    `\`${r.level}\``,
    [`\`${r.responseSet}\``, r.responseSetNote].filter(Boolean).join(" · ").replace(/\|/g, "\\|"),
    `\`${cutoverDispositionFor(r.id).disposition}\``,
    cutoverDispositionFor(r.id).definitionId ? `\`${cutoverDispositionFor(r.id).definitionId}\`` : "—",
    [r.sourceVerified ? `Checked ${r.sourceVerifiedAt}` : "Not checked", r.officialTitle, r.note || r.evidence]
      .filter(Boolean).join(" · ").replace(/\|/g, "\\|") || "—",
    (outstandingClinicalQuestion(r.id)?.question || "—").replace(/\|/g, "\\|"),
    r.clinicallyReviewed ? `Answered by ${r.reviewedBy}` : " ",
    r.clinicallyReviewed ? r.reviewedAt : " ",
    "",
  ].join(" | ").trim()).join("\n");

  const pending = rows.filter((r) => !r.clinicallyReviewed).length;
  const footer = [
    "",
    pending === 0
      ? `**All ${rows.length} items are signed off.** Both the classification and the clinical `
        + "question are answered; the reviewer and scope are recorded per item in "
        + "`src/components/oasis/specs/verification.js`. The sign-off itself states that response "
        + "OPTIONS were not individually verified; a later read (2026-09-01) closed that gap and "
        + "its findings are in the \"Answer choices vs CMS\" column."
      : `**${pending} of ${rows.length} items await the clinical answer.** Their classification is `
        + "already signed off; only the clinical question above is open.",
    "",
    "Record any further confirmation in `src/components/oasis/specs/verification.js`",
    "(`reviewed_by`, `reviewed_at`, `review_source`) so the product reports its own review",
    "state rather than relying on this document.",
  ].join("\n");

  return `${header}\n${body}\n${footer}\n`;
}

/**
 * Status of the FACTUAL source check — separate from clinical sign-off.
 *
 * @param {string[]} [itemIds]
 */
export function sourceCheckStatus(itemIds) {
  const ids = Array.isArray(itemIds) && itemIds.length
    ? [...new Set(itemIds.map((i) => String(i || "").toLowerCase()).filter(Boolean))]
    : Object.keys(ITEM_VERIFICATION);
  const rows = ids.map(classifyItem);
  const problems = rows.filter((r) => ["retired", "not_a_cms_item"].includes(r.level));
  return {
    total: ids.length,
    checked: rows.filter((r) => r.sourceVerified).length,
    retired: rows.filter((r) => r.level === "retired").length,
    notCmsItems: rows.filter((r) => r.level === "not_a_cms_item").length,
    problems: problems.map((r) => ({ id: r.id, level: r.level, note: r.note })),
    statement: problems.length === 0
      ? "Every item number in PennSync's internal set exists in the CMS instrument currently in effect."
      : `${problems.length} of ${ids.length} items in PennSync's internal set are retired or are not `
        + "CMS item numbers. They are kept as internal prompts only — enter official responses in your EMR.",
  };
}

/**
 * The `item_source` value to persist alongside a saved OASIS answer.
 *
 * PennSync writes its own form ids into `OASISAssessment.oasis_items[].item_number`,
 * the field every downstream consumer reads as a CMS item number. Without this
 * marker a PennSync screening answer is indistinguishable from a real CMS item
 * response — so `m1730` (retired) or `m1020` (not a CMS number at all) would be
 * read as official assessment data.
 *
 * @param {string} itemId
 * @returns {"cms_item"|"pennsync_screening"|"retired_cms_item"|"unknown"}
 */
export function itemSourceFor(itemId) {
  const c = classifyItem(itemId);
  const level = c.level;
  if (level === "retired") return "retired_cms_item";
  if (level === "pennsync_screening" || level === "not_a_cms_item") return "pennsync_screening";
  if (level === "verified" || level === "abbreviated") {
    // Verified IDENTITY is not enough to call the saved answer a CMS response.
    // M1830 is a real, verified item number under both response sets, and only
    // the response set says whether its `6` means "bathed totally by another
    // person" (CMS) or "unable to rate — artificial opening" (legacy PennSync).
    // Calling a conflicting row `cms_item` is how a legacy code reached
    // CMS-labeled output and scoring.
    if (c.responseSet === "conflicts" || c.responseSet === "unchecked") return "unknown";
    return "cms_item";
  }
  return "unknown";
}

/**
 * Keep only the saved answers that are genuinely CMS item responses.
 *
 * A row with NO `item_source` predates the marker and is treated as `unknown` —
 * excluded rather than assumed official, because assuming is how PennSync's own
 * screening answers would end up read as the assessment.
 *
 * @param {Array<{ item_number?: string, item_source?: string, response_schema_id?: string }>} items
 */
export function cmsItemsOnly(items) {
  return (Array.isArray(items) ? items : []).filter((row) => {
    if (!row?.item_number) return false;
    // A row with no `item_source` predates the marker. It is UNKNOWN, and the
    // registry cannot rescue it: today's registry describes today's response
    // meanings, so consulting it for an unversioned row retrospectively
    // declares that the old answer meant what the new option list means.
    // That is exactly the reinterpretation this layer exists to prevent.
    if (!row.item_source) return false;
    if (row.item_source !== "cms_item") return false;
    // `item_source: "cms_item"` alone is still not sufficient — it was written
    // by the old `itemSourceFor()`, which treated a conflicting response set as
    // official. A row must also state a RESPONSE schema, and only v2 carries
    // CMS-aligned meanings.
    return row.response_schema_id === "pennsync-oasis-response-v2-cms-e2";
  });
}

/**
 * What a clinical reviewer still has to decide, now that the classification is
 * settled.
 *
 * Kept deliberately narrow. "Re-check all 36 items" is a job nobody does;
 * "answer one question per item, with the item number and title already
 * confirmed" is a job that gets done.
 */
export const OUTSTANDING_CLINICAL_QUESTIONS = Object.freeze([
  {
    id: "response_options_safe",
    applies_to: ["verified", "abbreviated"],
    question:
      "PennSync's response options for this item were NOT verified against the CMS manual "
      + "(the manual states response codes as prose, not a parseable list). Are the options this "
      + "form offers safe and sufficient as a screening prompt?",
  },
  {
    id: "retired_item_still_useful",
    applies_to: ["retired", "not_a_cms_item", "pennsync_screening"],
    question:
      "This question is not a current CMS item. Is it still clinically worth asking as an internal "
      + "prompt, or should it be removed from the form?",
  },
]);

/**
 * The specific question outstanding for one item, or null when none is.
 * @param {string} itemId
 */
export function outstandingClinicalQuestion(itemId) {
  const c = classifyItem(itemId);
  if (c.clinicallyReviewed) return null;
  return OUTSTANDING_CLINICAL_QUESTIONS.find((q) => q.applies_to.includes(c.level)) || null;
}
