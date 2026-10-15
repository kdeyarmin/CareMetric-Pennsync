import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { SHARED_HELPERS } from '../_shared/backendHelpers.mjs';

/**
 * The request directInvokeLLM sends and how it reads the answer.
 *
 * Every other test stubs the helper out at the call site, so the request it
 * builds was never exercised: Wave 1 shipped a forced `tool_choice`
 * (`{type:'tool'}`), which the 5.5 models it maps to reject with a 400 — every
 * structured call (SmartNote drafting, coverage and grounding included) would
 * have failed in production. These tests drive the generated helper source
 * against a fake provider.
 */

function loadHelper() {
  return new Function(`${SHARED_HELPERS.directInvokeLLM}\nreturn directInvokeLLM;`)();
}

function providerAnswer(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

function fakeProvider(answers) {
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    const next = answers.shift();
    if (!next) throw new Error('unexpected provider call');
    return providerAnswer(next.payload, next.status);
  };
  return { fetcher, requests };
}

const quiet = (t) => t.mock.method(console, 'log', () => {});

const toolAnswer = (result) => ({
  payload: {
    stop_reason: 'tool_use',
    content: [
      { type: 'thinking', thinking: '' },
      { type: 'tool_use', id: 'toolu_1', name: 'return_result', input: { result } },
    ],
    usage: { input_tokens: 10, output_tokens: 5 },
  },
});

const textAnswer = (text) => ({
  payload: { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text }], usage: {} },
});

const SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', maxLength: 50 },
    // A free-form object, as extractClinicalEvents passes for structured_data.
    details: { type: 'object' },
  },
  required: ['summary'],
};

test('a structured call requests the tool without forcing it', async (t) => {
  quiet(t);
  const directInvokeLLM = loadHelper();
  const { fetcher, requests } = fakeProvider([toolAnswer({ summary: 'ok', details: { drug: 'metformin', dose_mg: 500 } })]);
  const result = await directInvokeLLM({ prompt: 'Summarize.', response_json_schema: SCHEMA }, { fetcher, apiKey: 'test-key' });
  assert.deepEqual(result, { summary: 'ok', details: { drug: 'metformin', dose_mg: 500 } });
  assert.equal(requests.length, 1);
  const body = requests[0].body;
  assert.equal(body.model, 'claude-sonnet-5-5');
  assert.deepEqual(body.tool_choice, { type: 'auto', disable_parallel_tool_use: true });
  assert.match(body.system, /return_result tool/);
  assert.equal(body.tools.length, 1);
  assert.equal(body.tools[0].name, 'return_result');
  assert.deepEqual(body.tools[0].input_schema.properties.result, SCHEMA);
  assert.ok(body.max_tokens >= 16000, 'thinking counts against max_tokens, so the budget needs headroom');
});

test('a prose answer to a structured call is asked once more, then accepted', async (t) => {
  quiet(t);
  const directInvokeLLM = loadHelper();
  const { fetcher, requests } = fakeProvider([textAnswer('Here is the summary: ok'), toolAnswer({ summary: 'ok' })]);
  const result = await directInvokeLLM({ prompt: 'Summarize.', response_json_schema: SCHEMA }, { fetcher, apiKey: 'test-key' });
  assert.deepEqual(result, { summary: 'ok' });
  assert.equal(requests.length, 2);
});

test('two prose answers to a structured call fail as a schema mismatch', async (t) => {
  quiet(t);
  const directInvokeLLM = loadHelper();
  const { fetcher, requests } = fakeProvider([textAnswer('no tool'), textAnswer('still no tool')]);
  await assert.rejects(
    directInvokeLLM({ prompt: 'Summarize.', response_json_schema: SCHEMA }, { fetcher, apiKey: 'test-key' }),
    (error) => error.code === 'AI_RESULT_SCHEMA_MISMATCH' && error.status === 502,
  );
  assert.equal(requests.length, 2);
});

test('the caller schema still bounds the result', async (t) => {
  quiet(t);
  const directInvokeLLM = loadHelper();
  const { fetcher } = fakeProvider([toolAnswer({ summary: 'x'.repeat(51) })]);
  await assert.rejects(
    directInvokeLLM({ prompt: 'Summarize.', response_json_schema: SCHEMA }, { fetcher, apiKey: 'test-key' }),
    (error) => error.code === 'AI_RESULT_SCHEMA_MISMATCH',
  );
});

test('a plain call sends no tools and returns the text, skipping thinking blocks', async (t) => {
  quiet(t);
  const directInvokeLLM = loadHelper();
  const { fetcher, requests } = fakeProvider([textAnswer('Patient tolerated visit well.')]);
  const answer = await directInvokeLLM({ prompt: 'Write.' }, { fetcher, apiKey: 'test-key' });
  assert.equal(answer, 'Patient tolerated visit well.');
  const body = requests[0].body;
  assert.equal(body.tools, undefined);
  assert.equal(body.tool_choice, undefined);
  assert.equal(body.system, undefined);
  assert.ok(body.max_tokens >= 16000);
});

test('a refusal stop is incomplete, not an empty answer', async (t) => {
  quiet(t);
  const directInvokeLLM = loadHelper();
  const { fetcher } = fakeProvider([{ payload: { stop_reason: 'refusal', content: [], usage: {} } }]);
  await assert.rejects(
    directInvokeLLM({ prompt: 'Write.' }, { fetcher, apiKey: 'test-key' }),
    (error) => error.code === 'AI_RESULT_INCOMPLETE' && error.status === 502,
  );
});

test('a provider rejection logs its status and error type, never its message', async (t) => {
  const logged = [];
  t.mock.method(console, 'log', (line) => logged.push(line));
  const directInvokeLLM = loadHelper();
  const { fetcher } = fakeProvider([{
    status: 400,
    payload: { type: 'error', error: { type: 'invalid_request_error', message: 'echo of patient Jane Doe' } },
  }]);
  await assert.rejects(
    directInvokeLLM({ prompt: 'Write.' }, { fetcher, apiKey: 'test-key' }),
    (error) => error.code === 'AI_PROVIDER_REJECTED' && error.status === 502,
  );
  assert.equal(logged.length, 1);
  assert.deepEqual(JSON.parse(logged[0]), { event: 'direct_ai_rejected', model: 'claude-sonnet-5-5', status: 400, error_type: 'invalid_request_error' });
  assert.doesNotMatch(logged[0], /Jane Doe/);
});

test('no Base44 function forces a tool choice', () => {
  const root = join(process.cwd(), 'base44', 'functions');
  const offenders = readdirSync(root).filter((name) => {
    let source;
    try { source = readFileSync(join(root, name, 'entry.ts'), 'utf8'); } catch { return false; }
    return /tool_choice\s*[:=]\s*\{\s*type\s*:\s*['"](?:tool|any)['"]/.test(source);
  });
  assert.deepEqual(offenders, []);
});
