import test from "node:test";
import assert from "node:assert/strict";
import {
  CMS_HHGS_RELEASES_CY2026,
  resolveCmsHhgsReleaseForClaimFromDate,
} from "./cmsHhgsReleasesCy2026.js";

const resolvedVersion = (date) => {
  const result = resolveCmsHhgsReleaseForClaimFromDate(date);
  assert.equal(result.resolved, true, `${date} should resolve`);
  return result.release.version;
};

test("CY 2026 claim-from boundaries select the official CMS HHGS release", () => {
  assert.equal(resolvedVersion("2026-01-01"), "07.0.26");
  assert.equal(resolvedVersion("2026-03-31"), "07.0.26");
  assert.equal(resolvedVersion("2026-04-01"), "07.1.26");
  assert.equal(resolvedVersion("2026-09-30"), "07.1.26");
  assert.equal(resolvedVersion("2026-10-01"), "07.2.26");
  assert.equal(resolvedVersion("2026-12-31"), "07.2.26");
});

test("resolver never substitutes a posted-but-not-effective or out-of-year release", () => {
  for (const date of ["2025-12-31", "2027-01-01"]) {
    assert.deepEqual(resolveCmsHhgsReleaseForClaimFromDate(date), {
      resolved: false,
      reason: "unsupported_claim_from_date",
      release: null,
    });
  }
});

test("resolver rejects timestamps, impossible dates, and non-string inputs", () => {
  for (const value of [
    "2026-02-29",
    "2026-13-01",
    "2026-04-01T00:00:00Z",
    "04/01/2026",
    "",
    null,
    new Date("2026-04-01T00:00:00Z"),
  ]) {
    assert.deepEqual(resolveCmsHhgsReleaseForClaimFromDate(value), {
      resolved: false,
      reason: "invalid_claim_from_date",
      release: null,
    });
  }
});

test("manifest pins complete SHA-256 values and all 310 official fixture rows", () => {
  assert.deepEqual(
    CMS_HHGS_RELEASES_CY2026.map(({ version, effectiveFrom, effectiveThrough }) => ({
      version,
      effectiveFrom,
      effectiveThrough,
    })),
    [
      { version: "07.0.26", effectiveFrom: "2026-01-01", effectiveThrough: "2026-03-31" },
      { version: "07.1.26", effectiveFrom: "2026-04-01", effectiveThrough: "2026-09-30" },
      { version: "07.2.26", effectiveFrom: "2026-10-01", effectiveThrough: "2026-12-31" },
    ],
  );

  let fixtureRows = 0;
  for (const release of CMS_HHGS_RELEASES_CY2026) {
    assert.match(release.packageSha256, /^[a-f0-9]{64}$/);
    assert.ok(release.packageBytes > 0);
    assert.equal(Object.isFrozen(release), true);
    assert.equal(Object.isFrozen(release.files), true);
    assert.equal(Object.isFrozen(release.fixtures), true);
    assert.equal(release.fixtures.length, 2);

    for (const [path, sha256] of Object.entries(release.files)) {
      assert.ok(path.length > 0);
      assert.match(sha256, /^[a-f0-9]{64}$/);
    }
    for (const fixture of release.fixtures) {
      assert.equal(release.files[fixture.path]?.length, 64);
      fixtureRows += fixture.expectedRecords;
    }
  }
  assert.equal(fixtureRows, 310);
});
