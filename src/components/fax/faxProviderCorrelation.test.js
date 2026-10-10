import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import {
  FAX_CLIENT_STATE_VERSION,
  decodeFaxClientState,
  encodeFaxClientState,
  exactFaxCorrelationId,
  faxEventProviderId,
  faxStatusWebhookUrl,
} from "./faxProviderCorrelation.js";

test("a fax client_state round-trips and is the base64 Telnyx requires", () => {
  const encoded = encodeFaxClientState("outbound", "FaxLog_1");
  assert.match(encoded, /^[A-Za-z0-9+/]+=*$/);
  assert.deepEqual(JSON.parse(Buffer.from(encoded, "base64").toString("utf8")), {
    v: FAX_CLIENT_STATE_VERSION, k: "outbound", id: "FaxLog_1",
  });
  assert.deepEqual(decodeFaxClientState(encoded), { kind: "outbound", id: "FaxLog_1" });
  assert.deepEqual(decodeFaxClientState(encodeFaxClientState("office_forward", "IncomingFax_9")), {
    kind: "office_forward", id: "IncomingFax_9",
  });
});

test("only an exact row id of a known kind can be encoded", () => {
  for (const [kind, id] of [["outbound", ""], ["outbound", " padded"], ["outbound", "$ne"],
    ["outbound", "a\u0000b"], ["outbound", "x".repeat(201)], ["outbound", 7], ["voicemail", "FaxLog_1"]]) {
    assert.equal(encodeFaxClientState(kind, id), null, `${kind}/${JSON.stringify(id)}`);
  }
  assert.equal(exactFaxCorrelationId("x".repeat(200)), "x".repeat(200));
});

test("a client_state this app did not write decodes to nothing", () => {
  const b64 = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64");
  for (const value of [
    undefined, null, 42, "", "%%%not-base64%%%", b64("not json"),
    // The voice ringdown's client_state shape.
    b64({ t: "ringdown", targets: [], idx: 0 }),
    b64({ v: "pennsync.fax.v0", k: "outbound", id: "FaxLog_1" }),
    b64({ v: FAX_CLIENT_STATE_VERSION, k: "inbound", id: "FaxLog_1" }),
    b64({ v: FAX_CLIENT_STATE_VERSION, k: "outbound", id: "$where" }),
    b64([FAX_CLIENT_STATE_VERSION, "outbound", "FaxLog_1"]),
    "A".repeat(4096),
  ]) {
    assert.equal(decodeFaxClientState(value), null, String(value).slice(0, 40));
  }
});

test("a fax event names its fax by the documented fax_id, tolerating the legacy id", () => {
  assert.deepEqual(faxEventProviderId({ fax_id: "f1" }), { present: true, id: "f1" });
  assert.deepEqual(faxEventProviderId({ id: "f1" }), { present: true, id: "f1" });
  assert.deepEqual(faxEventProviderId({ fax_id: "f1", id: "f1" }), { present: true, id: "f1" });
  assert.deepEqual(faxEventProviderId({ fax_id: "f1", id: "f2" }), { present: true, id: null });
  assert.deepEqual(faxEventProviderId({ fax_id: " f1" }), { present: true, id: null });
  assert.deepEqual(faxEventProviderId({}), { present: false, id: null });
  assert.deepEqual(faxEventProviderId(null), { present: false, id: null });
});

test("the status webhook URL is derived only from a request that reached the sender by name", () => {
  assert.equal(
    faxStatusWebhookUrl("https://app.example/api/apps/a1/functions/sendBatchFax", "sendBatchFax"),
    "https://app.example/api/apps/a1/functions/handleTelnyxStatusWebhook",
  );
  assert.equal(
    faxStatusWebhookUrl("https://app.example/functions/sendFax/?x=1", "sendFax"),
    "https://app.example/functions/handleTelnyxStatusWebhook",
  );
  // The old derivation turned a bare origin into "https://handleTelnyxStatusWebhook"-
  // style garbage; these now omit the override instead.
  for (const [url, name] of [
    ["https://app.example/", "sendFax"],
    ["https://app.example", "sendFax"],
    ["https://app.example/functions/sendBatchFax", "sendFax"],
    ["http://app.example/functions/sendFax", "sendFax"],
    ["https://user:pw@app.example/functions/sendFax", "sendFax"],
    ["not a url", "sendFax"],
    ["https://app.example/functions/sendFax", "send/Fax"],
  ]) {
    assert.equal(faxStatusWebhookUrl(url, name), null, `${url} as ${name}`);
  }
});
