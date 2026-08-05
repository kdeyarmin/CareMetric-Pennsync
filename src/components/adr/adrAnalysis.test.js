import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAdrLetterPrompt,
  ADR_LETTER_SCHEMA,
  runAdrLetterAnalysis,
  checklistForPrompt,
  buildPacketVerificationPrompt,
  PACKET_VERIFICATION_SCHEMA,
  runAdrPacketVerification,
} from "./adrAnalysis.js";
import { buildAdrChecklist, AUDIT_TYPE_IDS } from "./adrRequirements.js";

// ── letter analysis ──

test("letter prompt demands verbatim extraction and forbids invention", () => {
  const prompt = buildAdrLetterPrompt();
  assert.match(prompt, /VERBATIM/);
  assert.match(prompt, /NEVER invent/);
  assert.match(prompt, /HONESTY CONTRACT/);
  assert.match(prompt, /unclear_fields/);
});

test("letter schema audit types stay in sync with the catalog's audit type ids", () => {
  const schemaEnum = ADR_LETTER_SCHEMA.properties.audit_type.enum;
  assert.deepEqual([...schemaEnum].sort(), [...AUDIT_TYPE_IDS].sort());
});

test("letter schema requires the fields the checklist builder consumes", () => {
  assert.ok(ADR_LETTER_SCHEMA.required.includes("requested_items"));
  assert.ok(ADR_LETTER_SCHEMA.required.includes("audit_type"));
  const item = ADR_LETTER_SCHEMA.properties.requested_items.items;
  assert.deepEqual(item.required, ["text"]);
  assert.ok(item.properties.details);
});

test("runAdrLetterAnalysis wires prompt, file and schema through the injected invoker", async () => {
  let captured = null;
  const invoke = async (params, options) => {
    captured = { params, options };
    return { audit_type: "tpe", requested_items: [], letter_summary: "x" };
  };
  const result = await runAdrLetterAnalysis(invoke, { fileUrl: "https://files.example/letter.pdf" });
  assert.equal(result.audit_type, "tpe");
  assert.equal(captured.params.model, "automatic");
  assert.deepEqual(captured.params.file_urls, ["https://files.example/letter.pdf"]);
  assert.equal(captured.params.response_json_schema, ADR_LETTER_SCHEMA);
  assert.equal(captured.options.retries, 2);
  assert.ok(captured.options.timeoutMs >= 60000);
});

// ── packet verification ──

const checklist = buildAdrChecklist({
  letterItems: [{ text: "Signed plan of care (CMS-485)" }],
  auditType: "mac_adr",
});

test("checklistForPrompt renders ids, citations, letter wording and reviewer checks", () => {
  const rendered = checklistForPrompt(checklist);
  assert.match(rendered, /\[plan_of_care\]/);
  assert.match(rendered, /42 CFR 409\.43/);
  assert.match(rendered, /Letter wording: "Signed plan of care \(CMS-485\)"/);
  assert.match(rendered, /Reviewer checks:/);
  assert.match(rendered, /\[face_to_face\]/, "baseline items must be included too");
});

test("verification prompt embeds the checklist and the honesty contract", () => {
  const prompt = buildPacketVerificationPrompt(checklist);
  assert.match(prompt, /EVERY page/);
  assert.match(prompt, /\[plan_of_care\]/);
  assert.match(prompt, /HONESTY CONTRACT/);
  assert.match(prompt, /NEVER fabricate page numbers/);
  assert.match(prompt, /overall_observations/);
  assert.match(prompt, /90-day-before\/30-day-after/);
});

test("verification schema constrains statuses and issue severities", () => {
  const itemSchema = PACKET_VERIFICATION_SCHEMA.properties.items.items;
  assert.deepEqual(itemSchema.properties.status.enum, ["found", "partial", "missing", "not_applicable"]);
  assert.ok(itemSchema.properties.na_reason, "na_reason must be reportable for waived conditional items");
  assert.deepEqual(itemSchema.properties.issues.items.properties.severity.enum, ["critical", "high", "medium"]);
  assert.deepEqual(itemSchema.required, ["id", "status"]);
  assert.ok(PACKET_VERIFICATION_SCHEMA.required.includes("items"));
});

test("runAdrPacketVerification uses a long single-retry window", async () => {
  let captured = null;
  const invoke = async (params, options) => {
    captured = { params, options };
    return { items: [] };
  };
  await runAdrPacketVerification(invoke, { fileUrl: "https://files.example/packet.pdf", checklist });
  assert.deepEqual(captured.params.file_urls, ["https://files.example/packet.pdf"]);
  assert.equal(captured.params.response_json_schema, PACKET_VERIFICATION_SCHEMA);
  assert.match(captured.params.prompt, /\[plan_of_care\]/);
  assert.equal(captured.options.retries, 1);
  assert.equal(captured.options.timeoutMs, 300000);
});

test("the verification prompt renders each item's Applies: condition", () => {
  // Regression: the NOT-APPLICABLE RULES told the model to use the "Applies:"
  // condition, but checklistForPrompt never rendered it — the model couldn't
  // tell conditional items from always-required ones.
  const checklist = buildAdrChecklist({ letterItems: [], auditType: "mac_adr" });
  const rendered = checklistForPrompt(checklist);
  const conditional = checklist.filter((it) => it.when && it.when !== "always");
  assert.ok(conditional.length > 0, "expected conditional baseline items");
  for (const it of conditional.slice(0, 3)) {
    assert.ok(rendered.includes(`Applies: ${it.when}`), `missing Applies: for ${it.id}`);
  }
});
