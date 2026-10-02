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

// --- The two priorities D72 measured as broken -------------------------------
//
// Both read columns that exist in neither store: `visit.note_id`, so the
// negation `!visit.note_id` was always true and the tile counted EVERY
// completed visit; and `patient.risk_level` / `patient.hospitalization_risk`,
// so the high-risk tile could never fire at all. These cases pin what each one
// counts now. Each was watched to fail against the old implementation first.

test('a completed visit that carries a nurse note is not counted as needing one', () => {
  const priorities = buildTodayPriorities({
    now: NOW,
    currentUser: { email: 'nurse@example.com', role: 'user' },
    visits: [
      { id: 'v1', patient_id: 'p1', status: 'completed', visit_date: '2026-07-22', nurse_notes: 'Wound dressing changed; no drainage.' },
      { id: 'v2', patient_id: 'p1', status: 'completed', visit_date: '2026-07-22', nurse_notes: '   ' },
      { id: 'v3', patient_id: 'p1', status: 'completed', visit_date: '2026-07-22' },
    ],
  });

  const missing = priorities.find((priority) => priority.id === 'completed-visits-missing-notes');
  assert.ok(missing, 'the two undocumented visits still raise the priority');
  assert.match(missing.title, /^2 completed visits need notes$/);
});

test('the owned store\'s has_documentation decides when it is present', () => {
  // The dashboard contract projects a boolean rather than the note text, so a
  // payload from that path carries no `nurse_notes` to fall back on.
  const priorities = buildTodayPriorities({
    now: NOW,
    currentUser: { email: 'nurse@example.com', role: 'user' },
    visits: [
      { id: 'v1', patient_id: 'p1', status: 'completed', visit_date: '2026-07-22', has_documentation: true },
      { id: 'v2', patient_id: 'p1', status: 'completed', visit_date: '2026-07-22', has_documentation: false },
    ],
  });

  const missing = priorities.find((priority) => priority.id === 'completed-visits-missing-notes');
  assert.match(missing.title, /^1 completed visit needs? notes?$/);
});

test('high-risk patients come from active high and critical alerts', () => {
  const priorities = buildTodayPriorities({
    now: NOW,
    currentUser: { email: 'nurse@example.com', role: 'user' },
    patients: [{ id: 'p1', first_name: 'Ada', last_name: 'Lovelace' }, { id: 'p2', first_name: 'Grace', last_name: 'Hopper' }],
    patientAlerts: [
      { id: 'a1', patient_id: 'p1', status: 'active', severity: 'high' },
      { id: 'a2', patient_id: 'p2', status: 'active', severity: 'critical' },
      { id: 'a3', patient_id: 'p2', status: 'active', severity: 'high' },
    ],
  });

  const highRisk = priorities.find((priority) => priority.id === 'high-risk-patients');
  assert.ok(highRisk, 'the priority fires');
  assert.match(highRisk.title, /^2 high-risk patients to review$/, 'one row per patient, not per alert');
  assert.match(highRisk.description, /Grace Hopper/, 'the critical alert leads');
});

test('resolved and low-severity alerts raise no high-risk priority', () => {
  const priorities = buildTodayPriorities({
    now: NOW,
    currentUser: { email: 'nurse@example.com', role: 'user' },
    patients: [{ id: 'p1', first_name: 'Ada', last_name: 'Lovelace' }],
    patientAlerts: [
      { id: 'a1', patient_id: 'p1', status: 'resolved', resolved_at: '2026-07-21T10:00:00Z', severity: 'critical' },
      { id: 'a2', patient_id: 'p1', status: 'active', severity: 'medium' },
    ],
  });

  assert.equal(priorities.some((priority) => priority.id === 'high-risk-patients'), false);
});

test('status decides, so an active alert is counted whatever else it carries', () => {
  // This case replaces a third row the first draft of the test above carried:
  // `{ status: 'active', severity: 'high', resolved_date: ... }`, excluded by a
  // guard on `resolved_date`. That field is on no alert — the entity and the
  // contract both declare `resolved_at` — so the guard never fired on a real
  // row, and because that row was the only one in the case that would otherwise
  // have raised the priority, the assertion passed while proving nothing.
  //
  // `resolved_at` has one writer on each path and both set `status = 'resolved'`
  // in the same statement, so the honest check is the status one, and a row that
  // disagreed is counted. That is what this pins.
  const priorities = buildTodayPriorities({
    now: NOW,
    currentUser: { email: 'nurse@example.com', role: 'user' },
    patients: [{ id: 'p1', first_name: 'Ada', last_name: 'Lovelace' }],
    patientAlerts: [
      { id: 'a1', patient_id: 'p1', status: 'active', severity: 'high', resolved_at: '2026-07-21T10:00:00Z' },
    ],
  });

  const highRisk = priorities.find((priority) => priority.id === 'high-risk-patients');
  assert.ok(highRisk, 'the active row is counted');
  assert.match(highRisk.title, /^1 high-risk patient to review$/);
});

test('a truncated alert read says "at least", because the count is a floor', () => {
  // The alert page is capped at 500 rows before anything reduces them to one
  // per patient, so a full page may hide matching patients. A bare number would
  // be the same kind of claim this tile was fixed for making.
  const base = {
    now: NOW,
    currentUser: { email: 'nurse@example.com', role: 'user' },
    patients: [{ id: 'p1', first_name: 'Ada', last_name: 'Lovelace' }, { id: 'p2', first_name: 'Grace', last_name: 'Hopper' }],
    patientAlerts: [
      { id: 'a1', patient_id: 'p1', status: 'active', severity: 'high' },
      { id: 'a2', patient_id: 'p2', status: 'active', severity: 'critical' },
    ],
  };

  const whole = buildTodayPriorities(base).find((priority) => priority.id === 'high-risk-patients');
  assert.match(whole.title, /^2 high-risk patients to review$/, 'a whole read states the count');

  const truncated = buildTodayPriorities({ ...base, patientAlertsTruncated: true })
    .find((priority) => priority.id === 'high-risk-patients');
  assert.match(truncated.title, /^at least 2 high-risk patients to review$/);
});

test('a patient row claiming a risk level raises nothing, because no such column exists', () => {
  // The three spellings this used to read — risk_level, riskLevel and
  // hospitalization_risk — are on no patient table and in no entity schema, so
  // reading them was dead code that made the tile look implemented.
  const priorities = buildTodayPriorities({
    now: NOW,
    currentUser: { email: 'nurse@example.com', role: 'user' },
    patients: [{ id: 'p1', first_name: 'Ada', last_name: 'Lovelace', risk_level: 'critical', hospitalization_risk: 'high' }],
  });

  assert.equal(priorities.some((priority) => priority.id === 'high-risk-patients'), false);
});
