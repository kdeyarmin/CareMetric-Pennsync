import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const ORIGINAL = 'base44/functions/analyzeVisitForSupplyUsage/entry.ts';
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

test('the prompt and the schema are the original s, read from its source', async () => {
  const h = harness();
  await analyzeVisitSupplyUsage(h);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].operation, 'InvokeLLM');
  assert.equal(h.calls[0].payload.model, SUPPLY_MODEL);
  assert.deepEqual(Object.keys(h.calls[0].payload).sort(),
    ['model', 'prompt', 'response_json_schema']);
  const original = readFileSync(resolve(repository, ORIGINAL), 'utf8');
  const start = original.indexOf('You are a clinical documentation analyzer.');
  const end = original.indexOf('Return ONLY valid JSON array, no other text.');
  assert.ok(start > 0 && end > start, 'the original still carries the prompt');
  const prompt = buildSupplyPrompt('NOTES');
  for (const line of original.slice(start, end).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.includes('${')) continue;
    assert.ok(prompt.includes(trimmed), `the prompt lost: ${trimmed}`);
  }
  assert.ok(prompt.includes('Visit Notes: "NOTES"'), 'and the notes are interpolated');
  // The schema marks no field required, which is exactly why the contract
  // guards every one of them.
  assert.deepEqual(Object.keys(SUPPLY_RESPONSE_SCHEMA.properties.supplies.items.properties),
    ['name', 'quantity', 'unit', 'purpose']);
  assert.equal('required' in SUPPLY_RESPONSE_SCHEMA.properties.supplies.items, false);
  assert.ok(original.includes('response_json_schema'), 'the original passes one too');
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

test('the body keys stay the original s, because the SPA sends them', async () => {
  // D57 renamed `predictSupplyNeeds`'s `patientId` safely because nothing in
  // `src/` calls it. This one is called, and the SPA is shared between the two
  // backends, so the keys are read from the call site rather than chosen.
  const caller = readFileSync(resolve(repository, 'src/pages/SmartNoteAssistant.jsx'), 'utf8');
  assert.match(caller,
    /analyzeVisitForSupplyUsage\(\{\s*visitId,\s*visitNotes:\s*noteText,\s*patientId\s*\}\)/);
  const handlers = readFileSync(resolve(repository, 'services/pennsync-api/handlers.mjs'), 'utf8');
  const entry = handlers.slice(handlers.indexOf('analyzeVisitForSupplyUsage: Object.freeze({'));
  assert.match(entry.slice(0, entry.indexOf('}),')),
    /exactObject\(params, \['visitId', 'visitNotes', 'patientId'\]/);
});
