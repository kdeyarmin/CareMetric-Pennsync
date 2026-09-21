import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FOLLOW_UP_MODEL, FOLLOW_UP_SCHEMA, buildFollowUpPrompt, buildPatientContext,
  generateFollowUpTasks,
} from './follow-up-tasks.mjs';

/**
 * The model half of the follow-up task generator.
 *
 * What stays here is what needs only this module: the order, the context line
 * and the request guards. Everything compared against the Base44 original
 * lives in `base44/functionTests/pennsyncApiOriginalParity.test.js` (D60).
 */
const CONTEXT = Object.freeze({
  success: true, patient_id: 'patient-1', visit_id: 'visit-1',
  patient_name: 'Ada Lovelace', primary_diagnosis: 'CHF',
  secondary_diagnoses: ['COPD', 'Diabetes'],
});
const harness = (overrides = {}) => {
  const calls = [];
  const contracts = [];
  return {
    calls,
    contracts,
    params: { noteText: 'BP 172/96. Wound improving.', patientId: 'patient-1',
      visitId: 'visit-1', visitType: 'routine_visit', ...overrides.params },
    integration: async (operation, payload) => {
      calls.push({ operation, payload });
      return 'answer' in overrides ? overrides.answer
        : { tasks: [{ title: 'Contact MD', priority: 'high' }] };
    },
    contract: async (name, args) => {
      contracts.push({ name, args });
      if (name === 'getFollowUpTaskContext') return { ...CONTEXT, ...overrides.context };
      return { success: true, already_processed: false, tasks_created: 1,
        tasks_skipped: 0, tasks: [{ id: 'task-1', title: 'Contact MD' }],
        ...overrides.stored };
    },
  };
};

test('the chart is authorized before the model call is paid for', async () => {
  const h = harness();
  h.contract = async name => {
    h.contracts.push({ name });
    throw Object.assign(new Error('refused'),
      { code: 'PENNSYNC_FOLLOW_UP_PATIENT_NOT_VISIBLE' });
  };
  await assert.rejects(() => generateFollowUpTasks(h),
    error => error?.code === 'PENNSYNC_FOLLOW_UP_PATIENT_NOT_VISIBLE');
  assert.equal(h.calls.length, 0);
});

test('the order is read contract, model, write contract', async () => {
  const h = harness();
  const result = await generateFollowUpTasks(h);
  assert.deepEqual(h.contracts.map(c => c.name),
    ['getFollowUpTaskContext', 'recordFollowUpTasks']);
  assert.deepEqual(h.contracts[0].args, { patient_id: 'patient-1', visit_id: 'visit-1' });
  // The model's tasks reach the store untouched: nothing here filters, renames
  // or defaults one.
  assert.deepEqual(h.contracts[1].args.tasks, [{ title: 'Contact MD', priority: 'high' }]);
  assert.equal(h.calls[0].payload.model, FOLLOW_UP_MODEL);
  assert.deepEqual(h.calls[0].payload.response_json_schema, FOLLOW_UP_SCHEMA);
  assert.deepEqual(result, { success: true, tasks_created: 1, tasks_skipped: 0,
    tasks: [{ id: 'task-1', title: 'Contact MD' }], patient_name: 'Ada Lovelace' });
});

test('a visit already processed carries the original s two extra fields', async () => {
  const h = harness({ stored: { already_processed: true, tasks_created: 0,
    tasks: [], skipped: 'ai follow-up tasks already exist for visit' } });
  const result = await generateFollowUpTasks(h);
  assert.equal(result.already_processed, true);
  assert.match(result.skipped, /already exist for visit/);
  assert.equal(result.patient_name, 'Ada Lovelace');
});

test('the context line is the original s, with the caller s diagnosis as fallback', () => {
  assert.equal(buildPatientContext(CONTEXT, 'anything'),
    'Patient: Ada Lovelace, Primary Diagnosis: CHF, Secondary Diagnoses: COPD, Diabetes');
  // The chart's diagnosis wins; the caller's is only a fallback, and then the
  // original's literal.
  assert.match(buildPatientContext({ ...CONTEXT, primary_diagnosis: null }, 'Sepsis'),
    /Primary Diagnosis: Sepsis,/);
  assert.match(buildPatientContext({ ...CONTEXT, primary_diagnosis: null }, undefined),
    /Primary Diagnosis: Not documented,/);
  assert.match(buildPatientContext({ ...CONTEXT, secondary_diagnoses: [] }, null),
    /Secondary Diagnoses: None$/);
  assert.match(buildPatientContext({ ...CONTEXT, secondary_diagnoses: null }, null),
    /Secondary Diagnoses: None$/);
});

test('an answer that is not a task list is an empty one, not a failure', async () => {
  for (const answer of [undefined, null, {}, { tasks: null }, { tasks: 'one' }, 'prose']) {
    const h = harness({ answer });
    await generateFollowUpTasks(h);
    assert.deepEqual(h.contracts[1].args.tasks, [], JSON.stringify(answer ?? null));
  }
});

test('the original s own four hundreds, in its own order', async () => {
  for (const [params, code] of [
    [{ noteText: '' }, 'NOTE_TEXT_REQUIRED'],
    [{ noteText: '   ' }, 'NOTE_TEXT_REQUIRED'],
    [{ noteText: 42 }, 'NOTE_TEXT_REQUIRED'],
    [{ patientId: '' }, 'PATIENT_ID_REQUIRED'],
    [{ patientId: '  ' }, 'PATIENT_ID_REQUIRED'],
    [{ patientId: 'x'.repeat(201) }, 'PATIENT_ID_REQUIRED'],
    [{ visitId: '' }, 'VISIT_ID_INVALID'],
    [{ visitId: 42 }, 'VISIT_ID_INVALID'],
    [{ visitId: 'x'.repeat(201) }, 'VISIT_ID_INVALID'],
  ]) {
    const h = harness({ params });
    await assert.rejects(() => generateFollowUpTasks(h), error => error?.code === code,
      JSON.stringify(params));
    assert.equal(h.contracts.length, 0, 'and the chart was never asked about');
  }
  // An absent visit is a null, which the contract reads as no visit named.
  const h = harness({ params: { visitId: undefined } });
  await generateFollowUpTasks(h);
  assert.equal(h.contracts[0].args.visit_id, null);
});

test('the prompt is composed from the note, the context and the visit type', () => {
  const prompt = buildFollowUpPrompt('NOTE', 'CONTEXT', 'recert');
  assert.match(prompt, /FINALIZED NOTE:\nNOTE/);
  assert.match(prompt, /PATIENT CONTEXT:\nCONTEXT/);
  assert.match(prompt, /VISIT TYPE: recert/);
  // The original's two fallbacks: no context line at all, and a default type.
  const bare = buildFollowUpPrompt('NOTE', '', undefined);
  assert.equal(bare.includes('PATIENT CONTEXT:'), false);
  assert.match(bare, /VISIT TYPE: routine_visit/);
});
