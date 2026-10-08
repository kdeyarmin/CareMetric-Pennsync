import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8');

describe('purpose-bound Patient projection migration', () => {
  it('uses the authorized roster for patient-alert selection', () => {
    const page = read('src/pages/PatientAlerts.jsx');

    expect(page).toMatch(/purpose:\s*'roster'/);
  });

  it('loads visit-summary Patient fields through the exact broker hook', () => {
    const summary = read('src/components/smartNote/VisitSummaryGenerator.jsx');

    expect(summary).toMatch(/useAuthorizedPatient\(\{/);
    expect(summary).toMatch(/purpose:\s*'visit_summary'/);
    expect(summary).toMatch(/agencyId:\s*tenantContext\?\.agency_id/);
    expect(summary).not.toMatch(/entities\.Patient\.(?:get|filter|list)/);
  });

  it('uses authorized roster and education projections for personalization', () => {
    const sender = read('src/components/education/PersonalizedMaterialSender.jsx');

    expect(sender).toMatch(/purpose:\s*'education_delivery'/);
    expect(sender).toMatch(/useAuthorizedPatient\(\{/);
    expect(sender).toMatch(/purpose:\s*'education_context'/);
    expect(sender).toMatch(/agencyId:\s*tenantContext\?\.agency_id/);
    expect(sender).not.toMatch(/entities\.Patient\.(?:get|filter|list)/);
  });

  it('reuses the authorized roster for incident patient identity', () => {
    const report = read('src/pages/EventReport.jsx');

    expect(report).toMatch(/purpose:\s*'roster'/);
    expect(report).toMatch(/patients\.find/);
    expect(report).not.toMatch(/entities\.Patient\.(?:get|filter|list)/);
  });

  it('loads the discharge workflow and audio through the selector projection', () => {
    // 2026-10-08 owner decision: discharge summaries are restored; the
    // workflow's patient header comes from the reviewed selector projection.
    const discharge = read('src/components/discharge/DischargeSummaryWorkflow.jsx');
    expect(discharge).toMatch(/useAuthorizedPatient\(\{/);
    expect(discharge).toMatch(/purpose:\s*'selector'/);
    expect(discharge).toMatch(/agencyId:\s*tenantContext\?\.agency_id/);
    expect(discharge).not.toMatch(/entities\.Patient\.(?:get|filter|list)/);

    const audio = read('src/components/visit/AudioVisitCapture.jsx');
    expect(audio).toMatch(/useAuthorizedPatient\(\{/);
    expect(audio).toMatch(/purpose:\s*'selector'/);
    expect(audio).toMatch(/agencyId:\s*tenantContext\?\.agency_id/);
    expect(audio).not.toMatch(/entities\.Patient\.(?:get|filter|list)/);
  });

  it('revalidates health-history merge bases through the write projection', () => {
    const history = read('src/components/patient/HealthHistorySection.jsx');

    expect(history).toMatch(/purpose:\s*'health_history_write_base'/);
    expect(history).toMatch(/refetchWriteBase\(\)/);
    expect(history).not.toMatch(/entities\.Patient\.(?:get|filter|list)/);
  });

  it('uses authorized roster and chart-safety projections for Smart Notes', () => {
    const smartNote = read('src/pages/SmartNoteAssistant.jsx');

    expect(smartNote).toMatch(/purpose:\s*'roster'/);
    expect(smartNote).toMatch(/purpose:\s*'smart_note_context'/);
    expect(smartNote).toMatch(/agencyId:\s*tenantContext\?\.agency_id/);
    expect(smartNote).not.toMatch(/entities\.Patient\.(?:get|filter|list)/);
  });

  it('loads OASIS analysis Patient fields through its reviewed projection', () => {
    // AIProactiveOASISAssistant.jsx, the other reader of this projection, was
    // never mounted and was deleted when the OASIS Center was turned back on.
    for (const relativePath of [
      'src/components/compliance/AIComplianceAuditor.jsx',
    ]) {
      const source = read(relativePath);
      expect(source).toMatch(/purpose:\s*'oasis_analysis_context'/);
      expect(source).toMatch(/agencyId:\s*tenantContext\?\.agency_id/);
      expect(source).not.toMatch(/entities\.Patient\.(?:get|filter|list)/);
    }
  });

  it('mounts call history and callbacks on the caller-scoped call log and contact projection', () => {
    // Restored 2026-10-08 (owner decision). Both tabs and the Callbacks badge
    // read ONE query, the caller's own CallLog rows (CallLog RLS admits a
    // non-admin only to rows naming them), and resolve patients through the
    // authorized `contact` projection, never a direct Patient read.
    const phoneCenter = read('src/pages/PhoneCenter.jsx');
    const hook = read('src/components/voice/useNurseCallLogs.js');

    expect(phoneCenter).toMatch(/\{activeTab === "calls" && <CallHistoryList \/>\}/);
    expect(phoneCenter).toMatch(/\{activeTab === "callbacks" && <CallbackQueue \/>\}/);
    expect(phoneCenter).toMatch(/useNurseCallLogs\(user\)/);
    expect(phoneCenter).not.toMatch(/entities\.(?:Patient|CallLog)\./);
    expect(hook).toMatch(/entities\.CallLog\.filter\(\{ nurse_email: user\.email \}/);
    for (const file of ['src/components/voice/CallHistoryList.jsx', 'src/components/voice/CallbackQueue.jsx']) {
      const source = read(file);
      expect(source, file).toMatch(/useNurseCallLogs\(user\)/);
      expect(source, file).toMatch(/useScopedPatients\(\{[\s\S]*?purpose: 'contact'/);
      expect(source, file).not.toMatch(/entities\.Patient\.(?:get|filter|list)|entities\.CallLog\.(?:filter|list)/);
    }
  });
});
