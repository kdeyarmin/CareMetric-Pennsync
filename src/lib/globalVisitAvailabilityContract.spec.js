import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const read = (relativePath) => readFileSync(path.join(process.cwd(), relativePath), 'utf8');
const dataQuality = read('src/components/admin/DataQualityDashboard.jsx');
const reports = read('src/components/hub-tabs/AdminReportsCenter.jsx');
const quality = read('src/components/admin/QualityMetricsDashboard.jsx');
const kpi = read('src/components/admin/AIKPIReportGenerator.jsx');
const tagger = read('src/components/admin/AIAutoTagger.jsx');
const patientData = read('src/pages/PatientDataManagement.jsx');
const dedupe = read('src/pages/DuplicatePatients.jsx');
const agency = read('src/pages/AgencyAnalytics.jsx');

const globalViews = [dataQuality, reports, quality, kpi, tagger, patientData, dedupe, agency];
const combinedViews = [dataQuality, reports, quality, kpi, patientData, dedupe, agency];

describe('global Visit unavailable-state containment', () => {
  it('never treats a hook default as authorized Visit data', () => {
    expect(globalViews).toHaveLength(8);
    expect(globalViews.every((text) => text.includes('useAuthorizedVisits'))).toBe(true);
    expect(globalViews.every((text) => text.includes('.isSuccess'))).toBe(true);
    expect(globalViews.every((text) => /unavailable|withheld/i.test(text))).toBe(true);
    expect(globalViews.some((text) => /\{\s*data:\s*(?:allVisits|visits)\s*=\s*\[\]\s*\}\s*=\s*useAuthorizedVisits/.test(text))).toBe(false);
  });

  it('requires exact immutable Patient/Visit authority in every combined view', () => {
    expect(combinedViews).toHaveLength(7);
    expect(combinedViews.every((text) => text.includes('sameAuthorizedTenantScope'))).toBe(true);
    expect(combinedViews.every((text) => text.includes('tenantScopesMismatch'))).toBe(true);
    expect(reports).toContain('authorityKey: reportAuthorityKey');
    expect(reports).toContain('patientQuery.tenantScope');
    expect(reports).toContain('visitQuery.tenantScope');
    expect(quality).toContain('patientTenantScope: patientQuery.tenantScope');
    expect(kpi).toContain('patientTenantScope: patientQuery.tenantScope');
  });

  it('gates expensive or disclosing actions and rejects late derived results', () => {
    expect(kpi).toContain('disabled={ai.loading || !analysisSnapshot}');
    expect(kpi).toContain('analysisSnapshotRef.current !== authorizedSnapshot');
    expect(tagger).toContain('disabled={isTagging || !visitSnapshot}');
    expect(tagger).toContain('visitSnapshotRef.current !== authorizedSnapshot');
    expect(quality).toContain('disabled={!analyticsSnapshot}');
    expect(agency).toMatch(/onClick=\{handleExport\}[\s\S]{0,160}\bdisabled\b/);
    expect(agency).toContain('disabled={!analyticsAvailable}');
    expect(dedupe).toContain('disabled={isScanning || !scanSnapshot');
  });

  it('requires fresh auxiliary sources before metrics or AI actions', () => {
    expect(quality).toContain('freshQuerySuccess(incidentQuery)');
    expect(quality).toContain('freshQuerySuccess(userQuery)');
    expect(quality).toContain('sameAuthorizedTenantScope(auxiliaryTenantScope, patientQuery.tenantScope)');
    // 2026-10-08 owner decision: quality score (compliance audits) and AI time
    // saved (note enhancements) are measured again, from fresh nurse-attributed
    // agency reads that gate the snapshot like every other source.
    expect(quality).toMatch(/const noteConversionQuery = useAgencyScopedQuery\(\{[\s\S]{0,300}NoteConversion\.list\(/);
    expect(quality).toMatch(/const complianceAuditQuery = useAgencyScopedQuery\(\{[\s\S]{0,300}ComplianceAudit\.list\(/);
    expect(quality).toContain('freshQuerySuccess(noteConversionQuery)');
    expect(quality).toContain('freshQuerySuccess(complianceAuditQuery)');
    expect(quality).toMatch(/&& complianceAuditFresh\s*&& noteConversionFresh/);
    expect(quality).toContain('avgQualityScore: averageAuditScore(allComplianceAudits)');
    expect(quality).not.toContain('SecurityLog');
    expect(kpi).toContain('freshQuerySuccess(incidentQuery)');
    // 2026-10-08 owner decision: KPI reports are on. The compliance-audit
    // source is loaded again, but only a FRESH post-mount answer may feed the
    // prompt, and a failed source withholds the report instead of reading as 0.
    expect(kpi).not.toContain('KPI_REPORTS_ENABLED');
    expect(kpi).toMatch(/const complianceAuditQuery = useAgencyScopedQuery\(\{[\s\S]{0,300}ComplianceAudit\.list\('-audit_date'/);
    expect(kpi).toContain('freshQuerySuccess(complianceAuditQuery)');
    expect(kpi).toMatch(/tenantSnapshot\s*&& incidentFresh\s*&& complianceAuditFresh/);
    expect(kpi).toContain('complianceAuditQuery.isError');
    expect(kpi).not.toContain('Unavailable pending a tenant-authorized aggregate source');
    expect(kpi).toContain('Compliance Audits: ${auditSummary.total}');
    expect(kpi).toContain('{!analysisSnapshot && (');
    expect(kpi).toContain('normalizeKpiReport(result');
    expect(tagger).toContain('freshQuerySuccess(currentUserQuery)');
    expect(tagger).toContain('freshQuerySuccess(incidentQuery)');
    expect(tagger).toContain('sameAuthorizedTenantScope(incidentTenantScope, visitQuery.tenantScope)');
  });

  it('avoids duplicate report scans', () => {
    expect(reports).toContain("activeTab === 'reports'");
    expect(reports).toContain('reportsSnapshot ?');
  });
});
