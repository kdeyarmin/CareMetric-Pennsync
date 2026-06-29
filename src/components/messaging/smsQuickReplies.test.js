import { test } from "node:test";
import assert from "node:assert/strict";
import { getQuickReplies, DEFAULT_QUICK_REPLIES } from "./smsQuickReplies.js";

test("falls back to defaults when nothing is configured", () => {
  assert.deepEqual(getQuickReplies(undefined), DEFAULT_QUICK_REPLIES);
  assert.deepEqual(getQuickReplies({}), DEFAULT_QUICK_REPLIES);
  assert.deepEqual(getQuickReplies({ sms_quick_replies: [] }), DEFAULT_QUICK_REPLIES);
});

test("normalizes a configured string list to label/text rows", () => {
  const result = getQuickReplies({ sms_quick_replies: ["On my way.", "  "] });
  assert.equal(result.length, 1); // blank dropped
  assert.equal(result[0].text, "On my way.");
  assert.equal(result[0].label, "On my way.");
});

test("derives a short label for long string entries", () => {
  const long = "This is a fairly long canned message that should be truncated in its chip label.";
  const [row] = getQuickReplies({ sms_quick_replies: [long] });
  assert.ok(row.label.length <= 25);
  assert.ok(row.label.endsWith("…"));
  assert.equal(row.text, long);
});

test("accepts {label,text} objects and drops blank text", () => {
  const result = getQuickReplies({
    sms_quick_replies: [
      { label: "Confirm", text: "See you tomorrow." },
      { label: "Empty", text: "   " },
    ],
  });
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], { label: "Confirm", text: "See you tomorrow." });
});
