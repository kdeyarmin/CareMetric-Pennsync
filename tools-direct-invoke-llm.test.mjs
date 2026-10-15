import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SHARED_HELPERS } from './base44/_shared/backendHelpers.mjs';

// The generated directInvokeLLM helper, evaluated from its canonical source
// (the same text tools-sync-shared-helpers.mjs inlines into each function).
// All keys and payloads here are synthetic; no request leaves the process.
const directInvokeLLM = new Function(`${SHARED_HELPERS.directInvokeLLM}\nreturn directInvokeLLM;`)();

function harness(content) {
  const bodies = [];
  const fetcher = async (url, options) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    bodies.push(JSON.parse(options.body));
    return Response.json({
      content,
      stop_reason: content.some((block) => block.type === 'tool_use') ? 'tool_use' : 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  };
  return { bodies, deps: { fetcher, apiKey: 'synthetic-anthropic' } };
}
const schema = { type: 'object', properties: { value: { type: 'integer', minimum: 0 } }, required: ['value'] };
const call = { type: 'tool_use', name: 'return_result', input: { result: { value: 3 } } };

test('structured mode never forces the tool call, which the 5.5 models reject with a 400', async (t) => {
  const logs = t.mock.method(console, 'log', () => {});
  const { bodies, deps } = harness([{ type: 'text', text: 'Synthetic preamble' }, call]);
  assert.deepEqual(await directInvokeLLM({ prompt: 'Synthetic prompt', model: 'automatic', response_json_schema: schema }, deps), { value: 3 });
  const body = bodies[0];
  assert.equal(body.model, 'claude-sonnet-5-5');
  assert.equal(body.max_tokens, 8192);
  assert.deepEqual(body.tool_choice, { type: 'auto', disable_parallel_tool_use: true });
  assert.equal(body.tools.length, 1);
  assert.equal(body.tools[0].name, 'return_result');
  assert.equal(body.tools[0].strict, undefined);
  assert.deepEqual(body.tools[0].input_schema, { type: 'object', properties: { result: schema }, required: ['result'], additionalProperties: false });
  assert.match(body.system, /calling the return_result tool exactly once/);
  assert.equal(body.output_config, undefined);
  assert.equal(JSON.parse(logs.mock.calls[0].arguments[0]).class, 'structured');
});

test('structured mode refuses a reply without exactly one conforming return_result call', async (t) => {
  t.mock.method(console, 'log', () => {});
  for (const content of [
    [{ type: 'text', text: '{"value":3}' }],
    [call, { ...call, input: { result: { value: 4 } } }],
    [{ ...call, input: { result: { value: -1 } } }],
    [{ ...call, name: 'other_tool' }],
  ]) {
    const { deps } = harness(content);
    await assert.rejects(
      () => directInvokeLLM({ prompt: 'Synthetic prompt', response_json_schema: schema }, deps),
      (error) => error.status === 502 && error.code === 'AI_RESULT_SCHEMA_MISMATCH',
    );
  }
});

test('plain mode sends no tools, tool_choice or system prompt', async (t) => {
  t.mock.method(console, 'log', () => {});
  const { bodies, deps } = harness([{ type: 'text', text: 'Synthetic answer' }]);
  assert.equal(await directInvokeLLM({ prompt: 'Synthetic prompt' }, deps), 'Synthetic answer');
  assert.equal(bodies[0].max_tokens, 4096);
  for (const key of ['tools', 'tool_choice', 'system']) assert.equal(bodies[0][key], undefined);
});

test('no Anthropic caller in the tree forces tool_choice to "tool" or "any"', () => {
  const forced = /tool_choice[^\n;]*type:\s*['"](?:tool|any)['"]/;
  const sources = [];
  const walk = (dir, pattern) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules') continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path, pattern);
      else if (pattern.test(entry) && !/\.test\./.test(entry)) sources.push(path);
    }
  };
  walk('base44/functions', /\.ts$/);
  walk('base44/_shared', /\.mjs$/);
  walk('services', /\.(?:mjs|js|ts)$/);
  assert.ok(sources.length > 100);
  assert.deepEqual(sources.filter((path) => forced.test(readFileSync(path, 'utf8'))), []);
});
