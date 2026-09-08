import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const read = (relativePath) => readFileSync(path.join(process.cwd(), relativePath), 'utf8');
const risk = read('src/components/dashboard/HospitalizationRiskWidget.jsx');
const dataQuality = read('src/components/admin/DataQualityDashboard.jsx');
const reports = read('src/components/hub-tabs/AdminReportsCenter.jsx');
const quality = read('src/components/admin/QualityMetricsDashboard.jsx');
const kpi = read('src/components/admin/AIKPIReportGenerator.jsx');
const tagger = read('src/components/admin/AIAutoTagger.jsx');
const patientData = read('src/pages/PatientDataManagement.jsx');
const dedupe = read('src/pages/DuplicatePatients.jsx');
const agency = read('src/pages/AgencyAnalytics.jsx');

const globalViews = [risk, dataQuality, reports, quality, kpi, tagger, patientData, dedupe, agency];
const combinedViews = [risk, dataQuality, reports, quality, kpi, patientData, dedupe, agency];

describe('global Visit unavailable-state containment', () => {
  it('never treats a hook default as authorized Visit data', () => {
    expect(globalViews).toHaveLength(9);
    expect(globalViews.every((text) => text.includes('useAuthorizedVisits'))).toBe(true);
    expect(globalViews.every((text) => text.includes('.isSuccess'))).toBe(true);
    expect(globalViews.every((text) => /unavailable|withheld/i.test(text))).toBe(true);
    expect(globalViews.some((text) => /\{\s*data:\s*(?:allVisits|visits)\s*=\s*\[\]\s*\}\s*=\s*useAuthorizedVisits/.test(text))).toBe(false);
  });

  it('requires exact immutable Patient/Visit authority in every combined view', () => {
    expect(combinedViews).toHaveLength(8);
    expect(combinedViews.every((text) => text.includes('sameAuthorizedTenantScope'))).toBe(true);
    expect(combinedViews.every((text) => text.includes('tenantScopesMismatch'))).toBe(true);
    expect(risk).toContain('patientTenantScope: patientQuery.tenantScope');
    expect(risk).toContain('visitTenantScope: visitQuery.tenantScope');
    expect(reports).toContain('authorityKey: reportAuthorityKey');
    expect(reports).toContain('patientQuery.tenantScope');
    expect(reports).toContain('visitQuery.tenantScope');
    expect(quality).toContain('patientTenantScope: patientQuery.tenantScope');
    expect(kpi).toContain('patientTenantScope: patientQuery.tenantScope');
  });

  it('gates expensive or disclosing actions and rejects late derived results', () => {
    expect(risk).toContain('disabled={analyzing || !analysisSnapshot');
    expect(risk).toContain('analysisSnapshotRef.current === authorizedSnapshot');
    expect(kpi).toContain('disabled={ai.loading || !analysisSnapshot || !KPI_REPORTS_ENABLED}');
    expect(kpi).toContain('analysisSnapshotRef.current !== authorizedSnapshot');
    expect(tagger).toContain('disabled={isTagging || !visitSnapshot}');
    expect(tagger).toContain('visitSnapshotRef.current !== authorizedSnapshot');
    expect(quality).toContain('disabled={!analyticsSnapshot}');
    expect(agency).toMatch(/onClick=\{handleExport\}[\s\S]{0,160}\bdisabled\b/);
    expect(agency).toContain('Tenant-bound reporting projections are not available');
    expect(dedupe).toContain('disabled={isScanning || !scanSnapshot');
  });

  it('requires fresh auxiliary sources before metrics or AI actions', () => {
    expect(quality).toContain('freshQuerySuccess(incidentQuery)');
    expect(quality).toContain('freshQuerySuccess(userQuery)');
    expect(quality).toContain('sameAuthorizedTenantScope(auxiliaryTenantScope, patientQuery.tenantScope)');
    expect(quality).not.toContain('NoteConversion.list');
    expect(quality).toContain('tenant-authorized NoteConversion');
    expect(kpi).toContain('freshQuerySuccess(incidentQuery)');
    expect(kpi).not.toContain('ComplianceAudit.list');
    expect(kpi).toContain('const KPI_REPORTS_ENABLED = false');
    expect(kpi.match(/enabled: KPI_REPORTS_ENABLED/g)).toHaveLength(3);
    expect(kpi).toMatch(/const visitQuery = useAuthorizedVisits\(\{[\s\S]{0,240}enabled: KPI_REPORTS_ENABLED/);
    expect(kpi).toMatch(/const patientQuery = useScopedPatients\(\{[\s\S]{0,240}enabled: KPI_REPORTS_ENABLED/);
    expect(kpi).toMatch(/const incidentQuery = useAgencyScopedQuery\(\{[\s\S]{0,300}enabled: KPI_REPORTS_ENABLED/);
    expect(kpi).toContain('{KPI_REPORTS_ENABLED && !analysisSnapshot && (');
    expect(tagger).toContain('freshQuerySuccess(currentUserQuery)');
    expect(tagger).toContain('freshQuerySuccess(incidentQuery)');
    expect(tagger).toContain('sameAuthorizedTenantScope(incidentTenantScope, visitQuery.tenantScope)');
  });

  it('keeps risk alert persistence quarantined and avoids duplicate report scans', () => {
    expect(risk).not.toMatch(/PatientAlert\.(?:filter|create|update)/);
    expect(risk).toContain('display-only');
    expect(reports).toContain("activeTab === 'reports'");
    expect(reports).toContain('reportsSnapshot ?');
  });
});
