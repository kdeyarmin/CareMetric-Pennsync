import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeE164,
  getThreadId,
  mapMessageStatus,
  mapFaxStatus,
  mapCallStatus,
  buildSignedPayload,
  isFreshTimestamp,
  extractTelnyxEvent,
  TELNYX_API_BASE,
} from "./telnyxUtils.js";

test("normalizeE164 handles US 10/11-digit and international forms", () => {
  assert.equal(normalizeE164("2155550100"), "+12155550100");
  assert.equal(normalizeE164("(215) 555-0100"), "+12155550100");
  assert.equal(normalizeE164("12155550100"), "+12155550100");
  assert.equal(normalizeE164("+442071838750"), "+442071838750");
  assert.equal(normalizeE164(""), null);
  assert.equal(normalizeE164("123"), null);
  // Leading 0 international is rejected (not E.164 dialable as given).
  assert.equal(normalizeE164("+0442071838750"), null);
});

test("getThreadId is order-independent and normalizes both sides", () => {
  const a = getThreadId("2155550100", "+13125550182");
  const b = getThreadId("+13125550182", "(215) 555-0100");
  assert.equal(a, b);
});

test("mapMessageStatus collapses Telnyx statuses to the internal vocabulary", () => {
  assert.equal(mapMessageStatus("queued"), "queued");
  assert.equal(mapMessageStatus("sending"), "queued");
  assert.equal(mapMessageStatus("sent"), "sent");
  assert.equal(mapMessageStatus("delivered"), "delivered");
  assert.equal(mapMessageStatus("sending_failed"), "failed");
  assert.equal(mapMessageStatus("delivery_failed"), "failed");
  assert.equal(mapMessageStatus("expired"), "failed");
  // Unknown → null so the webhook acks without regressing a terminal row.
  assert.equal(mapMessageStatus("bogus"), null);
  assert.equal(mapMessageStatus(undefined), null);
});

test("mapFaxStatus maps to the FaxLog enum and treats cancel as failed", () => {
  assert.equal(mapFaxStatus("queued"), "queued");
  assert.equal(mapFaxStatus("media.processed"), "sending");
  assert.equal(mapFaxStatus("sending"), "sending");
  assert.equal(mapFaxStatus("delivered"), "delivered");
  assert.equal(mapFaxStatus("failed"), "failed");
  assert.equal(mapFaxStatus("cancelled"), "failed");
  assert.equal(mapFaxStatus("unknown"), null);
});

test("mapCallStatus maps Call Control event types to coarse states", () => {
  assert.equal(mapCallStatus("call.initiated"), "ringing");
  assert.equal(mapCallStatus("call.answered"), "in_progress");
  assert.equal(mapCallStatus("call.bridged"), "in_progress");
  assert.equal(mapCallStatus("call.hangup"), "completed");
  assert.equal(mapCallStatus("call.nonsense"), null);
});

test("buildSignedPayload matches Telnyx's timestamp|body construction", () => {
  assert.equal(buildSignedPayload("1700000000", '{"a":1}'), '1700000000|{"a":1}');
  // Null-safe: never produces "undefined".
  assert.equal(buildSignedPayload(undefined, undefined), "|");
});

test("isFreshTimestamp enforces a replay window and fails closed", () => {
  const now = 1_700_000_000_000; // ms
  const nowSec = now / 1000;
  assert.equal(isFreshTimestamp(nowSec, now, 300), true);
  assert.equal(isFreshTimestamp(nowSec - 299, now, 300), true);
  assert.equal(isFreshTimestamp(nowSec - 301, now, 300), false);
  assert.equal(isFreshTimestamp("not-a-number", now, 300), false);
  assert.equal(isFreshTimestamp("", now, 300), false);
});

test("extractTelnyxEvent reads the v2 envelope and tolerates flat payloads", () => {
  const env = extractTelnyxEvent({
    data: { event_type: "message.finalized", payload: { id: "msg_1", to: [{ status: "delivered" }] } },
  });
  assert.equal(env.eventType, "message.finalized");
  assert.equal(env.id, "msg_1");
  assert.equal(env.payload.to[0].status, "delivered");

  // Flat fallback (used in tests / non-enveloped callers).
  const flat = extractTelnyxEvent({ event_type: "fax.delivered", payload: { id: "fax_1", status: "delivered" } });
  assert.equal(flat.eventType, "fax.delivered");
  assert.equal(flat.payload.status, "delivered");

  // Never throws on garbage.
  assert.equal(extractTelnyxEvent(null).eventType, null);
});

test("TELNYX_API_BASE is the canonical v2 host", () => {
  assert.equal(TELNYX_API_BASE, "https://api.telnyx.com/v2");
});
