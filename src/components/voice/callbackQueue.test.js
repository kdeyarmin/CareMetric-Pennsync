import { test } from "node:test";
import assert from "node:assert/strict";
import {
  callbackReason,
  needsCallback,
  buildCallbackQueue,
  callbackCount,
} from "./callbackQueue.js";

const missedInbound = { id: "m", direction: "inbound", call_mode: "masked_bridge", status: "no_answer", created_date: "2026-06-02T10:00:00Z" };

test("an unanswered inbound masked call needs a callback", () => {
  assert.equal(callbackReason(missedInbound), "Missed call");
  assert.equal(needsCallback(missedInbound), true);
});

test("a completed call with no flag does not need a callback", () => {
  assert.equal(needsCallback({ direction: "inbound", call_mode: "masked_bridge", status: "completed" }), false);
});

test("a resolved/no-action disposition clears the call even if missed or with voicemail", () => {
  assert.equal(needsCallback({ ...missedInbound, disposition: "resolved" }), false);
  assert.equal(needsCallback({ ...missedInbound, disposition: "no_action", has_voicemail: true }), false);
});

test("explicit dispositions and voicemails are flagged", () => {
  assert.equal(callbackReason({ disposition: "callback_requested" }), "Callback requested");
  assert.equal(callbackReason({ disposition: "follow_up_needed" }), "Follow-up needed");
  assert.equal(callbackReason({ has_voicemail: true, status: "completed", direction: "outbound" }), "Voicemail");
});

test("an answered outbound call with no flag is ignored", () => {
  assert.equal(needsCallback({ direction: "outbound", status: "completed" }), false);
});

test("buildCallbackQueue orders by priority then recency", () => {
  const calls = [
    { ...missedInbound, id: "missed_old", created_date: "2026-06-02T08:00:00Z" },
    { id: "vm", has_voicemail: true, status: "no_answer", direction: "inbound", call_mode: "masked_bridge", created_date: "2026-06-02T09:00:00Z" },
    { id: "req", disposition: "callback_requested", created_date: "2026-06-01T09:00:00Z" },
    { ...missedInbound, id: "missed_new", created_date: "2026-06-02T11:00:00Z" },
    { ...missedInbound, id: "done", disposition: "resolved", created_date: "2026-06-02T12:00:00Z" },
  ];
  const q = buildCallbackQueue(calls);
  // callback_requested (p1) first, then voicemail (p2), then the two missed (p4) newest-first.
  assert.deepEqual(q.map((c) => c.id), ["req", "vm", "missed_new", "missed_old"]);
  assert.equal(q[0].reason, "Callback requested");
});

test("buildCallbackQueue annotates reason and priority", () => {
  const q = buildCallbackQueue([{ disposition: "callback_requested", created_date: "2026-06-02T10:00:00Z" }]);
  assert.equal(q[0].reason, "Callback requested");
  assert.equal(q[0].priority, 1);
});

test("callbackCount counts only items needing a callback", () => {
  assert.equal(
    callbackCount([
      missedInbound,
      { ...missedInbound, disposition: "resolved" },
      { disposition: "callback_requested" },
      { status: "completed", direction: "inbound", call_mode: "masked_bridge" },
    ]),
    2
  );
});

test("empty / non-array input is safe", () => {
  assert.deepEqual(buildCallbackQueue(undefined), []);
  assert.equal(callbackCount(null), 0);
});
