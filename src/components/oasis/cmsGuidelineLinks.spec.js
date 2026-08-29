import { describe, it, expect } from 'vitest';
import {
  ecfrUrlFromCitation,
  resolveCmsGuidelineLink,
  HH_QUALITY_REPORTING_URL,
  OASIS_DATA_SETS_URL,
  HH_COPS_PART_484_URL,
} from '@/components/oasis/cmsGuidelineLinks';

describe('ecfrUrlFromCitation', () => {
  it('derives the official section URL from common citation forms', () => {
    const expected = 'https://www.ecfr.gov/current/title-42/section-484.55';
    expect(ecfrUrlFromCitation('42 CFR 484.55')).toBe(expected);
    expect(ecfrUrlFromCitation('42 C.F.R. § 484.55')).toBe(expected);
    expect(ecfrUrlFromCitation('Per 42 CFR section 484.55, the comprehensive assessment…')).toBe(expected);
    expect(ecfrUrlFromCitation('42 CFR 484.55(b)(2)')).toBe(expected);
  });

  it('handles the F2F certification rule and part-only citations', () => {
    expect(ecfrUrlFromCitation('42 CFR 424.22')).toBe('https://www.ecfr.gov/current/title-42/section-424.22');
    expect(ecfrUrlFromCitation('42 CFR Part 484')).toBe(HH_COPS_PART_484_URL);
    expect(ecfrUrlFromCitation('42 CFR Part 409')).toBe('https://www.ecfr.gov/current/title-42/part-409');
  });

  it('returns null when no CFR citation is present', () => {
    expect(ecfrUrlFromCitation('OASIS-E Guidance Manual, Section GG')).toBeNull();
    expect(ecfrUrlFromCitation('')).toBeNull();
    expect(ecfrUrlFromCitation(null)).toBeNull();
  });
});

describe('resolveCmsGuidelineLink', () => {
  it('prefers the derived official eCFR link over the AI-supplied one', () => {
    expect(resolveCmsGuidelineLink('42 CFR 484.60', 'https://www.cms.gov/some-dead-page')).toBe(
      'https://www.ecfr.gov/current/title-42/section-484.60'
    );
  });

  it('falls back to a safe AI link when there is no citation', () => {
    expect(resolveCmsGuidelineLink('OASIS-E manual', 'https://www.cms.gov/files/document/oasis-e-manual.pdf')).toBe(
      'https://www.cms.gov/files/document/oasis-e-manual.pdf'
    );
  });

  it('never returns an unsafe AI link — falls back to the curated topic page', () => {
    expect(resolveCmsGuidelineLink('OASIS accuracy requirement', 'javascript:alert(1)')).toBe(OASIS_DATA_SETS_URL);
    expect(resolveCmsGuidelineLink('Home Health Quality Reporting Program', '')).toBe(HH_QUALITY_REPORTING_URL);
    expect(resolveCmsGuidelineLink('Medicare Conditions of Participation', undefined)).toBe(HH_COPS_PART_484_URL);
  });

  it('matches the CoP acronym only as a whole word — COPD must not resolve to the CoPs link', () => {
    // COPD is one of the most common home health diagnoses, so an unbounded
    // "CoP" alternation turned ordinary clinical text into a CoP citation.
    expect(resolveCmsGuidelineLink('COPD exacerbation management', '')).toBeNull();
    expect(resolveCmsGuidelineLink('Chronic obstructive pulmonary disease (COPD)', '')).toBeNull();
    expect(resolveCmsGuidelineLink('Scope of practice', '')).toBeNull();
    expect(resolveCmsGuidelineLink('copay collection policy', '')).toBeNull();
    // Genuine CoP references still resolve.
    expect(resolveCmsGuidelineLink('CoP compliance', '')).toBe(HH_COPS_PART_484_URL);
    expect(resolveCmsGuidelineLink('Home health CoPs', '')).toBe(HH_COPS_PART_484_URL);
    expect(resolveCmsGuidelineLink('Medicare Condition of Participation', '')).toBe(HH_COPS_PART_484_URL);
  });

  it('returns null when nothing can be resolved', () => {
    expect(resolveCmsGuidelineLink('internal agency policy', 'not a url')).toBeNull();
    expect(resolveCmsGuidelineLink('', '')).toBeNull();
  });
});
