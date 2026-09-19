import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transpileTs } from '../../tools-transpile-ts.mjs';
import { analyzeReferralPriority } from '../../services/pennsync-api/referral-priority.mjs';
import { analyzeReferralIntake } from '../../services/pennsync-api/referral-intake.mjs';
import { generateReferralTasks } from '../../services/pennsync-api/referral-tasks.mjs';
import { matchPatientWithAI } from '../../services/pennsync-api/patient-match.mjs';
import { analyzeReferral } from '../../services/pennsync-api/referral-analysis.mjs';
import { REFERRAL_ACTIONS } from '../../services/pennsync-api/referral-analysis.mjs';
import { parseLLMJson } from '../../services/pennsync-api/llm-json.mjs';

/**
 * Parity for ports whose real output is a request to somebody else.
 *
 * These handlers compute almost nothing: they build a prompt, ask a model, and
 * shape the answer. Comparing return values alone would miss the part that
 * matters, because the prompt IS the contract with the model — a reworded
 * prompt is a different function even when every surrounding line matches.
 *
 * So each case drives the ORIGINAL Deno module with a stubbed client that
 * records the `InvokeLLM` argument, drives the port with a stubbed capability
 * that records the same, and compares both the recorded call and the answer.
 * A transcription slip in a 2,000-character prompt fails here.
 */
globalThis.Deno = globalThis.Deno || { serve() {}, env: { get: () => undefined } };

/** Load an original's `Deno.serve` handler with its client and provider stubbed. */
async function loadOriginal(name) {
  let source = await readFile(new URL(`../functions/${name}/entry.ts`, import.meta.url), 'utf8');
  source = source.replace(/import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    `const createClientFromRequest = () => ({
       auth: { me: async () => ({ id: 'synthetic-user', is_active: true }) },
       integrations: { Core: { InvokeLLM: async (argument) => { globalThis.__calls.push(argument); return globalThis.__answer; } } },
     });`);
  assert.match(source, /Deno\.serve\(/, `${name} should still be a Deno.serve module`);
  const js = transpileTs(source).outputText;
  const file = join(tmpdir(), `integparity_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  let handler = null;
  const previous = globalThis.Deno.serve;
  globalThis.Deno = { ...globalThis.Deno, serve: fn => { handler = fn; } };
  await writeFile(file, js);
  try { await import(pathToFileURL(file).href); }
  finally { await unlink(file).catch(() => {}); globalThis.Deno.serve = previous; }
  assert.ok(handler, `${name} did not register a handler`);
  return handler;
}

/** Run the original with one body and one canned model answer. */
async function driveOriginal(name, params, answer) {
  const handler = await loadOriginal(name);
  globalThis.__calls = [];
  globalThis.__answer = answer;
  const response = await handler(new Request('https://synthetic.invalid/', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params),
  }));
  return { calls: globalThis.__calls, body: await response.json() };
}

/** Run the port with the same body and the same canned answer. */
async function drivePort(port, params, answer) {
  const calls = [];
  const body = await port({
    params,
    integration: async (operation, argument) => { calls.push({ operation, argument }); return answer; },
  });
  return { calls, body };
}

const ANSWERS = [
  '{"priority":"urgent","priority_score":9}',
  '```json\n{"a":1}\n```',
  'Here is the assessment: {"b":2} and nothing else.',
  'no json at all',
  '',
  { already: 'object' },
];

const PORTS = [
  {
    name: 'analyzeReferralPriority',
    port: analyzeReferralPriority,
    cases: [
      { extractedData: { diagnosis: 'Synthetic wound care' }, analysisResults: { risk: 'synthetic' } },
      // Absent fields: `JSON.stringify(undefined, null, 2)` is undefined, and
      // both sides interpolate it, so the prompt carries the literal word.
      { extractedData: undefined, analysisResults: undefined },
      { extractedData: { nested: { deep: [1, 2, { three: true }] } }, analysisResults: null },
    ],
  },
  {
    name: 'analyzeReferralIntake',
    port: analyzeReferralIntake,
    cases: [
      { extractedData: { diagnosis: 'Synthetic CHF' }, analysisResults: { prior: 'synthetic' } },
      // The guard that skips the model entirely. The original's comment says an
      // empty payload otherwise fires a call that times out at 120s.
      { extractedData: {}, analysisResults: { prior: 'synthetic' } },
      { extractedData: undefined, analysisResults: undefined },
      { extractedData: null, analysisResults: null },
    ],
  },
  {
    name: 'generateReferralTasks',
    port: generateReferralTasks,
    cases: [
      { referralData: { diagnosis: 'Synthetic' }, priorityAnalysis: { priority: 'urgent' } },
      { referralData: undefined, priorityAnalysis: undefined },
    ],
  },
  {
    name: 'matchPatientWithAI',
    port: matchPatientWithAI,
    cases: [
      {
        extractedData: { demographics: { first_name: 'Synthetic', last_name: 'Patient', date_of_birth: '1950-04-02' } },
        existingPatients: [
          { id: 'p1', first_name: 'Synthetic', middle_name: 'Q', last_name: 'Patient',
            medical_record_number: 'MRN-1', date_of_birth: '1950-04-02', phone: '555-0100' },
          // No middle name: `full_name` loses a space, and the projection must
          // lose it on both sides.
          { id: 'p2', first_name: 'Other', last_name: 'Person' },
        ],
      },
      // An empty candidate list is valid input, and the count is interpolated.
      { extractedData: { demographics: {} }, existingPatients: [] },
      { extractedData: { notDemographics: true }, existingPatients: [{ id: 'p3' }] },
    ],
  },
  {
    name: 'analyzeReferral',
    port: analyzeReferral,
    cases: [
      { action: 'analyze_priority', extractedData: { diagnosis: 'Synthetic' }, analysisResults: { risk: 'low' } },
      { action: 'generate_tasks', referralData: { diagnosis: 'Synthetic' }, priorityAnalysis: { priority: 'high' } },
      {
        action: 'match_patient',
        extractedData: { demographics: { first_name: 'Synthetic' } },
        existingPatients: [
          { id: 'p1', first_name: 'Synthetic', middle_name: 'Q', last_name: 'Patient',
            medical_record_number: 'MRN-1', date_of_birth: '1950-04-02', phone: '555-0100' },
          { id: 'p2', first_name: 'Other', last_name: 'Person' },
        ],
      },
      // Three calls, and the order is behaviour: priority and match start
      // together, tasks waits because its prompt takes the priority answer.
      {
        action: 'full_analysis',
        extractedData: { demographics: { first_name: 'Synthetic' }, diagnosis: 'Synthetic' },
        analysisResults: { risk: 'low' },
        existingPatients: [
          { id: 'p1', first_name: 'Synthetic', middle_name: 'Q', last_name: 'Patient',
            medical_record_number: 'MRN-1', date_of_birth: '1950-04-02', phone: '555-0100' },
          { id: 'p2', first_name: 'Other', last_name: 'Person' },
        ],
      },
    ],
  },
];

for (const { name, port, cases } of PORTS) {
  test(`${name} asks the model exactly what the original asked`, async () => {
    for (const params of cases) {
      const original = await driveOriginal(name, params, ANSWERS[0]);
      const ported = await drivePort(port, params, ANSWERS[0]);
      assert.equal(ported.calls.length, original.calls.length,
        `${name} made ${ported.calls.length} calls where the original made ${original.calls.length}`);
      for (const [index, call] of ported.calls.entries()) {
        assert.equal(call.operation, 'InvokeLLM');
        // The whole argument, so a changed model selector or a dropped
        // response_json_schema fails as loudly as a reworded prompt.
        assert.deepEqual(call.argument, original.calls[index]);
      }
      assert.deepEqual(ported.body, original.body);
    }
  });

  test(`${name} shapes every answer the way the original shaped it`, async () => {
    const params = cases[0];
    for (const answer of ANSWERS) {
      const original = await driveOriginal(name, params, answer);
      const ported = await drivePort(port, params, answer);
      assert.deepEqual(ported.body, original.body, `answer ${JSON.stringify(answer)} shaped differently`);
    }
  });
}

test('the empty-referral guard answers without calling the model at all', async () => {
  for (const extractedData of [undefined, null, {}, '', 0]) {
    const ported = await drivePort(analyzeReferralIntake, { extractedData, analysisResults: {} },
      'unused — the model must not be asked');
    assert.deepEqual(ported.calls, [], `${JSON.stringify(extractedData)} should skip the model`);
    assert.deepEqual(ported.body.analysis.missing_critical_info.high_priority,
      ['No referral data provided — cannot analyze.']);
  }
  // A non-empty object is analysed, so the guard is not simply always on.
  const analysed = await drivePort(analyzeReferralIntake, { extractedData: { a: 1 }, analysisResults: {} }, '{}');
  assert.equal(analysed.calls.length, 1);
});

test('the canned empty analysis cannot be mutated by a caller', async () => {
  const first = await drivePort(analyzeReferralIntake, { extractedData: {}, analysisResults: {} }, '');
  first.body.analysis.missing_critical_info.high_priority.push('tampered');
  const second = await drivePort(analyzeReferralIntake, { extractedData: {}, analysisResults: {} }, '');
  assert.deepEqual(second.body.analysis.missing_critical_info.high_priority,
    ['No referral data provided — cannot analyze.']);
});

test('the shared parser keeps the fallbacks that make a tolerant answer usable', () => {
  // Pinned directly, because these are the cases the originals' comment exists
  // for: the provider is asked for strict JSON in-prompt rather than through a
  // response schema, so the answer arrives fenced, prefixed or not at all.
  assert.deepEqual(parseLLMJson('{"a":1}'), { a: 1 });
  assert.deepEqual(parseLLMJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseLLMJson('```\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseLLMJson('prose {"a":1} more prose'), { a: 1 });
  assert.deepEqual(parseLLMJson({ already: 'object' }), { already: 'object' });
  assert.equal(parseLLMJson('no braces here'), null);
  assert.equal(parseLLMJson('}{'), null);
  assert.equal(parseLLMJson(''), null);
  assert.equal(parseLLMJson(null), null);
  assert.equal(parseLLMJson(undefined), null);
});

test('a task answer without a task list is still a list', async () => {
  for (const answer of [{ tasks: null }, {}, 'prose', null, { tasks: [{ title: 'Synthetic' }] }]) {
    const original = await driveOriginal('generateReferralTasks',
      { referralData: {}, priorityAnalysis: {} }, answer);
    const ported = await drivePort(generateReferralTasks, { referralData: {}, priorityAnalysis: {} }, answer);
    assert.ok(Array.isArray(ported.body.tasks));
    assert.deepEqual(ported.body, original.body);
  }
});

test('the patient match refuses the same malformed input the original refused', async () => {
  // The original answers 400 with its own message; this service has one error
  // envelope every handler shares, so the same inputs are refused with the same
  // status under this service's code. The rule itself is unchanged.
  for (const params of [
    { extractedData: null, existingPatients: [] },
    { extractedData: undefined, existingPatients: [] },
    { extractedData: {}, existingPatients: 'not-an-array' },
    { extractedData: {}, existingPatients: null },
  ]) {
    await assert.rejects(
      matchPatientWithAI({ params, integration: async () => assert.fail('the model must not be asked') }),
      error => error?.status === 400 && error?.code === 'INVALID_PARAMS');
    // And the original refuses them too, rather than calling the model.
    const original = await driveOriginal('matchPatientWithAI', params, '{}');
    assert.deepEqual(original.calls, []);
  }
  // An empty array is a valid list of candidates on both sides.
  const ported = await drivePort(matchPatientWithAI,
    { extractedData: { demographics: {} }, existingPatients: [] }, { best_match_id: null });
  assert.equal(ported.calls.length, 1);
});

test('the referral dispatcher refuses an action the original refused', async () => {
  for (const action of [undefined, null, '', 'nope', 'ANALYZE_PRIORITY']) {
    await assert.rejects(
      analyzeReferral({ params: { action }, integration: async () => assert.fail('the model must not be asked') }),
      error => error?.status === 400 && error?.code === 'INVALID_ACTION', `${action} should be refused`);
    const original = await driveOriginal('analyzeReferral', { action }, '{}');
    assert.equal(original.body.error, 'Invalid action');
    assert.deepEqual(original.calls, []);
  }
  assert.deepEqual([...REFERRAL_ACTIONS], ['analyze_priority', 'generate_tasks', 'match_patient', 'full_analysis']);
});

test('a full analysis asks for priority and match before it asks for tasks', async () => {
  const params = {
    action: 'full_analysis',
    extractedData: { demographics: { first_name: 'Synthetic' }, diagnosis: 'Synthetic' },
    analysisResults: { risk: 'low' },
    existingPatients: [{ id: 'p1', first_name: 'Synthetic', last_name: 'Patient' }],
  };
  const answers = ['{"priority":"urgent"}', '{"best_match_id":"p1"}', '{"tasks":[{"title":"Synthetic"}]}'];
  let index = 0;
  const seen = [];
  const body = await analyzeReferral({
    params,
    integration: async (_operation, argument) => { seen.push(argument.prompt); return answers[index++]; },
  });
  assert.equal(seen.length, 3);
  assert.match(seen[0], /clinical triage AI/);
  assert.match(seen[1], /patient matching system/);
  assert.match(seen[2], /intake coordinator/);
  // The tasks prompt carries the priority answer, which is why it cannot start
  // with the other two.
  assert.match(seen[2], /"priority": "urgent"/);
  assert.deepEqual(body, {
    success: true,
    priority: { priority: 'urgent' },
    patientMatch: { best_match_id: 'p1' },
    tasks: [{ title: 'Synthetic' }],
  });
});

test('the dispatcher task path takes whatever sits under tasks, as its original does', async () => {
  // Its standalone namesake guards with Array.isArray; this one does not, and a
  // port that "fixed" that would answer differently from the function it replaces.
  for (const answer of ['{"tasks":{"not":"an array"}}', '{"tasks":null}', '{}', 'prose']) {
    const params = { action: 'generate_tasks', referralData: {}, priorityAnalysis: {} };
    const original = await driveOriginal('analyzeReferral', params, answer);
    const ported = await drivePort(analyzeReferral, params, answer);
    assert.deepEqual(ported.body, original.body, `answer ${answer} shaped differently`);
  }
});
