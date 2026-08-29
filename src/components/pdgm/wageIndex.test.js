import test from "node:test";
import assert from "node:assert/strict";
import { parseWageIndexCsv, wageIndexCsvTemplate, matchWageIndex } from "./wageIndex.js";

test("the shipped template round-trips through the parser", () => {
  const r = parseWageIndexCsv(wageIndexCsvTemplate());
  assert.equal(r.ok, true);
  assert.equal(r.errors.length, 0);
  assert.equal(r.rows.length, 3);
  const scranton = r.rows[0];
  assert.equal(scranton.cbsa, "42540");
  assert.equal(scranton.wage_index, 0.8412);
  assert.deepEqual(scranton.counties, ["lackawanna", "luzerne", "wyoming"]);
  assert.deepEqual(scranton.zip_prefixes, ["184", "185", "186", "187"]);
});

test("implausible or non-numeric wage indexes are skipped with errors, never kept", () => {
  const r = parseWageIndexCsv(
    "cbsa,label,wage_index,counties\n1,A,not-a-number,X\n2,B,12.5,Y\n3,C,0.9,Z"
  );
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].cbsa, "3");
  assert.ok(r.errors.some((e) => e.includes("not a number")));
  assert.ok(r.errors.some((e) => e.includes("outside the plausible range")));
});

test("a row with no counties AND no ZIPs is rejected (it could never match)", () => {
  const r = parseWageIndexCsv("cbsa,label,wage_index\n42540,Scranton,0.84");
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("could never match")));
});

test("county names are normalized (' County' stripped) and duplicates warned", () => {
  const r = parseWageIndexCsv(
    "cbsa,wage_index,counties\n1,0.9,Lackawanna County; Luzerne\n1,0.8,Other"
  );
  assert.deepEqual(r.rows[0].counties, ["lackawanna", "luzerne"]);
  assert.equal(r.rows.length, 1);
  assert.ok(r.warnings.some((w) => w.includes("duplicate")));
});

const table = {
  rows: [
    { cbsa: "42540", label: "Scranton PA", wage_index: 0.8412, counties: ["lackawanna"], zip_prefixes: ["184", "185"] },
    { cbsa: "20700", label: "E. Stroudsburg PA", wage_index: 0.9134, counties: ["monroe"], zip_prefixes: ["183"] },
  ],
};

test("matches by ZIP prefix first, then whole-word county, else null", () => {
  const byZip = matchWageIndex("12 Elm St, Moscow PA 18444", table);
  assert.deepEqual(byZip, { wage_index: 0.8412, cbsa: "42540", label: "Scranton PA", matchedBy: "zip" });

  const byCounty = matchWageIndex("Rural route 2, Monroe County, PA", table);
  assert.equal(byCounty.cbsa, "20700");
  assert.equal(byCounty.matchedBy, "county");

  assert.equal(matchWageIndex("500 Main St, Pittsburgh PA 15213", table), null);
  assert.equal(matchWageIndex("", table), null);
  assert.equal(matchWageIndex("18444 somewhere", null), null);
});

test("a county name inside another word does not match", () => {
  const t = { rows: [{ cbsa: "1", label: "X", wage_index: 0.9, counties: ["wayne"], zip_prefixes: [] }] };
  assert.equal(matchWageIndex("101 Waynesburg Road, PA", t), null);
  assert.ok(matchWageIndex("55 Oak St, Wayne County PA", t));
});

test("ZIP+4 addresses match on the 5-digit ZIP", () => {
  const m = matchWageIndex("PO Box 9, Stroudsburg PA 18360-1234", table);
  assert.equal(m.cbsa, "20700");
  assert.equal(m.matchedBy, "zip");
});

test("overlapping ZIP prefixes resolve to the most specific row, not CSV order", () => {
  const overlapping = {
    rows: [
      { cbsa: "1", label: "Broad", wage_index: 0.8, counties: [], zip_prefixes: ["184"] },
      { cbsa: "2", label: "Exact", wage_index: 1.1, counties: [], zip_prefixes: ["18401"] },
    ],
  };
  assert.equal(matchWageIndex("1 Main St 18401", overlapping).cbsa, "2");
  // Reversed row order gives the same answer.
  const reversed = { rows: [...overlapping.rows].reverse() };
  assert.equal(matchWageIndex("1 Main St 18401", reversed).cbsa, "2");
  // A ZIP only the broad prefix covers still matches the broad row.
  assert.equal(matchWageIndex("1 Main St 18455", overlapping).cbsa, "1");
});
