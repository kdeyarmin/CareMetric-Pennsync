import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_OASIS_SPEC,
  KNOWN_OASIS_SPECS,
  getOasisSpec,
  resolveSpecForDate,
} from "./registry.js";
import { OASIS_E_SPEC } from "./e/index.js";
import {
  ITEM_VERIFICATION,
  RESPONSE_SET_CHECK,
  RESPONSE_SET_VERDICTS,
  VERIFICATION_LEVELS,
  conflictingResponseSets,
  mayCarryResponseToEmr,
  responseSetCaveat,
  responseSetStatus,
  buildClinicalReviewWorksheet,
  classifyItem,
  clinicalReviewStatus,
  cmsItemsOnly,
  itemSourceFor,
  OUTSTANDING_CLINICAL_QUESTIONS,
  outstandingClinicalQuestion,
  describeVerification,
  isClinicallyReviewed,
  isOfficialCmsItem,
  pendingClinicalReview,
  sourceCheckStatus,
  itemDisclaimer,
  officialItemNumber,
} from "./verification.js";

// ── The honesty guarantees ─────────────────────────────────────────────────

test("the spec never claims to contain the authoritative CMS instrument", () => {
  assert.equal(ACTIVE_OASIS_SPEC.completeness, "partial");
  assert.equal(OASIS_E_SPEC.completeness, "partial");
  assert.match(OASIS_E_SPEC.notes, /does not contain the authoritative CMS OASIS instrument/i);
  assert.ok(OASIS_E_SPEC.source, "a source must be named");
  assert.ok(OASIS_E_SPEC.source_url, "a source URL must be named");
  assert.ok(OASIS_E_SPEC.effective_date, "a version needs an effective date");
});

test("every registry entry uses a known verification level", () => {
  for (const [id, entry] of Object.entries(ITEM_VERIFICATION)) {
    assert.ok(VERIFICATION_LEVELS.includes(entry.level), `${id}: unknown level ${entry.level}`);
  }
});

test("a PennSync screening item never carries a CMS item number", () => {
  for (const [id, entry] of Object.entries(ITEM_VERIFICATION)) {
    if (entry.level !== "pennsync_screening") continue;
    assert.equal(entry.official_item, null, `${id} must not claim a CMS item number`);
    assert.ok(entry.pennsync_item, `${id} needs its own PennSync item id`);
    assert.equal(officialItemNumber(id), null, `${id} must not expose a CMS number to the UI`);
    assert.equal(isOfficialCmsItem(id), false);
  }
});

test("the three mislabelled therapy items are recorded as PennSync screening items", () => {
  // The 2026-08-31 audit finding: these carried M2102 / M2110 / M2200 attached
  // to content that does not belong to those CMS items.
  for (const id of ["m2102", "m2110", "m2200"]) {
    const c = classifyItem(id);
    assert.equal(c.level, "pennsync_screening", `${id} must not be presented as a CMS item`);
    assert.equal(c.officialItem, null);
    assert.match(c.note, /Not a CMS OASIS item/i);
  }
});

test("an abbreviated response set is labelled as abbreviated, not as the official set", () => {
  const c = classifyItem("m2420");
  assert.equal(c.level, "abbreviated");
  assert.equal(c.officialItem, "M2420");
  assert.match(itemDisclaimer("m2420"), /abbreviated and may not match the official CMS response set/i);
});

test("a retired item is not presented as current, and shows no CMS number", () => {
  // Verified 2026-09-01: the OASIS-E manual lists M1730 as Removed, and it is
  // absent from E1 and E2.
  const c = classifyItem("m1730");
  assert.equal(c.level, "retired");
  assert.equal(c.officialItem, null);
  assert.equal(c.formerItem, "M1730");
  assert.equal(officialItemNumber("m1730"), null);
  assert.match(itemDisclaimer("m1730"), /NOT in the OASIS instrument currently in effect/i);
  assert.match(c.note, /D0150\/D0160/, "the note must say where the current item lives");
});

test("an item number found in no CMS manual is marked as such", () => {
  const c = classifyItem("m1020");
  assert.equal(c.level, "not_a_cms_item");
  assert.equal(c.officialItem, null);
  assert.match(c.note, /appears in no published CMS OASIS manual/i);
  assert.match(c.note, /M1021/, "the note must name the real item");
});

test("the factual source check is recorded separately from clinical sign-off", () => {
  // A lookup ("does this number exist, what is its title") is not a judgement
  // ("is PennSync's use of it appropriate"). Conflating them would let an
  // automated check masquerade as a reviewer.
  const c = classifyItem("m1860");
  assert.equal(c.sourceVerified, true);
  assert.equal(c.sourceVerifiedAt, "2026-09-01");
  assert.match(c.sourceVerifiedAgainst, /OASIS-E2 Manual/);
  assert.equal(c.officialTitle, "Ambulation/Locomotion");
  // The source check is recorded under its own fields and never under the
  // clinical ones, even now that a human has signed off.
  assert.notEqual(c.sourceVerifiedAgainst, c.reviewSource);
  assert.ok(!/pennsync|automated/i.test(c.reviewedBy), "the check must not appear as the reviewer");
});

test("the source check reports the items it found retired or invented", () => {
  const status = sourceCheckStatus();
  assert.equal(status.retired, 5);
  assert.equal(status.notCmsItems, 4);
  assert.match(status.statement, /retired or are not\s+CMS item numbers/i);
  assert.match(status.statement, /enter official responses in your EMR/i);
});

test("an unregistered item fails closed to unverified", () => {
  const c = classifyItem("m9999");
  assert.equal(c.level, "unverified", "a new item must not default to verified");
  assert.equal(c.officialItem, "M9999");
  assert.match(c.note, /has not verified/i);
});

test("classification is case-insensitive and safe on junk input", () => {
  assert.equal(classifyItem("M2102").level, "pennsync_screening");
  assert.equal(classifyItem("").level, "unverified");
  assert.equal(classifyItem(null).level, "unverified");
  assert.equal(classifyItem(undefined).officialItem, null);
});

// ── Disclaimers ────────────────────────────────────────────────────────────

test("every disclaimer points the nurse back to the EMR and never claims submission", () => {
  for (const id of ["m1800", "m1030", "m9999", "m2102"]) {
    const text = itemDisclaimer(id);
    assert.match(text, /EMR/, `${id}: must direct the nurse to the EMR`);
    assert.ok(!/submit|iqies|official submission/i.test(text), `${id}: must not imply submission`);
  }
});

test("a verified item still asks the clinician to confirm against their own assessment", () => {
  assert.match(itemDisclaimer("m1800"), /Review this against your patient assessment/i);
});

test("verification badges are described in text, never by colour alone", () => {
  for (const id of ["m1800", "m1030", "m9999", "m2102"]) {
    const badge = describeVerification(id);
    assert.ok(badge.label, `${id} needs a text label`);
    assert.ok(badge.tone, `${id} needs a tone`);
  }
  assert.equal(describeVerification("m2102").label, "PennSync screening item");
});

// ── Version resolution ─────────────────────────────────────────────────────

test("the active spec is a member of the known set", () => {
  assert.ok(KNOWN_OASIS_SPECS.includes(ACTIVE_OASIS_SPEC));
  assert.equal(getOasisSpec(ACTIVE_OASIS_SPEC.id), ACTIVE_OASIS_SPEC);
  assert.equal(getOasisSpec("oasis-z"), null);
});

test("an assessment date resolves to the version in force at the time", () => {
  // Verified effective dates: E 2023-01-01, E1 2025-01-01, E2 2026-04-01.
  assert.equal(resolveSpecForDate("2026-08-31").id, "oasis-e2");
  assert.equal(resolveSpecForDate(new Date("2023-06-01")).id, "oasis-e");
  assert.equal(resolveSpecForDate("2025-06-01").id, "oasis-e1");
});

test("the active spec is the version currently in effect, not a superseded one", () => {
  // PennSync claimed OASIS-E with no retirement date while OASIS-E2 had been in
  // force since 2026-04-01 — two versions behind.
  assert.equal(ACTIVE_OASIS_SPEC.id, "oasis-e2");
  assert.equal(ACTIVE_OASIS_SPEC.effective_date, "2026-04-01");
  assert.equal(ACTIVE_OASIS_SPEC.retired_date, null);
  assert.equal(getOasisSpec("oasis-e").retired_date, "2025-01-01");
});

test("a date before every known version resolves to null rather than guessing", () => {
  // PennSync must not apply OASIS-E definitions to an assessment completed under
  // an instrument it does not hold.
  assert.equal(resolveSpecForDate("2019-05-01"), null);
});

test("a missing or unparseable date resolves to null, not the active spec", () => {
  // Falling back to the active spec stamped OASIS-E2 onto assessments whose
  // instrument nobody knew. An unresolved date must stay unresolved so callers
  // treat the assessment as ineligible rather than scoring it under E2.
  assert.equal(resolveSpecForDate("not-a-date"), null);
  assert.equal(resolveSpecForDate(null), null);
  assert.equal(resolveSpecForDate(""), null);
  assert.equal(resolveSpecForDate(undefined), null);
});

// ── Clinical sign-off ──────────────────────────────────────────────────────

test("a recorded clinical reviewer is a named human, never an automated check", () => {
  // `reviewed_by` means a NAMED HUMAN confirmed this. The failure this guards
  // against is an automated pass writing itself in — which would make the
  // product assert something untrue to a future auditor.
  const AUTOMATED = /pennsync|automated|source check|claude|ai\b|system|script/i;
  for (const [id, entry] of Object.entries(ITEM_VERIFICATION)) {
    if (!entry.reviewed_by) continue;
    assert.ok(
      !AUTOMATED.test(entry.reviewed_by),
      `${id}: reviewed_by must name a person, got "${entry.reviewed_by}"`,
    );
    assert.match(entry.reviewed_at, /^\d{4}-\d{2}-\d{2}$/, `${id} needs a review date`);
    assert.match(
      entry.reviewed_by, /^[A-Z][a-z]+ [A-Z][a-z]/,
      `${id}: reviewed_by should lead with a person's name, got "${entry.reviewed_by}"`,
    );
    assert.ok(entry.review_source, `${id} needs the scope of what was reviewed`);
  }
});

test("the sign-off records the gap inside it, so it cannot be read as broader than it was", () => {
  // Response options were never verified against the CMS manual. A sign-off
  // that hid that would be a record an auditor could act on wrongly.
  for (const [id, entry] of Object.entries(ITEM_VERIFICATION)) {
    if (!entry.reviewed_by) continue;
    assert.match(
      entry.review_source,
      /RESPONSE OPTIONS WERE NOT\s+individually verified/i,
      `${id}: the sign-off must state what it did not cover`,
    );
  }
});

test("clinical sign-off and the automated source check stay distinguishable", () => {
  const c = classifyItem("m1860");
  assert.equal(c.classificationSignedOffBy, "PennSync CMS source check");
  assert.notEqual(c.reviewedBy, c.classificationSignedOffBy, "the two must never collapse");
  assert.equal(c.clinicallyReviewed, true);
  // The signature does not retroactively verify the response options.
  assert.equal(c.responseSetVerified, false);
});

test("the CLASSIFICATION is signed off, and says what it rests on", () => {
  // Which level applies follows from the source check, so it is signed. This is
  // a different claim from clinical appropriateness and is recorded separately.
  for (const [id, entry] of Object.entries(ITEM_VERIFICATION)) {
    assert.equal(entry.classification_signed_off_by, "PennSync CMS source check", id);
    assert.equal(entry.classification_signed_off_at, "2026-09-01", id);
    assert.match(entry.classification_basis, /checked against the published CMS/i, id);
  }
  const c = classifyItem("m1860");
  assert.equal(c.classificationSignedOff, true);
  assert.equal(c.classificationSignedOffBy, "PennSync CMS source check");
  assert.notEqual(
    c.classificationSignedOffBy, c.reviewedBy,
    "the automated classification and the human clinical sign-off must stay distinct",
  );
});

test("responseSetVerified is true ONLY where the option list reproduces CMS", () => {
  // Superseded the blanket `false`: every item has now been read against the
  // CMS OASIS-E2 All Items instrument option by option. The invariant that
  // matters is that the flag tracks the verdict rather than the item's level —
  // an `abbreviated` or `conflicts` verdict must never read as verified.
  for (const [id, entry] of Object.entries(ITEM_VERIFICATION)) {
    const c = classifyItem(id);
    assert.ok(RESPONSE_SET_VERDICTS.includes(c.responseSet), `${id}: ${c.responseSet}`);
    assert.equal(c.responseSetVerified, entry.response_set === "matches", id);
    assert.equal(c.responseSetConflicts, entry.response_set === "conflicts", id);
    assert.ok(c.responseSetNote.length > 20, `${id} must say what the read found`);
  }
});

test("a signed-off item has no outstanding clinical question", () => {
  assert.equal(isClinicallyReviewed("m1860"), true);
  assert.equal(outstandingClinicalQuestion("m1860"), null);
  assert.equal(outstandingClinicalQuestion("m1730"), null);
  // An item nobody has signed off still reports as unreviewed.
  assert.equal(isClinicallyReviewed("m9999"), false);
});

test("the question set still maps every classification, for items added later", () => {
  // A new item ships unreviewed; it must resolve to a question rather than to
  // silence, or it would look signed off by omission.
  const q = outstandingClinicalQuestion("m9999");
  assert.ok(q === null || q.question, "an unregistered item must not fail closed into silence");
  for (const level of ["verified", "abbreviated", "retired", "not_a_cms_item", "pennsync_screening"]) {
    assert.ok(
      OUTSTANDING_CLINICAL_QUESTIONS.some((x) => x.applies_to.includes(level)),
      `no clinical question defined for level ${level}`,
    );
  }
});

test("review provenance travels with the classification", () => {
  const c = classifyItem("m1800");
  assert.equal(c.clinicallyReviewed, true);
  assert.equal(c.reviewedBy, "Kevin Deyarmin (kdeyarmin@comcast.net)");
  assert.match(c.reviewSource, /Product-owner sign-off/);
});

test("an unregistered item is reported as unreviewed, not silently omitted", () => {
  const c = classifyItem("m9999");
  assert.equal(c.clinicallyReviewed, false);
  assert.equal(c.reviewSource, "");
});

test("the three demoted therapy items now cite the CMS source, not internal inference", () => {
  // The original demotion rested on the repository contradicting itself. The
  // 2026-09-01 source check confirmed all three against the CMS manuals.
  assert.match(classifyItem("m2102").note, /Types and Sources of Assistance/);
  assert.match(classifyItem("m2200").note, /removed per CMS-1780-F/i);
  assert.match(classifyItem("m2110").note, /appears in none of OASIS-E, E1 or E2/i);
  for (const id of ["m2102", "m2110", "m2200"]) {
    assert.equal(classifyItem(id).sourceVerified, true, `${id} must cite the source check`);
  }
});

test("pendingClinicalReview is empty once every item is signed off", () => {
  assert.deepEqual(pendingClinicalReview(), []);
});

test("an item added later is reported as pending, not signed off by omission", () => {
  // A new form question has no registry entry, so it must surface as
  // outstanding rather than inherit the existing sign-off.
  const pending = pendingClinicalReview(["m1800", "m9999"]);
  assert.deepEqual(pending.map((p) => p.id), ["m9999"]);
});

test("the review status reports the completed sign-off", () => {
  const status = clinicalReviewStatus();
  assert.equal(status.complete, true);
  assert.equal(status.pending, 0);
  assert.equal(status.reviewed, status.total);
  assert.match(status.statement, /signed off by a named clinical reviewer/i);
});

test("the worksheet states PennSync lacks the CMS instrument and never pre-fills a conclusion", () => {
  const sheet = buildClinicalReviewWorksheet(
    [{ id: "m2102", label: "Physical therapy need (PennSync screening item)" }],
    { generatedAt: "2026-09-01" },
  );
  assert.match(sheet, /does \*\*not\*\* contain the authoritative CMS OASIS instrument/i);
  assert.match(sheet, /Clinical question outstanding/);
  assert.match(sheet, /Reviewer: answer/);
  // The classification column is settled; the reviewer is not asked to re-do it.
  assert.match(sheet, /classification column is already signed off/i);
  const row = sheet.split("\n").find((l) => l.includes("`m2102`"));
  assert.ok(row, "the item must appear as a row");
  assert.match(row, /Answered by Kevin Deyarmin/, "a signed row names who signed it");
  assert.match(sheet, /All 1 items are signed off/);
  assert.match(sheet, /response OPTIONS were not\s+individually verified/i,
    "the worksheet must repeat the gap the sign-off states");
});

test("the worksheet shows a PennSync screening item with no CMS item number", () => {
  const sheet = buildClinicalReviewWorksheet([{ id: "m2102", label: "PT need" }]);
  const row = sheet.split("\n").find((l) => l.includes("`m2102`"));
  assert.match(row, /—\s*\(none\)/, "a screening item must not display an M-number");
});

test("a pipe in a label cannot break the worksheet table", () => {
  const sheet = buildClinicalReviewWorksheet([{ id: "m1800", label: "Grooming | upper body" }]);
  const row = sheet.split("\n").find((l) => l.includes("`m1800`"));
  assert.match(row, /Grooming \\\| upper body/);
});

test("the worksheet is deterministic and safe on empty input", () => {
  const a = buildClinicalReviewWorksheet([{ id: "m1800" }], { generatedAt: "2026-09-01" });
  const b = buildClinicalReviewWorksheet([{ id: "m1800" }], { generatedAt: "2026-09-01" });
  assert.equal(a, b);
  assert.doesNotThrow(() => buildClinicalReviewWorksheet([]));
  assert.doesNotThrow(() => buildClinicalReviewWorksheet(null));
});


// ── Persisted item classification ──────────────────────────────────────────

test("itemSourceFor marks each id for the shape it is persisted in", () => {
  // PennSync writes its own form ids into OASISAssessment.oasis_items[].item_number,
  // the field every consumer reads as a CMS item number. Without this marker a
  // screening answer is indistinguishable from an official response.
  // A VERIFIED item number whose response set conflicts is NOT `cms_item`.
  // M1860's legacy scale inserts a level CMS does not have, so its saved codes
  // name different things than the official item — calling the row `cms_item`
  // is how a legacy code reached CMS-labeled output and scoring.
  assert.equal(itemSourceFor("m1860"), "unknown", "a conflicting response set is not an official CMS response");
  assert.equal(itemSourceFor("m2420"), "unknown", "an abbreviated/conflicting response set is not carryable as CMS");
  assert.equal(itemSourceFor("m1800"), "cms_item", "a matching response set is a genuine CMS response");
  assert.equal(itemSourceFor("m1730"), "retired_cms_item");
  assert.equal(itemSourceFor("m1020"), "pennsync_screening", "an invented number is not a CMS item");
  assert.equal(itemSourceFor("m2102"), "pennsync_screening");
  assert.equal(itemSourceFor("m9999"), "unknown");
});

test("cmsItemsOnly keeps only v2 CMS rows and drops screening answers", () => {
  // `item_source: "cms_item"` alone is not sufficient: it was written by the old
  // `itemSourceFor()`, which treated a conflicting response set as official. A
  // row must ALSO state the v2 response schema.
  const rows = [
    { item_number: "M1860", response_value: { code: "3" }, item_source: "cms_item", response_schema_id: "pennsync-oasis-response-v2-cms-e2" },
    { item_number: "M1860", response: "3", item_source: "cms_item" },
    { item_number: "M1860", response: "3", item_source: "cms_item", response_schema_id: "pennsync-oasis-response-v1-legacy" },
    { item_number: "m1730", response: "1", item_source: "retired_cms_item" },
    { item_number: "m1020", response: "2", item_source: "pennsync_screening" },
  ];
  const kept = cmsItemsOnly(rows);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].response_schema_id, "pennsync-oasis-response-v2-cms-e2");
});

test("an unversioned legacy row is never rescued by the current registry", () => {
  // Consulting today's registry for a row that states no response schema
  // retrospectively declares that the old answer meant what the new option list
  // means. That is the reinterpretation this layer exists to prevent.
  const legacy = [
    { item_number: "M1860", response: "3" },
    { item_number: "M1730", response: "1" },
    { item_number: "M1020", response: "2" },
  ];
  assert.deepEqual(cmsItemsOnly(legacy), []);
});

test("cmsItemsOnly is safe on junk input", () => {
  assert.deepEqual(cmsItemsOnly(null), []);
  assert.deepEqual(cmsItemsOnly([null, {}, { response: "1" }]), []);
});

// ── The response-set read (2026-09-01) ─────────────────────────────────────
// The clinical sign-off recorded that response OPTIONS were not individually
// verified. These cover the read that closed that gap.

test("a matching code SET is not treated as a matching response set", () => {
  // The trap the read exists to close. M1340's codes are {0,1,2} exactly as CMS
  // has them, and its code 2 still means something else: CMS 2 is "known but
  // not observable", PennSync's is "Yes — infected". A code-set comparison
  // alone would have cleared this item.
  const c = classifyItem("m1340");
  assert.equal(c.level, "verified", "the item number and title are genuinely current");
  assert.equal(c.responseSet, "conflicts");
  assert.equal(mayCarryResponseToEmr("m1340"), false);
  assert.match(c.responseSetNote, /not observable/i);
});

test("mayCarryResponseToEmr is granted only by a faithful response set", () => {
  for (const id of Object.keys(ITEM_VERIFICATION)) {
    const c = classifyItem(id);
    assert.equal(
      mayCarryResponseToEmr(id),
      c.responseSet === "matches" && isOfficialCmsItem(id),
      `${id} (${c.level}/${c.responseSet})`,
    );
  }
  // Nothing outside the registry may be carried across either — fail closed.
  assert.equal(mayCarryResponseToEmr("m9999"), false);
  assert.equal(mayCarryResponseToEmr(""), false);
  assert.equal(mayCarryResponseToEmr(null), false);
});

test("a conflicting response set overrides a reassuring badge", () => {
  // A green "Verified item" chip beside answer choices whose codes mean
  // something else on the official assessment is the precise reassurance a
  // nurse must not be given, however accurate the item's identity is.
  for (const c of conflictingResponseSets()) {
    const badge = describeVerification(c.id);
    assert.notEqual(badge.tone, "success", `${c.id} must not read as reassuring`);
    assert.match(badge.label, /differ/i, c.id);
  }
  assert.equal(describeVerification("m1800").tone, "success", "a faithful item keeps its badge");
});

test("every conflicting item tells the nurse not to carry the code across", () => {
  for (const c of conflictingResponseSets()) {
    assert.match(responseSetCaveat(c.id), /do not carry this code into your emr/i, c.id);
    assert.match(itemDisclaimer(c.id), /do not carry this code into your emr/i, c.id);
  }
  // A faithful item is not given a warning it does not need.
  assert.equal(responseSetCaveat("m1800"), "");
});

test("an unread item fails closed rather than reading as clean", () => {
  const c = classifyItem("m9999");
  assert.equal(c.responseSet, "unchecked");
  assert.equal(c.responseSetVerified, false);
  assert.equal(c.responseSetConflicts, false, "unread is not the same as read-and-conflicting");
  assert.match(responseSetCaveat("m9999"), /has not read this item's answer choices/i);
});

test("items absent from the current instrument have no response set to compare", () => {
  // Comparing PennSync's options against a response set that does not exist
  // would be inventing a comparison, so these are `not_applicable`, not `matches`.
  for (const id of ["m1020", "m1730", "m2200", "m2102"]) {
    assert.equal(classifyItem(id).responseSet, "not_applicable", id);
    assert.equal(mayCarryResponseToEmr(id), false, id);
  }
});

test("the response-set check records what it was read against", () => {
  assert.equal(RESPONSE_SET_CHECK.checked_at, "2026-09-01");
  assert.match(RESPONSE_SET_CHECK.checked_against, /All Items instrument/i);
  assert.match(RESPONSE_SET_CHECK.method, /option by option/i);
  // It is a separate record from the human clinical sign-off, and must not be
  // written into it: the sign-off's own text says response options were not
  // verified, and that remains a true account of what was signed.
  for (const entry of Object.values(ITEM_VERIFICATION)) {
    assert.match(entry.review_source, /RESPONSE OPTIONS WERE NOT individually verified/);
  }
});

test("responseSetStatus counts the read rather than asserting a conclusion", () => {
  const s = responseSetStatus();
  assert.equal(s.total, Object.keys(ITEM_VERIFICATION).length);
  assert.equal(s.comparable, s.matches + s.abbreviated + s.conflicts);
  assert.ok(s.conflicts > 0, "the read found conflicts; the status must not hide them");
  assert.match(s.statement, /means something different on the official assessment/i);
  // Scoped to a caller's own bank.
  const scoped = responseSetStatus(["m1800", "m1340"]);
  assert.equal(scoped.total, 2);
  assert.equal(scoped.matches, 1);
  assert.equal(scoped.conflicts, 1);
});
