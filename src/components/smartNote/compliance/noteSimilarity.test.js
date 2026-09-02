import test from "node:test";
import assert from "node:assert/strict";
import {
  SIMILARITY_BANDS,
  bandFor,
  categorySimilarity,
  identicalVitals,
  normalizeForSimilarity,
  repeatedSentences,
  reviewCopyForward,
  shingleSimilarity,
} from "./noteSimilarity.js";

const PRIOR = [
  "Patient is homebound due to severe exertional dyspnea; requires a rolling walker and one-person assist.",
  "Assessed the right heel wound: 2x3 cm, granulating, no odor or drainage noted.",
  "Dressing change performed with saline gauze to the right heel wound.",
  "Patient tolerated the dressing change without complaint or distress.",
  "Educated the patient and daughter on signs of infection; patient verbalized understanding.",
].join(" ");

// ── Tone guardrails (non-negotiable) ───────────────────────────────────────

test("no band or advisory ever alleges cloning, fraud, or misconduct", () => {
  const forbidden = /fraud|cloning|cloned|falsif|misconduct|copy[- ]?paste abuse|upcod/i;
  for (const band of SIMILARITY_BANDS) {
    assert.ok(!forbidden.test(band.label), `band label: ${band.label}`);
    assert.ok(!forbidden.test(band.advisory), `band advisory: ${band.advisory}`);
  }
});

test("the high band uses the mandated review-for-visit-specific-detail wording", () => {
  const high = SIMILARITY_BANDS.find((b) => b.id === "high");
  assert.match(high.label, /High similarity to prior documentation/);
  assert.match(high.advisory, /review for visit-specific detail/i);
});

test("the review is always advisory and never reports a block", () => {
  const result = reviewCopyForward(PRIOR, [PRIOR]);
  assert.equal(result.advisory, true);
  assert.ok(!("blocked" in result), "the similarity engine must not gate saving");
});

// ── Similarity maths ───────────────────────────────────────────────────────

test("identical text scores 1 and distinct text scores low", () => {
  assert.equal(shingleSimilarity(PRIOR, PRIOR), 1);
  const distinct = "Assessed the sacral pressure injury; measured 4x5 cm with moderate serous exudate.";
  assert.ok(shingleSimilarity(PRIOR, distinct) < 0.2, "unrelated notes must not register as copied");
});

test("similarity is symmetric and safe on empty input", () => {
  const a = "Patient tolerated the dressing change without complaint.";
  const b = "Patient tolerated the wound care without complaint or distress.";
  assert.equal(shingleSimilarity(a, b), shingleSimilarity(b, a));
  assert.equal(shingleSimilarity("", b), 0);
  assert.equal(shingleSimilarity(a, ""), 0);
  assert.equal(shingleSimilarity(null, undefined), 0);
});

test("normalization keeps numbers so repeated measurements stay visible", () => {
  assert.equal(normalizeForSimilarity("BP 148/90, HR 82!"), "bp 148/90 hr 82");
});

test("bandFor maps scores to the documented bands", () => {
  assert.equal(bandFor(0).id, "low");
  assert.equal(bandFor(0.6).id, "moderate");
  assert.equal(bandFor(0.75).id, "high");
  assert.equal(bandFor(0.95).id, "very_high");
  assert.equal(bandFor(1).id, "very_high");
});

// ── The negative case that matters most ────────────────────────────────────

test("a legitimately similar but genuinely updated note is NOT flagged high", () => {
  // Same patient, same wound, same teaching topic — but every clinical detail
  // is this visit's. A nurse doing the right thing must not be flagged.
  const today = [
    "Patient remains homebound due to COPD; today required two-person assist to reach the bathroom.",
    "Assessed the right heel wound: now 1x2 cm with 80% granulation and scant serosanguineous drainage.",
    "Irrigated with saline and applied a hydrocolloid dressing per the updated order.",
    "Patient reported mild discomfort rated 2/10 during irrigation, relieved with repositioning.",
    "Reviewed the new hydrocolloid change schedule; daughter returned the demonstration correctly.",
  ].join(" ");
  const result = reviewCopyForward(today, [PRIOR]);
  assert.ok(
    result.band.id === "low" || result.band.id === "moderate",
    `expected low/moderate, got ${result.band.id} (${result.score})`,
  );
  assert.deepEqual(result.repeatedSentences, [], "no sentence was actually copied");
});

test("a verbatim copy-forward is flagged very high with the repeated sentences shown", () => {
  const result = reviewCopyForward(PRIOR, [PRIOR]);
  assert.equal(result.band.id, "very_high");
  assert.equal(result.score, 1);
  assert.ok(result.repeatedSentences.length >= 4, "the nurse must see WHICH text repeats");
  assert.ok(result.repeatedSentences.every((r) => r.words >= 8));
  assert.ok(result.reviewPrompts.some((p) => /visit-specific/i.test(p)));
});

test("the closest prior note is identified, not just the most recent", () => {
  const unrelated = "Routine assessment. Vitals within normal limits. No concerns reported.";
  const result = reviewCopyForward(PRIOR, [unrelated, PRIOR]);
  assert.equal(result.comparedCount, 2);
  assert.equal(result.closest.index, 1);
  assert.equal(result.closest.score, 1);
});

test("note-history rows carry their date and visit id through to the finding", () => {
  const result = reviewCopyForward(PRIOR, [{ note: PRIOR, date: "2026-08-24", visit_id: "v-1" }]);
  assert.equal(result.closest.date, "2026-08-24");
  assert.equal(result.closest.visitId, "v-1");
});

// ── Repeated sentences ─────────────────────────────────────────────────────

test("short shared lines are not reported as repeated documentation", () => {
  const repeats = repeatedSentences("Vitals stable. No new concerns.", "Vitals stable. No new concerns.");
  assert.deepEqual(repeats, [], "an 8-word floor keeps ordinary short lines quiet");
});

test("a repeated sentence is tagged with the categories it belongs to", () => {
  const sentence = "Educated the patient and daughter on signs of infection; patient verbalized understanding.";
  const [repeat] = repeatedSentences(sentence, PRIOR);
  assert.ok(repeat.categories.includes("education"));
});

test("the same repeated sentence is reported once, not per occurrence", () => {
  const sentence = "Patient tolerated the dressing change without complaint or distress.";
  const repeats = repeatedSentences(`${sentence} ${sentence}`, PRIOR);
  assert.equal(repeats.length, 1);
});

// ── Category repeats ───────────────────────────────────────────────────────

test("word-for-word identical intervention wording is called out by category", () => {
  const today = "Dressing change performed with saline gauze to the right heel wound. Vitals within normal limits today.";
  const categories = categorySimilarity(today, PRIOR);
  const intervention = categories.find((c) => c.id === "intervention");
  assert.ok(intervention, "the intervention category must be compared");
  assert.equal(intervention.identical, true);

  const result = reviewCopyForward(today, [PRIOR]);
  assert.ok(result.reviewPrompts.some((p) => /Intervention wording is word-for-word identical/.test(p)));
});

test("a category absent from the prior note is not compared", () => {
  const today = "Educated the patient on a new low-sodium diet; teach-back completed successfully today.";
  const prior = "Assessed the patient. Vital signs recorded and within the expected range for her.";
  const ids = categorySimilarity(today, prior).map((c) => c.id);
  assert.ok(!ids.includes("education"), "the prior note has no education content to copy from");
});

// ── Identical vitals ───────────────────────────────────────────────────────

test("a full set of byte-identical vitals is surfaced for confirmation", () => {
  const vitals = { bp_sys: 148, bp_dia: 90, hr: 82, o2: 95 };
  const out = identicalVitals(vitals, [{ ...vitals }]);
  assert.equal(out.repeated, true);
  assert.equal(out.matchedCount, 1);
  assert.deepEqual(out.keys, ["bp_sys", "bp_dia", "hr", "o2"]);
});

test("one or two matching readings are NOT reported — a stable patient repeats values", () => {
  assert.equal(identicalVitals({ hr: 82, o2: 95 }, [{ hr: 82, o2: 95 }]).repeated, false);
  assert.equal(identicalVitals({ bp_sys: 148, bp_dia: 90, hr: 82 }, [{ bp_sys: 148, bp_dia: 90, hr: 90 }]).repeated, false);
});

test("identical vitals prompt asks to confirm, never accuses", () => {
  const vitals = { bp_sys: 148, bp_dia: 90, hr: 82, o2: 95 };
  const result = reviewCopyForward(PRIOR, ["Different prior note entirely."], {
    currentVitals: vitals,
    priorVitals: [{ ...vitals }],
  });
  const prompt = result.reviewPrompts.find((p) => /vital signs/i.test(p));
  assert.match(prompt, /confirm these readings were taken today/i);
});

test("missing vitals never throw", () => {
  assert.equal(identicalVitals(null, null).repeated, false);
  assert.equal(identicalVitals(undefined, [undefined]).repeated, false);
});

// ── Degenerate input ───────────────────────────────────────────────────────

test("no prior notes yields a clean, non-alarming result", () => {
  const result = reviewCopyForward(PRIOR, []);
  assert.equal(result.score, 0);
  assert.equal(result.band.id, "low");
  assert.equal(result.comparedCount, 0);
  assert.equal(result.closest, null);
  assert.deepEqual(result.reviewPrompts, []);
});

test("empty or blank prior notes are ignored rather than compared", () => {
  const result = reviewCopyForward(PRIOR, ["", "   ", { note: "" }]);
  assert.equal(result.comparedCount, 0);
  assert.equal(result.score, 0);
});

test("an empty draft is never flagged", () => {
  assert.equal(reviewCopyForward("", [PRIOR]).score, 0);
  assert.equal(reviewCopyForward(null, [PRIOR]).band.id, "low");
});
