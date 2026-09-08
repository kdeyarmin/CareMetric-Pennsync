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

  it('does not load platform-wide reporting entities as agency evidence', () => {
    expect(agencyAnalytics).not.toMatch(
      /entities\.(?:NoteConversion|ComplianceAudit|TrainingAssignment)\.(?:list|filter)/,
    );
    expect(agencyAnalytics).toContain('tenant-bound reporting projections');
    expect(adminReports).not.toContain('NoteConversionReport');
    expect(adminReports).toContain('Note analytics are unavailable');
    expect(reportsCenter).not.toMatch(/entities\.NoteConversion\.(?:list|filter)/);
    expect(reportsCenter).toContain('NOTE_CONVERSION_REPORTS_AVAILABLE = false');
    expect(dataQuality).not.toMatch(/entities\.PersonnelCredential\.(?:list|filter)/);
    expect(dataQuality).toContain('CREDENTIAL_METRICS_AVAILABLE = false');
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
