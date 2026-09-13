import { describe, expect, it } from 'vitest';
import { parseStoredPatientIds } from './SearchablePatientSelect';

describe('parseStoredPatientIds', () => {
  it('normalizes identifiers and applies the requested bound', () => {
    expect(parseStoredPatientIds('["patient-1","patient-1","patient-2","patient-3"]', 2))
      .toEqual(['patient-1', 'patient-2']);
  });

  it.each([
    [null, []],
    ['{bad', []],
    ['{}', []],
    ['[null,3,""," spaced ","patient-1"]', ['patient-1']],
  ])('fails closed for invalid stored data %#', (stored, expected) => {
    expect(parseStoredPatientIds(stored)).toEqual(expected);
  });

  it('rejects invalid bounds rather than returning an unbounded list', () => {
    expect(parseStoredPatientIds('["patient-1"]', 0)).toEqual([]);
  });
});
