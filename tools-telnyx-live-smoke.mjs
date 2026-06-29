#!/usr/bin/env node
// tools-telnyx-live-smoke — validate a live Telnyx account against the IDs this
// app expects, turning the integration's TODO(verify) items into real checks.
//
// It is SAFE by default: read-only API probes (auth + resource existence). It
// only sends a real text when you explicitly pass --send-to <e164> --confirm.
//
// Usage:
//   TELNYX_API_KEY=KEY... \
//   TELNYX_PUBLIC_KEY=... TELNYX_MESSAGING_PROFILE_ID=... \
//   TELNYX_VOICE_CONNECTION_ID=... TELNYX_FAX_CONNECTION_ID=... \
//   node tools-telnyx-live-smoke.mjs [--send-to +1215... --confirm]
//
// Exit code is non-zero if any check fails (auth/resource), so it can gate CI
// or a deploy step when a key is available.

const API = "https://api.telnyx.com/v2";

// The Call Control / Programmable-Fax events the webhook state machine relies
// on. A read-only API probe can't observe these (they require a real call), so
// we print them for the operator to confirm against Telnyx's webhook debugger
// when placing a test call. Keeping the list here makes the manual step concrete.
export const EXPECTED_CALL_CONTROL_EVENTS = [
  "call.initiated", "call.answered", "call.hangup", "call.speak.ended",
  "call.recording.saved", "call.transcription",
  "message.received", "message.sent", "message.finalized",
  "fax.queued", "fax.sending.started", "fax.delivered", "fax.failed",
];

export function parseArgs(argv = []) {
  const out = { sendTo: null, confirm: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--send-to") out.sendTo = argv[++i] || null;
    else if (a === "--confirm") out.confirm = true;
  }
  return out;
}

function classify(status) {
  if (status === 200) return "ok";
  // Network-unreachable (status 0 from probe()'s catch) and rejected credentials
  // are hard failures so this can gate CI/deploy. 404 (resource not found) stays
  // a warn since a missing/mistyped id isn't a connectivity failure.
  if (status === 0) return "fail";
  if (status === 401 || status === 403) return "fail";
  if (status === 404) return "warn";
  return "warn";
}

async function probe(fetchImpl, url, apiKey, init = {}) {
  try {
    const resp = await fetchImpl(url, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", ...(init.headers || {}) },
    });
    return { status: resp.status, ok: resp.ok };
  } catch (err) {
    return { status: 0, ok: false, error: String(err?.message || err) };
  }
}

/**
 * Run the smoke checks. Pure w.r.t. `fetchImpl` so it can be unit-tested with a
 * mock. Returns { checks: [{id,label,status,detail}], passed, failed }.
 */
export async function runSmoke({
  apiKey,
  publicKey = null,
  messagingProfileId = null,
  voiceConnectionId = null,
  faxConnectionId = null,
  sendTo = null,
  confirm = false,
  fetchImpl,
  log = () => {},
} = {}) {
  if (!apiKey) throw new Error("Missing TELNYX_API_KEY");
  if (typeof fetchImpl !== "function") throw new Error("fetchImpl is required");

  const checks = [];
  const add = (id, label, status, detail) => { checks.push({ id, label, status, detail }); log(`[${status}] ${label} — ${detail}`); };

  // 1) Auth.
  const who = await probe(fetchImpl, `${API}/whoami`, apiKey);
  add("auth", "API key authenticates", classify(who.status),
    who.status === 200 ? "Authenticated (/v2/whoami 200)."
      : who.status === 0 ? `Could not reach api.telnyx.com (${who.error}).`
        : `Telnyx returned HTTP ${who.status}.`);

  // 2) Webhook public key presence (correctness needs a signed webhook).
  add("public_key", "Webhook Ed25519 public key", publicKey ? "ok" : "warn",
    publicKey ? "Set — inbound webhooks can be verified." : "Not set — inbound webhooks will be rejected fail-closed.");

  // 3) Resource existence per channel.
  if (messagingProfileId) {
    const r = await probe(fetchImpl, `${API}/messaging_profiles/${encodeURIComponent(messagingProfileId)}`, apiKey);
    add("messaging_profile", "Messaging profile (text)", classify(r.status),
      r.status === 200 ? "Found." : r.status === 404 ? "Not found — check TELNYX_MESSAGING_PROFILE_ID." : `HTTP ${r.status}.`);
  } else {
    add("messaging_profile", "Messaging profile (text)", "warn", "No id configured.");
  }
  if (voiceConnectionId) {
    const r = await probe(fetchImpl, `${API}/call_control_applications/${encodeURIComponent(voiceConnectionId)}`, apiKey);
    add("voice_connection", "Call Control application (voice)", classify(r.status),
      r.status === 200 ? "Found." : r.status === 404 ? "Not found — check TELNYX_VOICE_CONNECTION_ID (must be a Call Control App)." : `HTTP ${r.status}.`);
  } else {
    add("voice_connection", "Call Control application (voice)", "warn", "No id configured.");
  }
  if (faxConnectionId) {
    const r = await probe(fetchImpl, `${API}/fax_applications/${encodeURIComponent(faxConnectionId)}`, apiKey);
    add("fax_connection", "Fax application (fax)", classify(r.status),
      r.status === 200 ? "Found." : r.status === 404 ? "Not found — check TELNYX_FAX_CONNECTION_ID (must be a Fax App)." : `HTTP ${r.status}.`);
  } else {
    add("fax_connection", "Fax application (fax)", "warn", "No id configured.");
  }

  // 4) Optional guarded real send.
  if (sendTo) {
    if (!confirm) {
      add("test_sms", "Test SMS send", "warn", `Skipped — re-run with --confirm to actually text ${sendTo}.`);
    } else {
      try {
        const resp = await fetchImpl(`${API}/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ to: sendTo, text: "PennSync Telnyx smoke test — please ignore.", ...(messagingProfileId ? { messaging_profile_id: messagingProfileId } : {}) }),
        });
        add("test_sms", "Test SMS send", resp.ok ? "ok" : "fail", resp.ok ? `Accepted (HTTP ${resp.status}).` : `Rejected (HTTP ${resp.status}).`);
      } catch (err) {
        add("test_sms", "Test SMS send", "fail", `Network error: ${String(err?.message || err)}`);
      }
    }
  }

  const failed = checks.filter((c) => c.status === "fail").length;
  const passed = checks.filter((c) => c.status === "ok").length;
  return { checks, passed, failed };
}

// CLI entry — only runs when invoked directly, not when imported by the test.
const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  const args = parseArgs(process.argv.slice(2));
  const cfg = {
    apiKey: process.env.TELNYX_API_KEY,
    publicKey: process.env.TELNYX_PUBLIC_KEY || null,
    messagingProfileId: process.env.TELNYX_MESSAGING_PROFILE_ID || null,
    voiceConnectionId: process.env.TELNYX_VOICE_CONNECTION_ID || process.env.TELNYX_CONNECTION_ID || null,
    faxConnectionId: process.env.TELNYX_FAX_CONNECTION_ID || null,
    sendTo: args.sendTo,
    confirm: args.confirm,
    fetchImpl: globalThis.fetch,
    log: (line) => console.log(line),
  };
  if (!cfg.apiKey) {
    console.error("Set TELNYX_API_KEY to run the live smoke test.");
    process.exit(2);
  }
  runSmoke(cfg).then(({ failed }) => {
    console.log("\nManual step — place one test call/text and confirm these event types arrive at handleTelnyxStatusWebhook:");
    console.log("  " + EXPECTED_CALL_CONTROL_EVENTS.join(", "));
    process.exit(failed > 0 ? 1 : 0);
  }).catch((err) => {
    console.error("Smoke run failed:", err?.message || err);
    process.exit(2);
  });
}
