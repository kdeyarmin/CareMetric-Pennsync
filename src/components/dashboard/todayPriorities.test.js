import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
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
// so the high-risk tile could never fire at all.
//
// The first was fixed and the cases below pin what it counts now; it was
// watched to fail against the old implementation first. The SECOND no longer
// exists: the high-risk-patients tile was removed from the product along with
// the two dashboard widgets it shared its read with, so what is pinned for it
// is its ABSENCE, at the end of this file.

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

test('the high-risk-patients tile is gone, and no input brings it back', () => {
  // The tile and the two dashboard widgets it shared a read with
  // (HospitalizationRiskWidget, HighRiskPatientsWidget) were removed from the
  // product. `patientAlerts` and `patientAlertsTruncated` are no longer
  // parameters of this builder, and the three patient spellings the tile
  // originally read — risk_level, riskLevel, hospitalization_risk — are on no
  // patient table and in no entity schema, as they always were.
  //
  // So this passes an input of every shape that used to raise it. It is here to
  // bite if the tile is reintroduced, which is the only way it can fail.
  const priorities = buildTodayPriorities({
    now: NOW,
    currentUser: { email: 'nurse@example.com', role: 'user' },
    patients: [
      { id: 'p1', first_name: 'Ada', last_name: 'Lovelace', risk_level: 'critical', hospitalization_risk: 'high' },
      { id: 'p2', first_name: 'Grace', last_name: 'Hopper', riskLevel: 'critical' },
    ],
    patientAlerts: [
      { id: 'a1', patient_id: 'p1', status: 'active', severity: 'high' },
      { id: 'a2', patient_id: 'p2', status: 'active', severity: 'critical' },
    ],
    patientAlertsTruncated: true,
  });

  assert.equal(priorities.some((priority) => priority.id === 'high-risk-patients'), false);
  assert.equal(priorities.some((priority) => /high-risk/i.test(priority.title)), false);
});

// The builder's own signature is the other half: a caller that still passed the
// alert props would otherwise look wired while changing nothing. Reading the
// parameter list is what makes the absence above a property of the module
// rather than of the inputs this file happens to choose.
test('the builder no longer takes the alert inputs that fed the tile', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/dashboard/todayPriorities.js'), 'utf8');
  const signature = source.slice(
    source.indexOf('export function buildTodayPriorities({'),
    source.indexOf('} = {}) {'),
  );
  assert.ok(signature.length > 0, 'the builder signature was found');
  assert.equal(/patientAlerts/.test(signature), false);
  assert.equal(/patientAlertsTruncated/.test(signature), false);
  // And nothing in the module reaches for them under another name.
  assert.equal(/highRiskPatientIds|ALERT_SEVERITY_RANK/.test(source), false);
});
