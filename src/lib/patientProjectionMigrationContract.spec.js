import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8');

describe('purpose-bound Patient projection migration', () => {
  it('uses the authorized roster for patient-alert selection', () => {
    const page = read('src/pages/PatientAlerts.jsx');

    expect(page).toMatch(/readMode:\s*'authorized-roster'/);
  });

  it('loads alert-analysis Patient fields through the exact broker hook', () => {
    const analyzer = read('src/components/alerts/PatientAlertAnalyzer.jsx');

    expect(analyzer).toMatch(/useAuthorizedPatient\(\{/);
    expect(analyzer).toMatch(/purpose:\s*'alert_analysis'/);
    expect(analyzer).toMatch(/agencyId:\s*tenantContext\?\.agency_id/);
    expect(analyzer).not.toMatch(/entities\.Patient\.(?:get|filter|list)/);
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

    expect(sender).toMatch(/readMode:\s*'authorized-roster'/);
    expect(sender).toMatch(/useAuthorizedPatient\(\{/);
    expect(sender).toMatch(/purpose:\s*'education_context'/);
    expect(sender).toMatch(/agencyId:\s*tenantContext\?\.agency_id/);
    expect(sender).not.toMatch(/entities\.Patient\.(?:get|filter|list)/);
  });

  it('reuses the authorized roster for incident patient identity', () => {
    const report = read('src/pages/EventReport.jsx');

    expect(report).toMatch(/readMode:\s*'authorized-roster'/);
    expect(report).toMatch(/patients\.find/);
    expect(report).not.toMatch(/entities\.Patient\.(?:get|filter|list)/);
  });

  it('loads discharge and audio Patient fields through the selector projection', () => {
    for (const relativePath of [
      'src/components/discharge/DischargeSummaryWorkflow.jsx',
      'src/components/visit/AudioVisitCapture.jsx',
    ]) {
      const source = read(relativePath);
      expect(source).toMatch(/useAuthorizedPatient\(\{/);
      expect(source).toMatch(/purpose:\s*'selector'/);
      expect(source).toMatch(/agencyId:\s*tenantContext\?\.agency_id/);
      expect(source).not.toMatch(/entities\.Patient\.(?:get|filter|list)/);
    }
  });

  it('revalidates health-history merge bases through the write projection', () => {
    const history = read('src/components/patient/HealthHistorySection.jsx');

    expect(history).toMatch(/purpose:\s*'health_history_write_base'/);
    expect(history).toMatch(/refetchWriteBase\(\)/);
    expect(history).not.toMatch(/entities\.Patient\.(?:get|filter|list)/);
  });

  it('uses authorized roster and chart-safety projections for Smart Notes', () => {
    const smartNote = read('src/pages/SmartNoteAssistant.jsx');

    expect(smartNote).toMatch(/readMode:\s*'authorized-roster'/);
    expect(smartNote).toMatch(/purpose:\s*'smart_note_context'/);
    expect(smartNote).toMatch(/agencyId:\s*tenantContext\?\.agency_id/);
    expect(smartNote).not.toMatch(/entities\.Patient\.(?:get|filter|list)/);
  });

  it('loads OASIS analysis Patient fields through its reviewed projection', () => {
    for (const relativePath of [
      'src/components/oasis/PredictiveOutcomesAnalyzer.jsx',
      'src/components/oasis/AIProactiveOASISAssistant.jsx',
    ]) {
      const source = read(relativePath);
      expect(source).toMatch(/purpose:\s*'oasis_analysis_context'/);
      expect(source).toMatch(/agencyId:\s*tenantContext\?\.agency_id/);
      expect(source).not.toMatch(/entities\.Patient\.(?:get|filter|list)/);
    }
  });

  it('keeps unverified call history and callbacks outside the routed bundle', () => {
    const phoneCenter = read('src/pages/PhoneCenter.jsx');

    expect(phoneCenter).toMatch(/TelecomUnavailable/);
    expect(phoneCenter).not.toMatch(/CallHistoryList/);
    expect(phoneCenter).not.toMatch(/CallbackQueue/);
    expect(phoneCenter).not.toMatch(/entities\.Patient\.(?:get|filter|list)/);
  });
});
