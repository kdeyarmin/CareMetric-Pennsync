import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transpileTs } from "../../tools-transpile-ts.mjs";

/**
 * Outbound fax origination (product owner, 2026-10-09: "I want the outgoing fax
 * number to be the office number so all return faxes are routed to the
 * office"). Each of the three senders inlines the shared `faxOrigination`
 * helper; this drives every copy against a mocked Telnyx
 * GET /v2/verified_numbers/{phone_number} (OpenAPI spec, read 2026-10-09) and
 * checks each sender actually sends from what the helper decides. Never calls
 * Telnyx.
 */

const SENDERS = ["sendFax", "sendBatchFax", "sendAuthorizedReferralFax"];
const OFFICE = "+17244650444";
const BLIND = "+17244418937";

async function loadInline(name) {
  let src = await readFile(new URL(`../functions/${name}/entry.ts`, import.meta.url), "utf8");
  src = src.replace(/import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/, "const createClientFromRequest = () => ({});");
  const tmp = join(tmpdir(), `faxorig_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(tmp, `${transpileTs(src).outputText}\nexport { resolveFaxOrigination };\n`);
  globalThis.Deno = { serve() {}, env: { get: () => undefined } };
  try {
    return (await import(pathToFileURL(tmp).href)).resolveFaxOrigination;
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

function provider(answer) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({
      url: String(url), method: init.method || "GET", authorization: init.headers?.Authorization,
      signal: init.signal, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return answer(String(url), init);
  };
  return calls;
}

const verified = (number = OFFICE) => () => Response.json({ data: {
  phone_number: number, record_type: "verified_number", verified_at: "2026-10-09T12:00:00.000000",
} });

test("every sender's origination copy sends from a verified office number and nothing else", async () => {
  for (const name of SENDERS) {
    const resolveFaxOrigination = await loadInline(name);
    const cases = [
      ["verified", verified(), { from: OFFICE, officeVerified: true, warning: null }],
      ["verification pending (no verified_at)", () => Response.json({ data: { phone_number: OFFICE } }),
        { from: BLIND, officeVerified: false, warning: "office_fax_number_unverified" }],
      ["a different number's record", verified("+17244650400"),
        { from: BLIND, officeVerified: false, warning: "office_fax_number_unverified" }],
      ["not a verified number (404)", () => Response.json({ errors: [{ title: "Not found" }] }, { status: 404 }),
        { from: BLIND, officeVerified: false, warning: "office_fax_number_unverified" }],
      ["unauthorized key (401)", () => Response.json({}, { status: 401 }),
        { from: BLIND, officeVerified: false, warning: "office_fax_verification_unavailable" }],
      ["provider error (503)", () => Response.json({}, { status: 503 }),
        { from: BLIND, officeVerified: false, warning: "office_fax_verification_unavailable" }],
      ["network error", () => { throw new TypeError("fetch failed"); },
        { from: BLIND, officeVerified: false, warning: "office_fax_verification_unavailable" }],
      ["timeout", () => { throw new DOMException("The operation timed out.", "TimeoutError"); },
        { from: BLIND, officeVerified: false, warning: "office_fax_verification_unavailable" }],
      ["unreadable body", () => new Response("not json", { status: 200 }),
        { from: BLIND, officeVerified: false, warning: "office_fax_number_unverified" }],
    ];
    for (const [label, answer, expected] of cases) {
      const calls = provider(answer);
      const result = await resolveFaxOrigination(new Request("https://app/x"), " KEYtest ", OFFICE, BLIND);
      assert.deepEqual(result, expected, `${name}: ${label}`);
      assert.equal(calls.length, 1, `${name}: ${label}`);
      assert.equal(calls[0].url, "https://api.telnyx.com/v2/verified_numbers/%2B17244650444");
      assert.equal(calls[0].method, "GET");
      assert.equal(calls[0].authorization, "Bearer KEYtest");
      assert.ok(calls[0].signal instanceof AbortSignal, `${name}: the lookup is bounded`);
    }
  }
});

test("no lookup is made when there is nothing to verify, and a batch asks once", async () => {
  for (const name of SENDERS) {
    const resolveFaxOrigination = await loadInline(name);
    const calls = provider(verified());
    const req = new Request("https://app/x");
    // No distinct office number: the blind line, exactly as before.
    assert.deepEqual(await resolveFaxOrigination(req, "KEY", null, BLIND), { from: BLIND, officeVerified: null, warning: null });
    assert.deepEqual(await resolveFaxOrigination(req, "KEY", BLIND, BLIND), { from: BLIND, officeVerified: null, warning: null });
    // No blind line: the office number IS the Telnyx line (legacy configuration).
    assert.deepEqual(await resolveFaxOrigination(req, "KEY", OFFICE, null), { from: OFFICE, officeVerified: null, warning: null });
    assert.equal(calls.length, 0, `${name}: nothing to verify`);
    // No key: nothing can be asked, the blind line stays.
    assert.deepEqual(await resolveFaxOrigination(req, "", OFFICE, BLIND),
      { from: BLIND, officeVerified: false, warning: "office_fax_verification_unavailable" });
    assert.equal(calls.length, 0);
    // Cached per request: a batch of recipients asks Telnyx once.
    await resolveFaxOrigination(req, "KEY", OFFICE, BLIND);
    await resolveFaxOrigination(req, "KEY", OFFICE, BLIND);
    assert.equal(calls.length, 1, `${name}: one lookup per request`);
    await resolveFaxOrigination(new Request("https://app/y"), "KEY", OFFICE, BLIND);
    assert.equal(calls.length, 2, `${name}: a new request asks again`);
  }
});

test("each sender records and sends the origination number, with the office display name kept", async () => {
  const wiring = {
    sendFax: { decide: "resolveFaxOrigination(req, apiKey, officeFax, outboundFax)", from: "sendFrom" },
    sendBatchFax: { decide: "resolveFaxOrigination(\n    req, credentials.apiKey, authority.officeFax, authority.fromNumber,\n  )", from: "originationNumber" },
    sendAuthorizedReferralFax: { decide: "resolveFaxOrigination(req, finalCredentials.apiKey, officeFax, outboundFax)", from: "sendFrom" },
  };
  for (const [name, { decide, from }] of Object.entries(wiring)) {
    const source = await readFile(new URL(`../functions/${name}/entry.ts`, import.meta.url), "utf8");
    const body = source.slice(source.indexOf("<<<END SHARED HELPER: faxOrigination>>>"));
    const decision = body.indexOf(decide);
    const create = body.indexOf("FaxLog.create(");
    const post = body.indexOf("fetch('https://api.telnyx.com/v2/faxes'");
    assert.ok(decision > -1, `${name}: decides the origination`);
    assert.ok(decision < create && create < post, `${name}: decided before the FaxLog and the POST`);
    assert.match(body, new RegExp(`from_number: ${from},`), `${name}: the FaxLog records the number sent`);
    assert.match(body, new RegExp(`\\bfrom: ${from},`), `${name}: the provider payload uses it`);
    assert.match(body, /from_display_name = displayName/, `${name}: the office display name is kept`);
    assert.match(body, /origination_warning/, `${name}: reports why the blind line was used`);
  }
  // The automatic retry reaches sendBatchFax's submitOneFax, and so this decision.
  const retry = await readFile(new URL("../functions/autoRetryFailedFaxes/entry.ts", import.meta.url), "utf8");
  assert.match(retry, /functions\.invoke\('sendBatchFax', \{\s*action: 'dispatch_retry'/);
  const batch = await readFile(new URL("../functions/sendBatchFax/entry.ts", import.meta.url), "utf8");
  assert.match(batch, /const result = await submitOneFax\(base44, req, \{\s*\.\.\.retry\.expected/);
});

async function loadSendFax() {
  let src = await readFile(new URL("../functions/sendFax/entry.ts", import.meta.url), "utf8");
  src = src.replace(/import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/, "const createClientFromRequest = globalThis.__faxOriginClient;");
  const tmp = join(tmpdir(), `faxorig_send_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(tmp, transpileTs(src).outputText);
  let handler;
  const env = { OUTBOUND_DELIVERY_RELEASE: "enabled-v1", SUPER_ADMIN_EMAIL: "n@x.com" };
  globalThis.Deno = { serve: (h) => { handler = h; }, env: { get: (k) => env[k] } };
  try {
    await import(pathToFileURL(tmp).href);
  } finally {
    await unlink(tmp).catch(() => {});
  }
  return handler;
}

test("sendFax end to end: a verified office number becomes the from; otherwise the blind line, as before", async () => {
  const settings = { office_fax_number_e164: OFFICE, outbound_fax_number_e164: BLIND };
  for (const [answer, expectedFrom, warning] of [
    [verified(), OFFICE, undefined],
    [() => Response.json({}, { status: 404 }), BLIND, "office_fax_number_unverified"],
  ]) {
    const faxLogs = [];
    const entities = new Proxy({}, { get: (_target, name) => ({
      filter: async () => (name === "IntegrationSecret"
        ? [{ id: "i1", provider: "telnyx", is_active: true, api_key: "KEYtest", fax_connection_id: "FC1" }]
        : []),
      list: async () => (name === "AgencySettings" ? [settings] : []),
      create: async (row) => {
        const created = { id: `${String(name)}_1`, ...row };
        if (name === "FaxLog") faxLogs.push(created);
        return created;
      },
      update: async (id, patch) => ({ id, ...patch }),
    }) });
    globalThis.__faxOriginClient = () => ({
      auth: { me: async () => ({ email: "n@x.com", role: "admin", full_name: "Nora" }) },
      entities,
      asServiceRole: { entities },
    });
    const handler = await loadSendFax();
    const calls = provider((url, init) => (url === "https://api.telnyx.com/v2/faxes" && init.method === "POST"
      ? Response.json({ data: { id: "fax_9", status: "queued" } }, { status: 202 })
      : answer(url, init)));
    const response = await handler(new Request("https://app/functions/sendFax", {
      method: "POST",
      body: JSON.stringify({ file_url: "https://base44.app/files/x.pdf", to_number: "+12155550144" }),
    }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).origination_warning, warning);
    const post = calls.find((call) => call.url === "https://api.telnyx.com/v2/faxes");
    assert.equal(post.body.from, expectedFrom);
    assert.equal(post.body.from_display_name, "Office Fax 724-465-0444");
    assert.equal(faxLogs[0].from_number, expectedFrom);
    assert.equal(calls.filter((call) => call.url.includes("/v2/verified_numbers/")).length, 1);
  }
});
