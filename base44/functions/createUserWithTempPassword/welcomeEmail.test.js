import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transpileTs } from "../../../tools-transpile-ts.mjs";

/**
 * Unit tests for the branded welcome-email builder that lives inline in
 * createUserWithTempPassword/entry.ts (the Base44 Deno function that runs when an
 * admin sets up a new user). We transpile the function's TypeScript, neutralize
 * the Deno/`npm:` runtime bits, and import its pure exported builders so the
 * email content (role → manual mapping, download link, app-store section, HTML
 * escaping) is verified against the exact source that ships.
 */

// Stub the Deno global so the top-level `Deno.serve(...)` is a no-op on import.
globalThis.Deno = globalThis.Deno || { serve() {}, env: { get: () => undefined } };

async function loadBuilders() {
  let src = await readFile(new URL("./entry.ts", import.meta.url), "utf8");
  // Drop the `npm:@base44/sdk` import — unresolvable (and unneeded) under node.
  src = src.replace(/import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/, "");
  const js = transpileTs(src).outputText;
  const tmp = join(tmpdir(), `welcomeEmail_${process.pid}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(tmp, js);
  try {
    return await import(pathToFileURL(tmp).href);
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

const mod = await loadBuilders();
const {
  buildWelcomeEmail,
  manualForRole,
  escapeHtml,
  originOf,
  DEFAULT_IOS_APP_URL,
  DEFAULT_ANDROID_APP_URL,
  DEFAULT_SUPPORT_EMAIL,
} = mod;

const BASE = {
  fullName: "Jane Doe",
  email: "jane@example.test",
  appUrl: "https://app.example.test",
  manualsBaseUrl: "https://app.example.test",
  iosAppUrl: "https://apps.apple.com/app/pennsync",
  androidAppUrl: "https://play.google.com/store/apps/details?id=com.caremetric.pennsync",
  supportEmail: "info@caremetric.ai",
};

test("manualForRole maps clinical users to the User Manual", () => {
  const m = manualForRole("user");
  assert.equal(m.title, "User Manual");
  assert.equal(m.file, "PennSync-User-Manual.pdf");
});

test("manualForRole maps admins to the Facility Administrator Manual", () => {
  for (const role of ["admin", "agency_admin", "super_admin", "Admin"]) {
    const m = manualForRole(role);
    assert.equal(m.title, "Facility Administrator Manual", `role=${role}`);
    assert.equal(m.file, "PennSync-Facility-Admin-Manual.pdf", `role=${role}`);
  }
});

test("manualForRole defaults unknown/empty roles to the User Manual", () => {
  assert.equal(manualForRole(undefined).file, "PennSync-User-Manual.pdf");
  assert.equal(manualForRole("").file, "PennSync-User-Manual.pdf");
  assert.equal(manualForRole("therapist").file, "PennSync-User-Manual.pdf");
});

test("user email links the User Manual PDF with a download button", () => {
  const { subject, body } = buildWelcomeEmail({ ...BASE, role: "user" });
  assert.match(subject, /Welcome to PennSync/);
  assert.ok(body.includes("https://app.example.test/manuals/PennSync-User-Manual.pdf"));
  assert.ok(body.includes("Download the manual (PDF)"));
  assert.ok(body.includes("User Manual"));
  assert.ok(!body.includes("Facility Administrator Manual"));
});

test("admin email links the Facility Administrator Manual PDF", () => {
  const { body } = buildWelcomeEmail({ ...BASE, role: "admin" });
  assert.ok(body.includes("https://app.example.test/manuals/PennSync-Facility-Admin-Manual.pdf"));
  assert.ok(body.includes("Facility Administrator Manual"));
});

test("manuals base URL override and trailing slashes are handled", () => {
  const { body } = buildWelcomeEmail({
    ...BASE,
    role: "user",
    appUrl: "https://app.example.test/",
    manualsBaseUrl: "https://cdn.example.test/static/",
  });
  assert.ok(body.includes("https://cdn.example.test/static/manuals/PennSync-User-Manual.pdf"));
  assert.ok(!body.includes("static//manuals"));
});

test("originOf returns scheme+host and drops any path", () => {
  assert.equal(originOf("https://hub.base44.app/apps/abc123"), "https://hub.base44.app");
  assert.equal(originOf("https://app.pennsync.com/"), "https://app.pennsync.com");
  assert.equal(originOf("https://app.pennsync.com"), "https://app.pennsync.com");
});

test("manual link uses the app ORIGIN when appUrl carries a path (no manualsBaseUrl)", () => {
  // Regression: with a path-prefixed APP_URL the manual link must resolve to the
  // origin root (matching the in-app /manuals/... links), NOT the /apps/<id> path.
  const { body } = buildWelcomeEmail({
    ...BASE,
    role: "user",
    appUrl: "https://hub.base44.app/apps/68ee80d98929370f9e8f2932",
    manualsBaseUrl: undefined,
  });
  assert.ok(body.includes("https://hub.base44.app/manuals/PennSync-User-Manual.pdf"));
  assert.ok(!body.includes("/apps/68ee80d98929370f9e8f2932/manuals/"));
  // The sign-in button still uses the full app URL (with its path).
  assert.ok(body.includes("https://hub.base44.app/apps/68ee80d98929370f9e8f2932"));
});

test("app-store badges render only when store URLs are provided", () => {
  const withStores = buildWelcomeEmail({ ...BASE, role: "user" }).body;
  assert.ok(withStores.includes("App Store"));
  assert.ok(withStores.includes("Google Play"));
  assert.ok(withStores.includes(BASE.iosAppUrl));
  assert.ok(withStores.includes(BASE.androidAppUrl));

  const noStores = buildWelcomeEmail({
    ...BASE,
    role: "user",
    iosAppUrl: null,
    androidAppUrl: null,
  }).body;
  assert.ok(!noStores.includes("App Store"));
  assert.ok(!noStores.includes("Google Play"));
  // The install-as-an-app (PWA) instructions are always present.
  assert.ok(noStores.includes("Add to Home Screen"));
});

test("always includes app-install (Add to Home Screen) instructions", () => {
  const { body } = buildWelcomeEmail({ ...BASE, role: "user" });
  assert.ok(body.includes("Add to Home Screen"));
  assert.ok(/Safari/.test(body) && /Chrome/.test(body));
});

test("includes the recipient email and a sign-in link", () => {
  const { body } = buildWelcomeEmail({ ...BASE, role: "user" });
  assert.ok(body.includes("jane@example.test"));
  assert.ok(body.includes("https://app.example.test"));
  assert.ok(body.includes("Go to PennSync"));
});

test("escapeHtml neutralizes markup", () => {
  assert.equal(escapeHtml('<b>&"\'</b>'), "&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;");
});

test("attacker-controlled name is HTML-escaped (no raw markup in body)", () => {
  const { body } = buildWelcomeEmail({
    ...BASE,
    role: "user",
    fullName: '<script>alert(1)</script>',
  });
  assert.ok(!body.includes("<script>alert(1)</script>"));
  assert.ok(body.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
});

test("blank name falls back to a friendly greeting", () => {
  const { body } = buildWelcomeEmail({ ...BASE, role: "user", fullName: "   " });
  assert.ok(body.includes("Welcome to PennSync, there!"));
});

test("ships the info@caremetric.ai support default as a mailto link", () => {
  assert.equal(DEFAULT_SUPPORT_EMAIL, "info@caremetric.ai");
  const { body } = buildWelcomeEmail({ ...BASE, role: "user", supportEmail: DEFAULT_SUPPORT_EMAIL });
  assert.ok(body.includes('mailto:info@caremetric.ai'));
  assert.ok(body.includes("contact <a"));
  // No placeholder / inviting-admin address leaks into the support line.
  assert.ok(!body.includes("sunrisehealth"));
  assert.ok(!body.includes("contact your administrator"));
});

test("falls back to 'contact your administrator' as plain text when no support email", () => {
  const { body } = buildWelcomeEmail({ ...BASE, role: "user", supportEmail: null });
  assert.ok(body.includes("contact your administrator"));
  assert.ok(!body.includes("mailto:your"));
});

test("ships the published App Store / Play Store defaults", () => {
  assert.equal(DEFAULT_IOS_APP_URL, "https://apps.apple.com/us/app/caremetric-ai/id6757097720");
  assert.equal(DEFAULT_ANDROID_APP_URL, "https://play.google.com/store/apps/details?id=com.caremetic.ai");
  // Rendering with the shipped defaults produces working badges.
  const { body } = buildWelcomeEmail({
    ...BASE,
    role: "user",
    iosAppUrl: DEFAULT_IOS_APP_URL,
    androidAppUrl: DEFAULT_ANDROID_APP_URL,
  });
  assert.ok(body.includes(DEFAULT_IOS_APP_URL));
  assert.ok(body.includes(DEFAULT_ANDROID_APP_URL));
  assert.ok(body.includes("App Store"));
  assert.ok(body.includes("Google Play"));
});
