import { describe, expect, it } from 'vitest';
import {
  MAX_PATIENT_MATCH_SUGGESTIONS,
  normalizePatientMatchSuggestions,
} from './patientMatchSuggestions';

describe('patient match suggestion normalization', () => {
  it('keeps a duplicated preferred match first and merges its evidence', () => {
    const result = normalizePatientMatchSuggestions({
      preferred: {
        patient_id: 'patient-a',
        confidence_score: 92,
        reasons: ['Name and DOB'],
        discrepancies: ['Phone differs'],
      },
      suggestions: [
        {
          patient_id: 'patient-a',
          confidence_score: 95,
          reasons: ['Name and DOB', 'MRN is close'],
          discrepancies: ['Phone differs', 'Address differs'],
        },
        {
          patient_id: 'patient-b',
          confidence_score: 70,
          reasons: ['Name is similar'],
        },
      ],
    });

    expect(result).toEqual({
      suggestions: [
        {
          patient_id: 'patient-a',
          confidence_score: 95,
          reasons: ['Name and DOB', 'MRN is close'],
          discrepancies: ['Phone differs', 'Address differs'],
        },
        {
          patient_id: 'patient-b',
          confidence_score: 70,
          reasons: ['Name is similar'],
          discrepancies: [],
        },
      ],
      invalidCount: 0,
      duplicateCount: 1,
      truncatedCount: 0,
    });
  });

  it('deduplicates alternatives in stable order and keeps their strongest score', () => {
    const result = normalizePatientMatchSuggestions({
      suggestions: [
        { patient_id: 'patient-b', confidence_score: 40, reasons: ['First'] },
        { patient_id: 'patient-a', confidence_score: 60, reasons: ['Other'] },
        { patient_id: 'patient-b', confidence_score: 80, reasons: ['Second'] },
      ],
    });

    expect(result.suggestions.map(({ patient_id }) => patient_id)).toEqual([
      'patient-b',
      'patient-a',
    ]);
    expect(result.suggestions[0]).toMatchObject({
      confidence_score: 80,
      reasons: ['First', 'Second'],
    });
    expect(result.duplicateCount).toBe(1);
  });

  it('drops malformed ids and canonicalizes untrusted metadata to the finite shape', () => {
    const longReason = 'x'.repeat(550);
    const result = normalizePatientMatchSuggestions({
      suggestions: [
        null,
        { patient_id: ' patient-a', confidence_score: 50 },
        { patient_id: '$ne', confidence_score: 50 },
        { patient_id: { id: 'patient-a' }, confidence_score: 50 },
        {
          patient_id: 'patient-valid',
          patient_name: 'Stale untrusted name',
          confidence_score: 101,
          reasons: [' Reason ', 'Reason', 42, longReason],
          discrepancies: 'not-an-array',
          extra: true,
        },
      ],
    });

    expect(result.invalidCount).toBe(4);
    expect(result.suggestions).toEqual([{
      patient_id: 'patient-valid',
      confidence_score: 0,
      reasons: ['Reason', longReason.slice(0, 500)],
      discrepancies: [],
    }]);
  });

  it('retains the preferred match within the 100-record cap without mutating inputs', () => {
    const preferred = {
      patient_id: 'patient-best',
      confidence_score: 90,
      reasons: ['Best'],
    };
    const suggestions = Array.from(
      { length: MAX_PATIENT_MATCH_SUGGESTIONS },
      (_, index) => ({
        patient_id: `patient-${index}`,
        confidence_score: index,
        reasons: [`Reason ${index}`],
      }),
    );
    const preferredSnapshot = structuredClone(preferred);
    const suggestionsSnapshot = structuredClone(suggestions);

    const result = normalizePatientMatchSuggestions({ preferred, suggestions });

    expect(result.suggestions).toHaveLength(MAX_PATIENT_MATCH_SUGGESTIONS);
    expect(result.suggestions[0].patient_id).toBe('patient-best');
    expect(result.truncatedCount).toBe(1);
    expect(preferred).toEqual(preferredSnapshot);
    expect(suggestions).toEqual(suggestionsSnapshot);
  });
});
