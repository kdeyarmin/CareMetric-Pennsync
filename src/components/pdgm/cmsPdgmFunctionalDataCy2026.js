// CMS HHGS functional-impairment data for CY 2026.
//
// Source package:
// https://www.cms.gov/files/zip/oct-2026-hh-pps-grouper-software-hh-pdgm-v07-2-26-posted-08-20-2026.zip
// Table: tables/Versions/{07026,07126,07226}/RT/FI_Responses.txt
// The three versioned files are byte-identical (SHA-256 below). This module
// intentionally contains only the small functional-scoring table; diagnosis,
// comorbidity, timing, and version-selection logic remain fail-closed.

export const CMS_PDGM_FUNCTIONAL_DATA_PROVENANCE_CY2026 = Object.freeze({
  grouperVersions: Object.freeze(["07026", "07126", "07226"]),
  sourceTable: "RT/FI_Responses.txt",
  sourceTableSha256: "36a4646815903eceb7d16ee67b787c7a97f53beeb71397cd2546ba2094542efa",
});

const freezePoints = (points) => Object.freeze({ ...points });

export const CMS_PDGM_FUNCTIONAL_ITEM_POINTS_CY2026 = Object.freeze({
  M1800: freezePoints({ "0": 0, "1": 0, "2": 3, "3": 3 }),
  M1810: freezePoints({ "0": 0, "1": 0, "2": 5, "3": 5 }),
  M1820: freezePoints({ "0": 0, "1": 0, "2": 4, "3": 12 }),
  M1830: freezePoints({ "0": 0, "1": 0, "2": 2, "3": 10, "4": 10, "5": 17, "6": 17 }),
  M1840: freezePoints({ "0": 0, "1": 0, "2": 6, "3": 6, "4": 6 }),
  M1850: freezePoints({ "0": 0, "1": 1, "2": 4, "3": 4, "4": 4, "5": 4 }),
  // This non-monotonic mapping is intentional in the CMS table.
  M1860: freezePoints({ "0": 0, "1": 0, "2": 5, "3": 1, "4": 20, "5": 20, "6": 20 }),
});

export const CMS_PDGM_FUNCTIONAL_ITEM_IDS_CY2026 = Object.freeze(
  Object.keys(CMS_PDGM_FUNCTIONAL_ITEM_POINTS_CY2026),
);

export const CMS_PDGM_M1033_SCORING_CY2026 = Object.freeze({
  itemIds: Object.freeze([
    "M1033_HOSP_RISK_HSTRY_FALLS",
    "M1033_HOSP_RISK_WEIGHT_LOSS",
    "M1033_HOSP_RISK_MLTPL_HOSPZTN",
    "M1033_HOSP_RISK_MLTPL_ED_VISIT",
    "M1033_HOSP_RISK_MNTL_BHV_DCLN",
    "M1033_HOSP_RISK_COMPLIANCE",
    "M1033_HOSP_RISK_5PLUS_MDCTN",
    "M1033_HOSP_RISK_CRNT_EXHSTN",
    "M1033_HOSP_RISK_OTHR_RISK",
    "M1033_HOSP_RISK_NONE_ABOVE",
  ]),
  // CMS validates all ten fields, but ignores these last two risk choices when
  // counting the four qualifying risks for the functional score.
  scoringItemIds: Object.freeze([
    "M1033_HOSP_RISK_HSTRY_FALLS",
    "M1033_HOSP_RISK_WEIGHT_LOSS",
    "M1033_HOSP_RISK_MLTPL_HOSPZTN",
    "M1033_HOSP_RISK_MLTPL_ED_VISIT",
    "M1033_HOSP_RISK_MNTL_BHV_DCLN",
    "M1033_HOSP_RISK_COMPLIANCE",
    "M1033_HOSP_RISK_5PLUS_MDCTN",
  ]),
  noneAboveItemId: "M1033_HOSP_RISK_NONE_ABOVE",
  responseLimit: 4,
  categoryPoints: 12,
});
