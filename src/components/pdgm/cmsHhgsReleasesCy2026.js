// Authoritative CMS Home Health PPS Grouper Software release manifest for CY 2026.
//
// Sources are the three primary CMS distribution ZIPs linked from:
// https://www.cms.gov/medicare/payment/prospective-payment-systems/home-health/home-health-grouper-software
//
// The hashes below were computed from fresh downloads on 2026-09-03. They pin
// the distribution, Java runner, date-range table, version-specific reference
// tables, and both official fixture files. The large CMS ZIPs are intentionally
// not vendored; tools-verify-cms-hhgs-cy2026.mjs verifies user-downloaded copies.

export const CMS_HHGS_RELEASE_PAGE =
  "https://www.cms.gov/medicare/payment/prospective-payment-systems/home-health/home-health-grouper-software";

const freezeFiles = (files) => Object.freeze({ ...files });
const freezeFixtures = (fixtures) => Object.freeze(
  fixtures.map((fixture) => Object.freeze({ ...fixture })),
);
const freezeRelease = (release) => Object.freeze({
  ...release,
  files: freezeFiles(release.files),
  fixtures: freezeFixtures(release.fixtures),
});

export const CMS_HHGS_RELEASES_CY2026 = Object.freeze([
  freezeRelease({
    version: "07.0.26",
    versionCode: "07026",
    postedOn: "2025-12-01",
    effectiveFrom: "2026-01-01",
    effectiveThrough: "2026-03-31",
    packageUrl: "https://www.cms.gov/files/zip/jan-2026-hh-pps-grouper-software-hh-pdgm-v07-0-26-posted-12-1-2025.zip",
    packageSha256: "40cdaad09e83ec67d37ae041b59bdc2a9f9fd8b76638dd36702da0236f4628e7",
    packageBytes: 53912097,
    archiveRoot: "Jan 2026 HH PPS Grouper Software HH PDGM v",
    files: {
      "dist/HomeHealth.jar": "750e0ef77a124a82d5e752827d534d55cbe20f72da66d8af9a7f81172b280190",
      "tables/Versions/Version_Range.txt": "3b107eae719486661efc2bc7151fbc578687de0d821321d66ccf5a68342bd756",
      "tables/Versions/07026/Claim_Layout.txt": "40878902a3c065e6c42e16c3b757d03ca250eec70cfc167106ee791f13b5acae",
      "tables/Versions/07026/RT/Clinical_Groups.txt": "fc97f126b808b1408fa6fd9a278ec78be741d06f71871c8fde479fea43726a94",
      "tables/Versions/07026/RT/Code_First_Conditions.txt": "081ab6759b45713fdf503958d4bde990e2fb2b17bebb9767ced3e95a81a39573",
      "tables/Versions/07026/RT/Comorbidity_Groups.txt": "759e4df73b04e1deecf2ae3772ea8161a1aa4b0db8fdfad0d48d22e0c8020379",
      "tables/Versions/07026/RT/Comorbidity_Interactions.txt": "54bca6df878bb18cdb50171181a1d77a4ef3e473586362cbdeb3af95fbc6d8f0",
      "tables/Versions/07026/RT/Diagnosis_Codes.txt": "6f26592235d80a3ea57e3cfb1d94f5364c0503e879a50eb9d6724331198b823b",
      "tables/Versions/07026/RT/Diagnosis_Subchapters.txt": "fe953d9535b67848dd6900ac6c9c41e01560c01bbf0b4f04be8dc7279330dd00",
      "tables/Versions/07026/RT/FI_Responses.txt": "36a4646815903eceb7d16ee67b787c7a97f53beeb71397cd2546ba2094542efa",
      "tables/Versions/07026/RT/HIPPS_Structure.txt": "2d037dea324220cc7a6e807dae0705a65cca977cc33d947295ae490a37913351",
      "tables/Versions/07026/RT/Return_Codes.txt": "9afcab611d9c1728e8bd5647c1f79dfc3176bea086cd8cce1dc46f56f35faba1",
      "tables/Versions/07026/RT/Validity_Flags.txt": "9708c831387c3fddcd669db914241292ce1eac82faccc790a64d9085c84cd0ae",
      "test/TestDataV07026.txt": "04a757174881af85bd223090c3f914035d72c766319a00b29bee6567a2412cd3",
      "test/TestDataV07026_GRC.txt": "6cad984ab09a7ce2c4a2238b45718ec1521b478dd7fd14867fcaf0bd725c4d5e",
    },
    fixtures: [
      { path: "test/TestDataV07026.txt", expectedRecords: 50 },
      { path: "test/TestDataV07026_GRC.txt", expectedRecords: 51 },
    ],
  }),
  freezeRelease({
    version: "07.1.26",
    versionCode: "07126",
    postedOn: "2026-02-10",
    effectiveFrom: "2026-04-01",
    effectiveThrough: "2026-09-30",
    packageUrl: "https://www.cms.gov/files/zip/apr-2026-hh-pps-grouper-software-hh-pdgm-v07-1-26-posted-02-10-2026.zip",
    packageSha256: "0c8c35996fea3be516c000afa5ae67dac64e25d9fb3123ce0f5e16d9f95bf0e7",
    packageBytes: 56410274,
    archiveRoot: "HomeHealthGrouperSoftware",
    files: {
      "dist/HomeHealth.jar": "9c01ee8e8f1768b96e6e8389c0ab1fed30f6ee0f6e34c3cdd18f04ce0507c821",
      "tables/Versions/Version_Range.txt": "f124e0ec059986ad500122ff5c553cbcec803b86d921709d5e8ac76c206d8857",
      "tables/Versions/07126/Claim_Layout.txt": "40878902a3c065e6c42e16c3b757d03ca250eec70cfc167106ee791f13b5acae",
      "tables/Versions/07126/RT/Clinical_Groups.txt": "fc97f126b808b1408fa6fd9a278ec78be741d06f71871c8fde479fea43726a94",
      "tables/Versions/07126/RT/Code_First_Conditions.txt": "868ec620415a69d4ab9a080d4cb1cc14c2068e0a2983ccda69d406ccd14404c2",
      "tables/Versions/07126/RT/Comorbidity_Groups.txt": "759e4df73b04e1deecf2ae3772ea8161a1aa4b0db8fdfad0d48d22e0c8020379",
      "tables/Versions/07126/RT/Comorbidity_Interactions.txt": "54bca6df878bb18cdb50171181a1d77a4ef3e473586362cbdeb3af95fbc6d8f0",
      "tables/Versions/07126/RT/Diagnosis_Codes.txt": "0ebb40cd6a52f6c2b89794ae6c9c7f2236a25af41df1c60215cc2dae27c3824f",
      "tables/Versions/07126/RT/Diagnosis_Subchapters.txt": "fe953d9535b67848dd6900ac6c9c41e01560c01bbf0b4f04be8dc7279330dd00",
      "tables/Versions/07126/RT/FI_Responses.txt": "36a4646815903eceb7d16ee67b787c7a97f53beeb71397cd2546ba2094542efa",
      "tables/Versions/07126/RT/HIPPS_Structure.txt": "2d037dea324220cc7a6e807dae0705a65cca977cc33d947295ae490a37913351",
      "tables/Versions/07126/RT/Return_Codes.txt": "9afcab611d9c1728e8bd5647c1f79dfc3176bea086cd8cce1dc46f56f35faba1",
      "tables/Versions/07126/RT/Validity_Flags.txt": "9708c831387c3fddcd669db914241292ce1eac82faccc790a64d9085c84cd0ae",
      "test/TestDataV07126.txt": "6b7e41a085029ab4ae96b15f6bca4d6ee06b4ea524a93c429cc193122eabd012",
      "test/TestDataV07126_GRC.txt": "16274652125ffd7f8ec099bfbc8bce6a6aa929ee7851cd1251fdf013d8076010",
    },
    fixtures: [
      { path: "test/TestDataV07126.txt", expectedRecords: 17 },
      { path: "test/TestDataV07126_GRC.txt", expectedRecords: 51 },
    ],
  }),
  freezeRelease({
    version: "07.2.26",
    versionCode: "07226",
    postedOn: "2026-08-20",
    effectiveFrom: "2026-10-01",
    effectiveThrough: "2026-12-31",
    packageUrl: "https://www.cms.gov/files/zip/oct-2026-hh-pps-grouper-software-hh-pdgm-v07-2-26-posted-08-20-2026.zip",
    packageSha256: "ff3efb8e4a09f5fb9d111df133129dc2e2dbfea829a39b4498e405b3cdcb7f26",
    packageBytes: 58955979,
    archiveRoot: "HomeHealthGrouperSoftware",
    files: {
      "dist/HomeHealth.jar": "426cffe40293d332f7794c9ee5c02b1b54091c4774e906fe9773c00dd540d08b",
      "tables/Versions/Version_Range.txt": "4fac77dd29404dfc360cd8c5fd95e8a6fb21f693cd42947c379bb5f644839865",
      "tables/Versions/07226/Claim_Layout.txt": "40878902a3c065e6c42e16c3b757d03ca250eec70cfc167106ee791f13b5acae",
      "tables/Versions/07226/RT/Clinical_Groups.txt": "fc97f126b808b1408fa6fd9a278ec78be741d06f71871c8fde479fea43726a94",
      "tables/Versions/07226/RT/Code_First_Conditions.txt": "5dca679f26f396a10930459ebfd752301beedfd5318e11a6814d5f2f3a852cbb",
      "tables/Versions/07226/RT/Comorbidity_Groups.txt": "759e4df73b04e1deecf2ae3772ea8161a1aa4b0db8fdfad0d48d22e0c8020379",
      "tables/Versions/07226/RT/Comorbidity_Interactions.txt": "54bca6df878bb18cdb50171181a1d77a4ef3e473586362cbdeb3af95fbc6d8f0",
      "tables/Versions/07226/RT/Diagnosis_Codes.txt": "720700ef2f29d59aca9a568c2bcba1f40bd6f655af94eaef033cd54c099ac5f0",
      "tables/Versions/07226/RT/Diagnosis_Subchapters.txt": "57cb56ab4f2290d5ae4b9c95db3c4b9bc3720178a52241dbbaf9bdda2eee01a6",
      "tables/Versions/07226/RT/FI_Responses.txt": "36a4646815903eceb7d16ee67b787c7a97f53beeb71397cd2546ba2094542efa",
      "tables/Versions/07226/RT/HIPPS_Structure.txt": "2d037dea324220cc7a6e807dae0705a65cca977cc33d947295ae490a37913351",
      "tables/Versions/07226/RT/Return_Codes.txt": "9afcab611d9c1728e8bd5647c1f79dfc3176bea086cd8cce1dc46f56f35faba1",
      "tables/Versions/07226/RT/Validity_Flags.txt": "9708c831387c3fddcd669db914241292ce1eac82faccc790a64d9085c84cd0ae",
      "test/TestDataV07226.txt": "04ce6c05a14f4ece5a10b1aeceffdb590630ebc8cddb5927210e1f65c528eb81",
      "test/TestDataV07226_GRC.txt": "552ed4d35398c3f3e0fe1ef54ce87eb561a1d738dad4115509e1113bb0265bc8",
    },
    fixtures: [
      { path: "test/TestDataV07226.txt", expectedRecords: 90 },
      { path: "test/TestDataV07226_GRC.txt", expectedRecords: 51 },
    ],
  }),
]);

const parseIsoCalendarDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const time = Date.UTC(year, month - 1, day);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString().slice(0, 10) === value ? value : null;
};

/**
 * Resolve the official CMS HHGS release from the claim-from date.
 *
 * The input is deliberately a date-only ISO string. Date objects, timestamps,
 * malformed calendar dates, and dates outside CY 2026 fail closed. In
 * particular, this never selects the newest posted package just because it is
 * available: v07.2.26 is not valid before 2026-10-01.
 */
export function resolveCmsHhgsReleaseForClaimFromDate(claimFromDate) {
  const date = parseIsoCalendarDate(claimFromDate);
  if (!date) {
    return Object.freeze({ resolved: false, reason: "invalid_claim_from_date", release: null });
  }

  const release = CMS_HHGS_RELEASES_CY2026.find(
    (candidate) => date >= candidate.effectiveFrom && date <= candidate.effectiveThrough,
  );
  if (!release) {
    return Object.freeze({ resolved: false, reason: "unsupported_claim_from_date", release: null });
  }
  return Object.freeze({ resolved: true, reason: null, release });
}
