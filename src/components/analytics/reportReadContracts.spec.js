import { describe, expect, it } from 'vitest';
import { displayMeasurement, measuredAverage, readReportRows, reportRangeAvailable } from './reportReadContracts';

describe('report measurement and read contracts', () => {
  it('uses only measured values, retaining real zeroes in the denominator', () => {
    expect(measuredAverage([{ n: 0 }, { n: 80 }, {}, { n: null }], row => row.n)).toBe(40);
    expect(measuredAverage([{}, { n: null }, { n: NaN }], row => row.n)).toBeNull();
    expect(displayMeasurement(null, '%')).toBe('Not measured');
    expect(displayMeasurement(0, '%')).toBe('0.0%');
  });
  it.each([
    ['2026-02-31', '2026-03-10'], ['2026-01-01', '2025-01-01'], ['', '2026-01-01'],
    ['2026-01-01', '2027-01-02'], ['0001-01-01', '9999-12-31'], ['2026-1-1', '2026-01-02'],
  ])('rejects invalid or unbounded calendar ranges %s..%s', (start, end) => {
    expect(reportRangeAvailable(start, end)).toBe(false);
  });
  it('accepts one-day and 366-day calendar windows including a leap day', () => {
    expect(reportRangeAvailable('2028-02-29', '2028-02-29')).toBe(true);
    expect(reportRangeAvailable('2028-01-01', '2028-12-31')).toBe(true);
  });
  it.each([
    ['notes', {}], ['notes', [null]], ['notes', [{ id: 'a' }]],
    ['notes', [{ id: 'a', created_date: '2026-01-01', quality_score: '80' }]],
    ['audits', [{ id: 'a', audit_date: '2026-02-31' }]],
    ['audits', [{ id: 'a', audit_date: '2026-02-31T00:00:00Z' }]],
    ['notes', [{ id: 'a', created_date: '9/17/2026' }]],
    ['assignments', [{ id: 'a', score_percentage: Infinity }]],
    ['modules', [{ id: 'a', title: {} }]], ['recommendations', [{ id: 'a', addressed: 'false' }]],
    ['users', [{ id: 'a' }, { id: 'a' }]],
  ])('rejects unreadable %s rows', (kind, rows) => {
    expect(() => readReportRows(rows, kind)).toThrow('REPORT_READ_INVALID');
  });
  it('preserves valid legacy rows without inventing a score or mutating unknown fields', () => {
    const rows = [{ id: 'a', migration_note: 'kept', score_percentage: null }];
    expect(readReportRows(rows, 'assignments')).toBe(rows);
    expect(rows[0].score_percentage).toBeNull();
  });
  it.each(['2026-09-17', '2026-09-17T23:59:59Z', '2026-09-17T23:59:59.123456+05:30', '2026-09-17T00:00:00-04:00'])('accepts a real ISO date/timestamp with its timezone intact (%s)', created_date => {
    const rows = [{ id: 'a', created_date }];
    expect(readReportRows(rows, 'notes')).toBe(rows);
  });
});
