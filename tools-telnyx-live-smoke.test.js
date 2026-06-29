import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, runSmoke, EXPECTED_CALL_CONTROL_EVENTS } from "./tools-telnyx-live-smoke.mjs";

// A mock fetch keyed by URL substring → { status, ok }.
function mockFetch(routes) {
  const calls = [];
  return {
    calls,
    impl: async (url, init = {}) => {
      const u = String(url);
      calls.push({ url: u, method: init.method || "GET", body: init.body });
      const r = routes.find((x) => u.includes(x.match));
      const status = r ? r.status : 404;
      return { status, ok: status >= 200 && status < 300, async text() { return ""; } };
    },
  };
}

test("parseArgs reads --send-to and --confirm", () => {
  assert.deepEqual(parseArgs(["--send-to", "+12155550100", "--confirm"]), { sendTo: "+12155550100", confirm: true });
  assert.deepEqual(parseArgs([]), { sendTo: null, confirm: false });
});

test("runSmoke requires an api key and a fetch impl", async () => {
  await assert.rejects(() => runSmoke({ fetchImpl: () => {} }), /TELNYX_API_KEY/);
  await assert.rejects(() => runSmoke({ apiKey: "KEY" }), /fetchImpl/);
});

test("runSmoke reports ok when auth + all resources resolve", async () => {
  const { impl, calls } = mockFetch([
    { match: "/whoami", status: 200 },
    { match: "/messaging_profiles/", status: 200 },
    { match: "/call_control_applications/", status: 200 },
    { match: "/fax_applications/", status: 200 },
  ]);
  const { checks, failed } = await runSmoke({
    apiKey: "KEYtest", publicKey: "PUB",
    messagingProfileId: "MP", voiceConnectionId: "VC", faxConnectionId: "FC",
    fetchImpl: impl,
  });
  assert.equal(failed, 0);
  assert.equal(checks.find((c) => c.id === "auth").status, "ok");
  assert.equal(checks.find((c) => c.id === "public_key").status, "ok");
  assert.equal(checks.find((c) => c.id === "voice_connection").status, "ok");
  // Each resource was probed with the right endpoint.
  assert.ok(calls.some((c) => c.url.includes("/call_control_applications/VC")));
  assert.ok(calls.some((c) => c.url.includes("/fax_applications/FC")));
});

test("runSmoke fails on bad credentials and warns on a missing resource", async () => {
  const { impl } = mockFetch([
    { match: "/whoami", status: 401 },
    { match: "/messaging_profiles/", status: 404 },
  ]);
  const { checks, failed } = await runSmoke({
    apiKey: "KEYbad", messagingProfileId: "MP", fetchImpl: impl,
  });
  assert.equal(checks.find((c) => c.id === "auth").status, "fail");
  assert.equal(checks.find((c) => c.id === "messaging_profile").status, "warn");
  assert.ok(failed >= 1);
});

test("an unreachable API (network error) is a hard failure so CI can gate on it", async () => {
  const impl = async () => { throw new Error("ENOTFOUND api.telnyx.com"); };
  const { checks, failed } = await runSmoke({ apiKey: "KEY", fetchImpl: impl });
  assert.equal(checks.find((c) => c.id === "auth").status, "fail");
  assert.ok(failed >= 1, "network error must count as a failure (non-zero exit)");
});

test("missing public key is a warning, not a hard failure", async () => {
  const { impl } = mockFetch([{ match: "/whoami", status: 200 }]);
  const { checks } = await runSmoke({ apiKey: "KEY", publicKey: null, fetchImpl: impl });
  assert.equal(checks.find((c) => c.id === "public_key").status, "warn");
});

test("a real send is skipped unless --confirm is given", async () => {
  const { impl, calls } = mockFetch([{ match: "/whoami", status: 200 }, { match: "/messages", status: 200 }]);
  const noConfirm = await runSmoke({ apiKey: "KEY", sendTo: "+12155550100", confirm: false, fetchImpl: impl });
  assert.equal(noConfirm.checks.find((c) => c.id === "test_sms").status, "warn");
  assert.ok(!calls.some((c) => c.url.includes("/messages")), "no message POST without --confirm");

  const { impl: impl2, calls: calls2 } = mockFetch([{ match: "/whoami", status: 200 }, { match: "/messages", status: 200 }]);
  const confirmed = await runSmoke({ apiKey: "KEY", sendTo: "+12155550100", confirm: true, fetchImpl: impl2 });
  assert.equal(confirmed.checks.find((c) => c.id === "test_sms").status, "ok");
  assert.ok(calls2.some((c) => c.url.includes("/messages") && c.method === "POST"));
});

test("EXPECTED_CALL_CONTROL_EVENTS covers the events the webhook state machine uses", () => {
  for (const e of ["call.initiated", "call.answered", "call.speak.ended", "call.recording.saved", "call.transcription", "message.received"]) {
    assert.ok(EXPECTED_CALL_CONTROL_EVENTS.includes(e), `missing ${e}`);
  }
});
