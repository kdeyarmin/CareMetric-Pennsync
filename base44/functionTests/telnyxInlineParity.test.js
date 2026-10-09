import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transpileTs } from "../../tools-transpile-ts.mjs";
import * as util from "../../src/components/integrations/telnyx/telnyxUtils.js";

/**
 * Drift guard for the value-mapping helpers that handleTelnyxStatusWebhook inlines
 * (single-file Deno deploy model). The unit-tested source of truth lives in
 * src/components/integrations/telnyx/telnyxUtils.js; this asserts the inlined
 * copies in the webhook compute byte-identical results, so a status mapping or
 * signature-payload change in one place can't silently diverge from the other.
 */
globalThis.Deno = globalThis.Deno || { serve() {}, env: { get: () => undefined } };

async function loadInline(entryPath, names) {
  let src = await readFile(new URL(entryPath, import.meta.url), "utf8");
  src = src.replace(/import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/, "const createClientFromRequest = () => ({});");
  const js = transpileTs(src).outputText;
  const tmp = join(tmpdir(), `tnxmap_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(tmp, `${js}\nexport { ${names.join(", ")} };\n`);
  try {
    return await import(pathToFileURL(tmp).href);
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

const NAMES = ["mapMessageStatus", "mapFaxStatus", "mapCallStatus", "buildSignedPayload", "isFreshTimestamp", "extractTelnyxEvent"];

test("handleTelnyxStatusWebhook inlines value-mappers identical to telnyxUtils", async () => {
  const inlined = await loadInline("../functions/handleTelnyxStatusWebhook/entry.ts", NAMES);

  const msgStatuses = ["queued", "sending", "sent", "delivered", "webhook_delivered", "delivery_unconfirmed", "read", "gw_timeout", "sending_failed", "delivery_failed", "expired", "failed", "bogus", undefined];
  for (const s of msgStatuses) {
    assert.equal(inlined.mapMessageStatus(s), util.mapMessageStatus(s), `mapMessageStatus(${s})`);
  }

  const faxStatuses = ["queued", "media.processed", "originated", "sending", "sent", "delivered", "failed", "cancelled", "canceled", "nope", undefined];
  for (const s of faxStatuses) {
    assert.equal(inlined.mapFaxStatus(s), util.mapFaxStatus(s), `mapFaxStatus(${s})`);
  }

  const callEvents = ["call.initiated", "call.answered", "call.bridged", "call.hangup", "call.other", ""];
  for (const e of callEvents) {
    assert.equal(inlined.mapCallStatus(e), util.mapCallStatus(e), `mapCallStatus(${e})`);
  }

  assert.equal(inlined.buildSignedPayload("1700000000", '{"a":1}'), util.buildSignedPayload("1700000000", '{"a":1}'));
  assert.equal(inlined.buildSignedPayload(undefined, undefined), util.buildSignedPayload(undefined, undefined));

  const now = 1_700_000_000_000;
  for (const ts of [now / 1000, now / 1000 - 299, now / 1000 - 301, "x", ""]) {
    assert.equal(inlined.isFreshTimestamp(ts, now, 300), util.isFreshTimestamp(ts, now, 300), `isFreshTimestamp(${ts})`);
  }

  const env = { data: { event_type: "message.finalized", payload: { id: "m1", status: "delivered" } } };
  assert.deepEqual(inlined.extractTelnyxEvent(env), util.extractTelnyxEvent(env));
  assert.equal(inlined.extractTelnyxEvent(null).eventType, util.extractTelnyxEvent(null).eventType);
});

test("voicemail duration comes from the recording's own timestamps", async () => {
  // call.recording.saved has no duration field (Telnyx OpenAPI spec, 2026-10-09);
  // reading one left every stored voicemail duration null.
  const { recordingDurationSecs } = await loadInline("../functions/handleTelnyxStatusWebhook/entry.ts", ["recordingDurationSecs"]);
  assert.equal(recordingDurationSecs({
    recording_started_at: "2026-10-09T12:00:00.000Z",
    recording_ended_at: "2026-10-09T12:00:42.400Z",
  }), 42);
  assert.equal(recordingDurationSecs({ recording_duration_secs: 7 }), 7);
  assert.equal(recordingDurationSecs({ recording_started_at: "x", recording_ended_at: "y" }), null);
  assert.equal(recordingDurationSecs({
    recording_started_at: "2026-10-09T12:01:00Z", recording_ended_at: "2026-10-09T12:00:00Z",
  }), null);
  assert.equal(recordingDurationSecs(undefined), null);
});

test("an unanswered hangup on a never-answered leg is a missed call, not completed", async () => {
  const { unansweredHangupStatus } = await loadInline("../functions/handleTelnyxStatusWebhook/entry.ts", ["unansweredHangupStatus"]);
  // The nurse's cell on a masked call rang out / was busy.
  assert.equal(unansweredHangupStatus("call.hangup", "initiated", "no_answer"), "failed");
  assert.equal(unansweredHangupStatus("call.hangup", "ringing", "USER_BUSY"), "failed");
  assert.equal(unansweredHangupStatus("call.hangup", undefined, "timeout"), "failed");
  // Answered calls end normally whatever the cause; normal clearing is not a miss.
  assert.equal(unansweredHangupStatus("call.hangup", "in_progress", "no_answer"), null);
  assert.equal(unansweredHangupStatus("call.hangup", "ringing", "normal_clearing"), null);
  assert.equal(unansweredHangupStatus("call.hangup", "failed", "no_answer"), null);
  assert.equal(unansweredHangupStatus("call.answered", "ringing", "no_answer"), null);
});

test("a revocation in any of its FCC/CTIA forms never draws an auto-reply", async () => {
  const { isStopLikeText } = await loadInline("../functions/handleTelnyxStatusWebhook/entry.ts", ["isStopLikeText"]);
  for (const t of ["STOP", "stop", "Stop.", " stop! ", "STOPALL", "Stop all", "unsubscribe", "Cancel", "END", "quit",
    "REVOKE", "revoke.", "OPTOUT", "opt out", "Opt-Out"]) {
    assert.equal(isStopLikeText(t), true, t);
  }
  // Ordinary messages that merely contain a word still get the normal handling.
  for (const t of ["Please don't stop my visits", "When does my visit end?", "help", "", null]) {
    assert.equal(isStopLikeText(t), false, String(t));
  }
});
