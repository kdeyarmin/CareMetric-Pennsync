import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TASK_SUGGESTION_MODEL, analyzeAndGenerateClinicalTasks, dueDate,
} from './clinical-task-suggestions.mjs';

/**
 * The model half of the clinical task suggester.
 *
 * It SUGGESTS tasks and creates none, which is the whole reason D64 exists as
 * a decision: a reader taking "generate" for a write would look for a write
 * contract that should not be there. The prompt is compared against the
 * original in `base44/functionTests/pennsyncApiOriginalParity.test.js` (D60).
 */
const CONTEXT = Object.freeze({
  success: true, today: '2026-09-20',
  patient: { id: 'patient-1', patient_name: 'Ada Lovelace', primary_diagnosis: 'CHF',
    secondary_diagnoses: ['COPD'], current_medications: [{ name: 'Lasix' }],
    allergies: 'penicillin' },
  visits: [{ date: '2026-09-18', type: 'routine_visit', notes: 'BP up', vitals: { bp: '150/92' } }],
  alerts: [{ type: 'vital_deterioration', severity: 'high', message: 'BP trending up',
    created: '2026-09-18T00:00:00Z' }],
  tasks: [{ title: 'Call MD', type: 'call', priority: 'high', due_date: '2026-09-22' }],
});
const harness = (overrides = {}) => {
  const calls = [];
  const contracts = [];
  return {
    calls,
    contracts,
    params: { patientId: 'patient-1', ...overrides.params },
    integration: async (operation, payload) => {
      calls.push({ operation, payload });
      return 'answer' in overrides ? overrides.answer
        : JSON.stringify({ tasks: overrides.tasks ?? [
          { title: 'Recheck BP', due_timeframe: '24_hours', priority: 'high' }] });
    },
    contract: async (name, args) => {
      contracts.push({ name, args });
      return { ...CONTEXT, ...overrides.context };
    },
  };
};

test('it reads, asks, dates the suggestions and writes nothing', async () => {
  const h = harness();
  const result = await analyzeAndGenerateClinicalTasks(h);
  // One contract, and it is a read.
  assert.deepEqual(h.contracts.map(c => c.name), ['readClinicalTaskContext']);
  assert.deepEqual(h.contracts[0].args, { patient_id: 'patient-1' });
  assert.equal(h.calls[0].payload.model, TASK_SUGGESTION_MODEL);
  assert.deepEqual(Object.keys(h.calls[0].payload).sort(), ['model', 'prompt']);
  assert.equal(result.patient_id, 'patient-1');
  assert.equal(result.patient_name, 'Ada Lovelace');
  assert.deepEqual(result.tasks,
    [{ title: 'Recheck BP', due_timeframe: '24_hours', priority: 'high',
      due_date: '2026-09-21' }]);
  assert.match(result.analysis_timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test('the due date is the original s map, counted from the store s day', async () => {
  // D63 normalises a model's timeframe before dating it, because a STORED
  // column and its stored date could disagree. Nothing here is stored, so the
  // original's case-sensitive map stands — including its `default` of three.
  for (const [timeframe, expected] of [['today', '2026-09-20'], ['24_hours', '2026-09-21'],
    ['48_hours', '2026-09-22'], ['this_week', '2026-09-27'], ['next_visit', '2026-09-23'],
    ['TODAY', '2026-09-23'], ['nonsense', '2026-09-23'], [undefined, '2026-09-23'],
    [null, '2026-09-23']]) {
    assert.equal(dueDate('2026-09-20', timeframe), expected, String(timeframe));
  }
  // Month and year boundaries are the Date object's, not string arithmetic.
  assert.equal(dueDate('2026-09-30', '48_hours'), '2026-10-02');
  assert.equal(dueDate('2026-12-29', 'this_week'), '2027-01-05');
  assert.equal(dueDate('2028-02-28', '24_hours'), '2028-02-29');
});

test('a prompt carries the lists the contract shaped, and only those', async () => {
  const h = harness();
  await analyzeAndGenerateClinicalTasks(h);
  const { prompt } = h.calls[0].payload;
  assert.match(prompt, /Name: Ada Lovelace/);
  assert.match(prompt, /Secondary Diagnoses: COPD/);
  assert.match(prompt, /Allergies: penicillin/);
  assert.match(prompt, /"bp": "150\/92"/);
  assert.match(prompt, /"message": "BP trending up"/);
  assert.match(prompt, /"title": "Call MD"/);
  // The medication list is sliced to five, as the original slices it.
  const many = harness({ context: { patient: { ...CONTEXT.patient,
    current_medications: Array.from({ length: 9 }, (unused, i) => ({ name: `Drug${i}` })) } } });
  await analyzeAndGenerateClinicalTasks(many);
  // The medication list is the compact `JSON.stringify` the original uses,
  // not the indented one it uses for the three row lists.
  assert.match(many.calls[0].payload.prompt, /\{"name":"Drug4"\}/);
  assert.equal(many.calls[0].payload.prompt.includes('Drug5'), false);
});

test('an answer that is not a task list is an empty one', async () => {
  for (const answer of ['prose', JSON.stringify({}), JSON.stringify({ tasks: null }),
    JSON.stringify({ tasks: 'one' })]) {
    const h = harness({ answer });
    assert.deepEqual((await analyzeAndGenerateClinicalTasks(h)).tasks, [], answer);
  }
  // The original's `secondary_diagnoses?.join` and `allergies ||` fallbacks.
  const bare = harness({ context: { patient: { id: 'p', patient_name: 'A',
    primary_diagnosis: null, secondary_diagnoses: null, current_medications: null,
    allergies: null } } });
  await analyzeAndGenerateClinicalTasks(bare);
  assert.match(bare.calls[0].payload.prompt, /Secondary Diagnoses: None/);
  assert.match(bare.calls[0].payload.prompt, /Allergies: None documented/);
  assert.match(bare.calls[0].payload.prompt, /Medications: \[\]/);
});

test('an absent patient never reaches the store', async () => {
  for (const patientId of [undefined, null, '', '   ', 42, 'x'.repeat(201)]) {
    const h = harness({ params: { patientId } });
    await assert.rejects(() => analyzeAndGenerateClinicalTasks(h),
      error => error?.code === 'PATIENT_ID_REQUIRED', String(patientId));
    assert.equal(h.contracts.length, 0);
    assert.equal(h.calls.length, 0);
  }
});
