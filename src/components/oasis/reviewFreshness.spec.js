import { describe, it, expect } from 'vitest';
import { stableStringify, reviewFingerprint } from '@/components/oasis/reviewFreshness';

describe('stableStringify', () => {
  it('is independent of key insertion order at every depth', () => {
    const a = { b: 1, a: { y: 2, x: [1, { q: 1, p: 2 }] } };
    const b = { a: { x: [1, { p: 2, q: 1 }], y: 2 }, b: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it('preserves array order (order is meaningful) and handles primitives', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(undefined)).toBe('null');
    expect(stableStringify('x')).toBe('"x"');
  });
});

describe('reviewFingerprint', () => {
  const oasis = { functional_scores: { m1860_ambulation: 2 }, primary_diagnosis_code: 'I50.9' };

  it('is stable for equal inputs regardless of key order', () => {
    const reordered = { primary_diagnosis_code: 'I50.9', functional_scores: { m1860_ambulation: 2 } };
    expect(reviewFingerprint(oasis, { age: 70 })).toBe(reviewFingerprint(reordered, { age: 70 }));
  });

  it('changes when the assessment data changes', () => {
    const corrected = { ...oasis, functional_scores: { m1860_ambulation: 3 } };
    expect(reviewFingerprint(oasis, {})).not.toBe(reviewFingerprint(corrected, {}));
  });

  it('changes when the patient context changes — a match landing later is a real change', () => {
    expect(reviewFingerprint(oasis, {})).not.toBe(reviewFingerprint(oasis, { age: 70 }));
    expect(reviewFingerprint(oasis, { age: 70 })).not.toBe(
      reviewFingerprint(oasis, { age: 70, allergies: 'penicillin' })
    );
  });

  it('returns null without assessment data', () => {
    expect(reviewFingerprint(null, { age: 70 })).toBeNull();
    expect(reviewFingerprint(undefined)).toBeNull();
  });
});
