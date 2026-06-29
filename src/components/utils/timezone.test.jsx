import { describe, it, expect } from 'vitest';
import { formatEastern } from './timezone.jsx';

describe('formatEastern', () => {
  describe('date-only strings (YYYY-MM-DD) render the exact calendar day', () => {
    // Regression: previously a bare date was anchored at UTC midnight, which
    // converts to the PREVIOUS day in Eastern (UTC-4/-5), shifting every
    // visit_date / incident_date / due_date one day backward.
    it('keeps a mid-year date on the same day', () => {
      expect(formatEastern('2026-06-25', 'MMM d, yyyy')).toBe('Jun 25, 2026');
    });

    it('does not roll back across a year boundary', () => {
      expect(formatEastern('2026-01-01', 'MMM d, yyyy')).toBe('Jan 1, 2026');
    });

    it('does not roll forward at year-end', () => {
      expect(formatEastern('2026-12-31', 'MMM d, yyyy')).toBe('Dec 31, 2026');
    });

    it('handles a date with surrounding whitespace', () => {
      expect(formatEastern(' 2026-06-25 ', 'MMM d, yyyy')).toBe('Jun 25, 2026');
    });
  });

  describe('datetime strings keep their existing UTC-anchored behavior', () => {
    it('converts an explicit UTC datetime to Eastern wall-clock', () => {
      // 14:30 UTC = 10:30 EDT
      expect(formatEastern('2026-06-25T14:30:00Z', 'MMM d, yyyy HH:mm')).toBe('Jun 25, 2026 10:30');
    });

    it('treats a datetime without a zone as UTC', () => {
      // 00:30 UTC = 20:30 prior-day EDT
      expect(formatEastern('2026-06-25T00:30:00', 'MMM d, yyyy HH:mm')).toBe('Jun 24, 2026 20:30');
    });
  });

  it('returns empty string for falsy input', () => {
    expect(formatEastern('')).toBe('');
    expect(formatEastern(null)).toBe('');
    expect(formatEastern(undefined)).toBe('');
  });
});
