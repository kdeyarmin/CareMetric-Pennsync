import test from "node:test";
import assert from "node:assert/strict";

import {
  RESPONSE_SCHEMAS, RESPONSE_SCHEMA_IDS, RESPONSE_SCHEMA_V1_LEGACY, RESPONSE_SCHEMA_V2_CMS_E2,
  getResponseSchema, getDefinition, v2Definition, evaluateRow, partitionRowsForCms,
  resolveInstrumentForAssessment, visitTypeToTimepoint, isApplicableAtTimepoint,
  codesForTimepoint, UNIMPLEMENTED_ITEMS, NOT_PROMOTED_ABBREVIATED_ITEMS,
  V1_FROZEN_IDS, V2_CMS_DEFINITION_IDS, V2_SCREENING_DEFINITION_IDS, EXCLUSION_REASONS,
} from "./registry.js";
import { V1_LEGACY_DEFINITIONS, V1_LEGACY_WARNING } from "./v1Legacy.js";
import { validateResponseValue } from "./shapes.js";
import { buildOfficialResponseRow } from "./responseBuilder.js";
import { buildOasisOutput, COMPANION_DISCLAIMER, containsBannedOutputPhrase } from "./outputPolicy.js";
import { sanitizeAiItemPayload, sanitizeAiItems, stripCodeAssertions, looksLikeOasisCode } from "./aiResponseSanitizer.js";
import { evaluateDraft, draftKey, draftPayload, saveDraft, listDrafts, discardDraft } from "./draftStorage.js";
import {
  canWriteV2Responses, writesAreKilled, canReadSchema,
  OASIS_RESPONSE_SCHEMA_V2_FLAG as FLAG_FIELD, OASIS_WRITE_KILL_SWITCH as KILL_FIELD,
} from "./featureFlag.js";
import { v2Row, legacyRow, unversionedRow, v2Assessment, legacyAssessment } from "./testFixtures.js";
import {
  CMS_GOLDEN_CODES, CMS_GOLDEN_TIMEPOINTS, CMS_GOLDEN_SHAPES, CMS_GOLDEN_M2401_ROWS,
  CMS_GOLDEN_CODE_OMISSIONS, CMS_GOLDEN_EXCLUSIVE_CODES, CMS_GOLDEN_MEANINGS,
  M2420_FORBIDDEN_DESTINATIONS, EIGHTEEN_CONFLICT_ITEMS, DEMOTED_TO_SCREENING, ALIGNED_TO_CMS,
} from "./cmsGoldenFixtures.js";

const DC = { assessment_date: "2026-06-01", visit_type: "Discharge" };
const SOC = { assessment_date: "2026-05-01", visit_type: "Start of Care" };
const defFor = (item) => Object.values(
  getResponseSchema(RESPONSE_SCHEMA_V2_CMS_E2).definitions,
).find((d) => d.item_number === item);

// ─────────────────────────── 1–4: the 18-item partition ────────────────────

test("1. v1 contains all 18 frozen conflicts", () => {
  const frozen = V1_FROZEN_IDS.map((id) => V1_LEGACY_DEFINITIONS[id].legacy_item_number).sort();
  assert.deepEqual(frozen, [...EIGHTEEN_CONFLICT_ITEMS].sort());
  assert.equal(V1_FROZEN_IDS.length, 18);
});

test("2. v2 aligns exactly the 15 approved items, matching the CMS fixtures", () => {
  const aligned = V2_CMS_DEFINITION_IDS.map((id) => v2Definition(id).item_number).sort();
  assert.deepEqual(aligned, [...ALIGNED_TO_CMS].sort());
  for (const item of ALIGNED_TO_CMS) {
    const d = defFor(item);
    assert.ok(d, `${item} missing from v2`);
    assert.deepEqual(d.codes.map((c) => c.code), [...CMS_GOLDEN_CODES[item]], `${item} codes`);
    assert.equal(d.response_shape, CMS_GOLDEN_SHAPES[item], `${item} shape`);
    assert.deepEqual([...d.timepoints].sort(), [...CMS_GOLDEN_TIMEPOINTS[item]].sort(), `${item} timepoints`);
  }
});

test("3. the three demotions are exactly the approved ps_ prompts", () => {
  assert.deepEqual([...V2_SCREENING_DEFINITION_IDS], [
    "ps_hospitalization_risk_tier", "ps_ostomy_self_management", "ps_urinary_incontinence_frequency",
  ]);
  for (const id of V2_SCREENING_DEFINITION_IDS) {
    const d = v2Definition(id);
    assert.equal(d.item_number, null, `${id} must carry no M-number`);
    assert.equal(d.item_source, "pennsync_screening");
  }
  // And the legacy numbers they replaced live ONLY in the frozen reader.
  for (const m of DEMOTED_TO_SCREENING) {
    assert.ok(V1_FROZEN_IDS.includes(m.toLowerCase()), `${m} must remain readable in v1`);
    assert.equal(defFor(m), undefined, `${m} must not exist as a v2 CMS item`);
  }
});

test("4. the aligned and demoted sets do not overlap and their union is all 18", () => {
  const aligned = new Set(ALIGNED_TO_CMS);
  const demoted = new Set(DEMOTED_TO_SCREENING);
  for (const d of demoted) assert.ok(!aligned.has(d), `${d} in both sets`);
  assert.deepEqual([...new Set([...aligned, ...demoted])].sort(), [...EIGHTEEN_CONFLICT_ITEMS].sort());
  assert.equal(aligned.size + demoted.size, 18);
});

// ─────────────────────────── 5: the frozen snapshot ────────────────────────

test("5. legacy fixtures are byte-for-byte unchanged and frozen", () => {
  // Values were stored as JS NUMBERS by the legacy writer. That is part of the
  // evidence: a legacy 1 and a v2 "1" are different facts.
  assert.equal(V1_LEGACY_DEFINITIONS.m1830.options[6].value, 6);
  assert.equal(V1_LEGACY_DEFINITIONS.m1830.options[6].label, "6 — Unable to rate — patient has artificial opening");
  assert.equal(V1_LEGACY_DEFINITIONS.m2420.options[1].label, "2 — Transferred to hospital");
  assert.equal(V1_LEGACY_DEFINITIONS.m2010.options[0].label, "0 — Not applicable — no high-risk drugs");
  assert.ok(Object.isFrozen(V1_LEGACY_DEFINITIONS));
  assert.ok(Object.isFrozen(V1_LEGACY_DEFINITIONS.m1830.options));
  assert.throws(() => { V1_LEGACY_DEFINITIONS.m1830.options[6].value = 99; }, TypeError);
});

// ─────────────── 6: missing / unknown / v1 schemas are never usable ────────

test("6. missing, unknown or v1 schemas are never carryable, exportable or scorable", () => {
  const cases = [
    ["no schema", { item_number: "M1830", item_source: "cms_item", response: "6" }],
    ["unknown schema", { ...v2Row("m1830_cms_e2", "M1830", "6"), response_schema_id: "pennsync-oasis-response-v9" }],
    ["legacy schema", legacyRow("m1830", "M1830", "6")],
    // Even when the row insists it is a CMS item.
    ["cms_item but unversioned", { item_number: "M1830", item_source: "cms_item", item_spec_version: "oasis-e2", response: "6" }],
  ];
  for (const [name, row] of cases) {
    const v = evaluateRow(row, DC);
    assert.equal(v.carryable, false, `${name} carryable`);
    assert.equal(v.cmsOutputAllowed, false, `${name} exportable`);
    assert.equal(v.cmsScorable, false, `${name} scorable`);
    assert.ok(v.reasons.length > 0, `${name} must give a reason`);
  }
});

// ─────────────────── 7: lossless round-trip of every code form ─────────────

test("7. leading-zero, NA, UK, multi-select, matrix and grid values round-trip losslessly", () => {
  const cases = [
    ["m1100_cms_e2", SOC, { code: "01" }],
    ["m1100_cms_e2", SOC, { code: "09" }],
    ["m1100_cms_e2", SOC, { code: "15" }],
    ["m1620_cms_e2", SOC, { code: "NA" }],
    ["m1620_cms_e2", SOC, { code: "UK" }],
    ["m2001_cms_e2", SOC, { code: "9" }],
    ["m2010_cms_e2", SOC, { code: "NA" }],
    ["m2420_cms_e2", DC, { code: "UK" }],
    ["m1740_cms_e2", DC, { codes: ["1", "3", "6"] }],
    ["m2401_cms_e2", DC, { rows: CMS_GOLDEN_M2401_ROWS.map((r, i) => ({ row_id: r, code: ["0", "1", "NA"][i % 3] })) }],
  ];
  for (const [definitionId, ctx, value] of cases) {
    const built = buildOfficialResponseRow({ definitionId, responseValue: value, assessment: ctx, clinicianEmail: "rn@x.com" });
    assert.ok(built.ok, `${definitionId} ${JSON.stringify(value)}: ${built.detail}`);
    // Survives a JSON round-trip byte-for-byte.
    const rt = JSON.parse(JSON.stringify(built.row.response_value));
    assert.deepEqual(rt, value, `${definitionId} round-trip`);
    if (value.code) assert.equal(typeof rt.code, "string");
  }
  // "01" is not 1.
  assert.ok(!buildOfficialResponseRow({ definitionId: "m1100_cms_e2", responseValue: { code: "1" }, assessment: SOC, clinicianEmail: "rn@x.com" }).ok);
});

// ─────────────────── 8–9: mutual exclusion and grid completeness ───────────

test("8. M1740's none-of-the-above response is mutually exclusive", () => {
  const none = CMS_GOLDEN_EXCLUSIVE_CODES.M1740[0];
  const ok = buildOfficialResponseRow({ definitionId: "m1740_cms_e2", responseValue: { codes: [none] }, assessment: DC, clinicianEmail: "rn@x.com" });
  assert.ok(ok.ok);
  const bad = buildOfficialResponseRow({ definitionId: "m1740_cms_e2", responseValue: { codes: [none, "1"] }, assessment: DC, clinicianEmail: "rn@x.com" });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, "mutually_exclusive");
  // Order must not matter.
  assert.equal(buildOfficialResponseRow({ definitionId: "m1740_cms_e2", responseValue: { codes: ["1", none] }, assessment: DC, clinicianEmail: "rn@x.com" }).reason, "mutually_exclusive");
});

test("9. M2401 rejects missing, duplicated and unknown grid rows", () => {
  const full = CMS_GOLDEN_M2401_ROWS.map((r) => ({ row_id: r, code: "1" }));
  assert.ok(buildOfficialResponseRow({ definitionId: "m2401_cms_e2", responseValue: { rows: full }, assessment: DC, clinicianEmail: "rn@x.com" }).ok);
  const partial = buildOfficialResponseRow({ definitionId: "m2401_cms_e2", responseValue: { rows: full.slice(0, 2) }, assessment: DC, clinicianEmail: "rn@x.com" });
  assert.equal(partial.reason, "missing_rows");
  const dupe = buildOfficialResponseRow({ definitionId: "m2401_cms_e2", responseValue: { rows: [...full, { row_id: "b", code: "0" }] }, assessment: DC, clinicianEmail: "rn@x.com" });
  assert.equal(dupe.reason, "invalid_row");
  const unknown = buildOfficialResponseRow({ definitionId: "m2401_cms_e2", responseValue: { rows: [...full, { row_id: "z", code: "0" }] }, assessment: DC, clinicianEmail: "rn@x.com" });
  assert.equal(unknown.reason, "invalid_row");
  const badCode = buildOfficialResponseRow({ definitionId: "m2401_cms_e2", responseValue: { rows: full.map((r) => ({ ...r, code: "7" })) }, assessment: DC, clinicianEmail: "rn@x.com" });
  assert.equal(badCode.reason, "invalid_code");
});

// ─────────────────── 10: invalid / missing assessment date ─────────────────

test("10. an invalid or missing assessment date fails closed", () => {
  for (const bad of [undefined, null, "", "  ", "not-a-date", "2026-13-45"]) {
    const r = resolveInstrumentForAssessment({ assessment_date: bad });
    assert.equal(r.resolved, false, `${JSON.stringify(bad)} must not resolve`);
    assert.equal(r.instrument, null);
    const built = buildOfficialResponseRow({ definitionId: "m1830_cms_e2", responseValue: { code: "6" }, assessment: { assessment_date: bad, visit_type: "Discharge" }, clinicianEmail: "rn@x.com" });
    assert.equal(built.ok, false);
    assert.equal(built.reason, "unresolved_instrument");
  }
  // A date before OASIS-E2 does not resolve to E2 either.
  assert.equal(resolveInstrumentForAssessment({ assessment_date: "2025-01-01" }).resolved, false);
  assert.equal(resolveInstrumentForAssessment({ assessment_date: "2026-04-01" }).resolved, true);
});

// ─────────────────── 11: timepoints, M2420 discharge-only ──────────────────

test("11. every item rejects invalid timepoints", () => {
  for (const item of ALIGNED_TO_CMS) {
    const d = defFor(item);
    const allowed = CMS_GOLDEN_TIMEPOINTS[item];
    for (const tp of ["SOC", "ROC", "FU", "TRN", "DC", "DAH"]) {
      assert.equal(isApplicableAtTimepoint(d, tp), allowed.includes(tp), `${item} @ ${tp}`);
    }
    assert.equal(isApplicableAtTimepoint(d, "NOPE"), false);
    assert.equal(isApplicableAtTimepoint(d, null), false);
  }
});

test("11b. M2420 is discharge-only and an inpatient transfer is M2410", () => {
  assert.deepEqual([...defFor("M2420").timepoints], ["DC"]);
  for (const vt of ["Start of Care", "Resumption of Care", "Recertification", "Transfer"]) {
    const built = buildOfficialResponseRow({ definitionId: "m2420_cms_e2", responseValue: { code: "1" }, assessment: { assessment_date: "2026-06-01", visit_type: vt }, clinicianEmail: "rn@x.com" });
    assert.equal(built.reason, "invalid_timepoint", `M2420 must not be answerable at ${vt}`);
  }
  // M2410 is recorded as deliberately unimplemented, not silently absent.
  assert.ok(UNIMPLEMENTED_ITEMS.M2410);
  assert.deepEqual([...UNIMPLEMENTED_ITEMS.M2410.timepoints], ["TRN", "DC"]);
  assert.equal(defFor("M2410"), undefined);
});

test("11c. an unrecognised visit type resolves to no timepoint", () => {
  for (const vt of [undefined, null, "", "Routine", "OASIS"]) assert.equal(visitTypeToTimepoint(vt), null);
  assert.equal(visitTypeToTimepoint("Recertification"), "FU");
});

test("11d. a code CMS omits at a timepoint is refused there and allowed elsewhere", () => {
  const omitted = CMS_GOLDEN_CODE_OMISSIONS.M1620.DC;
  for (const code of omitted) {
    assert.equal(buildOfficialResponseRow({ definitionId: "m1620_cms_e2", responseValue: { code }, assessment: DC, clinicianEmail: "rn@x.com" }).reason, "invalid_code");
    assert.ok(buildOfficialResponseRow({ definitionId: "m1620_cms_e2", responseValue: { code }, assessment: SOC, clinicianEmail: "rn@x.com" }).ok);
  }
  assert.ok(!codesForTimepoint(defFor("M1620"), "DC").some((c) => omitted.includes(c.code)));
});

// ─────────────────── 12: writers stamp full provenance ─────────────────────

test("12. a built row stamps schema, source, instrument, timepoint and clinician provenance", () => {
  const built = buildOfficialResponseRow({
    definitionId: "m1830_cms_e2", responseValue: { code: "6" }, assessment: DC,
    clinicianEmail: "rn@example.com", selectedAt: "2026-06-01T10:00:00.000Z",
  });
  assert.ok(built.ok);
  assert.deepEqual(built.row, {
    definition_id: "m1830_cms_e2",
    item_number: "M1830",
    item_name: "Bathing",
    item_source: "cms_item",
    item_spec_version: "oasis-e2",
    response_schema_id: RESPONSE_SCHEMA_V2_CMS_E2,
    response_shape: "single",
    response_value: { code: "6" },
    response_origin: "clinician_selected",
    selected_by: "rn@example.com",
    selected_at: "2026-06-01T10:00:00.000Z",
    ai_suggested: false,
  });
  // A screening answer never gets an M-number or an instrument version.
  const scr = buildOfficialResponseRow({ definitionId: "ps_hospitalization_risk_tier", responseValue: { code: "high" }, assessment: DC, clinicianEmail: "rn@example.com" });
  assert.equal(scr.row.item_number, null);
  assert.equal(scr.row.item_spec_version, null);
  assert.equal(scr.row.item_source, "pennsync_screening");
});

test("12b. an official response requires an explicit clinician selection", () => {
  for (const email of [undefined, null, "", "   "]) {
    assert.equal(buildOfficialResponseRow({ definitionId: "m1830_cms_e2", responseValue: { code: "6" }, assessment: DC, clinicianEmail: email }).reason, "not_clinician_selected");
  }
  // A saved row that claims another origin is not scorable.
  assert.ok(evaluateRow(v2Row("m1830_cms_e2", "M1830", "6", { response_origin: "ai_suggested" }), DC).reasons.includes("not_clinician_selected"));
  assert.ok(evaluateRow(v2Row("m1830_cms_e2", "M1830", "6", { ai_suggested: true }), DC).reasons.includes("ai_originated"));
});

// ─────────────────── 14: AI codes cannot reach anything ────────────────────

test("14. AI-produced codes cannot populate, save, copy, export or score", () => {
  const hallucinated = {
    item_number: "M1830", suggested_response: "6", suggested_value: "6", recommended_score: "6",
    auto_update: true, code: "6", codes: ["6"], response_value: { code: "6" },
    evidence: "Bathed by aide.", question: "Who bathes the patient?",
  };
  const { clean, stripped } = sanitizeAiItemPayload(hallucinated);
  for (const k of ["suggested_response", "suggested_value", "recommended_score", "auto_update", "code", "codes", "response_value"]) {
    assert.ok(!(k in clean), `${k} survived sanitisation`);
    assert.ok(stripped.includes(k), `${k} not reported as stripped`);
  }
  assert.deepEqual(Object.keys(clean).sort(), ["evidence", "item_number", "question"]);

  // A code asserted inside prose is neutralised.
  for (const text of ["Enter code 3.", "Select NA.", "M1830 = 6", "Answer: 04", "code: UK"]) {
    assert.ok(!looksLikeOasisCode(stripCodeAssertions(text)), text);
    assert.match(stripCodeAssertions(text), /code removed/);
  }
  // Batch form.
  assert.deepEqual(sanitizeAiItems([{ suggested_value: "2" }, null]).clean, [{}, {}]);

  // Even if a code reached a row, it is not scorable without clinician origin.
  const aiRow = { ...v2Row("m1830_cms_e2", "M1830", "6"), response_origin: "ai_suggested", ai_suggested: true };
  const verdict = evaluateRow(aiRow, DC);
  assert.equal(verdict.cmsScorable, false);
  assert.equal(verdict.cmsOutputAllowed, false);
  // And it is quarantined out of output rather than printed.
  const out = buildOasisOutput({ ...DC, oasis_items: [aiRow] });
  assert.equal(out.counts.cms, 0);
  assert.equal(out.counts.quarantined, 1);
});

// ─────────────────── 15–16: drafts and stale clients ───────────────────────

test("15. drafts are isolated by patient, timepoint and schema; incompatible ones quarantine", () => {
  const ctx = { patientId: "p1", visitType: "Discharge", instrumentVersion: "oasis-e2", responseSchemaId: RESPONSE_SCHEMA_V2_CMS_E2 };
  assert.match(draftKey(ctx), /p1\|DC\|oasis-e2\|pennsync-oasis-response-v2-cms-e2$/);
  // A key cannot be built from an incomplete context — no loose keys.
  assert.equal(draftKey({ ...ctx, patientId: "" }), null);
  assert.equal(draftKey({ ...ctx, visitType: "Nope" }), null);

  assert.equal(evaluateDraft(draftPayload({ ...ctx, answers: {} }), ctx).restorable, true);
  const cases = [
    [{ answers: {} }, "unversioned"],
    [{ response_schema_id: RESPONSE_SCHEMA_V1_LEGACY }, "legacy_schema"],
    [{ response_schema_id: "pennsync-oasis-response-v9" }, "unknown_schema"],
    [draftPayload({ ...ctx, patientId: "p2", answers: {} }), "wrong_patient"],
    [draftPayload({ ...ctx, visitType: "Start of Care", answers: {} }), "wrong_timepoint"],
    [draftPayload({ ...ctx, instrumentVersion: "oasis-e1", answers: {} }), "wrong_instrument"],
  ];
  for (const [draft, reason] of cases) {
    const v = evaluateDraft(draft, ctx);
    assert.equal(v.restorable, false, reason);
    assert.equal(v.reason, reason);
    assert.ok(v.message.length > 0, `${reason} needs a message`);
    // Never destroyed: an unrestorable draft stays readable.
    assert.equal(v.recoverable, true, reason);
  }
});

test("15b. an incompatible draft is preserved until deliberately discarded", () => {
  const store = new Map();
  const storage = {
    get length() { return store.size; },
    key: (i) => [...store.keys()][i],
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  };
  const legacyCtx = { patientId: "p1", visitType: "Discharge", instrumentVersion: "oasis-e2", responseSchemaId: RESPONSE_SCHEMA_V1_LEGACY };
  saveDraft(legacyCtx, { m1830: 6 }, storage);
  const v2Ctx = { ...legacyCtx, responseSchemaId: RESPONSE_SCHEMA_V2_CMS_E2 };
  const listed = listDrafts(v2Ctx, storage);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].verdict.restorable, false);
  assert.equal(listed[0].verdict.reason, "legacy_schema");
  // Still there after listing.
  assert.equal(storage.length, 1);
  discardDraft(listed[0].key, storage);
  assert.equal(storage.length, 0);
});

test("16. a stale-client write using an obsolete schema is rejected", () => {
  // v1 is permanently non-writable; the frozen schema declares it.
  assert.equal(getResponseSchema(RESPONSE_SCHEMA_V1_LEGACY).writable, false);
  assert.equal(getResponseSchema(RESPONSE_SCHEMA_V2_CMS_E2).writable, true);
  // The builder cannot even address a v1 definition.
  assert.equal(getDefinition(RESPONSE_SCHEMA_V1_LEGACY, "m1830_cms_e2"), null);
  const stale = buildOfficialResponseRow({ definitionId: "m1830", responseValue: { code: "6" }, assessment: DC, clinicianEmail: "rn@x.com" });
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, "unknown_definition");
});

// ─────────────────── 17–18: output refusal and screening labelling ─────────

test("17. output refuses all 18 legacy forms and never prints their codes", () => {
  const rows = V1_FROZEN_IDS.map((id) => legacyRow(id, V1_LEGACY_DEFINITIONS[id].legacy_item_number, "1"));
  const out = buildOasisOutput({ ...DC, oasis_items: rows });
  assert.equal(out.counts.cms, 0, "no legacy row may reach the CMS section");
  assert.equal(out.counts.quarantined, 18);
  for (const q of out.quarantineSection.rows) {
    assert.equal(q.code, "", "a quarantined row must never carry a code");
    assert.ok(q.reason.length > 0, "a quarantined row must say why");
    assert.equal(q.warning, V1_LEGACY_WARNING);
  }
  // Unversioned rows are refused too.
  const unv = buildOasisOutput({ ...DC, oasis_items: [unversionedRow("M1830", "6")] });
  assert.equal(unv.counts.cms, 0);
  assert.equal(unv.counts.quarantined, 1);
});

test("17b. every allowed guide states PennSync is a companion reference", () => {
  const out = buildOasisOutput({ ...DC, oasis_items: [v2Row("m1830_cms_e2", "M1830", "6")] });
  assert.equal(out.disclaimer, COMPANION_DISCLAIMER);
  assert.match(out.disclaimer, /did not submit/i);
  assert.match(out.disclaimer, /does not certify/i);
  assert.deepEqual(containsBannedOutputPhrase(out.disclaimer), []);
  for (const phrase of ["Transcribe each OASIS item", "CMS compliant", "CMS approved", "CMS certified"]) {
    assert.deepEqual(containsBannedOutputPhrase(`x ${phrase} y`), [phrase]);
  }
});

test("18. screening prompts never show an M-number and never count as OASIS", () => {
  const rows = V2_SCREENING_DEFINITION_IDS.map((id) => ({
    ...v2Row(id, null, v2Definition(id).codes[0].code),
    item_source: "pennsync_screening", item_spec_version: null, item_number: null,
  }));
  const out = buildOasisOutput({ ...DC, oasis_items: rows });
  assert.equal(out.counts.screening, 3);
  assert.equal(out.counts.cms, 0, "a screening answer never counts toward OASIS");
  assert.equal(out.screeningSection.title, "PennSync screening — not an OASIS item");
  for (const r of out.screeningSection.rows) {
    assert.equal(r.code, "", "a screening answer must never print a code");
    assert.doesNotMatch(r.itemLabel, /\bM\d{4}\b/, `screening label leaked an M-number: ${r.itemLabel}`);
  }
  // A screening row wearing an M-number is refused outright.
  const wearing = { ...rows[0], item_number: "M1033" };
  assert.ok(evaluateRow(wearing, DC).reasons.includes("screening_wearing_m_number"));
  assert.equal(buildOasisOutput({ ...DC, oasis_items: [wearing] }).counts.quarantined, 1);
});

// ─────────────────── 19–21: scoring regressions ────────────────────────────

test("19. a mixed-schema pair is excluded with a visible reason and zero denominator", () => {
  const legacyA = legacyAssessment({ visitType: "Start of Care", date: "2026-05-01", rows: [legacyRow("m1830", "M1830", "6")] });
  const { included, excluded } = partitionRowsForCms(legacyA);
  assert.equal(included.length, 0);
  assert.equal(excluded.length, 1);
  assert.ok(excluded[0].reasons.includes("legacy_response_schema"));
  assert.ok(EXCLUSION_REASONS.legacy_response_schema.length > 0);
});

test("20. v2 M1830 code 6 is ratable while legacy code 6 is excluded", () => {
  const v2 = v2Assessment({ visitType: "Discharge", date: "2026-06-01", rows: [v2Row("m1830_cms_e2", "M1830", "6")] });
  assert.equal(partitionRowsForCms(v2).included.length, 1);
  assert.equal(partitionRowsForCms(v2).included[0].row.response_value.code, "6");
  const legacy = legacyAssessment({ visitType: "Discharge", date: "2026-06-01", rows: [legacyRow("m1830", "M1830", "6")] });
  assert.equal(partitionRowsForCms(legacy).included.length, 0);
  // And the two 6s mean different things — that is the whole point.
  assert.match(defFor("M1830").codes[6].label, /bathed totally by another person/);
  assert.match(V1_LEGACY_DEFINITIONS.m1830.options[6].label, /artificial opening/);
});

test("21. M2420 never names a hospital, rehab or SNF destination", () => {
  for (const c of defFor("M2420").codes) {
    const l = c.label.toLowerCase();
    for (const banned of M2420_FORBIDDEN_DESTINATIONS) {
      assert.ok(!l.includes(banned), `M2420 code ${c.code} names "${banned}": ${c.label}`);
    }
  }
  // The legacy set DID name them — which is why legacy codes are not carryable.
  assert.match(V1_LEGACY_DEFINITIONS.m2420.options[1].label, /hospital/i);
  // The real facility item is recorded as unimplemented, with the reason.
  assert.match(UNIMPLEMENTED_ITEMS.M2410.reason, /must never be repurposed/);
});

// ─────────────────── 23–24: derived data and the feature flag ──────────────

test("23. the five abbreviated items were not silently promoted", () => {
  for (const id of NOT_PROMOTED_ABBREVIATED_ITEMS) {
    assert.equal(v2Definition(id), null, `${id} must have no v2 definition`);
  }
  assert.deepEqual([...NOT_PROMOTED_ABBREVIATED_ITEMS], ["m1700", "m1810", "m1820", "m1845", "m1850"]);
});

test("24. the flag gates new v2 writes only; reading is never gated", () => {
  // The argument is an AgencySettings row. Flat fields, not a nested bag.
  assert.equal(canWriteV2Responses(null), false, "default OFF");
  assert.equal(canWriteV2Responses(undefined), false);
  assert.equal(canWriteV2Responses({}), false, "absent field is not enabled");
  assert.equal(canWriteV2Responses({ [FLAG_FIELD]: false }), false);
  assert.equal(canWriteV2Responses({ [FLAG_FIELD]: true }), true);
  // Truthy non-booleans are not "on". `"false"` is truthy.
  assert.equal(canWriteV2Responses({ [FLAG_FIELD]: "true" }), false);
  assert.equal(canWriteV2Responses({ [FLAG_FIELD]: "false" }), false);
  assert.equal(canWriteV2Responses({ [FLAG_FIELD]: 1 }), false);

  assert.equal(writesAreKilled(null), false);
  assert.equal(writesAreKilled({}), false, "absent kill switch is not engaged");
  assert.equal(writesAreKilled({ [KILL_FIELD]: true }), true);
  assert.equal(writesAreKilled({ [KILL_FIELD]: "true" }), false);

  assert.equal(canReadSchema(), true);
  // Reading both schemas works regardless of any flag.
  assert.ok(getResponseSchema(RESPONSE_SCHEMA_V1_LEGACY));
  assert.ok(getResponseSchema(RESPONSE_SCHEMA_V2_CMS_E2));
});

test("24b. both flag names are fields the AgencySettings entity actually declares", async () => {
  // The test that was missing. A gate reading a field no entity defines is not
  // a gate: it answers the same way forever. That already happened here — the
  // flags were read from `agency.feature_access`, which no entity declares, so
  // `canWriteV2Responses` could never be true (the feature was unreachable) and
  // `writesAreKilled` could never be true either (the incident kill switch
  // could not fire). Asserting the names against the schema, rather than
  // against a hand-written fixture, is what makes the two sides unable to drift.
  const { readFile } = await import("node:fs/promises");
  const raw = await readFile(new URL("../../../../base44/entities/AgencySettings.jsonc", import.meta.url), "utf8");
  const declared = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, "")).properties;

  for (const field of [FLAG_FIELD, KILL_FIELD]) {
    assert.ok(declared[field], `AgencySettings must declare ${field}`);
    assert.equal(declared[field].type, "boolean", `${field} must be a boolean`);
    assert.equal(declared[field].default, false, `${field} must default to false`);
  }

  // Neither flag may migrate into a nested bag: no entity in the app has one.
  assert.equal(declared.feature_access, undefined);
  assert.equal(declared.features, undefined);

  // The backend gate must read the same two field names off the same entity.
  const entry = await readFile(new URL("../../../../base44/functions/saveOasisResponses/entry.ts", import.meta.url), "utf8");
  assert.match(entry, new RegExp(`OASIS_V2_FLAG_FIELD = '${FLAG_FIELD}'`));
  assert.match(entry, new RegExp(`OASIS_WRITE_KILL_SWITCH_FIELD = '${KILL_FIELD}'`));
});

test("25. rollback preserves v2 data and never re-enables legacy entry", () => {
  // v2 rows stay readable and scorable; the flag is a WRITE gate, not a reader.
  const v2 = v2Assessment({ visitType: "Discharge", date: "2026-06-01", rows: [v2Row("m1830_cms_e2", "M1830", "6")] });
  assert.equal(partitionRowsForCms(v2).included.length, 1);
  // v1 can never become writable again, at any flag state.
  assert.equal(getResponseSchema(RESPONSE_SCHEMA_V1_LEGACY).writable, false);
  assert.equal(getResponseSchema(RESPONSE_SCHEMA_V1_LEGACY).status, "frozen");
});

// ─────────────────── registry invariants ───────────────────────────────────

test("the registry is append-only and every v2 definition cites a final CMS source", () => {
  assert.deepEqual([...RESPONSE_SCHEMA_IDS], [RESPONSE_SCHEMA_V1_LEGACY, RESPONSE_SCHEMA_V2_CMS_E2]);
  assert.ok(Object.isFrozen(RESPONSE_SCHEMAS));
  for (const id of V2_CMS_DEFINITION_IDS) {
    const d = v2Definition(id);
    assert.equal(d.source_verification, "verified_against_final_cms_source", id);
    assert.equal(d.source_id, "e2_all_items_2026_04_01", id);
    assert.ok(d.citation, id);
    // Clinical review is a SEPARATE approval and is still outstanding.
    assert.equal(d.clinical_review, "pending_named_sme_review", id);
    assert.equal(d.clinical_reviewed_by, null, id);
  }
});

test("published CMS meanings are preserved verbatim enough to be recognisable", () => {
  for (const { item, code, contains } of CMS_GOLDEN_MEANINGS) {
    const d = defFor(item);
    const hit = d.codes.find((c) => c.code === code);
    assert.ok(hit, `${item} has no code ${code}`);
    assert.ok(hit.label.toLowerCase().includes(contains.toLowerCase()), `${item} ${code} should mention "${contains}" — got "${hit.label}"`);
  }
});

test("shape validation refuses a value of the wrong shape for its item", () => {
  assert.equal(validateResponseValue(defFor("M1830"), { codes: ["6"] }).reason, "invalid_shape");
  assert.equal(validateResponseValue(defFor("M1740"), { code: "1" }).reason, "invalid_shape");
  assert.equal(validateResponseValue(defFor("M2401"), { code: "1" }).reason, "invalid_shape");
  assert.equal(validateResponseValue(defFor("M1830"), { code: 6 }).reason, "invalid_code", "a NUMBER is not a code");
  assert.equal(validateResponseValue(defFor("M1830"), null).reason, "invalid_shape");
  assert.equal(validateResponseValue(null, { code: "6" }).reason, "unknown_definition");
});
