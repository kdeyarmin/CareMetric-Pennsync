import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPatientTimeline } from './patientTimeline.js';

test('buildPatientTimeline normalizes and sorts patient events newest first', () => {
  const events = buildPatientTimeline({
    patientId: 'p1',
    visits: [{ id: 'v1', patient_id: 'p1', visit_date: '2026-07-20', visit_type: 'SOC Visit', status: 'completed' }],
    documents: [{ id: 'd1', patient_id: 'p1', uploaded_at: '2026-07-22T10:00:00Z', document_name: 'Plan of care' }],
    incidents: [{ id: 'i-other', patient_id: 'p2', incident_date: '2026-07-23', incident_name: 'Other patient' }],
  });
  assert.deepEqual(events.map((e) => e.type), ['document', 'visit']);
  assert.equal(events[0].title, 'Plan of care');
  assert.equal(events[0].route, '/DocumentHub?id=d1');
});

test('buildPatientTimeline skips undated records and tolerates empty inputs', () => {
  const events = buildPatientTimeline({ tasks: [{ id: 't1', title: 'No date' }] });
  assert.deepEqual(events, []);
});

test("records without a patient_id never appear on a specific patient's timeline", () => {
  const events = buildPatientTimeline({
    patientId: "p1",
    documents: [
      { id: "d1", patient_id: "p1", created_date: "2026-07-01", title: "Chart note" },
      { id: "d2", created_date: "2026-07-02", title: "Unattributed psych eval" },
    ],
  });
  assert.ok(!events.some((e) => /unattributed/i.test(e.title || "")));
});
