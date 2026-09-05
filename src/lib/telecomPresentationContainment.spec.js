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
      "SmsMessage",
      "ScheduledSms",
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

  it("renders unavailable states instead of zero SMS history or analytics", () => {
    for (const relativePath of [
      "src/components/messaging/SmsConversationList.jsx",
      "src/components/messaging/ScheduledSmsList.jsx",
      "src/components/admin/PhoneAnalyticsPanel.jsx",
    ]) {
      const source = read(relativePath);
      expect(source, relativePath).toMatch(/TelecomUnavailable/);
      expect(source, relativePath).not.toMatch(/useQuery|base44\.entities/);
    }

    const patientActions = read("src/components/voice/PatientContactActions.jsx");
    expect(patientActions).toMatch(/title="Patient texting unavailable"/);
    expect(patientActions).not.toMatch(
      /base44\.entities\.SmsConsent|functions\.invoke\(["'](?:sendSms|recordSmsConsent)["']/,
    );

    const layout = read("src/components/Layout.jsx");
    expect(layout).not.toMatch(/unreadSms|entities\.SmsMessage/);
    expect(read("src/lib/nav.manifest.js")).not.toMatch(/badge:\s*["']sms["']/);
  });

  it("hard-gates every telehealth entry surface before data, provider, or device hooks", () => {
    for (const relativePath of [
      "src/pages/Telehealth.jsx",
      "src/pages/JoinTelehealth.jsx",
      "src/components/dashboard/UpcomingTelehealthWidget.jsx",
      "src/components/telehealth/PatientTelehealthPanel.jsx",
      "src/components/telehealth/RealtimeVitalMonitor.jsx",
    ]) {
      const source = read(relativePath);
      expect(source, relativePath).toMatch(/TELEHEALTH_UNAVAILABLE_MESSAGE/);
      expect(source, relativePath).not.toMatch(
        /useQuery|useMutation|useEffect|useSearchParams|TelehealthCall|PreJoinDeviceCheck|VideoRoom|base44\./,
      );
    }
  });

  it("keeps the protected-owner consent ledger on its server broker", () => {
    const ledger = read("src/components/admin/ConsentLedgerPanel.jsx");
    expect(ledger).toMatch(/manageSmsConsent\(\{ action: ["']list["']/);
    expect(ledger).toMatch(/manageSmsConsent\(\{ action: ["']set["']/);
    expect(ledger).not.toMatch(/base44\.entities\.SmsConsent/);
  });
});
