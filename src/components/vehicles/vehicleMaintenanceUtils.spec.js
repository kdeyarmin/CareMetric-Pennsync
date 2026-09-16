import { describe, expect, it } from 'vitest';
import { parseCostCents, summarizeEntries, serviceDate, vehicleTitle, todayLocal } from './vehicleMaintenanceUtils';

describe('vehicle service values', () => {
  it.each([['89.95', 8995], ['10.5', 1050], ['0', 0], [' 20 ', 2000], ['', undefined]])('parses %s without floating-point currency rounding', (input, expected) => {
    expect(parseCostCents(input)).toBe(expected);
  });
  it.each(['-1', '1.234', 'Infinity', 'abc', '1e3', '1000000.01'])('rejects invalid cost %s', input => {
    expect(() => parseCostCents(input)).toThrow();
  });
  it('distinguishes unknown costs, retains historical odometers, and counts pending reviews', () => {
    expect(summarizeEntries([{ cost_cents: 8995, odometer: 12500, review_status: 'reviewed' }, { odometer: 9000, review_status: 'pending' }, { cost_cents: 0, odometer: 11500, review_status: 'needs_follow_up' }], 10000))
      .toEqual({ entries: 3, knownCostCents: 8995, missingCosts: 1, awaitingReview: 2, odometer: 12500 });
  });
  it('does not shift a service date into another timezone', () => {
    expect(serviceDate('2026-01-01')).toBe('01/01/2026');
    expect(todayLocal(new Date(2026, 0, 2, 12))).toBe('2026-01-02');
  });
  it('builds a useful vehicle description', () => {
    expect(vehicleTitle({ year: 2024, make: 'Ford', model: 'Escape' })).toBe('2024 Ford Escape');
  });
});
