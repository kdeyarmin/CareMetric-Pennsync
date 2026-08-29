import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTodayPriorities } from './todayPriorities.js';

const NOW = new Date('2026-07-22T12:00:00Z');

test('buildTodayPriorities ranks same-day missing notes above scheduled visits', () => {
  const priorities = buildTodayPriorities({
    now: NOW,
    currentUser: { email: 'nurse@example.com', role: 'user' },
    patients: [{ id: 'p1', first_name: 'Ada', last_name: 'Lovelace' }],
    visits: [
      { id: 'v1', patient_id: 'p1', status: 'scheduled', visit_date: '2026-07-22', visit_time: '09:00' },
      { id: 'v2', patient_id: 'p1', status: 'completed', visit_date: '2026-07-22' },
    ],
  });

  assert.equal(priorities[0].id, 'completed-visits-missing-notes');
  assert.equal(priorities[1].id, 'todays-scheduled-visits');
  assert.match(priorities[1].description, /Ada Lovelace/);
});

test('buildTodayPriorities sends admins to incident review and admin console', () => {
  const priorities = buildTodayPriorities({
    now: NOW,
    currentUser: { email: 'admin@example.com', role: 'admin' },
    incidents: [{ id: 'i1', status: 'open' }],
  });

  const incidentPriority = priorities.find((priority) => priority.id === 'open-incidents');
  const adminPriority = priorities.find((priority) => priority.id === 'admin-console-check');

  assert.equal(incidentPriority.to, '/IncidentReview');
  assert.equal(adminPriority.to, '/AdminOperations');
});

test('buildTodayPriorities returns an all-clear action when no urgent data exists', () => {
  const priorities = buildTodayPriorities({
    now: NOW,
    currentUser: { email: 'nurse@example.com', role: 'user' },
  });

  assert.deepEqual(priorities.map((priority) => priority.id), ['all-clear']);
  assert.equal(priorities[0].to, '/Patients');
});

test('buildTodayPriorities does not mutate the `now` it is given', () => {
  // parseLocalDate hands back the SAME Date instance it is passed, so the
  // normalization inside daysUntil used to rewind the caller's clock to local
  // midnight — a silent side effect on an argument a caller may reuse.
  const now = new Date('2026-07-22T12:34:56Z');
  const before = now.getTime();

  buildTodayPriorities({
    now,
    currentUser: { email: 'nurse@example.com', role: 'user' },
    visits: [{ id: 'v1', patient_id: 'p1', status: 'scheduled', visit_date: '2026-07-22' }],
    noteConversions: [{ id: 'n1', created_date: '2026-07-20' }],
  });

  assert.equal(now.getTime(), before);
});

test('buildTodayPriorities does not mutate Date values carried on records', () => {
  const visitDate = new Date(2026, 6, 22, 9, 30, 0);
  const before = visitDate.getTime();

  buildTodayPriorities({
    now: new Date(2026, 6, 22, 12, 0, 0),
    currentUser: { email: 'nurse@example.com', role: 'user' },
    visits: [{ id: 'v1', patient_id: 'p1', status: 'scheduled', visit_date: visitDate }],
  });

  assert.equal(visitDate.getTime(), before);
});
