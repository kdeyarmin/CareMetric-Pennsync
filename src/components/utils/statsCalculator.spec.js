import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { format, subDays } from 'date-fns';
import { calculateStats, calculateNurseStats } from './statsCalculator.jsx';
import { toLocalISODate } from '@/lib/dateLocal';

/**
 * Date-window regression tests for the shared stats calculator.
 *
 * Two defects are pinned here:
 *
 * 1. The "in range" boundary carried the CURRENT TIME OF DAY (`new Date()` minus
 *    N days), while `visit_date` / `incident_date` / `audit_date` are date-only
 *    fields with no time component. A record dated exactly N days ago parses at
 *    midnight, which is always earlier than "this time of day, N days ago", so
 *    the oldest day of every window silently vanished from the counts.
 *
 * 2. Date-only fields were parsed with `new Date("YYYY-MM-DD")`, which is UTC
 *    midnight — the PREVIOUS local day for every timezone west of UTC (i.e. all
 *    of this app's Pennsylvania users). That shifted records out of the window
 *    at its edges.
 *
 * Assertion 1 is timezone-independent; assertion 2 pins TZ to the app's actual
 * market so it fails on a UTC CI box too if the parsing regresses.
 */

const localDay = (daysAgo) => toLocalISODate(subDays(new Date(), daysAgo));

describe('calculateStats date windows', () => {
  it('counts a visit dated exactly on the window boundary', () => {
    const stats = calculateStats({
      dateRange: 30,
      visits: [{ visit_date: localDay(30), status: 'completed' }],
    });

    expect(stats.visits.inRange).toBe(1);
    expect(stats.visits.completedInRange).toBe(1);
  });

  it('counts an incident dated exactly on the window boundary', () => {
    const stats = calculateStats({
      dateRange: 30,
      incidents: [{ incident_date: localDay(30), incident_type: 'fall' }],
    });

    expect(stats.incidents.inRange).toBe(1);
  });

  it('still excludes records from before the window', () => {
    const stats = calculateStats({
      dateRange: 30,
      visits: [{ visit_date: localDay(31), status: 'completed' }],
      incidents: [{ incident_date: localDay(31), incident_type: 'fall' }],
    });

    expect(stats.visits.inRange).toBe(0);
    expect(stats.incidents.inRange).toBe(0);
  });

  it('counts a visit dated today', () => {
    const stats = calculateStats({
      dateRange: 7,
      visits: [{ visit_date: localDay(0), status: 'completed' }],
    });

    expect(stats.visits.inRange).toBe(1);
  });

  it('ignores records whose date is missing or unparseable', () => {
    const stats = calculateStats({
      dateRange: 30,
      visits: [{ status: 'completed' }, { visit_date: '', status: 'completed' }],
      incidents: [{ incident_date: 'not-a-date' }, { incident_date: '2026-02-31' }],
    });

    expect(stats.visits.inRange).toBe(0);
    expect(stats.incidents.inRange).toBe(0);
  });

  it('applies the same window to per-nurse stats as to agency stats', () => {
    const data = {
      dateRange: 30,
      noteConversions: [{ nurse_email: 'nurse@example.com', created_date: localDay(30) }],
    };

    expect(calculateStats(data).noteEnhancements.inRange).toBe(1);
    expect(calculateNurseStats('nurse@example.com', data).noteConversionsInRange).toBe(1);
  });
});

describe('date-only handling west of UTC (America/New_York)', () => {
  // Reached through globalThis so this browser-globals-linted file doesn't
  // reference the bare `process` identifier.
  const env = globalThis.process.env;
  const originalTZ = env.TZ;
  beforeAll(() => { env.TZ = 'America/New_York'; });
  afterAll(() => {
    // CI starts with no TZ set, and `env.TZ = undefined` stores the STRING
    // "undefined" — an invalid zone Node resolves as GMT. A reused Vitest worker
    // would then run later date-sensitive suites under a silently wrong
    // timezone, which could mask exactly the regressions this file exists to
    // catch. Delete the variable instead of assigning undefined back.
    if (originalTZ === undefined) delete env.TZ;
    else env.TZ = originalTZ;
  });

  it('does not shift a date-only visit_date back a day', () => {
    // Sanity check that the pinned zone is actually in effect.
    expect(new Date('2026-07-27T12:00:00Z').getTimezoneOffset()).toBe(240);

    const stats = calculateStats({
      dateRange: 30,
      visits: [{ visit_date: localDay(30), status: 'completed' }],
    });

    expect(stats.visits.inRange).toBe(1);
  });

  it('buckets a date-only value under its own local calendar day', () => {
    // The trend charts key their buckets with toLocalISODate() and read them
    // back with date-fns `format(localDate, "yyyy-MM-dd")`. Those two must agree,
    // otherwise every plotted point lands one bucket early (the bug in
    // PopulationTrendAnalyzer, where the newest day always rendered as 0).
    const day = '2026-07-27';
    expect(toLocalISODate(day)).toBe(day);
    expect(format(new Date(2026, 6, 27), 'yyyy-MM-dd')).toBe(toLocalISODate(day));

    // The naive parse is what shifted: it lands on the 26th in this zone.
    expect(format(new Date(day), 'yyyy-MM-dd')).toBe('2026-07-26');
  });
});
