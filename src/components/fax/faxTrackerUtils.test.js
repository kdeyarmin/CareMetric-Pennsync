import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TWENTY_FOUR_HOURS_MS,
  filterRecentFaxLogs,
  getStatusCounts,
  getRelativeTimeLabel,
  normalizeStatus,
  isUntrackedLegacyFaxRow,
  faxTrackerDisplayStatus,
} from './faxTrackerUtils.js';

/** Authority senders stamp an attempt id and leave document_url null. */
const tracked = (status) => ({
  status,
  provider_submission_attempt_id: 'att_test',
  document_url: null,
});

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
    tracked('delivered'),
    tracked('failed'),
    tracked('queued'),
    tracked('submission_unknown'),
    tracked('in_transit'),
    tracked(undefined),
  ];

  assert.deepEqual(getStatusCounts(logs), {
    delivered: 1,
    failed: 1,
    pending: 2,
    queued: 1,
    needs_review: 1,
    untracked: 0,
  });
});

test('normalizeStatus never counts an unconfirmed sent fax as delivered', () => {
  assert.equal(normalizeStatus('sent'), 'queued');
  assert.equal(normalizeStatus('sending'), 'queued');
  assert.equal(normalizeStatus('retrying'), 'queued');
  assert.equal(normalizeStatus('retried'), 'failed');
  assert.equal(normalizeStatus('delivered'), 'delivered');
  assert.equal(normalizeStatus('submission_unknown'), 'needs_review');
  assert.deepEqual(getStatusCounts([
    tracked('sent'), tracked('delivered'), tracked('retrying'), tracked('retried'),
  ]), { delivered: 1, failed: 1, pending: 0, queued: 2, needs_review: 0, untracked: 0 });
});

test('legacy sendFax URL rows display as untracked, not queued forever', () => {
  assert.equal(isUntrackedLegacyFaxRow({
    status: 'sending',
    document_url: 'https://files.example/a.pdf',
  }), true);
  assert.equal(isUntrackedLegacyFaxRow({
    status: 'sending',
    document_url: null,
    provider_submission_attempt_id: 'att_1',
  }), false);
  assert.equal(faxTrackerDisplayStatus({
    status: 'sending',
    document_url: 'https://files.example/a.pdf',
  }), 'untracked');
  // A terminal send-time failure still reads as failed, not "not tracked".
  assert.equal(faxTrackerDisplayStatus({
    status: 'failed',
    document_url: 'https://files.example/a.pdf',
  }), 'failed');
  assert.deepEqual(getStatusCounts([
    { status: 'sending', document_url: 'https://files.example/a.pdf' },
    tracked('sending'),
  ]), { delivered: 0, failed: 0, pending: 0, queued: 1, needs_review: 0, untracked: 1 });
});

test('the fax logs dashboard groups statuses with the same buckets', async () => {
  const { readFile } = await import('node:fs/promises');
  const dashboard = await readFile(new URL('../hub-tabs/FaxLogsDashboard.jsx', import.meta.url), 'utf8');
  assert.match(dashboard, /import \{ normalizeStatus \} from "@\/components\/fax\/faxTrackerUtils"/);
  assert.doesNotMatch(dashboard, /const STATUS_GROUPS = \{/);
  assert.doesNotMatch(dashboard, /f\.status === 'sent'/);
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
    queued: 0,
    needs_review: 0,
    untracked: 0,
  });
});
