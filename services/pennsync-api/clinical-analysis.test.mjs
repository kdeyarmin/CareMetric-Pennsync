import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLINICAL_MODEL, analyzeClinicalEvents, analyzeClinicalTrends, medicationNames,
} from './clinical-analysis.mjs';

/**
 * The model half of the two clinical analyses.
 *
 * There is no write contract behind either — a capability that only reads
 * needs only a read — so what this file proves is the order, the early return
 * that never pays for a model call, and the field-by-field fallbacks both
 * originals use against a model that answers prose. The prompts are compared
 * against the originals in
 * `base44/functionTests/pennsyncApiOriginalParity.test.js` (D60).
 */
const PATIENT = Object.freeze({ id: 'patient-1', patient_name: 'Ada Lovelace',
  primary_diagnosis: 'CHF', current_medications: [{ name: 'Lasix' }, { dose: '40mg' }] });
const EVENTS = [{ id: 'e1', title: 'Dyspnea', type: 'symptom_new' }];
const harness = (overrides = {}) => {
  const calls = [];
  const contracts = [];
  return {
    calls,
    contracts,
    params: { patient_id: 'patient-1', ...overrides.params },
    integration: async (operation, payload) => {
      calls.push({ operation, payload });
      return 'answer' in overrides ? overrides.answer : JSON.stringify(overrides.parsed ?? {});
    },
    contract: async (name, args) => {
      contracts.push({ name, args });
      return name === 'reviewClinicalEvents'
        ? { success: true, patient: PATIENT, events: overrides.events ?? EVENTS,
          total_events: (overrides.events ?? EVENTS).length }
        : { success: true, patient: PATIENT,
          vitals_history: overrides.vitals ?? [{ date: '2026-06-01', vitals: { bp: '132/84' } }],
          events: overrides.trendEvents ?? [
            { date: '2026-06-01', title: 'M', group: 'medication' },
            { date: '2026-05-01', title: 'S', group: 'symptom', severity: 'medium' },
            { date: '2026-04-01', title: 'L', group: 'lab' },
            { date: '2026-03-01', title: 'W', group: 'other' }] };
    },
  };
};

test('an empty unverified list never pays for a model call', async () => {
  // The original's own early return, word for word.
  const h = harness({ events: [] });
  const result = await analyzeClinicalEvents(h);
  assert.deepEqual(h.contracts.map(c => c.name), ['reviewClinicalEvents']);
  assert.equal(h.calls.length, 0);
  assert.deepEqual(result,
    { success: true, flagged_events: [], message: 'No unverified events to analyze' });
});

test('the review reads, asks, and shapes the answer', async () => {
  const h = harness({ parsed: { flagged_events: [{ event_id: 'e1' }],
    overall_summary: 'One gap.' } });
  const result = await analyzeClinicalEvents(h);
  assert.deepEqual(h.contracts.map(c => c.name), ['reviewClinicalEvents']);
  assert.deepEqual(h.contracts[0].args, { patient_id: 'patient-1' });
  assert.equal(h.calls[0].payload.model, CLINICAL_MODEL);
  // Nothing but the prompt and the model: no schema, the original passes none.
  assert.deepEqual(Object.keys(h.calls[0].payload).sort(), ['model', 'prompt']);
  assert.match(h.calls[0].payload.prompt, /Name: Ada Lovelace/);
  assert.match(h.calls[0].payload.prompt, /Current Medications: Lasix/);
  assert.match(h.calls[0].payload.prompt, /"id": "e1"/);
  assert.deepEqual(result, { success: true, flagged_events: [{ event_id: 'e1' }],
    overall_summary: 'One gap.', total_events_analyzed: 1 });
});

test('the trends read groups once and counts what it sent', async () => {
  const h = harness();
  const result = await analyzeClinicalTrends(h);
  assert.deepEqual(h.contracts.map(c => c.name), ['readClinicalTrendContext']);
  assert.deepEqual(result.data_analyzed,
    { visits: 1, medication_events: 1, symptom_events: 1, lab_events: 1 });
  assert.equal(result.patient_name, 'Ada Lovelace');
  assert.deepEqual(result.vitals_data, [{ date: '2026-06-01', vitals: { bp: '132/84' } }]);
  // The prompt carries each group and its count, as the original composes it.
  assert.match(h.calls[0].payload.prompt, /MEDICATION CHANGES \(1 events\)/);
  assert.match(h.calls[0].payload.prompt, /SYMPTOM PROGRESSION \(1 events\)/);
  assert.match(h.calls[0].payload.prompt, /LAB RESULTS \(1 events\)/);
  assert.match(h.calls[0].payload.prompt, /VITAL SIGNS HISTORY \(1 visits\)/);
  // The `other` group reaches no section of the prompt.
  assert.equal(h.calls[0].payload.prompt.includes('"title": "W"'), false);
});

test('a model that answers prose leaves every field at its fallback', async () => {
  const h = harness({ answer: 'I cannot help with that.' });
  const result = await analyzeClinicalTrends(h);
  assert.deepEqual(result.vital_trends, []);
  assert.deepEqual(result.medication_insights, {});
  assert.deepEqual(result.predictive_analytics, {});
  assert.equal(result.overall_trajectory, 'unknown');
  assert.deepEqual(result.priority_recommendations, []);
  const review = harness({ answer: 'nope' });
  const reviewed = await analyzeClinicalEvents(review);
  assert.deepEqual(reviewed.flagged_events, []);
  assert.equal(reviewed.overall_summary, '');
  // And a fenced answer is still parsed.
  const fenced = harness({ answer: '```json\n{"overall_trajectory":"declining"}\n```' });
  assert.equal((await analyzeClinicalTrends(fenced)).overall_trajectory, 'declining');
});

test('the medication names are the original s map, guarded', () => {
  assert.equal(medicationNames([{ name: 'Lasix' }, { name: 'Metoprolol' }]),
    'Lasix, Metoprolol');
  // An entry with no name is dropped rather than rendered as `undefined`,
  // which is what `.map(m => m.name).join(', ')` would print.
  assert.equal(medicationNames([{ name: 'Lasix' }, { dose: '40mg' }]), 'Lasix');
  for (const value of [null, undefined, 'Lasix', {}, []]) {
    assert.equal(medicationNames(value), '');
  }
});

test('an absent patient never reaches the store', async () => {
  for (const patient_id of [undefined, null, '', 42, { id: 'x' }]) {
    for (const run of [analyzeClinicalEvents, analyzeClinicalTrends]) {
      const h = harness({ params: { patient_id } });
      await assert.rejects(() => run(h), error => error?.code === 'PATIENT_ID_REQUIRED');
      assert.equal(h.contracts.length, 0);
      assert.equal(h.calls.length, 0);
    }
  }
});
