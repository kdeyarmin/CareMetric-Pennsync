import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

// The module imports the Base44 client only to invoke the function inside the
// query; nothing here calls the query, so a bare stub keeps the import graph
// from reaching a real client at load.
vi.mock('@/api/base44Client', () => ({ base44: { functions: { invoke: vi.fn() } } }));

const { ALERT_PAGE_LIMIT, toHighRiskPage, reduceToOnePerPatient } = await import(
  '@/components/dashboard/useHighRiskPatientAlerts'
);

function alert(id, patientId, severity, createdDate) {
  return { id, patient_id: patientId, severity, status: 'active', created_date: createdDate };
}

describe('the high-risk alert page', () => {
  it('reduces to one row per patient, most severe first', () => {
    const rows = reduceToOnePerPatient([
      alert('a1', 'p1', 'high', '2026-07-20'),
      alert('a2', 'p1', 'critical', '2026-07-19'),
      alert('a3', 'p2', 'high', '2026-07-21'),
    ]);

    expect(rows.map((row) => row.patient_id)).toEqual(['p1', 'p2']);
    expect(rows[0].severity).toBe('critical');
  });

  it('a short page is not truncated', () => {
    const page = toHighRiskPage([alert('a1', 'p1', 'high', '2026-07-20')]);

    expect(page.truncated).toBe(false);
    expect(page.alerts).toHaveLength(1);
  });

  // The cap is applied to ALERTS, upstream of the reduction, so a full page can
  // hide matching patients however few distinct patients it contains. These two
  // cases are the extremes of that: the same number of alerts, 500 patients in
  // one and 1 in the other, and both are truncated.
  it('a full page is truncated even when it reduces to a handful of patients', () => {
    const many = Array.from({ length: ALERT_PAGE_LIMIT }, (_, index) =>
      alert(`a${index}`, `p${index}`, 'high', '2026-07-20'));
    const few = Array.from({ length: ALERT_PAGE_LIMIT }, (_, index) =>
      alert(`a${index}`, 'p1', 'high', '2026-07-20'));

    expect(toHighRiskPage(many)).toMatchObject({ truncated: true });
    expect(toHighRiskPage(many).alerts).toHaveLength(ALERT_PAGE_LIMIT);

    expect(toHighRiskPage(few)).toMatchObject({ truncated: true });
    expect(toHighRiskPage(few).alerts).toHaveLength(1);
  });

  it('asks for exactly the page size it tests against', () => {
    // A limit sent and a ceiling compared against are two numbers, and a
    // truncation flag is only right while they are the same one.
    const source = readFileSync(
      join(process.cwd(), 'src/components/dashboard/useHighRiskPatientAlerts.js'), 'utf8');
    expect(source).toMatch(/limit:\s*ALERT_PAGE_LIMIT/);
    expect(source).toMatch(/alerts\.length\s*>=\s*ALERT_PAGE_LIMIT/);
  });
});

