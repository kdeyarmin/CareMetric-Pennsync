import test from "node:test";
import assert from "node:assert/strict";
import {
  splitSentences,
  extractVitals,
  extractNumbersAndMeasurements,
  extractMedications,
  getSentencesContaining,
  formatVitalsSentence,
  toCanonicalVitalSigns,
  extractCanonicalVitalsFromText,
} from "./factExtraction.js";
import { valueGuard } from "./valueGuard.js";

test("splitSentences breaks on punctuation and newlines, stripping bullets", () => {
  const out = splitSentences("• BP 148/90\n- taught meds. Patient stable!");
  assert.deepEqual(out, ["BP 148/90", "taught meds", "Patient stable"]);
});

test("extractVitals parses BP, HR, and O2", () => {
  const v = extractVitals("BP 148/90, HR 82, O2 95% RA");
  assert.equal(v.bp_sys, 148);
  assert.equal(v.bp_dia, 90);
  assert.equal(v.hr, 82);
  assert.equal(v.o2, 95);
});

test("extractVitals tolerates a colon between the label and value (HR/temp/RR/weight)", () => {
  // Regression: HR/temp/RR/weight only matched without a colon, while BP/O2 did,
  // so the very common "HR: 82" / "Temp: 101.5" EMR style dropped the value
  // entirely (chart data loss + missed escalation/trend detection).
  assert.equal(extractVitals("HR: 82").hr, 82);
  assert.equal(extractVitals("Heart Rate: 110").hr, 110);
  assert.equal(extractVitals("Temp: 101.5").temp, 101.5);
  assert.equal(extractVitals("Temperature: 98.6").temp, 98.6);
  assert.equal(extractVitals("RR: 22").rr, 22);
  assert.equal(extractVitals("Respiratory Rate: 18").rr, 18);
  assert.equal(extractVitals("Weight: 180").weight, 180);
  // The bare single-letter "T 99.1" space form still parses as a temperature.
  assert.equal(extractVitals("T 99.1").temp, 99.1);
});

test("colon support does not misread generic 'T:'/'...rr:' labels as vitals", () => {
  // The colon was added to Temp/Temperature/RR full spellings only — a bare "T:"
  // list label or a word ending in 'rr' before a colon must NOT become a vital.
  assert.equal(extractVitals("Item T: 98 reviewed").temp, undefined);
  assert.equal(extractVitals("List T: 100 entries total").temp, undefined);
  assert.equal(extractVitals("Room T: 95 degrees ambient").temp, undefined);
  assert.equal(extractVitals("corr: 5 days").rr, undefined);
  assert.equal(extractVitals("burr: 12").rr, undefined);
});

test("extractVitals reads O2 saturation with the filler words nurses actually write", () => {
  // Regression: only the bare "O2 85%" form matched, so the severe-hypoxia
  // escalation was silently missed for "O2 sat 85%", "SpO2 of 86%", etc.
  assert.equal(extractVitals("O2 sat 85% on room air").o2, 85);
  assert.equal(extractVitals("O2 saturation 84%").o2, 84);
  assert.equal(extractVitals("SpO2 of 86%").o2, 86);
  assert.equal(extractVitals("O2 sat: 90%").o2, 90);
  assert.equal(extractVitals("pulse ox 88%").o2, 88);
  // Must not false-match an oxygen-flow-rate mention with no saturation percent.
  assert.equal(extractVitals("oxygen therapy at 2 L per minute").o2, undefined);
});

test("extractNumbersAndMeasurements captures unit-bearing values only", () => {
  const tokens = extractNumbersAndMeasurements("BP 148/90, O2 95%, wound 2x3 cm, gave 500 mg, pain 3/10");
  assert.ok(tokens.includes("148/90"));
  assert.ok(tokens.includes("95%"));
  assert.ok(tokens.includes("2x3cm"));
  assert.ok(tokens.includes("500mg"));
  assert.ok(tokens.includes("3/10"));
});

test("extractNumbersAndMeasurements ignores bare prose counts", () => {
  const tokens = extractNumbersAndMeasurements("seen 2 times this week, 3 children present");
  assert.equal(tokens.length, 0);
});

test("extractMedications finds known medications by canonical name", () => {
  const meds = extractMedications("Patient takes Metformin and Furosemide daily.");
  assert.ok(meds.includes("Metformin"));
  assert.ok(meds.includes("Furosemide"));
});

test("extractMedications returns empty when no known meds present", () => {
  assert.deepEqual(extractMedications("Patient ambulated in the hallway."), []);
});

test("getSentencesContaining returns the matching sentence", () => {
  const hits = getSentencesContaining("Patient stable. Wound to right heel is granulating.", /wound/i);
  assert.equal(hits.length, 1);
  assert.match(hits[0], /right heel/);
});


// ── Regression tests for audit fixes ────────────────────────────────────────

test("getSentencesContaining is deterministic with a global regex (no lastIndex carry-over)", () => {
  const text = "Patient uses a walker. The walker is new. A walker helps mobility. Walker stored at home.";
  // All four sentences mention a walker; a stateful global regex (advancing
  // RegExp.lastIndex across .test() calls) would skip some of them.
  assert.equal(getSentencesContaining(text, /walker/gi).length, 4);
  const re = /walker/gi;
  assert.deepEqual(getSentencesContaining(text, re), getSentencesContaining(text, re));
});

test("getSentencesContaining returns ALL matches with a global-flag pattern", () => {
  const text = "Wound to heel. Dressing changed today. Patient stable. Incision clean. Vitals normal.";
  const hits = getSentencesContaining(text, /wound|dressing|incision/gi);
  // The /g flag must not make .test() stateful and skip matching sentences.
  assert.equal(hits.length, 3);
  assert.ok(hits.some((s) => /Dressing changed today/.test(s)));
  assert.ok(hits.some((s) => /Incision clean/.test(s)));
});

test("extractVitals 't' shorthand does not match the trailing t of other words", () => {
  assert.equal(extractVitals("weight 150").temp, undefined);
  assert.equal(extractVitals("last visit 98.6").temp, undefined);
  assert.equal(extractVitals("T 99.1").temp, 99.1);
});

test("extractVitals does not read a date as a blood pressure", () => {
  const v = extractVitals("follow up 11/20 for recheck");
  assert.equal(v.bp_sys, undefined);
  assert.equal(v.bp_dia, undefined);
});

test("extractVitals rejects a leading-digit BP typo instead of truncating it", () => {
  // "BP 1148/90" must not be silently read as systolic 148.
  const v = extractVitals("BP 1148/90");
  assert.equal(v.bp_sys, undefined);
  assert.equal(v.bp_dia, undefined);
  // A normal labeled reading still parses.
  assert.equal(extractVitals("BP 148/90").bp_sys, 148);
});

test("temperature with and without the degree sign normalize to one token", () => {
  const withSign = extractNumbersAndMeasurements("Temperature was 98.6°F");
  const without = extractNumbersAndMeasurements("Temp 98.6 F");
  assert.deepEqual(withSign, without);
});

test("extractMedications does not return case-duplicated canonical names", () => {
  const meds = extractMedications("patient on atorvastatin");
  const lowered = meds.map((m) => m.toLowerCase());
  assert.equal(new Set(lowered).size, lowered.length);
});

// ── formatVitalsSentence (structured vitals → note source) ──────────────────

test("formatVitalsSentence returns empty when no vitals are captured", () => {
  assert.equal(formatVitalsSentence(null), "");
  assert.equal(formatVitalsSentence({}), "");
  assert.equal(formatVitalsSentence({ blood_pressure_systolic: null, heart_rate: "" }), "");
});

test("formatVitalsSentence formats the canonical vital_signs shape", () => {
  const s = formatVitalsSentence({
    blood_pressure_systolic: 148, blood_pressure_diastolic: 90,
    heart_rate: 82, respiratory_rate: 16, oxygen_saturation: 95,
    temperature: 98.6, pain_level: 3,
  });
  assert.match(s, /BP 148\/90 mmHg/);
  assert.match(s, /HR 82 bpm/);
  assert.match(s, /RR 16 breaths\/min/);
  assert.match(s, /O2 95%/);
  assert.match(s, /Temp 98\.6°F/);
  assert.match(s, /pain 3\/10/);
});

test("formatVitalsSentence omits BP unless both systolic and diastolic are present", () => {
  assert.equal(formatVitalsSentence({ blood_pressure_systolic: 120 }), "");
  assert.match(formatVitalsSentence({ blood_pressure_systolic: 120, blood_pressure_diastolic: 80 }), /BP 120\/80/);
});

test("formatVitalsSentence includes a genuine pain score of 0", () => {
  assert.match(formatVitalsSentence({ pain_level: 0 }), /pain 0\/10/);
});

test("formatVitalsSentence output survives the value-guard against itself", () => {
  // The whole point of injecting vitals this way: the deterministic sentence is
  // whitelisted as source material, so every value it contains must trace back
  // to that same source. A token-shape mismatch here would flag captured vitals
  // as hallucinated.
  const samples = [
    { blood_pressure_systolic: 148, blood_pressure_diastolic: 90, heart_rate: 82, oxygen_saturation: 95, temperature: 98.6, respiratory_rate: 16, pain_level: 3 },
    { blood_pressure_systolic: 120, blood_pressure_diastolic: 80 },
    { oxygen_saturation: 88, pain_level: 7 },
    { temperature: 101, heart_rate: 110 },
  ];
  for (const v of samples) {
    const sentence = formatVitalsSentence(v);
    assert.equal(valueGuard(sentence, sentence).ok, true, `value-guard rejected its own vitals sentence: ${sentence}`);
  }
});

// ── toCanonicalVitalSigns (StructuredNoteDrafter legacy shape → canonical) ──

test("toCanonicalVitalSigns maps the legacy drafter field names to canonical keys", () => {
  const out = toCanonicalVitalSigns({
    bp_systolic: "148", bp_diastolic: "90", heart_rate: "82", resp_rate: "16",
    o2_sat: "95", temperature: "98.6", pain_level: "3", weight: "180",
  });
  assert.deepEqual(out, {
    blood_pressure_systolic: 148, blood_pressure_diastolic: 90, heart_rate: 82,
    respiratory_rate: 16, oxygen_saturation: 95, temperature: 98.6, pain_level: 3,
  });
  // weight is intentionally not part of the canonical vital_signs shape.
  assert.equal("weight" in out, false);
});

test("toCanonicalVitalSigns returns null when nothing usable is set", () => {
  assert.equal(toCanonicalVitalSigns(null), null);
  assert.equal(toCanonicalVitalSigns({}), null);
  assert.equal(toCanonicalVitalSigns({ bp_systolic: "", weight: "180" }), null);
});

test("toCanonicalVitalSigns output flows cleanly into the value-guarded vitals sentence", () => {
  // The drafter's mapped vitals must survive the same value-guard the main form's
  // vitals do — otherwise routing them through the pipeline would flag them.
  const canonical = toCanonicalVitalSigns({ bp_systolic: "138", bp_diastolic: "84", o2_sat: "97", pain_level: "2" });
  const sentence = formatVitalsSentence(canonical);
  assert.match(sentence, /BP 138\/84/);
  assert.match(sentence, /O2 97%/);
  assert.equal(valueGuard(sentence, sentence).ok, true);
});

// ── extractCanonicalVitalsFromText (edited-draft text is the source of truth) ──

test("extractCanonicalVitalsFromText parses the drafter's generated vitals line incl. pain", () => {
  const line = "Vitals: BP 148/90 mmHg, HR 82 bpm, RR 16 breaths/min, O2 sat 95%, Temp 98.6°F, Pain 3/10.";
  assert.deepEqual(extractCanonicalVitalsFromText(line), {
    blood_pressure_systolic: 148, blood_pressure_diastolic: 90, heart_rate: 82,
    respiratory_rate: 16, oxygen_saturation: 95, temperature: 98.6, pain_level: 3,
  });
});

test("extractCanonicalVitalsFromText honors an in-text edit over a stale value", () => {
  // The bug this guards: a nurse corrects BP in the draft text; the saved value
  // must follow the text, not a separate stale form state.
  assert.equal(extractCanonicalVitalsFromText("Vitals: BP 138/84 mmHg").blood_pressure_systolic, 138);
  assert.equal(extractCanonicalVitalsFromText("Vitals: BP 138/84 mmHg").blood_pressure_diastolic, 84);
});

test("extractCanonicalVitalsFromText returns null when the text has no vitals", () => {
  assert.equal(extractCanonicalVitalsFromText("Patient ambulated in the hallway."), null);
  assert.equal(extractCanonicalVitalsFromText(""), null);
});

test("text-sourced vitals take precedence in a per-key merge with grid vitals", () => {
  // Mirrors StructuredNoteDrafter.useInNoteBuilder: { ...grid, ...text } so an
  // edited text value wins while a grid-only field (removed from the text) survives.
  const fromGrid = toCanonicalVitalSigns({ bp_systolic: "148", bp_diastolic: "90", heart_rate: "82" });
  const fromText = extractCanonicalVitalsFromText("BP 138/84 mmHg"); // nurse corrected BP in text
  const merged = { ...fromGrid, ...fromText };
  assert.equal(merged.blood_pressure_systolic, 138); // text wins
  assert.equal(merged.blood_pressure_diastolic, 84);
  assert.equal(merged.heart_rate, 82); // grid-only field preserved
});

test("a draft plus the whitelisted vitals sentence value-guards a note that quotes those vitals", () => {
  const vitalsSentence = formatVitalsSentence({ blood_pressure_systolic: 148, blood_pressure_diastolic: 90, oxygen_saturation: 95 });
  const allowed = `Patient assessed, wound stable. ${vitalsSentence}`;
  // A note that repeats the captured vitals must pass when the vitals sentence is
  // part of the allowed source — mirroring how the reviewer whitelists it.
  const note = `Skilled nursing visit completed; wound stable. ${vitalsSentence}`;
  assert.equal(valueGuard(note, allowed).ok, true);
  // But a value NOT in the source is still caught.
  assert.equal(valueGuard("BP 200/110 noted.", allowed).ok, false);
});

test("extractMedications does not report symptoms/diagnoses as medications", () => {
  // common_mishears maps some terms to diagnoses/symptoms; those must not surface
  // as medications (which would falsely flag faithful notes in valueGuard).
  assert.deepEqual(
    extractMedications("Patient reports nausea, fever, and chest pain with dyspnea."),
    []
  );
});

// ── Regression: value-guard must accept faithful unit-restated vitals ────────
test("value-guard accepts a scribe restating bare labeled vitals with units", () => {
  // The nurse documents vitals the common way — WITHOUT units. The constrained
  // scribe faithfully re-voices them WITH units. Every restated value traces to
  // the draft, so the guard must pass (previously it flagged 82bpm/98.6f/etc as
  // hallucinated because the bare draft produced no HR/RR/temp/weight tokens).
  const draft = "HR 82, RR 18, T 98.6, wt 180";
  const output = "Vitals: HR 82 bpm, RR 18 breaths/min, temperature 98.6°F, weight 180 lbs.";
  const res = valueGuard(output, draft);
  assert.equal(res.ok, true, `unexpected flags: ${JSON.stringify(res.unverified)}`);
});

test("extractNumbersAndMeasurements surfaces bare labeled HR/RR/temp/weight as unit tokens", () => {
  const tokens = extractNumbersAndMeasurements("HR 82, RR 18, T 98.6, wt 180");
  assert.ok(tokens.includes("82bpm"));
  assert.ok(tokens.includes("18breaths"));
  assert.ok(tokens.includes("98.6f"));
  assert.ok(tokens.includes("180lbs"));
});

test("value-guard still catches a kg->lb weight unit error (no synthesized lbs token for a kg source)", () => {
  // "80 kg" (~176 lb) must NOT be allowed to pass as "80 lbs": the source weight is
  // explicitly in kg, so no lbs token is synthesized and the guard flags the change.
  const res = valueGuard("Weight 80 lbs.", "Weight: 80 kg.");
  assert.equal(res.ok, false);
  assert.ok(res.unverified.some((u) => u.value === "80lbs"));
  // A unitless source weight still round-trips (the intended false-positive fix).
  assert.equal(valueGuard("weight 180 lbs", "wt 180").ok, true);
});

// ── Regression: value-guard tokenization holes (2026-07 review) ─────────────

test("3-D wound dimensions are guarded — a hallucinated first dimension is flagged", () => {
  const tokens = extractNumbersAndMeasurements("Sacral wound 4 x 5 x 2 cm.");
  assert.ok(tokens.includes("4x5x2cm"), `expected 4x5x2cm in ${tokens}`);
  const vg = valueGuard("Sacral wound measures 9 x 5 x 2 cm.", "Sacral wound 4 x 5 x 2 cm.");
  assert.equal(vg.ok, false, "a changed wound length must not pass the value-guard");
});

test("insulin mix ratios are not read as blood pressure", () => {
  const v = extractVitals("Gave Novolin 70/30 10 units SQ");
  assert.equal(v.bp_sys, undefined);
  assert.equal(v.bp_dia, undefined);
  const v2 = extractVitals("insulin aspart 70/30 administered");
  assert.equal(v2.bp_sys, undefined);
});

test("a LABELED hypotensive/equal BP is kept (agonal readings are real chart data)", () => {
  assert.deepEqual(extractVitals("BP 55/30, patient unresponsive"), { bp_sys: 55, bp_dia: 30 });
  const v = extractVitals("BP 90/90 today");
  assert.equal(v.bp_sys, 90);
  assert.equal(v.bp_dia, 90);
  // The UNLABELED fallback keeps the strict plausibility window (dates etc.).
  assert.deepEqual(extractVitals("Recert due 11/20"), {});
});

test("kg spelling variants defeat the lb-synthesis and are guarded as kg", () => {
  const vg = valueGuard("Weight 80 lbs.", "Weight: 80 kgs.");
  assert.equal(vg.ok, false, "an 80 kg -> 80 lbs unit error must be flagged");
  // Faithful respelling of the same unit does NOT flag.
  assert.equal(valueGuard("Weight 80 kg.", "Weight: 80 kgs.").ok, true);
});

test("RR / weight typos are dropped rather than truncated", () => {
  assert.equal(extractVitals("RR 210").rr, undefined);
  assert.equal(extractVitals("weight 1800").weight, undefined);
  assert.equal(extractVitals("temperature 1013").temp, undefined);
  assert.equal(extractVitals("underweight 15% below ideal").weight, undefined);
});

test("every labeled occurrence of a repeated vital is whitelisted", () => {
  const vg = valueGuard(
    "HR 88 bpm initially, HR 92 bpm after ambulation.",
    "HR 88, rechecked HR 92",
  );
  assert.equal(vg.ok, true, "a faithful second reading must not be flagged");
});

test("brand-name meds resolve to the canonical medication", () => {
  assert.deepEqual(extractMedications("continue Lasix 40 mg daily"), ["Furosemide"]);
  // Brand in the note, generic in the source (or vice versa) — same canonical name.
  assert.equal(valueGuard("Continued Furosemide.", "continue Lasix").ok, true);
  assert.equal(valueGuard("Administered Vicodin for pain.", "Reviewed the medication list.").ok, false);
});

test("O2 flow rate and bare-u insulin doses are guarded", () => {
  assert.equal(valueGuard("O2 at 4 L/min via NC.", "O2 at 2 L/min via NC.").ok, false);
  assert.equal(valueGuard("Gave 15 u insulin.", "Gave 10 u insulin.").ok, false);
  assert.equal(valueGuard("Gave 10 units insulin.", "Gave 10 u insulin.").ok, true, "u/units respellings are equivalent");
});

test("splitSentences keeps decimal values whole", () => {
  assert.deepEqual(splitSentences("Temp 98.6. BP 120/80."), ["Temp 98.6", "BP 120/80"]);
});
