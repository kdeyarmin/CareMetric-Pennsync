import { describe, expect, it } from 'vitest';
import { patientInformationRows, patientValueLines } from './patientInformationRows';

const NOW = new Date(2026, 9, 15);

describe('patientInformationRows', () => {
  it('labels identity and clinical fields in chart order and leaves empty ones out', () => {
    const rows = patientInformationRows({
      id: 'patient-a',
      first_name: 'Ada',
      last_name: 'Lovelace',
      medical_record_number: 'MRN-1',
      date_of_birth: '1940-03-02',
      status: 'active',
      care_type: 'home_health',
      primary_diagnosis: 'I50.9 Heart failure',
      secondary_diagnoses: ['E11.9', 'I10'],
      allergies: '',
      current_medications: [{ name: 'Metformin', dosage: '500 mg', frequency: 'BID' }],
      functional_status: { ambulation: 'Walker', fall_risk: 'high', notes: null },
      advance_directives: { has_living_will: true, dnr_status: 'full_code' },
    }, NOW);
    expect(rows.map((row) => row.label)).toEqual([
      'Date of birth', 'Medical record number', 'Status', 'Care type', 'Primary diagnosis',
      'Secondary diagnoses', 'Current medications', 'Functional status', 'Advance directives',
    ]);
    const byLabel = Object.fromEntries(rows.map((row) => [row.label, row.lines]));
    expect(byLabel['Date of birth'][0]).toMatch(/\(age 86\)$/);
    expect(byLabel.Status).toEqual(['Active']);
    expect(byLabel['Care type']).toEqual(['Home health']);
    expect(byLabel['Secondary diagnoses']).toEqual(['E11.9', 'I10']);
    expect(byLabel['Current medications']).toEqual(['Metformin — Dosage: 500 mg, Frequency: BID']);
    expect(byLabel['Functional status']).toEqual(['Ambulation: Walker', 'Fall risk: high']);
    expect(byLabel['Advance directives']).toEqual(['Has living will: Yes', 'DNR status: Full code']);
  });

  it('returns nothing for an absent or empty projection', () => {
    expect(patientInformationRows(null)).toEqual([]);
    expect(patientInformationRows({ id: 'p', first_name: 'Ada' })).toEqual([]);
    expect(patientValueLines([])).toEqual([]);
    expect(patientValueLines({ a: '', b: null })).toEqual([]);
  });

  it('leads a record with its identifying field', () => {
    expect(patientValueLines([{ stage: '2', location: 'Sacrum', type: 'pressure' }]))
      .toEqual(['Sacrum — Stage: 2, Type: pressure']);
    expect(patientValueLines([{ hospital: 'General', reason: 'CHF exacerbation', date: '2026-08-01' }]))
      .toEqual(['CHF exacerbation — Hospital: General, Date: 2026-08-01']);
  });
});
