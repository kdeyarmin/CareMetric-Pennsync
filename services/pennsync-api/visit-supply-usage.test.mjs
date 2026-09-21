import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUPPLY_MODEL, SUPPLY_RESPONSE_SCHEMA, analyzeVisitSupplyUsage, buildSupplyPrompt,
} from './visit-supply-usage.mjs';

/**
 * The model half of the visit supply port.
 *
 * What this file is for: the ORDER, and the fact that this module decides
 * nothing. The chart is authorized before the model call is paid for, the
 * extraction goes through untouched, and every judgement — which supply, how
 * much is left, whether that is an alert — belongs to the record contract,
 * which makes all of it in one transaction.
 */
const EXTRACTION = {
  supplies: [
    { name: 'gauze 4x4', quantity: 2, unit: 'boxes', purpose: 'wound care' },
    { name: 'saline', quantity: 1, unit: 'bottles', purpose: 'irrigation' },
  ],
};
const harness = (overrides = {}) => {
  const calls = [];
  const contracts = [];
  return {
    calls,
    contracts,
    params: {
      visitId: 'visit-1', patientId: 'patient-1',
      visitNotes: 'Dressing change; used 2 boxes of gauze 4x4 and a bottle of saline.',
      ...overrides.params,
    },
    integration: async (operation, payload) => {
      calls.push({ operation, payload });
      if (overrides.modelThrows) throw new Error('model unavailable');
      // Key presence, not `undefined`: one of the cases below IS undefined.
      return 'answer' in overrides ? overrides.answer : EXTRACTION;
    },
    contract: async (name, args) => {
      contracts.push({ name, args });
      if (overrides.contextThrows && name === 'getVisitSupplyContext') {
        throw Object.assign(new Error('refused'),
          { code: 'PENNSYNC_VISIT_SUPPLY_PATIENT_NOT_VISIBLE' });
      }
      return name === 'getVisitSupplyContext'
        ? { success: true, patient_id: args.patient_id, visit_id: args.visit_id,
          patient_name: 'Ada Lovelace' }
        : { success: true, usageLogs: 2, alertsCreated: 0, alerts: [] };
    },
  };
};

test('the chart is authorized before the model call is paid for', async () => {
  const h = harness({ contextThrows: true });
  await assert.rejects(() => analyzeVisitSupplyUsage(h),
    error => error?.code === 'PENNSYNC_VISIT_SUPPLY_PATIENT_NOT_VISIBLE');
  assert.deepEqual(h.contracts.map(c => c.name), ['getVisitSupplyContext']);
  assert.equal(h.calls.length, 0, 'nothing was asked of the model');
});

test('the order is read contract, model, write contract', async () => {
  const h = harness();
  const result = await analyzeVisitSupplyUsage(h);
  assert.deepEqual(h.contracts.map(c => c.name),
    ['getVisitSupplyContext', 'recordVisitSupplyUsage']);
  assert.deepEqual(h.contracts[0].args, { patient_id: 'patient-1', visit_id: 'visit-1' });
  // The extraction reaches the store untouched: nothing here filters, matches
  // or renames a supply.
  assert.deepEqual(h.contracts[1].args,
    { patient_id: 'patient-1', visit_id: 'visit-1', supplies: EXTRACTION.supplies });
  assert.deepEqual(result, { success: true, usageLogs: 2, alertsCreated: 0, alerts: [] });
});

test('an answer that is not an extraction is an empty one, not a failure', async () => {
  // `analysisResult?.supplies || []`, exactly.
  for (const answer of [undefined, null, {}, { supplies: null }, { supplies: 'gauze' }, 'prose']) {
    const h = harness({ answer });
    await analyzeVisitSupplyUsage(h);
    assert.deepEqual(h.contracts[1].args.supplies, [], JSON.stringify(answer ?? null));
  }
});

test('an absent note or patient never reaches the model', async () => {
  for (const params of [{ visitNotes: '' }, { visitNotes: undefined }, { visitNotes: 42 },
    { patientId: '' }, { patientId: undefined }, { patientId: { id: 'x' } }]) {
    const h = harness({ params });
    await assert.rejects(() => analyzeVisitSupplyUsage(h),
      error => error?.code === 'VISIT_NOTES_AND_PATIENT_REQUIRED');
    assert.equal(h.calls.length, 0);
    assert.equal(h.contracts.length, 0, 'and the chart was never asked about');
  }
});

test('an absent visit is a null, which the contract reads as no dedupe', async () => {
  for (const visitId of [undefined, null, '']) {
    const h = harness({ params: { visitId } });
    await analyzeVisitSupplyUsage(h);
    assert.equal(h.contracts[0].args.visit_id, null);
    assert.equal(h.contracts[1].args.visit_id, null);
  }
});
