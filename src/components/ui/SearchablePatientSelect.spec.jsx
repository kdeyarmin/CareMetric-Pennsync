import { describe, expect, it } from 'vitest';
import { normalizePatientIds, parseStoredPatientIds } from './SearchablePatientSelect';

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

describe('normalizePatientIds', () => {
  it('re-applies the requested bound after deduplicating a merged list', () => {
    const fromUser = Array.from({ length: 100 }, (_, index) => `profile-${index}`);
    const fromLocal = Array.from({ length: 100 }, (_, index) => `local-${index}`);

    expect(normalizePatientIds([...fromUser, ...fromLocal], 100)).toHaveLength(100);
  });
});
