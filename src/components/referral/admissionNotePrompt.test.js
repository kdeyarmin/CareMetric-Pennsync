import test from "node:test";
import assert from "node:assert/strict";
import { buildAdmissionNotePrompt, ADMISSION_NOTE_SCHEMA } from "./admissionNotePrompt.js";

const referral = {
  demographics: { full_name: "Mary Test" },
  diagnoses: { primary_diagnosis: "CHF exacerbation" },
};

test("prompt embeds the referral data as the only source of facts", () => {
  const prompt = buildAdmissionNotePrompt(referral);
  assert.match(prompt, /REFERRAL DATA \(the ONLY permitted source of facts\)/);
  assert.ok(prompt.includes('"CHF exacerbation"'), "referral JSON must be embedded");
});

test("prompt forbids fabrication: pre-visit framing, no invented values, bracketed blanks", () => {
  const prompt = buildAdmissionNotePrompt(referral);
  assert.match(prompt, /NON-NEGOTIABLE GROUNDING RULES/);
  assert.match(prompt, /admission visit has NOT happened yet/);
  assert.match(prompt, /Never invent vital signs/);
  assert.match(prompt, /Never write as if you examined the patient/);
  assert.match(prompt, /\[obtain at visit\]/);
  assert.match(prompt, /do NOT write plausible-sounding values/);
  // The old fabrication-inviting instructions must be gone.
  assert.ok(!/Document what YOU observed/i.test(prompt), "must not instruct writing invented observations");
  assert.ok(!/Include quotes when impactful/i.test(prompt), "must not invite invented patient quotes");
});

test("homebound may only be justified from documented limitations", () => {
  const prompt = buildAdmissionNotePrompt(referral);
  assert.match(prompt, /justify homebound ONLY from limitations the referral actually documents/);
  assert.match(prompt, /not yet documented in referral — assess and document at the SOC visit/);
  assert.match(prompt, /Never assert homebound without documented support/);
});

test("plan restates only documented orders", () => {
  const prompt = buildAdmissionNotePrompt(referral);
  assert.match(prompt, /restate only the services, frequencies, and orders the referral actually contains/);
  assert.match(prompt, /\[confirm orders with physician\]/);
});

test("schema keeps the consumer contract and grounds every description", () => {
  const props = ADMISSION_NOTE_SCHEMA.properties;
  assert.deepEqual(
    Object.keys(props).sort(),
    ["admission_note", "homebound_justification_strength", "key_findings", "suggested_care_priorities"]
  );
  assert.match(props.admission_note.description, /PRE-VISIT/);
  assert.match(props.admission_note.description, /never invented findings/);
  assert.match(props.key_findings.description, /supported by the referral data only/);
  assert.match(props.homebound_justification_strength.description, /REFERRAL ITSELF/);
  assert.deepEqual(props.homebound_justification_strength.enum, ["strong", "moderate", "needs_clarification"]);
});
