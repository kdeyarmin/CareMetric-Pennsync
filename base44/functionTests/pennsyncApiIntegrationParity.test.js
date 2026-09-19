import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transpileTs } from '../../tools-transpile-ts.mjs';
import { analyzeReferralPriority, parseLLMJson } from '../../services/pennsync-api/referral-priority.mjs';

/**
 * Parity for a port whose real output is a request to somebody else.
 *
 * `analyzeReferralPriority` computes almost nothing: it builds a prompt, asks a
 * model, and salvages JSON from the answer. So comparing return values would
 * miss the part that matters. This drives the ORIGINAL Deno module with a
 * stubbed client that records the `InvokeLLM` argument, drives the port with a
 * stubbed capability that records the same, and compares both the recorded call
 * and the answer.
 *
 * The prompt is the contract with the model. A reworded prompt is a different
 * function even when every line of surrounding code matches, which is exactly
 * the kind of drift a return-value test cannot see.
 */
globalThis.Deno = globalThis.Deno || { serve() {}, env: { get: () => undefined } };

/** Load the original's `Deno.serve` handler with its client and provider stubbed. */
async function loadOriginalHandler(calls, answer) {
  let source = await readFile(
    new URL('../functions/analyzeReferralPriority/entry.ts', import.meta.url), 'utf8');
  source = source.replace(/import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    `const createClientFromRequest = () => ({
       auth: { me: async () => ({ id: 'synthetic-user', is_active: true }) },
       integrations: { Core: { InvokeLLM: async (argument) => { globalThis.__calls.push(argument); return globalThis.__answer; } } },
     });`);
  assert.match(source, /Deno\.serve\(/, 'the original should still be a Deno.serve module');
  const js = transpileTs(source).outputText;
  const file = join(tmpdir(), `integparity_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  let handler = null;
  const previousServe = globalThis.Deno.serve;
  globalThis.Deno = { ...globalThis.Deno, serve: fn => { handler = fn; } };
  globalThis.__calls = calls;
  globalThis.__answer = answer;
  await writeFile(file, js);
  try { await import(pathToFileURL(file).href); }
  finally { await unlink(file).catch(() => {}); globalThis.Deno.serve = previousServe; }
  assert.ok(handler, 'the original did not register a handler');
  return handler;
}

const body = (extractedData, analysisResults) => new Request('https://synthetic.invalid/', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ extractedData, analysisResults }),
});

const CASES = [
  [{ diagnosis: 'Synthetic wound care', notes: 'Synthetic discharge summary' }, { risk: 'synthetic' }],
  // Absent fields: `JSON.stringify(undefined, null, 2)` is undefined, and both
  // sides interpolate it, so the prompt carries the literal word.
  [undefined, undefined],
  [{}, {}],
  [{ nested: { deep: [1, 2, { three: true }] } }, null],
];

const ANSWERS = [
  '{"priority":"urgent","priority_score":9}',
  '```json\n{"priority":"high"}\n```',
  'Here is the assessment: {"priority":"normal"} and nothing else.',
  'no json at all',
  '',
  { priority: 'low' },
];

test('the ported priority analysis asks the model exactly what the original asked', async () => {
  for (const [extractedData, analysisResults] of CASES) {
    const originalCalls = [];
    const handler = await loadOriginalHandler(originalCalls, ANSWERS[0]);
    const originalResponse = await handler(body(extractedData, analysisResults));
    const originalBody = await originalResponse.json();

    const portedCalls = [];
    const ported = await analyzeReferralPriority({
      params: { extractedData, analysisResults },
      integration: async (operation, params) => { portedCalls.push({ operation, params }); return ANSWERS[0]; },
    });

    assert.equal(portedCalls.length, 1, 'one brokered call, as the original made one');
    assert.equal(portedCalls[0].operation, 'InvokeLLM');
    assert.equal(originalCalls.length, 1);
    // The whole argument, so a changed model selector fails too.
    assert.deepEqual(portedCalls[0].params, originalCalls[0]);
    assert.deepEqual(ported, originalBody);
  }
});

test('the salvage behaviour of the answer parser is preserved exactly', async () => {
  const originalCalls = [];
  for (const answer of ANSWERS) {
    const handler = await loadOriginalHandler(originalCalls, answer);
    const originalBody = await (await handler(body({ a: 1 }, { b: 2 }))).json();
    const ported = await analyzeReferralPriority({
      params: { extractedData: { a: 1 }, analysisResults: { b: 2 } },
      integration: async () => answer,
    });
    assert.deepEqual(ported, originalBody, `answer ${JSON.stringify(answer)} parsed differently`);
  }
});

test('the parser keeps the fallbacks that make a tolerant answer usable', () => {
  // Pinned directly, because these are the cases the original's comment exists
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

test('an unparseable answer still hands the caller an object to read', async () => {
  const ported = await analyzeReferralPriority({
    params: { extractedData: {}, analysisResults: {} },
    integration: async () => 'not json',
  });
  assert.deepEqual(ported, { success: true, priorityAnalysis: {} });
});
