import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateAgencyConfig,
  summarize,
  functionUrlBase,
  WEBHOOK_FUNCTIONS,
  buildIntegrationSteps,
  summarizeSteps,
} from "./twilioSetup.js";

function byId(checks, id) {
  return checks.find((c) => c.id === id);
}

// A fully wired set of inputs, reused/tweaked by the step tests below.
// Telnyx credentials live in the secret panel, not in agency settings, so
// READY_INPUTS only carries office/template settings for agencySettings.
const READY_INPUTS = {
  secretStatus: { configured: true, source: "config", api_key_last_four: "9abc" },
  agencySettings: {
    main_office_number_e164: "+12155550100",
    default_off_duty_template: "We are closed; call {office}.",
    sms_messaging_enabled: true,
  },
  provisioning: { total: 5, withWorkNumber: 3, missingBridgeCell: 0 },
  liveResult: { checks: [{ id: "a", status: "ok" }, { id: "b", status: "ok" }] },
};

test("an empty config produces only warn checks (no required fields removed)", () => {
  const checks = evaluateAgencyConfig({});
  // All checks should be warn or ok — no required provider fields in Telnyx setup
  for (const c of checks) {
    assert.ok(c.status === "warn" || c.status === "ok", `unexpected fail status for ${c.id}`);
  }
});

test("a complete config is ready (no failures)", () => {
  const checks = evaluateAgencyConfig({
    main_office_number_e164: "+12155550100",
    default_off_duty_template: "We are closed; call {office}.",
    sms_messaging_enabled: true,
  });
  const sum = summarize(checks);
  assert.equal(sum.fail, 0);
  assert.equal(sum.ready, true);
  assert.equal(sum.severity, "ok");
});

test("missing main office is a warning, not a failure", () => {
  const checks = evaluateAgencyConfig({});
  assert.equal(byId(checks, "main_office").status, "warn");
  // No failures → the integration config is still "ready"
  assert.equal(summarize(checks).ready, true);
});

test("a malformed main office number warns", () => {
  const checks = evaluateAgencyConfig({ main_office_number_e164: "12" });
  assert.equal(byId(checks, "main_office").status, "warn");
});

test("the SMS kill switch surfaces as a warning when off", () => {
  const checks = evaluateAgencyConfig({ sms_messaging_enabled: false });
  assert.equal(byId(checks, "sms_enabled").status, "warn");
});

test("missing off-duty template warns", () => {
  const checks = evaluateAgencyConfig({});
  assert.equal(byId(checks, "off_duty_template").status, "warn");
});

test("no sms_subaccount / voice_subaccount / region checks exist (removed)", () => {
  const checks = evaluateAgencyConfig({});
  assert.equal(byId(checks, "sms_subaccount"), undefined);
  assert.equal(byId(checks, "voice_subaccount"), undefined);
  assert.equal(byId(checks, "voice_api_base"), undefined);
  assert.equal(byId(checks, "region"), undefined);
});

test("summarize picks the worst severity and counts statuses", () => {
  const sum = summarize([
    { id: "1", status: "ok" },
    { id: "2", status: "warn" },
    { id: "3", status: "fail" },
    { id: "4", status: "ok" },
  ]);
  assert.equal(sum.ok, 2);
  assert.equal(sum.warn, 1);
  assert.equal(sum.fail, 1);
  assert.equal(sum.total, 4);
  assert.equal(sum.severity, "fail");
  assert.equal(sum.ready, false);
});

test("summarize treats an empty list as not ready", () => {
  const sum = summarize([]);
  assert.equal(sum.ready, false);
  assert.equal(sum.severity, "ok");
});

test("functionUrlBase extracts the origin, or null when unparseable", () => {
  assert.equal(functionUrlBase("https://api.base44.com/apps/x"), "https://api.base44.com");
  assert.equal(functionUrlBase("https://api.base44.com"), "https://api.base44.com");
  assert.equal(functionUrlBase(""), null);
  assert.equal(functionUrlBase(null), null);
  assert.equal(functionUrlBase("not a url"), null);
});

// ---- buildIntegrationSteps / summarizeSteps -------------------------------

test("buildIntegrationSteps returns the ordered setup steps", () => {
  const steps = buildIntegrationSteps({});
  assert.deepEqual(
    steps.map((s) => s.id),
    ["api_secret", "agency_config", "provisioning", "webhooks", "live_test"],
  );
  // Every step carries a status, kind, and a jump anchor.
  for (const s of steps) {
    assert.ok(["done", "todo", "attention"].includes(s.status));
    assert.ok(["required", "verify", "manual"].includes(s.kind));
    assert.ok(s.anchor && s.title && s.detail);
  }
});

test("buildIntegrationSteps uses the Telnyx secret anchor", () => {
  const steps = buildIntegrationSteps({});
  assert.equal(byId(steps, "api_secret").anchor, "telnyx-secret");
});

test("buildIntegrationSteps with empty inputs leaves required steps undone", () => {
  const steps = buildIntegrationSteps({});
  assert.equal(byId(steps, "api_secret").status, "todo");
  // No credentials → secret step is todo; agency config has only warn → done
  assert.equal(byId(steps, "agency_config").status, "done");
  assert.equal(byId(steps, "provisioning").status, "todo");
  assert.equal(byId(steps, "live_test").status, "todo");
});

test("buildIntegrationSteps reflects a fully wired, verified integration (api_key_last_four)", () => {
  const steps = buildIntegrationSteps(READY_INPUTS);
  assert.equal(byId(steps, "api_secret").status, "done");
  assert.match(byId(steps, "api_secret").detail, /9abc/);
  assert.equal(byId(steps, "agency_config").status, "done");
  assert.equal(byId(steps, "provisioning").status, "done");
  assert.equal(byId(steps, "live_test").status, "done");
});

test("a dashboard-env secret reads as configured without a last-four", () => {
  const steps = buildIntegrationSteps({ secretStatus: { configured: true, source: "env" } });
  const s = byId(steps, "api_secret");
  assert.equal(s.status, "done");
  assert.match(s.detail, /dashboard env/);
});

test("provisioned nurses missing a bridge cell raise an attention step", () => {
  const steps = buildIntegrationSteps({
    ...READY_INPUTS,
    provisioning: { total: 5, withWorkNumber: 3, missingBridgeCell: 2 },
  });
  const s = byId(steps, "provisioning");
  assert.equal(s.status, "attention");
  assert.match(s.detail, /bridge cell/);
});

test("a failing live test surfaces as attention, never blocks readiness", () => {
  const steps = buildIntegrationSteps({
    ...READY_INPUTS,
    liveResult: { checks: [{ id: "a", status: "fail" }, { id: "b", status: "ok" }] },
  });
  assert.equal(byId(steps, "live_test").status, "attention");
  // live_test is a 'verify' step, so the required set is still complete.
  assert.equal(summarizeSteps(steps).ready, true);
});

test("webhooks is a manual step we never auto-complete", () => {
  const steps = buildIntegrationSteps(READY_INPUTS);
  const w = byId(steps, "webhooks");
  assert.equal(w.kind, "manual");
  assert.equal(w.status, "todo");
});

test("step 1 wording says Telnyx API key", () => {
  const steps = buildIntegrationSteps({});
  const s = byId(steps, "api_secret");
  assert.match(s.title, /Telnyx API key/i);
  assert.match(s.detail, /Telnyx API key/i);
});

test("step 4 wording says Telnyx Portal", () => {
  const steps = buildIntegrationSteps({});
  const w = byId(steps, "webhooks");
  assert.match(w.title, /Telnyx/i);
  assert.match(w.detail, /Telnyx Portal/);
});

test("summarizeSteps tracks required progress and percent", () => {
  const empty = summarizeSteps(buildIntegrationSteps({}));
  assert.equal(empty.requiredTotal, 3);
  // With empty inputs: secret=todo, agency_config=done (only warns), provisioning=todo → 1 done
  assert.equal(empty.requiredDone, 1);
  assert.equal(empty.ready, false);

  const ready = summarizeSteps(buildIntegrationSteps(READY_INPUTS));
  assert.equal(ready.requiredDone, 3);
  assert.equal(ready.percent, 100);
  assert.equal(ready.ready, true);
});

test("summarizeSteps points nextStep at the first unfinished required step", () => {
  // Secret not done → next is the secret step.
  const steps = buildIntegrationSteps({});
  const sum = summarizeSteps(steps);
  assert.equal(sum.nextStep.id, "api_secret");
});

test("summarizeSteps falls through to verify/manual once required steps are done", () => {
  // All required done, no live test run yet → next is a non-required step.
  const steps = buildIntegrationSteps({ ...READY_INPUTS, liveResult: null });
  const sum = summarizeSteps(steps);
  assert.equal(sum.ready, true);
  assert.ok(sum.nextStep && sum.nextStep.kind !== "required");
});

test("summarizeSteps handles a non-array input safely", () => {
  const sum = summarizeSteps(undefined);
  assert.equal(sum.total, 0);
  assert.equal(sum.ready, false);
  assert.equal(sum.nextStep, null);
});

test("WEBHOOK_FUNCTIONS points every connection at the single Telnyx handler", () => {
  assert.equal(WEBHOOK_FUNCTIONS.length, 3);
  // Telnyx delivers all event types to one webhook function.
  assert.ok(WEBHOOK_FUNCTIONS.every((w) => w.fn === "handleTelnyxStatusWebhook"));
  for (const w of WEBHOOK_FUNCTIONS) {
    assert.ok(w.event && w.configuredOn, "each entry has an event + where it's configured");
  }
});

test("WEBHOOK_FUNCTIONS configuredOn references Telnyx concepts (no legacy sub-account references)", () => {
  for (const w of WEBHOOK_FUNCTIONS) {
    assert.ok(
      !w.configuredOn.includes("sub-account"),
      `configuredOn should not mention sub-account: ${w.configuredOn}`,
    );
  }
});
