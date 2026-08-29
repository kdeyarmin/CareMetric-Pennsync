import test from "node:test";
import assert from "node:assert/strict";
import { PA_WAGE_INDEX_CY2026 } from "./paWageIndexCy2026.js";
import { WAGE_INDEX_MIN, WAGE_INDEX_MAX, matchWageIndex } from "./wageIndex.js";

const { rows } = PA_WAGE_INDEX_CY2026;

test("bundle carries its provenance and the stored-row shape", () => {
  assert.match(PA_WAGE_INDEX_CY2026.source_file, /CY 2026 Final HH PPS Wage Index/);
  assert.match(PA_WAGE_INDEX_CY2026.source_url, /^https:\/\/www\.cms\.gov\//);
  assert.equal(PA_WAGE_INDEX_CY2026.payment_year, "2026");
  for (const r of rows) {
    assert.deepEqual(Object.keys(r).sort(), ["cbsa", "counties", "label", "wage_index", "zip_prefixes"]);
    assert.ok(/^\d{5}$/.test(r.cbsa), `CBSA code shape: ${r.cbsa}`);
    assert.ok(r.label.trim().length > 0);
    assert.ok(Array.isArray(r.counties) && r.counties.length > 0, `${r.label} must carry counties`);
    // County names are stored normalized (lowercase, no " county" suffix).
    for (const c of r.counties) assert.equal(c, c.toLowerCase().replace(/\s+county$/, ""));
    // ZIP mappings are never invented — the CMS file is county-based.
    assert.deepEqual(r.zip_prefixes, []);
  }
});

test("every wage index is a plausible 4-decimal CMS value", () => {
  for (const r of rows) {
    assert.ok(Number.isFinite(r.wage_index), r.label);
    assert.ok(r.wage_index >= WAGE_INDEX_MIN && r.wage_index <= WAGE_INDEX_MAX, `${r.label}: ${r.wage_index}`);
    assert.equal(r.wage_index, Math.round(r.wage_index * 10000) / 10000, `${r.label}: more than 4 decimals`);
  }
});

test("all 67 Pennsylvania counties are covered exactly once", () => {
  const all = rows.flatMap((r) => r.counties);
  assert.equal(all.length, 67);
  assert.equal(new Set(all).size, 67, "no county may appear in two rows");
  // Spot-check the roster edges: urban, transition, and rural members.
  for (const c of ["philadelphia", "allegheny", "pike", "monroe", "cameron", "mckean", "york"]) {
    assert.ok(all.includes(c), `missing county: ${c}`);
  }
});

test("spot values match the CMS CY2026 file verbatim", () => {
  const byCbsa = Object.fromEntries(rows.map((r) => [r.cbsa, r]));
  assert.equal(byCbsa["38300"].wage_index, 0.8463); // Pittsburgh, PA
  assert.equal(byCbsa["38300"].counties.length, 8);
  assert.equal(byCbsa["37964"].wage_index, 1.0364); // Philadelphia, PA (division)
  assert.equal(byCbsa["44300"].wage_index, 1.1283); // State College, PA
  assert.equal(byCbsa["10900"].wage_index, 0.9978); // Allentown-Bethlehem-Easton, PA-NJ
  assert.deepEqual(byCbsa["10900"].counties, ["carbon", "lehigh", "northampton"], "PA counties only — no NJ");
  assert.equal(byCbsa["50023"].wage_index, 1.0188); // Pike County CY2026 transition code
  assert.deepEqual(byCbsa["50023"].counties, ["pike"]);
  assert.equal(byCbsa["99939"].wage_index, 0.8507); // statewide rural PA
  assert.equal(byCbsa["99939"].counties.length, 33);
  assert.ok(byCbsa["99939"].counties.includes("monroe"), "Monroe is in no CY2026 urban CBSA → rural");
});

test("the bundled rows drive matchWageIndex end to end", () => {
  const stored = { rows };
  assert.equal(matchWageIndex("123 Main St, Allegheny County, PA 15201", stored).wage_index, 0.8463);
  assert.equal(matchWageIndex("42 Ridge Rd, Milford, Pike County PA", stored).wage_index, 1.0188);
  const rural = matchWageIndex("7 Farm Ln, Stroudsburg, Monroe County, PA", stored);
  assert.equal(rural.wage_index, 0.8507);
  assert.equal(rural.matchedBy, "county");
  assert.equal(matchWageIndex("10 Oak St, Trenton, Mercer County, NJ", stored)?.cbsa, "99939",
    "county-name matching is not state-aware — Mercer NJ hits rural-PA Mercer; PA-only agencies are unaffected");
});
