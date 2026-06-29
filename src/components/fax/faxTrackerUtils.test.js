import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TWENTY_FOUR_HOURS_MS,
  filterRecentFaxLogs,
  getStatusCounts,
  getRelativeTimeLabel
} from './faxTrackerUtils.js';

test('filterRecentFaxLogs keeps only logs within configured time range', () => {
  const now = Date.parse('2026-04-04T12:00:00.000Z');
  const logs = [
    { id: 1, created_date: '2026-04-04T11:59:00.000Z' },
    { id: 2, created_date: '2026-04-03T12:01:00.000Z' },
    { id: 3, created_date: '2026-04-03T11:58:00.000Z' }
  ];

  const result = filterRecentFaxLogs(logs, now, TWENTY_FOUR_HOURS_MS);
  assert.deepEqual(result.map((log) => log.id), [1, 2]);
});

test('getStatusCounts normalizes unknown status to pending', () => {
  const logs = [
    { status: 'delivered' },
    { status: 'failed' },
    { status: 'queued' },
    { status: 'in_transit' },
    {}
  ];

  assert.deepEqual(getStatusCounts(logs), {
    delivered: 1,
    failed: 1,
    pending: 2,
    queued: 1
  });
});

test('getRelativeTimeLabel returns human readable labels', () => {
  const now = Date.parse('2026-04-04T12:00:00.000Z');

  assert.equal(getRelativeTimeLabel('2026-04-04T11:59:40.000Z', now), 'Just now');
  assert.equal(getRelativeTimeLabel('2026-04-04T11:30:00.000Z', now), '30m ago');
  assert.equal(getRelativeTimeLabel('2026-04-04T09:00:00.000Z', now), '3h ago');
  assert.equal(getRelativeTimeLabel('2026-04-02T12:00:00.000Z', now), '2d ago');
});

test('getStatusCounts handles empty arrays', () => {
  assert.deepEqual(getStatusCounts([]), {
    delivered: 0,
    failed: 0,
    pending: 0,
    queued: 0
  });
});
