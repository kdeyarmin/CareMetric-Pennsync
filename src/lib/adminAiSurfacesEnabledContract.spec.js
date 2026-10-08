import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { appendBriefingSection } from '@/components/referral/briefingSections';

// 2026-10-08 owner decision ("turn everything on"): the admin, reporting and
// AI surfaces below were paused behind static flags and are on again. These
// assertions pin the WORKING behaviour that replaced each pause, so a surface
// cannot quietly fall back to a stub or lose the guard it was re-enabled with.
const read = (relativePath) => readFileSync(path.join(process.cwd(), relativePath), 'utf8');

describe('AI admission documentation', () => {
  const assistant = read('src/components/clinical/AIAdmissionDocumentationAssistant.jsx');
  const processor = read('src/components/hub-tabs/ReferralProcessor.jsx');

  it('renders the assistant itself rather than a pause notice', () => {
    expect(assistant).not.toContain('AI_ADMISSION_DOCUMENTATION_ENABLED');
    expect(assistant).not.toContain('AI Admission Documentation Paused');
    expect(assistant).toMatch(/export default function AIAdmissionDocumentationAssistant\(\{/);
    expect(assistant).toContain('The AI response contained no usable documentation sections');
  });

  it('hands an accepted section to the referral briefing instead of a no-op', () => {
    expect(processor).toContain('saveLabel="Add to Nurse Briefing"');
    expect(processor).toMatch(/onSaveSection=\{\(title, content\) => \{[\s\S]{0,200}setAdmissionNote\(\(current\) => appendBriefingSection\(current, title, content\)\)/);
    expect(processor).not.toMatch(/onSaveSection=\{\(\) => \{\s*\}\}/);
  });

  it('appends sections in order under a heading', () => {
    expect(appendBriefingSection('', 'Homebound status', ' Unable to leave home. ')).toBe(
      'HOMEBOUND STATUS\nUnable to leave home.',
    );
    expect(appendBriefingSection('EARLIER\ntext', '', 'More')).toBe(
      'EARLIER\ntext\n\nADMISSION DOCUMENTATION\nMore',
    );
  });
});

describe('real-time compliance dashboard', () => {
  const dashboard = read('src/components/hub-tabs/RealTimeComplianceDashboard.jsx');

  it('renders the dashboard on reviewed reads, without OASIS or the retired activity log', () => {
    expect(dashboard).not.toContain('REALTIME_COMPLIANCE_ANALYTICS_ENABLED');
    expect(dashboard).toMatch(/export default function RealTimeComplianceDashboard\(\) \{/);
    expect(dashboard).toMatch(/useAuthorizedVisits\(\{ purpose: 'data_quality'/);
    expect(dashboard).toMatch(/useScopedPatients\(\{ purpose: 'roster'/);
    expect(dashboard).not.toMatch(/entities\.(?:Visit|Patient|UserActivity|OASISUpload)\b/);
    expect(dashboard.replace(/^\s*\/\/.*$/gm, '')).not.toMatch(/oasis|PDGM/i);
  });

  it('derives Smart Note activity from note enhancements', async () => {
    const { noteConversionActivities } = await import('@/components/hub-tabs/RealTimeComplianceDashboard');
    expect(noteConversionActivities([
      { nurse_email: 'a@example.test', created_date: '2026-10-01', enhanced_note_compliance: 88 },
      { nurse_email: 'b@example.test', created_date: '2026-10-02', enhanced_note_compliance: null },
      null,
    ])).toEqual([
      { user_email: 'a@example.test', created_date: '2026-10-01', action: 'note_enhanced' },
      { user_email: 'a@example.test', created_date: '2026-10-01', action: 'note_compliance_check', details: { overall_score: 88 } },
      { user_email: 'b@example.test', created_date: '2026-10-02', action: 'note_enhanced' },
    ]);
  });
});

describe('agency KPI and analytics reporting', () => {
  it('computes KPI trends only against a real baseline', async () => {
    const { averageScore, parseKpiDate, percentTrend } = await import('@/components/reports/KPIDashboard');
    expect(percentTrend(12, 10)).toBe('20.0');
    expect(percentTrend(5, 0)).toBeNull();
    expect(percentTrend(null, 10)).toBeNull();
    expect(averageScore([{ compliance_score: 80 }, { compliance_score: '90' }, { compliance_score: null }])).toBe(85);
    expect(averageScore([])).toBeNull();
    expect(parseKpiDate('2026-07-27').getDate()).toBe(27);
  });

  it('exports unavailable sources as Unavailable and carries no revenue figures', async () => {
    const { buildAgencyAnalyticsCsv, trainingCompletionStats } = await import('@/components/analytics/agencyAnalyticsExport');
    expect(trainingCompletionStats([{ status: 'completed' }, { pass_fail_result: 'passed' }, {}]))
      .toEqual({ completed: 2, total: 3, rate: '66.7' });
    expect(trainingCompletionStats([]).rate).toBeNull();
    const csv = buildAgencyAnalyticsCsv({
      overallStats: {
        visits: { total: 4, completed: 3, completionRate: 75 },
        patients: { total: 2, active: 1 },
        incidents: { total: 0 },
        compliance: { auditsInRange: 0, avgScore: 0 },
      },
      topPerformers: [],
      trainingStats: null,
      available: { compliance: true, incidents: false },
      generatedAt: '2026-10-08T00:00:00.000Z',
    });
    expect(csv).toContain('Total Incidents,Unavailable');
    expect(csv).toContain('Avg Compliance Score,Unavailable');
    expect(csv).toContain('Training Completion Rate (%),Unavailable');
    expect(csv).not.toMatch(/Revenue|Cost Savings/);
  });
});
