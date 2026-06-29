import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeComms } from './commsDashboard.js';

// Fixed reference time so the 7-day window is deterministic.
const NOW = new Date('2026-06-19T12:00:00');
const iso = (offsetDays, hour = 9) => {
  const d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - offsetDays, hour, 0, 0);
  return d.toISOString();
};

test('empty input yields all zeros and a 7-day series', () => {
  const out = summarizeComms({}, NOW);
  assert.deepEqual(out.sms, {
    total: 0, inbound: 0, outbound: 0, delivered: 0, failed: 0, delivery_rate: 0,
  });
  assert.deepEqual(out.calls, {
    total: 0, inbound: 0, outbound: 0, completed: 0, failed: 0,
    missed: 0, voicemail_backlog: 0, avg_duration_secs: 0,
  });
  assert.deepEqual(out.fax, { total: 0, delivered: 0, failed: 0, delivery_rate: 0 });
  assert.equal(out.daily.length, 7);
  assert.ok(out.daily.every((d) => d.sms === 0 && d.calls === 0 && d.faxes === 0));
  // Last bucket is today.
  assert.equal(out.daily[6].date, '2026-06-19');
  assert.equal(out.daily[0].date, '2026-06-13');
});

test('missing keys / undefined argument do not throw', () => {
  assert.doesNotThrow(() => summarizeComms(undefined, NOW));
  assert.doesNotThrow(() => summarizeComms({ messages: null, calls: null, faxes: null }, NOW));
});

test('sms counts and delivery rate (guards divide-by-zero)', () => {
  const messages = [
    { direction: 'outbound', status: 'delivered', created_date: iso(0) },
    { direction: 'outbound', status: 'delivered', created_date: iso(1) },
    { direction: 'outbound', status: 'failed', created_date: iso(1) },
    { direction: 'outbound', status: 'sent', created_date: iso(2) },
    { direction: 'inbound', status: 'received', created_date: iso(0) },
  ];
  const out = summarizeComms({ messages }, NOW);
  assert.equal(out.sms.total, 5);
  assert.equal(out.sms.inbound, 1);
  assert.equal(out.sms.outbound, 4);
  assert.equal(out.sms.delivered, 2);
  assert.equal(out.sms.failed, 1);
  // 2 delivered / 4 outbound = 50%
  assert.equal(out.sms.delivery_rate, 50);
});

test('sms delivery rate is 0 when there is no outbound', () => {
  const messages = [
    { direction: 'inbound', status: 'received', created_date: iso(0) },
    { direction: 'inbound', status: 'delivered', created_date: iso(0) },
  ];
  const out = summarizeComms({ messages }, NOW);
  assert.equal(out.sms.delivery_rate, 0);
});

test('call metrics: missed, voicemail backlog, avg duration', () => {
  const calls = [
    { direction: 'inbound', status: 'completed', has_voicemail: true, duration_seconds: 30, created_date: iso(0) },
    { direction: 'inbound', status: 'failed', has_voicemail: false, duration_seconds: 0, created_date: iso(0) },
    { direction: 'inbound', status: 'ringing', created_date: iso(1) },
    { direction: 'outbound', status: 'completed', duration_seconds: 90, created_date: iso(1) },
    { direction: 'outbound', status: 'completed', duration_seconds: 60, created_date: iso(2) },
  ];
  const out = summarizeComms({ calls }, NOW);
  assert.equal(out.calls.total, 5);
  assert.equal(out.calls.inbound, 3);
  assert.equal(out.calls.outbound, 2);
  assert.equal(out.calls.completed, 3);
  assert.equal(out.calls.failed, 1);
  // inbound w/ voicemail + inbound failed = 2 missed; active ringing is not terminal.
  assert.equal(out.calls.missed, 2);
  assert.equal(out.calls.voicemail_backlog, 1);
  // durations 30,90,60 (zero excluded) => avg 60
  assert.equal(out.calls.avg_duration_secs, 60);
});

test('avg duration is 0 when no positive durations', () => {
  const calls = [
    { direction: 'inbound', status: 'failed', duration_seconds: 0, created_date: iso(0) },
    { direction: 'inbound', status: 'ringing', created_date: iso(0) },
  ];
  const out = summarizeComms({ calls }, NOW);
  assert.equal(out.calls.avg_duration_secs, 0);
});

test('fax counts and delivery rate over total', () => {
  const faxes = [
    { status: 'delivered', created_date: iso(0) },
    { status: 'delivered', created_date: iso(0) },
    { status: 'failed', created_date: iso(1) },
    { status: 'sending', created_date: iso(1) },
  ];
  const out = summarizeComms({ faxes }, NOW);
  assert.equal(out.fax.total, 4);
  assert.equal(out.fax.delivered, 2);
  assert.equal(out.fax.failed, 1);
  // 2 delivered / 4 total = 50%
  assert.equal(out.fax.delivery_rate, 50);
});

test('daily series buckets by local day and ignores out-of-window rows', () => {
  const messages = [
    { direction: 'outbound', status: 'delivered', created_date: iso(0) },
    { direction: 'outbound', status: 'delivered', created_date: iso(0) },
    { direction: 'outbound', status: 'sent', created_date: iso(6) },
    { direction: 'outbound', status: 'sent', created_date: iso(30) }, // out of window
  ];
  const calls = [{ direction: 'outbound', status: 'completed', duration_seconds: 10, created_date: iso(6) }];
  const faxes = [{ status: 'delivered', created_date: iso(3) }];
  const out = summarizeComms({ messages, calls, faxes }, NOW);

  const today = out.daily[6];
  assert.equal(today.sms, 2);
  const oldest = out.daily[0]; // 6 days ago
  assert.equal(oldest.sms, 1);
  assert.equal(oldest.calls, 1);
  const midFax = out.daily.find((d) => d.faxes > 0);
  assert.equal(midFax.faxes, 1);
  // Total across the 7 buckets excludes the 30-day-old sms.
  const totalSms = out.daily.reduce((a, d) => a + d.sms, 0);
  assert.equal(totalSms, 3);
});

test('unparseable created_date does not crash daily bucketing', () => {
  const messages = [
    { direction: 'outbound', status: 'delivered', created_date: 'not-a-date' },
    { direction: 'outbound', status: 'delivered' },
  ];
  assert.doesNotThrow(() => summarizeComms({ messages }, NOW));
  const out = summarizeComms({ messages }, NOW);
  assert.equal(out.sms.total, 2);
  const totalSms = out.daily.reduce((a, d) => a + d.sms, 0);
  assert.equal(totalSms, 0);
});
