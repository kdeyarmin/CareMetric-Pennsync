import { describe, expect, it } from 'vitest';
import {
  buildComplianceAuditRecord,
  complianceAuditStatus,
  normalizeComplianceAuditResult,
} from './complianceAuditResult';

const valid = {
  overall_compliance_score: '82',
  compliance_level: 'Minor_Issues',
  critical_findings: [
    { category: 'Medication', issue: 'No reconciliation', risk_level: 'HIGH', actionable_steps: ['Reconcile', 7] },
    { category: 'Empty', issue: '   ' },
    'not an object',
  ],
  minor_findings: [{ issue: 'Vitals not trended', required_state: 'Trend vitals' }],
  compliance_strengths: ['Advance directives on file', { nested: true }],
  priority_actions: [{ action: 'Call physician' }, { rationale: 'missing action' }],
};

describe('normalizeComplianceAuditResult', () => {
  it('refuses an answer without a usable score or level', () => {
    expect(normalizeComplianceAuditResult(null)).toBeNull();
    expect(normalizeComplianceAuditResult({ ...valid, overall_compliance_score: 140 })).toBeNull();
    expect(normalizeComplianceAuditResult({ ...valid, overall_compliance_score: '' })).toBeNull();
    expect(normalizeComplianceAuditResult({ ...valid, compliance_level: 'excellent' })).toBeNull();
  });

  it('shapes findings and drops entries with no issue text', () => {
    const result = normalizeComplianceAuditResult(valid);
    expect(result.overall_compliance_score).toBe(82);
    expect(result.compliance_level).toBe('minor_issues');
    expect(result.critical_findings).toHaveLength(1);
    expect(result.critical_findings[0]).toMatchObject({
      category: 'Medication',
      risk_level: 'high',
      actionable_steps: ['Reconcile'],
    });
    expect(result.minor_findings[0]).toMatchObject({ category: 'General', risk_level: 'medium' });
    expect(result.compliance_strengths).toEqual(['Advance directives on file']);
    expect(result.priority_actions).toEqual([
      { action: 'Call physician', rationale: '', assigned_to: '', deadline: '' },
    ]);
  });
});

describe('buildComplianceAuditRecord', () => {
  const normalized = normalizeComplianceAuditResult(valid);

  it('maps the answer onto the ComplianceAudit schema', () => {
    const record = buildComplianceAuditRecord({
      normalized,
      nurseEmail: 'nurse@example.test',
      patientId: 'patient-1',
      visitId: 'visit-1',
      now: new Date('2026-10-08T12:00:00Z'),
    });
    expect(record).toEqual({
      visit_id: 'visit-1',
      nurse_email: 'nurse@example.test',
      patient_id: 'patient-1',
      audit_date: '2026-10-08T12:00:00.000Z',
      compliance_score: 82,
      status: 'flagged',
      issues: [
        { element: 'Medication', severity: 'high', problem: 'No reconciliation', suggestion: 'Reconcile' },
        { element: 'General', severity: 'medium', problem: 'Vitals not trended', suggestion: 'Trend vitals' },
      ],
      compliant_elements: ['Advance directives on file'],
      audit_type: 'automated',
    });
  });

  it('refuses to attribute an audit to a placeholder instead of the caller', () => {
    expect(() => buildComplianceAuditRecord({ normalized, nurseEmail: undefined, visitId: 'visit-1' }))
      .toThrow(/email/);
    expect(() => buildComplianceAuditRecord({ normalized, nurseEmail: 'system', visitId: 'visit-1' }))
      .toThrow(/email/);
    expect(() => buildComplianceAuditRecord({ normalized, nurseEmail: 'n@example.test', visitId: '' }))
      .toThrow(/visit/);
  });

  it('maps levels onto the status enum', () => {
    expect(complianceAuditStatus({ compliance_level: 'compliant' })).toBe('passed');
    expect(complianceAuditStatus({ compliance_level: 'critical_issues' })).toBe('critical');
    expect(complianceAuditStatus({ compliance_level: 'major_issues' })).toBe('flagged');
  });
});
