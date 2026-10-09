import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import JSON5 from "json5";
import { describe, expect, it } from "vitest";

const REPO_DIR = process.cwd();
const read = (relativePath) => readFileSync(join(REPO_DIR, relativePath), "utf8");

function productionSources(root = "src") {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (/\.(?:js|jsx|ts|tsx|mjs)$/.test(entry.name)
        && !/\.(?:test|spec)\.[^.]+$/.test(entry.name)) {
        files.push(path);
      }
    }
  };
  visit(join(REPO_DIR, root));
  return files;
}

function directEntityConsumers(entityName) {
  const pattern = new RegExp(
    `\\bentities\\.${entityName}\\s*\\.\\s*(?:filter|list|get|create|update|delete)\\s*\\(`,
  );
  return productionSources()
    .filter((path) => pattern.test(readFileSync(path, "utf8")))
    .map((path) => path.slice(REPO_DIR.length + 1))
    .sort();
}

describe("telecom presentation containment", () => {
  it("keeps service-only telecom entities out of every production browser source", () => {
    for (const entityName of [
      "SmsConsent",
      "ScheduledFax",
      "TelehealthSession",
    ]) {
      const schema = JSON5.parse(read(`base44/entities/${entityName}.jsonc`));
      expect(schema.rls, `${entityName} must remain service-only`).toEqual({
        read: false,
        create: false,
        update: false,
        delete: false,
      });
      expect(directEntityConsumers(entityName), `${entityName} browser consumers`).toEqual([]);
    }
  });

  it("reads the nurse's own texts and scheduled texts, and nothing wider", () => {
    // Restored 2026-10-08 (owner decision). Each entity has exactly one
    // browser consumer, which filters to the caller's own rows (RLS admits a
    // non-admin to nothing else), and every patient label comes from the
    // authorized `contact` projection.
    expect(directEntityConsumers("SmsMessage")).toEqual([
      "src/components/messaging/SmsConversationList.jsx",
    ]);
    expect(directEntityConsumers("ScheduledSms")).toEqual([
      "src/components/messaging/ScheduledSmsList.jsx",
    ]);
    const inbox = read("src/components/messaging/SmsConversationList.jsx");
    expect(inbox).toMatch(/entities\.SmsMessage\.filter\(\{ nurse_email: user\.email \}/);
    expect(inbox).toMatch(/<SmsThreadView/);
    const queue = read("src/components/messaging/ScheduledSmsList.jsx");
    expect(queue).toMatch(/entities\.ScheduledSms\.filter\(\{ nurse_email: user\.email, status: "pending" \}/);
    expect(queue).toMatch(/invoke\("cancelScheduledSms"/);
    // Marking read is a server action on the caller's own inbound rows; the
    // browser can no longer write SmsMessage at all (RLS update: false).
    expect(inbox).toMatch(/functions\.invoke\("markSmsRead", \{ message_ids:/);
    expect(inbox).not.toMatch(/entities\.SmsMessage\.(?:update|create|delete)\(/);
    for (const source of [inbox, queue]) {
      expect(source).toMatch(/useScopedPatients\(\{\s*purpose: "contact"/);
      expect(source).not.toMatch(/entities\.(?:Patient|SmsConsent)\./);
    }
    expect(read("src/components/messaging/ScheduleSendDialog.jsx"))
      .toMatch(/export const SCHEDULED_SMS_UI_ENABLED = true;/);
  });

  it("reads phone analytics only through the scoped server report, failing closed", () => {
    // Released 2026-10-08. The report comes from getUserActivityLog's phone
    // mode (built-in admin: platform; service-owned agency admin: their
    // agency), metadata only; the unavailable state is the error branch.
    const panel = read("src/components/admin/PhoneAnalyticsPanel.jsx");
    expect(panel).toMatch(/functions\.invoke\("getUserActivityLog", payload\)/);
    expect(panel).toMatch(/const payload = \{ mode: "phone" \};/);
    expect(panel).not.toMatch(/base44\.entities/);
    expect(panel).toMatch(/if \(reportQuery\.isError\) \{\s*return \(\s*<TelecomUnavailable/);
    expect(panel).not.toMatch(/key: "(?:body|from_number|to_number|patient_id)"/);
  });

  it("contacts a patient only through the chart-checking brokers", () => {
    const patientActions = read("src/components/voice/PatientContactActions.jsx");
    expect(patientActions).toMatch(/listAuthorizedPatients\(\{\s*agencyId,\s*mode: "ids",\s*purpose: "contact",\s*patientIds: \[patientId\],/);
    expect(patientActions).toMatch(/functions\.invoke\("startMaskedCall", \{ patient_id: patientId \}\)/);
    expect(patientActions).toMatch(/functions\.invoke\("sendSms", \{ to_number: patientPhone, body, patient_id: patientId \}\)/);
    expect(patientActions).not.toMatch(/base44\.entities|recordSmsConsent/);

    const layout = read("src/components/Layout.jsx");
    expect(layout).not.toMatch(/unreadSms|entities\.SmsMessage/);
    expect(read("src/lib/nav.manifest.js")).not.toMatch(/badge:\s*["']sms["']/);
  });

  it("routes every released telehealth surface through its server broker", () => {
    // Released by the owner on 2026-10-08. The staff page and dashboard reach
    // sessions only through the agency-scoped brokers; the public join page
    // only through the leased public capability client.
    const workspace = read("src/components/telehealth/TelehealthWorkspace.jsx");
    expect(workspace).toMatch(/manageTelehealthSession\(\{ action: "list", agency_id: agencyId/);
    expect(read("src/components/dashboard/UpcomingTelehealthWidget.jsx"))
      .toMatch(/invoke\("listMyUpcomingTelehealth", \{ agency_id: agencyId \}\)/);
    const join = read("src/pages/JoinTelehealth.jsx");
    expect(join).toMatch(/publicCapabilityClient\.createTelehealthToken\(lease, payload\)/);
    expect(join).not.toMatch(/\bbase44\./);

    // The chart panel is the same workspace, bound to one chart and its
    // agency; live vitals go through the broker's get / record_vitals
    // actions, never the session row.
    expect(workspace).toMatch(/const agencyId = chartAgencyId \|\| tenantContext\?\.agency_id \|\| null;/);
    expect(workspace).toMatch(/<RealtimeVitalMonitor sessionId=\{live\.id\} agencyId=\{agencyId\} \/>/);
    const chartPanel = read("src/components/telehealth/PatientTelehealthPanel.jsx");
    expect(chartPanel).toMatch(/<TelehealthWorkspace patientId=\{patientId\} patientName=\{patientName\} agencyId=\{agencyId\} \/>/);
    const vitals = read("src/components/telehealth/RealtimeVitalMonitor.jsx");
    expect(vitals).toMatch(/manageTelehealthSession\(\{ action: "get", agency_id: agencyId, session_id: sessionId \}\)/);
    expect(vitals).toMatch(/action: "record_vitals",/);
    for (const source of [chartPanel, vitals]) {
      expect(source).not.toMatch(/base44\./);
    }
  });

  it("keeps the protected-owner consent ledger on its server broker", () => {
    const ledger = read("src/components/admin/ConsentLedgerPanel.jsx");
    expect(ledger).toMatch(/manageSmsConsent\(\{ action: ["']list["']/);
    expect(ledger).toMatch(/manageSmsConsent\(\{ action: ["']set["']/);
    expect(ledger).not.toMatch(/base44\.entities\.SmsConsent/);
  });
});
