import test from "node:test";
import assert from "node:assert/strict";
import { buildChecklistPrintHtml } from "./adrChecklistPrint.js";
import { buildAdrChecklist, groupChecklistByCategory } from "./adrRequirements.js";

const caseMeta = {
  audit_type: "tpe",
  contractor_name: "Palmetto GBA",
  patient_name: "Jane <script>alert(1)</script> Smith",
  medicare_number: "1EG4-TE5-MK72",
  claim_number: "DCN123456",
  dates_of_service: "2026-01-04 to 2026-03-03",
  response_due_date: "2026-08-15",
};

const groups = groupChecklistByCategory(
  buildAdrChecklist({ letterItems: [{ text: 'Signed plan of care "CMS-485"' }], auditType: "tpe" })
);

test("renders a complete html document with case metadata and all items", () => {
  const html = buildChecklistPrintHtml({ caseMeta, groups });
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /ADR Documentation Checklist/);
  assert.match(html, /Palmetto GBA/);
  assert.match(html, /Targeted Probe &amp; Educate/);
  assert.match(html, /DCN123456/);
  assert.match(html, /Deadline: the response must reach the contractor by 2026-08-15/);
  const totalItems = groups.reduce((n, g) => n + g.items.length, 0);
  const checkboxCount = (html.match(/border:2px solid #94a3b8/g) || []).length;
  assert.equal(checkboxCount, totalItems, "one checkbox per item");
});

test("escapes untrusted values everywhere", () => {
  const html = buildChecklistPrintHtml({ caseMeta, groups });
  assert.ok(!html.includes("<script>alert(1)</script>"), "raw script must not appear");
  assert.match(html, /Jane &lt;script&gt;alert\(1\)&lt;\/script&gt; Smith/);
});

test("letter wording and citations are shown for letter-sourced items", () => {
  const html = buildChecklistPrintHtml({ caseMeta, groups });
  assert.match(html, /Letter wording:/);
  assert.match(html, /Signed plan of care &quot;CMS-485&quot;/);
  assert.match(html, /42 CFR 409\.43/);
  assert.match(html, /CMS baseline — not named in the letter/);
});

test("tolerates empty input", () => {
  const html = buildChecklistPrintHtml({});
  assert.match(html, /^<!doctype html>/);
  assert.ok(!html.includes("undefined"));
});
