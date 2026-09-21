import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXTRACT_MODEL, EXTRACTION_SCHEMA, extractClinicalEvents, textAnchors,
} from './clinical-extraction.mjs';

/**
 * The model half of the clinical event extractor.
 *
 * The one thing that genuinely belongs here rather than in the contract is
 * `textAnchors`: it is `indexOf` over a string the CALLER sent, and
 * reproducing JavaScript's `indexOf`, `trim` and `toLowerCase` in SQL would be
 * a transcription with nothing to gain. Everything about what may be STORED is
 * the contract's, and this file proves that nothing here decides it.
 */
const NOTE = 'Visit at 0900. Found on floor by bed. Denies pain.';
const EVENT = { event_type: 'fall', event_title: 'Fall', source_text: 'Found on floor' };
const harness = (overrides = {}) => {
  const calls = [];
  const contracts = [];
  return {
    calls,
    contracts,
    params: { visit_id: 'visit-1', patient_id: 'patient-1', nurse_notes: NOTE,
      ...overrides.params },
    integration: async (operation, payload) => {
      calls.push({ operation, payload });
      return 'answer' in overrides ? overrides.answer
        : JSON.stringify({ events: overrides.events ?? [EVENT] });
    },
    contract: async (name, args) => {
      contracts.push({ name, args });
      if (name === 'getClinicalExtractionContext') {
        return { success: true, patient_id: args.patient_id, visit_id: args.visit_id,
          visit_date: '2026-06-15', already_processed: overrides.alreadyProcessed ?? false };
      }
      return { success: true, already_processed: false, events_extracted: 1,
        events_skipped: 0, events: [{ id: 'event-1' }], tasks_created: 1, alerts_created: 0,
        ...overrides.stored };
    },
  };
};

test('the anchors are the original s search, exactly', () => {
  // Exact match on the TRIMMED quote.
  assert.deepEqual(textAnchors(NOTE, '  Found on floor  '),
    { text_anchor_start: 15, text_anchor_end: 29 });
  // Case-insensitive retry, with the end still the trimmed length.
  assert.deepEqual(textAnchors(NOTE, 'FOUND ON FLOOR'),
    { text_anchor_start: 15, text_anchor_end: 29 });
  // Neither: both anchors are null rather than a guess.
  assert.deepEqual(textAnchors(NOTE, 'never said this'),
    { text_anchor_start: null, text_anchor_end: null });
  for (const quote of [undefined, null, '', 42, {}]) {
    assert.deepEqual(textAnchors(NOTE, quote),
      { text_anchor_start: null, text_anchor_end: null }, String(quote));
  }
  assert.deepEqual(textAnchors('', 'anything'),
    { text_anchor_start: null, text_anchor_end: null });
});

test('the order is read contract, model, write contract', async () => {
  const h = harness();
  const result = await extractClinicalEvents(h);
  assert.deepEqual(h.contracts.map(c => c.name),
    ['getClinicalExtractionContext', 'recordClinicalEvents']);
  assert.deepEqual(h.contracts[0].args, { patient_id: 'patient-1', visit_id: 'visit-1' });
  assert.equal(h.calls[0].payload.model, EXTRACT_MODEL);
  assert.deepEqual(h.calls[0].payload.response_json_schema, EXTRACTION_SCHEMA);
  assert.match(h.calls[0].payload.prompt, /Visit Note:\nVisit at 0900/);
  // The model's events reach the store with anchors attached and nothing else
  // changed: no coercion, no filtering, no defaults.
  assert.deepEqual(h.contracts[1].args.events,
    [{ ...EVENT, text_anchor_start: 15, text_anchor_end: 29 }]);
  assert.equal(result.events_extracted, 1);
  assert.equal(result.tasks_created, 1);
});

test('a visit already extracted never pays for a model call', async () => {
  const h = harness({ alreadyProcessed: true });
  const result = await extractClinicalEvents(h);
  assert.deepEqual(h.contracts.map(c => c.name), ['getClinicalExtractionContext']);
  assert.equal(h.calls.length, 0);
  assert.deepEqual(result, { success: true, already_processed: true, events_extracted: 0,
    events: [], tasks_created: 0, alerts_created: 0,
    skipped: 'events already extracted for visit' });
});

test('the write contract can still say the visit was taken', async () => {
  // The read reports it so a model call is not paid for; the write re-checks
  // under the lock, which is where it decides anything.
  const h = harness({ stored: { already_processed: true, events_extracted: 0,
    events: [], tasks_created: 0, alerts_created: 0,
    skipped: 'events already extracted for visit' } });
  const result = await extractClinicalEvents(h);
  assert.equal(h.calls.length, 1, 'the model was asked');
  assert.equal(result.already_processed, true);
  assert.match(result.skipped, /already extracted/);
});

test('an answer that is not an event list is an empty one', async () => {
  for (const answer of ['prose', JSON.stringify({}), JSON.stringify({ events: null }),
    JSON.stringify({ events: 'one' })]) {
    const h = harness({ answer });
    await extractClinicalEvents(h);
    assert.deepEqual(h.contracts[1].args.events, [], answer);
  }
});

test('all three fields are required, as the original requires them', async () => {
  for (const params of [{ visit_id: '' }, { visit_id: undefined }, { visit_id: 42 },
    { patient_id: '' }, { patient_id: undefined }, { nurse_notes: '' },
    { nurse_notes: undefined }, { nurse_notes: 42 }]) {
    const h = harness({ params });
    await assert.rejects(() => extractClinicalEvents(h),
      error => error?.code === 'EXTRACT_FIELDS_REQUIRED', JSON.stringify(params));
    assert.equal(h.contracts.length, 0);
    assert.equal(h.calls.length, 0);
  }
});
