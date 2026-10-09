import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transpileTs } from "../../tools-transpile-ts.mjs";

/**
 * getVoicemailPlaybackUrl signs a short-lived link to a voicemail the webhook
 * copied into private storage. The authorization decision is the caller's OWN
 * CallLog read (RLS); the service role only signs. These tests give the user
 * read and the service-role read DIFFERENT answers, so a handler that decided
 * with the service role would be caught rather than happen to agree.
 */

const ENTRY_URL = new URL("../functions/getVoicemailPlaybackUrl/entry.ts", import.meta.url);

async function loadHandler(makeClient) {
  let source = await readFile(ENTRY_URL, "utf8");
  source = source.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    "const createClientFromRequest = globalThis.__voicemailPlaybackMakeClient;",
  );
  const tempPath = join(tmpdir(), `voicemail-playback-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(tempPath, transpileTs(source).outputText);
  let handler;
  globalThis.__voicemailPlaybackMakeClient = makeClient;
  globalThis.Deno = { serve: (candidate) => { handler = candidate; }, env: { get: () => undefined } };
  try {
    await import(`${pathToFileURL(tempPath).href}?v=${Date.now()}`);
  } finally {
    await unlink(tempPath).catch(() => {});
  }
  return handler;
}

const STORED = { id: "CallLog_1", nurse_email: "n@x.com", has_voicemail: true, voicemail_url: "private/voicemail/1.mp3" };

function makeClient({ user = { id: "u1", email: "n@x.com", role: "user" }, visible = [STORED], everything = [STORED], signedUrl = "https://storage.example/signed?sig=1" } = {}) {
  const calls = [];
  const exact = (rows, query) => rows.filter((row) => Object.entries(query || {}).every(([key, value]) => row[key] === value));
  const client = {
    auth: { me: async () => user },
    // The caller's own read: only the rows RLS shows them.
    entities: { CallLog: { filter: async (query, sort, limit) => { calls.push(["user.CallLog.filter", query, limit]); return exact(visible, query); } } },
    asServiceRole: {
      // A service-role read would see every row; deciding with it would be a leak.
      entities: { CallLog: { filter: async (query) => { calls.push(["service.CallLog.filter", query]); return exact(everything, query); } } },
      integrations: { Core: { CreateFileSignedUrl: async (input) => { calls.push(["sign", input]); return { signed_url: signedUrl }; } } },
    },
  };
  return { client, calls };
}

const post = (body, method = "POST") => new Request("https://app/functions/getVoicemailPlaybackUrl", {
  method, headers: { "content-type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body),
});

test("a caller who can read the call gets a five-minute signed link and nothing is cached", async () => {
  const { client, calls } = makeClient();
  const handler = await loadHandler(() => client);
  const response = await handler(post({ call_log_id: "CallLog_1" }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.url, "https://storage.example/signed?sig=1");
  assert.equal(body.expires_in, 300);
  assert.deepEqual(calls.find(([name]) => name === "sign")[1], { file_uri: "private/voicemail/1.mp3", expires_in: 300 });
  assert.ok(!calls.some(([name]) => name === "service.CallLog.filter"), "the service role never reads the row");
});

test("a row the caller's own read does not return is refused, whatever the service role sees", async () => {
  const { client, calls } = makeClient({ visible: [] });
  const handler = await loadHandler(() => client);
  const response = await handler(post({ call_log_id: "CallLog_1" }));
  assert.equal(response.status, 404);
  assert.equal((await response.json()).code, "VOICEMAIL_NOT_FOUND");
  assert.ok(!calls.some(([name]) => name === "sign"), "nothing is signed for a row the caller cannot read");
});

test("a legacy provider link, a row without a voicemail and bad input sign nothing", async () => {
  for (const [label, visible, body, status, code] of [
    ["legacy https link", [{ ...STORED, voicemail_url: "https://s3.amazonaws.com/rec.mp3" }], { call_log_id: "CallLog_1" }, 404, "VOICEMAIL_NOT_STORED"],
    ["no voicemail", [{ ...STORED, has_voicemail: false }], { call_log_id: "CallLog_1" }, 404, "VOICEMAIL_NOT_FOUND"],
    ["two rows for one id", [STORED, STORED], { call_log_id: "CallLog_1" }, 404, "VOICEMAIL_NOT_FOUND"],
    ["missing id", [STORED], {}, 400, "INVALID_CALL_LOG_ID"],
    ["operator id", [STORED], { call_log_id: "$ne" }, 400, "INVALID_CALL_LOG_ID"],
    ["array body", [STORED], ["CallLog_1"], 400, "INVALID_CALL_LOG_ID"],
  ]) {
    const { client, calls } = makeClient({ visible });
    const handler = await loadHandler(() => client);
    const response = await handler(post(body));
    assert.equal(response.status, status, label);
    assert.equal((await response.json()).code, code, label);
    assert.ok(!calls.some(([name]) => name === "sign"), `${label}: nothing signed`);
  }
});

test("anonymous, deactivated and non-POST callers are refused before any read", async () => {
  for (const [label, user, method, status] of [
    ["anonymous", null, "POST", 401],
    ["deactivated", { id: "u1", email: "n@x.com", is_active: false }, "POST", 403],
    ["service account", { id: "u1", email: "n@x.com", is_service: true }, "POST", 403],
    ["GET", { id: "u1", email: "n@x.com" }, "GET", 405],
  ]) {
    const { client, calls } = makeClient({ user });
    const handler = await loadHandler(() => client);
    const response = await handler(post({ call_log_id: "CallLog_1" }, method));
    assert.equal(response.status, status, label);
    assert.equal(calls.length, 0, `${label}: no read, no signing`);
  }
});

test("a signer answer that is not an https link is never handed to the browser", async () => {
  for (const signedUrl of ["http://storage.example/x", "javascript:alert(1)", "", null]) {
    const { client } = makeClient({ signedUrl });
    const handler = await loadHandler(() => client);
    const response = await handler(post({ call_log_id: "CallLog_1" }));
    assert.equal(response.status, 502, String(signedUrl));
    assert.equal((await response.json()).url, undefined);
  }
});
