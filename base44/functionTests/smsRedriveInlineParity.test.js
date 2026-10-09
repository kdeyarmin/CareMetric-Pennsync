import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transpileTs } from "../../tools-transpile-ts.mjs";

import * as smsRedrive from "../../src/components/messaging/smsRedrive.js";

/**
 * Drift guard for the SMS redrive policy redriveFailedSms inlines (single-file
 * Deno deploy). src/components/messaging/smsRedrive.js is the unit-tested
 * source; this asserts the inline copy decides every reason the same way, so a
 * pattern added to one — such as the "outcome unknown" refusal that keeps a
 * timed-out send from being texted twice — cannot be missing from the other.
 */
globalThis.Deno = globalThis.Deno || { serve() {}, env: { get: () => undefined } };

async function loadInline(entryPath, names) {
  let src = await readFile(new URL(entryPath, import.meta.url), "utf8");
  src = src.replace(/import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/, "const createClientFromRequest = () => ({});");
  const js = transpileTs(src).outputText;
  const tmp = join(tmpdir(), `smsredrive_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(tmp, `${js}\nexport { ${names.join(", ")} };\n`);
  try {
    return await import(pathToFileURL(tmp).href);
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

const REASONS = [
  "Outcome unknown: Telnyx did not answer within 15000 ms, so the text may have been sent. Not retried automatically.",
  "Outcome unknown: Telnyx did not answer the redrive in time, so the text may have been sent. Not retried automatically.",
  "Outcome unknown: the connection to Telnyx failed after the request may have been sent. Not retried automatically.",
  "Connection never opened: Telnyx could not be reached, so the text was not sent.",
  "Timed out after 15000 ms reaching Telnyx",
  "Timed out reaching Telnyx (redrive)",
  "Network error reaching Telnyx: dns error",
  "Telnyx API error (503)",
  "Telnyx API error (502)",
  "Invalid response from Telnyx API (502)",
  "Invalid 'To' number (503 while validating)",
  "Blocked due to STOP message",
  "Recipient opted out",
  "rate limit exceeded",
  "Telnyx delivery failed: code 40006: Carrier temporarily unavailable",
  "",
  null,
];
// Every status, in the format the writers now use, with and without a code.
for (let status = 100; status <= 599; status += 1) {
  REASONS.push(smsRedrive.telnyxApiFailureReason(status, [{ code: "10011", detail: "Too many requests" }]));
  REASONS.push(smsRedrive.telnyxApiFailureReason(status, []));
}
REASONS.push(smsRedrive.telnyxApiFailureReason(429, [{ code: smsRedrive.TELNYX_OPT_OUT_ERROR_CODE, title: "Blocked" }]));
REASONS.push(smsRedrive.telnyxApiFailureReason(503, [{ code: smsRedrive.TELNYX_OPT_OUT_ERROR_CODE }]));

test("redriveFailedSms inlines the smsRedrive policy unchanged", async () => {
  const inline = await loadInline("../functions/redriveFailedSms/entry.ts", ["isTransientFailureReason", "shouldRedriveSms"]);
  const now = Date.parse("2026-06-04T12:05:00Z");
  // The policy is not vacuous: both outcomes occur in the list.
  assert.ok(REASONS.some((reason) => smsRedrive.isTransientFailureReason(reason)));
  assert.ok(REASONS.some((reason) => reason && !smsRedrive.isTransientFailureReason(reason)));
  for (const reason of REASONS) {
    assert.equal(inline.isTransientFailureReason(reason), smsRedrive.isTransientFailureReason(reason), `isTransientFailureReason(${reason})`);
    const row = {
      status: "failed", direction: "outbound", failure_reason: reason, retry_count: 0,
      created_date: "2026-06-04T12:00:00Z", last_retry_at: null,
    };
    assert.equal(inline.shouldRedriveSms(row, now), smsRedrive.shouldRedriveSms(row, now), `shouldRedriveSms(${reason})`);
    // A row a manual Resend superseded is never redriven by either copy.
    const superseded = { ...row, superseded_by: "client_resend" };
    assert.equal(inline.shouldRedriveSms(superseded, now), false, `superseded: ${reason}`);
    assert.equal(smsRedrive.shouldRedriveSms(superseded, now), false, `superseded: ${reason}`);
    // Nor is an MMS, which a redrive would send as text only.
    const mms = { ...row, media: [{ status: "sent", external_url: "https://files.example.test/a.pdf" }] };
    assert.equal(inline.shouldRedriveSms(mms, now), false, `mms: ${reason}`);
    assert.equal(smsRedrive.shouldRedriveSms(mms, now), false, `mms: ${reason}`);
  }
});
