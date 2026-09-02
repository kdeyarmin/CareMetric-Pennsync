import test from "node:test";
import assert from "node:assert/strict";
import {
  EMR_HANDOFF_DISCLAIMER,
  EMR_HANDOFF_STATUSES,
  EMR_HANDOFF_STATUS_IDS,
  SELF_REPORTED_CAVEAT,
  advanceHandoffStatus,
  buildReviewAcknowledgement,
  getHandoffStatus,
  hashNoteText,
  isAcknowledgementStale,
  splitNoteSections,
} from "./emrHandoff.js";

test("the disclaimer never claims compliance, verification, or that PennSync is the record", () => {
  const lowered = EMR_HANDOFF_DISCLAIMER.toLowerCase();
  assert.match(lowered, /assists with documentation preparation/);
  assert.match(lowered, /official documentation in your agency's emr/);
  for (const forbidden of ["medicare compliant", "guaranteed", "verified", "submitted"]) {
    assert.ok(!lowered.includes(forbidden), `disclaimer must not say "${forbidden}"`);
  }
});

test("every self-reported status says PennSync did not verify it", () => {
  assert.match(SELF_REPORTED_CAVEAT, /did not verify/i);
  for (const status of EMR_HANDOFF_STATUSES.slice(1)) {
    assert.match(status.help, /PennSync did not verify/i, `${status.id} must disclaim verification`);
  }
});

test("status ids are the documented set, in order", () => {
  assert.deepEqual(EMR_HANDOFF_STATUS_IDS, [
    "not_started",
    "copied_to_emr",
    "reviewed_in_emr",
    "signed_in_emr",
  ]);
});

test("getHandoffStatus falls back to not_started for unknown ids", () => {
  assert.equal(getHandoffStatus("copied_to_emr").id, "copied_to_emr");
  assert.equal(getHandoffStatus("bogus").id, "not_started");
  assert.equal(getHandoffStatus(undefined).id, "not_started");
});

test("advancing the handoff status appends a self-reported history entry", () => {
  const out = advanceHandoffStatus({}, "copied_to_emr", {
    actorEmail: "nurse@example.com",
    at: "2026-08-31T12:00:00.000Z",
  });
  assert.equal(out.ok, true);
  assert.equal(out.changed, true);
  assert.equal(out.status, "copied_to_emr");
  assert.equal(out.history.length, 1);
  assert.deepEqual(out.history[0], {
    status: "copied_to_emr",
    reported_by: "nurse@example.com",
    reported_at: "2026-08-31T12:00:00.000Z",
    self_reported: true,
    note: "",
  });
});

test("the handoff status is forward-only and never rewrites an earlier report", () => {
  const copied = advanceHandoffStatus({}, "copied_to_emr", { at: "2026-08-31T12:00:00.000Z" });
  const signed = advanceHandoffStatus(copied, "signed_in_emr", { at: "2026-08-31T12:05:00.000Z" });
  assert.equal(signed.status, "signed_in_emr");
  assert.equal(signed.history.length, 2);

  const backwards = advanceHandoffStatus(signed, "copied_to_emr");
  assert.equal(backwards.ok, false);
  assert.equal(backwards.changed, false);
  assert.equal(backwards.status, "signed_in_emr");
  assert.equal(backwards.history.length, 2, "a rejected move must not append history");
  assert.match(backwards.reason, /Cannot move back/);
});

test("re-reporting the same status is a rejected no-op, not a duplicate row", () => {
  const copied = advanceHandoffStatus({}, "copied_to_emr");
  const again = advanceHandoffStatus(copied, "copied_to_emr");
  assert.equal(again.ok, false);
  assert.equal(again.history.length, 1);
  assert.match(again.reason, /Already reported/);
});

test("an unknown status id is rejected rather than stored", () => {
  const out = advanceHandoffStatus({ status: "copied_to_emr", history: [{}] }, "submitted_to_medicare");
  assert.equal(out.ok, false);
  assert.equal(out.status, "copied_to_emr");
  assert.match(out.reason, /Unknown handoff status/);
});

test("splitNoteSections returns nothing for empty input", () => {
  assert.deepEqual(splitNoteSections(""), []);
  assert.deepEqual(splitNoteSections("   \n  "), []);
  assert.deepEqual(splitNoteSections(null), []);
});

test("explicit headings become sections verbatim", () => {
  const note = [
    "Assessment:",
    "Lungs clear bilaterally. BP 148/90, HR 82.",
    "",
    "Interventions:",
    "Dressing change performed to the right heel wound.",
    "",
    "Patient Response:",
    "Patient tolerated the dressing change without complaint.",
  ].join("\n");

  const sections = splitNoteSections(note);
  assert.equal(sections.length, 3);
  assert.deepEqual(sections.map((s) => s.heading), ["Assessment", "Interventions", "Patient Response"]);
  assert.ok(sections.every((s) => s.labeled));
  assert.equal(sections[1].body, "Dressing change performed to the right heel wound.");
  assert.equal(
    sections[1].text,
    "Interventions:\nDressing change performed to the right heel wound.",
    "the copied text keeps the heading the nurse sees",
  );
  assert.ok(sections.every((s) => s.id), "every section needs a stable id");
  assert.equal(new Set(sections.map((s) => s.id)).size, 3, "section ids must be unique");
});

test("an inline heading keeps its content on the same line", () => {
  const sections = splitNoteSections("Plan: Return in 3 days for a repeat dressing change.");
  assert.equal(sections.length, 1);
  assert.equal(sections[0].heading, "Plan");
  assert.equal(sections[0].body, "Return in 3 days for a repeat dressing change.");
});

test("headingless prose is grouped by paragraph and labelled deterministically", () => {
  const note = [
    "Patient homebound due to severe exertional dyspnea; requires a rolling walker and one-person assist.",
    "",
    "Educated the patient and daughter on the low-sodium diet; patient verbalized understanding via teach-back.",
  ].join("\n\n");

  const sections = splitNoteSections(note);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].topic, "homebound");
  assert.equal(sections[1].topic, "education");
  assert.ok(sections.every((s) => !s.labeled), "fallback labels are presentational, not the note's own");
  assert.equal(sections[0].text, sections[0].body, "fallback sections copy the untouched source text");
});

test("classification is stable and never rewrites the body", () => {
  const body = "Assessed the sacral wound: 2x3 cm, granulating, no odor.";
  const [section] = splitNoteSections(body);
  assert.equal(section.body, body);
  assert.equal(section.text, body);
  assert.deepEqual(splitNoteSections(body), splitNoteSections(body));
});

test("a clinical colon mid-line is never mistaken for a heading", () => {
  // Regression: a permissive heading rule swallowed "Assessed the sacral wound"
  // as a heading and dropped it from the copied section body.
  const note = "Assessed the sacral wound: 2x3 cm, granulating, no odor. Patient tolerated it well.";
  const [section] = splitNoteSections(note);
  assert.equal(section.labeled, false);
  assert.equal(section.body, note);
  assert.ok(section.text.includes("Assessed the sacral wound"));
});

test("ALL-CAPS headings are recognised alongside the known vocabulary", () => {
  const note = "SUBJECTIVE:\nPatient reports pain 3/10.\n\nOBJECTIVE:\nBP 148/90.";
  const sections = splitNoteSections(note);
  assert.deepEqual(sections.map((s) => s.heading), ["SUBJECTIVE", "OBJECTIVE"]);
});

test("a single unbroken paragraph stays one section", () => {
  const note = "Alert and oriented x3. BP 148/90. Dressing change performed. Patient tolerated it well.";
  assert.equal(splitNoteSections(note).length, 1);
});

test("hashNoteText is stable, order-sensitive, and 8 hex characters", () => {
  const a = hashNoteText("Patient tolerated the dressing change.");
  const b = hashNoteText("Patient tolerated the dressing change.");
  const c = hashNoteText("Patient tolerated the dressing change!");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{8}$/);
  assert.match(hashNoteText(""), /^[0-9a-f]{8}$/);
});

test("the review acknowledgement is explicitly not a clinical signature", () => {
  const ack = buildReviewAcknowledgement({
    noteText: "Final note text",
    actorEmail: "nurse@example.com",
    aiAssisted: true,
    at: "2026-08-31T12:00:00.000Z",
    edited: true,
  });
  assert.equal(ack.acknowledged, true);
  assert.equal(ack.acknowledged_by, "nurse@example.com");
  assert.equal(ack.acknowledged_at, "2026-08-31T12:00:00.000Z");
  assert.equal(ack.ai_assisted, true);
  assert.equal(ack.nurse_edited, true);
  assert.equal(ack.is_clinical_signature, false);
  assert.equal(ack.note_hash, hashNoteText("Final note text"));
  assert.equal(ack.note_length, "Final note text".length);
  assert.ok(!("note_text" in ack), "the acknowledgement must not duplicate the note body");
});

test("an acknowledgement goes stale when the note is edited afterwards", () => {
  const ack = buildReviewAcknowledgement({ noteText: "Version one" });
  assert.equal(isAcknowledgementStale(ack, "Version one"), false);
  assert.equal(isAcknowledgementStale(ack, "Version one, edited"), true);
  assert.equal(isAcknowledgementStale(null, "anything"), false);
});
