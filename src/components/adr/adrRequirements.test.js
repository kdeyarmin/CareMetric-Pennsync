import test from "node:test";
import assert from "node:assert/strict";
import {
  ADR_DOCUMENT_CATALOG,
  CATALOG_BY_ID,
  AUDIT_TYPES,
  AUDIT_TYPE_IDS,
  CATEGORIES,
  CATEGORY_LABELS,
  SEVERITIES,
  matchCatalogItem,
  buildAdrChecklist,
  groupChecklistByCategory,
} from "./adrRequirements.js";

// ── catalog integrity ──

test("catalog entries are well-formed", () => {
  assert.ok(ADR_DOCUMENT_CATALOG.length >= 12, "expected a substantive catalog");
  const seen = new Set();
  for (const doc of ADR_DOCUMENT_CATALOG) {
    assert.ok(doc.id && !seen.has(doc.id), `duplicate/missing id: ${doc.id}`);
    seen.add(doc.id);
    assert.ok(SEVERITIES.includes(doc.severity), `${doc.id}: bad severity ${doc.severity}`);
    assert.ok(Object.keys(CATEGORIES).includes(doc.category), `${doc.id}: bad category ${doc.category}`);
    assert.ok(doc.citation && doc.citation.length > 5, `${doc.id}: missing citation`);
    assert.ok(doc.what_to_include && doc.what_to_include.length > 20, `${doc.id}: missing what_to_include`);
    assert.ok(Array.isArray(doc.verification_points) && doc.verification_points.length > 0, `${doc.id}: needs verification_points`);
    assert.ok(Array.isArray(doc.keywords) && doc.keywords.length > 0, `${doc.id}: needs keywords`);
    assert.ok(doc.when, `${doc.id}: needs a when condition`);
  }
});

test("conditions of payment carry their CFR citations", () => {
  assert.match(CATALOG_BY_ID.physician_certification.citation, /42 CFR 424\.22\(a\)/);
  assert.match(CATALOG_BY_ID.face_to_face.citation, /42 CFR 424\.22\(a\)\(1\)\(v\)/);
  assert.match(CATALOG_BY_ID.plan_of_care.citation, /42 CFR 409\.43/);
  assert.match(CATALOG_BY_ID.plan_of_care.citation, /42 CFR 484\.60/);
  assert.match(CATALOG_BY_ID.oasis_assessment.citation, /42 CFR 484\.55/);
  assert.match(CATALOG_BY_ID.skilled_visit_notes.citation, /42 CFR 409\.44/);
  assert.match(CATALOG_BY_ID.homebound_support.citation, /1835\(a\)/);
});

test("every category used has a display label", () => {
  for (const doc of ADR_DOCUMENT_CATALOG) {
    assert.ok(CATEGORY_LABELS[doc.category], `no label for category ${doc.category}`);
  }
});

test("audit types include the major medicare review programs", () => {
  for (const id of ["mac_adr", "tpe", "rcd", "upic", "smrc", "cert", "ra", "other"]) {
    assert.ok(AUDIT_TYPE_IDS.includes(id), `missing audit type ${id}`);
  }
  for (const t of AUDIT_TYPES) assert.ok(t.label && t.reviewer, `${t.id}: label/reviewer required`);
});

// ── matchCatalogItem ──

test("matches common letter phrasings to the right catalog entry", () => {
  assert.equal(matchCatalogItem("Signed Plan of Care (CMS-485)")?.id, "plan_of_care");
  assert.equal(matchCatalogItem("Face-to-Face encounter documentation")?.id, "face_to_face");
  assert.equal(matchCatalogItem("OASIS assessment for the episode")?.id, "oasis_assessment");
  assert.equal(matchCatalogItem("All skilled nursing visit notes for the dates of service")?.id, "skilled_visit_notes");
  assert.equal(matchCatalogItem("Documentation supporting homebound status")?.id, "homebound_support");
  assert.equal(matchCatalogItem("Signed physician certification of eligibility")?.id, "physician_certification");
  assert.equal(matchCatalogItem("Recertification for subsequent episodes")?.id, "recertification");
  assert.equal(matchCatalogItem("Copy of UB-04 claim form")?.id, "claim_copy");
});

test("longest keyword wins so specific requests beat generic ones", () => {
  // "aide care plan" must land on the aide entry, not plan_of_care.
  assert.equal(matchCatalogItem("Home health aide care plan and supervision notes")?.id, "aide_plan_supervision");
  // "verbal order" lands on interim orders, not the 485.
  assert.equal(matchCatalogItem("Signed verbal orders")?.id, "physician_orders_interim");
});

test("returns null for empty or unrecognized text", () => {
  assert.equal(matchCatalogItem(""), null);
  assert.equal(matchCatalogItem(null), null);
  assert.equal(matchCatalogItem("zzz completely unrelated request zzz"), null);
});

// ── buildAdrChecklist ──

test("letter items come first and adopt catalog grounding when matched", () => {
  const checklist = buildAdrChecklist({
    letterItems: [
      { text: "Signed plan of care (CMS-485) for all episodes" },
      { text: "Face to face encounter note" },
    ],
    auditType: "tpe",
  });
  assert.equal(checklist[0].id, "plan_of_care");
  assert.equal(checklist[0].source, "letter+cms");
  assert.equal(checklist[0].letter_text, "Signed plan of care (CMS-485) for all episodes");
  assert.match(checklist[0].citation, /42 CFR/);
  assert.equal(checklist[1].id, "face_to_face");
  assert.ok(checklist.every((it) => it.audit_type === "tpe"));
});

test("unmatched letter items are kept verbatim as letter-only requirements", () => {
  const checklist = buildAdrChecklist({
    letterItems: [{ text: "Itemized invoice for negative pressure wound therapy pump rental" }],
  });
  const custom = checklist.find((it) => it.source === "letter");
  assert.ok(custom, "unmatched letter item should be preserved");
  assert.equal(custom.severity, "high");
  assert.match(custom.citation, /Requested by the reviewing contractor/);
  assert.equal(custom.what_to_include, "Itemized invoice for negative pressure wound therapy pump rental");
});

test("cms baseline items are appended for anything the letter did not name", () => {
  const checklist = buildAdrChecklist({ letterItems: [{ text: "Plan of care" }] });
  const baseline = checklist.filter((it) => it.source === "cms_baseline");
  // Everything except plan_of_care should appear as baseline.
  assert.equal(baseline.length, ADR_DOCUMENT_CATALOG.length - 1);
  assert.ok(!baseline.some((it) => it.id === "plan_of_care"));
  const f2f = checklist.find((it) => it.id === "face_to_face");
  assert.equal(f2f.source, "cms_baseline");
});

test("two letter lines matching the same catalog entry merge into one row", () => {
  const checklist = buildAdrChecklist({
    letterItems: [
      { text: "Plan of care", details: "all episodes" },
      { text: "Signed CMS-485 plan of care", details: "with physician signature" },
    ],
  });
  // One row per checklist id — duplicate ids would double-count in the
  // verification summary and break per-id React keys.
  const pocLines = checklist.filter((it) => it.id === "plan_of_care");
  assert.equal(pocLines.length, 1);
  assert.equal(pocLines[0].source, "letter+cms");
  // Both letter wordings and details are preserved on the merged row.
  assert.equal(pocLines[0].letter_text, "Plan of care; Signed CMS-485 plan of care");
  assert.equal(pocLines[0].letter_details, "all episodes; with physician signature");
  // No cms_baseline duplicate is appended, and ids are globally unique.
  assert.equal(new Set(checklist.map((it) => it.id)).size, checklist.length);
});

test("unknown audit types collapse to other and blank letter items are skipped", () => {
  const checklist = buildAdrChecklist({ letterItems: [{ text: "  " }, { text: "" }], auditType: "bogus" });
  assert.ok(checklist.every((it) => it.audit_type === "other"));
  assert.ok(checklist.every((it) => it.source === "cms_baseline"));
  // seq stays contiguous starting at 1
  assert.deepEqual(checklist.map((it) => it.seq), checklist.map((_, i) => i + 1));
});

test("empty input yields the full cms baseline", () => {
  const checklist = buildAdrChecklist({});
  assert.equal(checklist.length, ADR_DOCUMENT_CATALOG.length);
  assert.ok(checklist.every((it) => it.source === "cms_baseline"));
});

// ── groupChecklistByCategory ──

test("groups follow the display order and letter items sort first in a group", () => {
  const checklist = buildAdrChecklist({ letterItems: [{ text: "wound care measurements" }] });
  const groups = groupChecklistByCategory(checklist);
  assert.ok(groups.length > 0);
  const labels = Object.values(CATEGORY_LABELS);
  let last = -1;
  for (const g of groups) {
    const idx = labels.indexOf(g.label);
    assert.ok(idx > last, "groups out of order");
    last = idx;
    assert.ok(g.items.length > 0, "empty groups must be dropped");
  }
  const clinical = groups.find((g) => g.category === "clinical_notes");
  assert.equal(clinical.items[0].id, "wound_care_documentation", "letter-sourced item should lead its category");
});

// ── matchCatalogItem word boundaries (regression) ──

test("catalog keywords match whole words only — no substring merges", () => {
  // Regression: the needle was trimmed AFTER padding, so 'abn' matched inside
  // "abnormal", 'claim' inside "disclaimer", 'poc' inside "epoch" — merging
  // unrelated letter items into the wrong catalog row (and out of the
  // checklist entirely).
  assert.equal(matchCatalogItem("Records of abnormal lab findings"), null);
  assert.equal(matchCatalogItem("Signed disclaimer form"), null);
  assert.equal(matchCatalogItem("Combination therapy flow sheets"), null);
  assert.equal(matchCatalogItem("Epoch summary of care"), null);
  // Real keyword hits still match.
  assert.ok(matchCatalogItem("Copy of the UB-04 claim form"));
  assert.ok(matchCatalogItem("Signed plan of care (CMS-485)"));
});

test("distinct letter items no longer merge into one catalog row", () => {
  const checklist = buildAdrChecklist({
    letterItems: [
      { text: "Copy of UB-04 claim form" },
      { text: "Signed disclaimer form for wound photography" },
    ],
    auditType: "mac_adr",
  });
  const letterRows = checklist.filter((it) => it.source !== "cms_baseline");
  assert.equal(letterRows.length, 2);
  assert.ok(letterRows.some((it) => it.source === "letter" && /disclaimer/i.test(it.letter_text)));
});

test("an unmatched letter item is always severity high — AI fields cannot downgrade it", () => {
  const checklist = buildAdrChecklist({
    letterItems: [{ text: "Signed disclaimer form for wound photography", severity: "medium" }],
    auditType: "mac_adr",
  });
  const row = checklist.find((it) => it.source === "letter");
  assert.equal(row.severity, "high");
});

test("groupChecklistByCategory keeps rows with drifted categories visible", () => {
  const groups = groupChecklistByCategory([
    { id: "a", seq: 1, category: "orders_certification", source: "cms_baseline", title: "A" },
    { id: "b", seq: 2, category: "weird_cat", source: "letter", title: "B" },
  ]);
  const flat = groups.flatMap((g) => g.items.map((it) => it.id));
  assert.ok(flat.includes("b"), "a drifted-category row must not vanish from the checklist");
});
