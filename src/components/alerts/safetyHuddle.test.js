import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSafetyHuddle, buildSafetyHuddleItem, formatSlaTime, isOpenSafetyAlert } from './safetyHuddle.js';

const NOW = new Date('2026-07-04T12:00:00Z');

test('buildSafetyHuddle prioritizes overdue critical and urgent alerts', () => {
  const huddle = buildSafetyHuddle([
    { id: 'low', severity: 'low', status: 'active', created_date: '2026-07-04T11:30:00Z' },
    { id: 'critical', severity: 'critical', status: 'active', created_date: '2026-07-04T10:30:00Z', risk_score: 90 },
    { id: 'high-urgent', severity: 'high', status: 'acknowledged', flagged_urgent: true, created_date: '2026-07-04T11:00:00Z' },
  ], NOW);

  assert.equal(huddle.summary.openCount, 3);
  assert.equal(huddle.summary.urgentCount, 2);
  assert.equal(huddle.summary.overdueCount, 1);
  assert.equal(huddle.summary.status, 'escalate');
  assert.equal(huddle.topItems[0].id, 'critical');
});

test('buildSafetyHuddleItem detects owner and acknowledgement gaps', () => {
  const item = buildSafetyHuddleItem({
    id: 'a1',
    severity: 'high',
    status: 'active',
    created_date: '2026-07-04T11:00:00Z',
  }, NOW);

  assert.equal(item.needsOwner, true);
  assert.equal(item.isAcknowledged, false);
  assert.match(item.nextAction, /Assign a clinician owner/);
});

test('resolved and dismissed alerts are excluded from huddle', () => {
  assert.equal(isOpenSafetyAlert({ status: 'resolved' }), false);
  assert.equal(isOpenSafetyAlert({ status: 'dismissed' }), false);
  assert.equal(isOpenSafetyAlert({ status: 'acknowledged' }), true);
  assert.equal(buildSafetyHuddle([{ status: 'resolved' }, { status: 'dismissed' }], NOW).summary.openCount, 0);
});

test('formatSlaTime renders overdue and remaining time', () => {
  assert.equal(formatSlaTime(-61), '2h overdue');
  assert.equal(formatSlaTime(45), '45m left');
  assert.equal(formatSlaTime(240), '4h left');
  assert.equal(formatSlaTime(2880), '2d left');
});
