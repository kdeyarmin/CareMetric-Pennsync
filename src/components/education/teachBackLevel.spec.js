import { describe, it, expect } from 'vitest';
import { computeOverallLevel } from './TeachBackConfirmation.jsx';

// Regression: the saved understanding level and the generated documentation note
// once used different thresholds, so an encounter could be recorded "fair"/"poor"
// while the note read "adequate understanding". Both now derive from this one fn.
describe('computeOverallLevel', () => {
  it('is "good" only when a majority of answers are good', () => {
    expect(computeOverallLevel(['good', 'good'])).toBe('good');
    expect(computeOverallLevel(['good', 'good', 'fair'])).toBe('good');
  });

  it('is "fair" when good+fair are a majority but good alone is not', () => {
    expect(computeOverallLevel(['good', 'fair'])).toBe('fair');
    expect(computeOverallLevel(['fair', 'fair'])).toBe('fair');
  });

  it('is "poor" when good+fair are not a majority', () => {
    expect(computeOverallLevel(['good', 'poor'])).toBe('poor');
    expect(computeOverallLevel(['poor', 'poor'])).toBe('poor');
  });

  it('never disagrees with the note threshold (good majority == adequate)', () => {
    // The note says "adequate understanding" iff overall === 'good'.
    const cases = [
      ['good', 'fair'],
      ['good', 'poor'],
      ['fair', 'fair'],
      ['good', 'good', 'poor'],
    ];
    for (const levels of cases) {
      const overall = computeOverallLevel(levels);
      const goodMajority = levels.filter((l) => l === 'good').length > levels.length / 2;
      expect(overall === 'good').toBe(goodMajority);
    }
  });
});
