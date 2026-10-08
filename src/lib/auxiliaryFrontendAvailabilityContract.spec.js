import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const read = (relativePath) => readFileSync(path.join(process.cwd(), relativePath), 'utf8');
const patientData = read('src/pages/PatientDataManagement.jsx');
const agencyAnalytics = read('src/pages/AgencyAnalytics.jsx');
const adminReports = read('src/components/hub-tabs/AdminReportsCenter.jsx');
const dataQuality = read('src/components/admin/DataQualityDashboard.jsx');
const reportsCenter = read('src/components/admin/ReportsCenter.jsx');

describe('auxiliary frontend availability containment', () => {
  it('withholds auxiliary cache data until a fresh idle post-mount success', () => {
    for (const source of [patientData, agencyAnalytics, adminReports, dataQuality]) {
      expect(source).toContain('settledSuccessfullyAfterMount');
      expect(source).toContain('isFetchedAfterMount');
      expect(source).toContain("fetchStatus === 'idle'");
      expect(source).not.toMatch(/initialData\s*:/);
    }
    expect(patientData).toContain('alertAuthorityMatches');
    expect(agencyAnalytics).toContain('auxiliaryAuthorityMatches');
    expect(adminReports).toContain('auxiliaryAuthorityMatches');
    expect(dataQuality).toContain('auxiliaryAuthorityMatches');
  });

  it('bounds the restored agency reporting sources to the verified authority and agency', () => {
    // 2026-10-08 owner decision: Agency Analytics loads its note-conversion,
    // compliance-audit, incident and training sources again — only after the
    // Patient/Visit authority and roster agree, each filtered to the agency by
    // the person its rows are attributed to, and only from a fresh answer.
    const auxiliary = read('src/components/analytics/useAgencyAnalyticsAuxiliary.js');
    expect(agencyAnalytics).not.toMatch(
      /entities\.(?:NoteConversion|ComplianceAudit|TrainingAssignment)\.(?:list|filter)/,
    );
    expect(agencyAnalytics).toMatch(/useAgencyAnalyticsAuxiliary\(\{\s*authorityKey: analyticsAuthorityKey,\s*enabled: analyticsAvailable,/);
    for (const entity of ['NoteConversion', 'ComplianceAudit', 'Incident', 'TrainingAssignment']) {
      expect(auxiliary).toContain(`base44.entities.${entity}.list(`);
    }
    expect(auxiliary).toContain('filterRecordsByAuthorAgency(');
    expect(auxiliary).toContain('settledSuccessfullyAfterMount(query)');
    expect(auxiliary).not.toMatch(/initialData\s*:/);
    expect(read('src/components/analytics/agencyAnalyticsExport.js')).not.toMatch(/Revenue|Cost Savings/);
  });

  it('loads productivity and note analytics from fresh, roster-bounded NoteConversion reads', () => {
    // 2026-10-08 owner decision: productivity reports and note analytics are
    // back. The read is loaded only while productivity is selected, only a
    // fresh post-mount answer counts, and rows outside the passed roster are
    // never attributed to this agency.
    expect(adminReports).toContain('<NoteConversionReport />');
    expect(adminReports).not.toContain('Note analytics are unavailable');
    expect(reportsCenter).not.toContain('NOTE_CONVERSION_REPORTS_AVAILABLE');
    expect(reportsCenter).toMatch(
      /const noteConversionQuery = useQuery\(\{[\s\S]{0,200}NoteConversion\.list\('-created_date', NOTE_CONVERSION_ROWS\)[\s\S]{0,120}enabled: sourceSnapshotAvailable && reportType === 'productivity'/,
    );
    expect(reportsCenter).toContain('noteConversionsSettled(noteConversionQuery)');
    expect(reportsCenter).toContain("rosterEmails.has(String(nc.nurse_email || '').trim().toLowerCase())");
    expect(reportsCenter).not.toMatch(/initialData\s*:/);
    expect(read('src/components/admin/NoteConversionReport.jsx'))
      .toMatch(/useAgencyScopedQuery\(\{[\s\S]{0,200}authorOf: \(conversion\) => conversion\?\.nurse_email/);
  });

  it('measures credential coverage only from a fresh, roster-wide read', () => {
    // 2026-10-08 owner decision: credential coverage is back. The read rule
    // admits an owner's own rows and the administrator, so only the
    // administrator's answer covers the roster; nobody else gets a figure the
    // rule silently narrowed, and an unmeasured source never joins the score.
    expect(dataQuality).not.toContain('CREDENTIAL_METRICS_AVAILABLE');
    expect(dataQuality).toMatch(
      /const credentialsQuery = useQuery\(\{[\s\S]{0,200}PersonnelCredential\.list\('-expiration_date', ALL_ROWS\)[\s\S]{0,200}enabled: Boolean\(dataQualityAuthorityKey && auxiliaryAuthorityMatches && credentialMetricsPermitted\),\s*\.\.\.FRESH_QUERY_OPTIONS/,
    );
    expect(dataQuality).toContain("const credentialReadCoversRoster = (user) => user?.role === 'admin';");
    expect(dataQuality).toContain('settledSuccessfullyAfterMount(credentialsQuery)');
    expect(dataQuality).toContain('if (qualityMetrics.credentialCoverage !== null)');
    expect(dataQuality).toContain('No nurse denominator');
    expect(dataQuality).toContain('Administrator account required');
  });

  it('quarantines the cross-authority patient import and prepaint filter state', () => {
    expect(patientData).not.toContain('PatientFileUpdateUploader');
    expect(patientData).toContain('one atomic tenant-bound broker');
    expect(patientData).toContain('filterAuthorityKey === patientAuthorityKey');
    expect(patientData).toContain("const effectiveSearchTerm = filtersCurrent ? searchTerm : ''");
  });

  it('fences late PDF and CSV downloads behind the current component authority', () => {
    expect(reportsCenter).toContain('operationSequenceRef');
    expect(reportsCenter).toContain('operation.authorityKey === authorityRef.current');
    expect(reportsCenter).toMatch(
      /const pdfBlob = await exportToPDF\(\{[\s\S]*?output:\s*'blob'[\s\S]*?if \(!operationIsCurrent\(operation\)\) return;[\s\S]*?downloadAuthorityBoundBlob\(pdfBlob, pdfFilename\)/,
    );
    expect(reportsCenter).toMatch(
      /new Blob\(\[reportContent\][\s\S]*?if \(!operationIsCurrent\(operation\)\) return;[\s\S]*?downloadAuthorityBoundBlob\(blob, fileName\)/,
    );
  });

  it('does not report an empty denominator as perfect data quality', () => {
    expect(dataQuality).not.toMatch(/patients\.length > 0[\s\S]{0,180}:\s*100/);
    expect(dataQuality).not.toMatch(/users\.length > 0[\s\S]{0,180}:\s*100/);
    expect(dataQuality).not.toMatch(/visits\.length > 0[\s\S]{0,180}:\s*100/);
    expect(dataQuality).toContain('No patient denominator');
    expect(dataQuality).toContain('No user denominator');
    expect(dataQuality).toContain('No completed-visit denominator');
  });
});
