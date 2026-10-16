// Runs the real invokeDirectLLM broker entry.ts against an in-memory Base44
// and a stand-in for the Anthropic Messages API, the way
// referralTriageJobsContract.test.js runs its function. No network.
//
// The broker is the frontend's one AI transport after the direct-AI
// migration's Wave 3 (D229): these tests pin the auth shell (caller from
// `auth.me()` + trusted claims, never from the body), the helper's
// validation refusals in Base44's `{error}` shape, the exact not-configured
// body `src/lib/aiFeatureError.js` keys on, and both happy paths.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const AGENCY = 'agency-a';
const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');

const clone = (value) => (value === undefined ? undefined : structuredClone(value));
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function matchValue(actual, expected) {
  if (expected === null || expected === undefined) return actual === null || actual === undefined;
  if (expected && typeof expected === 'object' && !Array.isArray(expected) && Object.hasOwn(expected, '$in')) {
    return expected.$in.some((value) => sameJson(value, actual));
  }
  return sameJson(actual, expected);
}
const matches = (row, query) => Object.entries(query || {}).every(([key, value]) => matchValue(row[key], value));

// ---- Anthropic stand-in ---------------------------------------------------
function fakeModel({ script } = {}) {
  const calls = [];
  async function answer(body) {
    calls.push(body);
    if (script) return script(body, calls.length);
    const tool = (body.tools || []).find((entry) => entry.name === 'return_result');
    if (tool) {
      return new Response(JSON.stringify({
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'return_result', input: { result: { summary: 'All clear.' } } }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 3, output_tokens: 2 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      content: [{ type: 'text', text: 'Plain answer.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 3, output_tokens: 2 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return { calls, answer };
}

// ---- in-memory Base44 -------------------------------------------------------
function createRuntime({ env = { ANTHROPIC_API_KEY: 'sk-ant-test-key' }, model = fakeModel() } = {}) {
  const db = { AgencyMembership: [], Agency: [] };
  const users = new Map();
  const logs = [];

  function entity(name) {
    return {
      filter: async (query, sort, limit) => {
        assert.ok(Number.isInteger(limit), `${name}.filter needs a limit`);
        return clone(db[name].filter((row) => matches(row, query)).slice(0, limit));
      },
    };
  }
  const entities = Object.fromEntries(Object.keys(db).map((name) => [name, entity(name)]));

  const fetch = async (url, init = {}) => {
    if (url === 'https://api.anthropic.com/v1/messages') return model.answer(JSON.parse(init.body));
    if (String(url).startsWith('https://base44.app/files/')) {
      return new Response(PDF_BYTES, { status: 200, headers: { 'content-type': 'application/pdf' } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  const environment = { ...env };
  const Deno = { env: { get: (key) => environment[key] }, serve: () => {} };

  let handler;
  async function load() {
    if (handler) return handler;
    let source = await readFile(new URL('../functions/invokeDirectLLM/entry.ts', import.meta.url), 'utf8');
    const binding = `__invokeDirectLLMHarness_${Math.random().toString(36).slice(2)}`;
    globalThis[binding] = {
      createClientFromRequest: () => ({
        auth: { me: async () => clone(users.get(currentToken) ?? null) },
        asServiceRole: { entities },
      }),
      Deno: { ...Deno, serve: (candidate) => { handler = candidate; } },
      fetch,
    };
    source = source.replace(/import \{ createClientFromRequest \} from 'npm:[^']+';/,
      `const createClientFromRequest = globalThis.${binding}.createClientFromRequest; `
      + `const Deno = globalThis.${binding}.Deno; const fetch = globalThis.${binding}.fetch;`);
    assert.doesNotMatch(source, /^import /m, 'the harness provides every import');
    const compiled = transpileTs(source, { fileName: 'invokeDirectLLM/entry.ts' }).outputText;
    await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}#${binding}`);
    assert.ok(handler, 'entry registered a handler');
    return handler;
  }

  let currentToken = null;
  async function call({ user = null, body, method = 'POST' } = {}) {
    const run = await load();
    currentToken = user;
    const originalLog = console.log;
    console.log = (...args) => { logs.push(args.join(' ')); };
    try {
      const response = await run(new Request('https://functions.test/invokeDirectLLM', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
      }));
      return { status: response.status, data: await response.json().catch(() => null) };
    } finally {
      console.log = originalLog;
      currentToken = null;
    }
  }

  function addUser(key, { role = 'office_staff', active = true, withMembership = true } = {}) {
    users.set(key, { id: key, email: `${key}@agency.test`, role: 'user', is_active: active, account_type: 'user' });
    if (withMembership) {
      db.AgencyMembership.push({
        id: `membership-${key}`,
        membership_key: `${AGENCY}:${key}`,
        agency_id: AGENCY,
        user_id: key,
        user_email_normalized: `${key}@agency.test`,
        tenant_role: role,
        status: 'active',
        version: 3,
        invitation_id: `invitation-${key}`,
        created_by_user_id: 'platform-owner',
        activated_at: '2026-01-01T00:00:00.000Z',
        deactivated_at: null,
        revoked_at: null,
        revocation_reason: null,
        last_transition_by_user_id: 'platform-owner',
        last_transition_by_email_normalized: 'owner@agency.test',
        last_transition_at: '2026-01-01T00:00:00.000Z',
        last_transition_reason: 'invitation accepted',
      });
    }
  }

  db.Agency.push({ id: AGENCY, agency_name: 'Agency A', status: 'active' });
  return { db, logs, model, call, addUser };
}

const provenance = (runtime) => runtime.logs
  .map((line) => { try { return JSON.parse(line); } catch { return null; } })
  .filter((entry) => entry && entry.event === 'direct_ai_broker_call');

test('unauthenticated and deactivated callers are refused before any provider call', async () => {
  const runtime = createRuntime();
  runtime.addUser('nurse');
  runtime.addUser('former', { active: false });

  const anonymous = await runtime.call({ body: { prompt: 'Summarize.' } });
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.data.error, 'Unauthorized');

  const deactivated = await runtime.call({ user: 'former', body: { prompt: 'Summarize.' } });
  assert.equal(deactivated.status, 403);
  assert.equal(deactivated.data.error, 'Unauthorized - account is deactivated');

  const wrongMethod = await runtime.call({ user: 'nurse', method: 'GET' });
  assert.equal(wrongMethod.status, 405);

  assert.equal(runtime.model.calls.length, 0);
  assert.deepEqual(provenance(runtime).map((entry) => entry.outcome), ['unauthenticated', 'deactivated']);
});

test('identity comes from the caller, never from the body', async () => {
  const runtime = createRuntime();
  runtime.addUser('nurse');

  // A body that tries to name a tenant or a user is refused outright by the
  // helper's parameter allowlist — the call never reaches the provider and
  // is never re-scoped to the body-supplied identity.
  for (const forged of [{ agency_id: 'agency-b' }, { user_id: 'someone-else' }, { tenant_id: 'agency-b' }]) {
    const refused = await runtime.call({ user: 'nurse', body: { prompt: 'Summarize.', ...forged } });
    assert.equal(refused.status, 400, JSON.stringify(forged));
    assert.equal(refused.data.error, 'INVALID_INPUT');
  }
  assert.equal(runtime.model.calls.length, 0);

  // A clean call is attributed to the caller's own bound tenant in the
  // provenance line.
  const ok = await runtime.call({ user: 'nurse', body: { prompt: 'Summarize.' } });
  assert.equal(ok.status, 200);
  const [entry] = provenance(runtime).filter((line) => line.outcome === 'ok');
  assert.equal(entry.actor_email, 'nurse@agency.test');
  assert.equal(entry.actor_id, 'nurse');
  assert.equal(entry.agency_id, AGENCY);
});

test('a caller with no membership still calls, attributed to no tenant', async () => {
  const runtime = createRuntime();
  runtime.addUser('floater', { withMembership: false });
  const ok = await runtime.call({ user: 'floater', body: { prompt: 'Summarize.' } });
  assert.equal(ok.status, 200);
  const [entry] = provenance(runtime);
  assert.equal(entry.agency_id, null);
});

test('a missing key answers the exact body the frontend copy keys on', async () => {
  const runtime = createRuntime({ env: {} });
  runtime.addUser('nurse');
  const refused = await runtime.call({ user: 'nurse', body: { prompt: 'Summarize.' } });
  assert.equal(refused.status, 500);
  assert.deepEqual(refused.data, { error: 'Anthropic API key not configured' });
  assert.equal(runtime.model.calls.length, 0);
});

test('the helper validation refusals keep their codes and statuses', async () => {
  const runtime = createRuntime();
  runtime.addUser('nurse');
  const call = (body) => runtime.call({ user: 'nurse', body });

  const tooLong = await call({ prompt: 'x'.repeat(100_001) });
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.data.error, 'INVALID_TEXT');

  const tooManyFiles = await call({
    prompt: 'Read these.',
    file_urls: ['https://base44.app/files/a.pdf', 'https://base44.app/files/b.pdf', 'https://base44.app/files/c.pdf', 'https://base44.app/files/d.pdf'],
  });
  assert.equal(tooManyFiles.status, 400);
  assert.equal(tooManyFiles.data.error, 'INVALID_FILES');

  const foreignHost = await call({ prompt: 'Read this.', file_urls: ['https://169.254.169.254/latest/meta-data'] });
  assert.equal(foreignHost.status, 400);
  assert.equal(foreignHost.data.error, 'INVALID_FILES');

  const badSchema = await call({ prompt: 'Extract.', response_json_schema: { type: 'object', properties: { x: { type: 'funky' } } } });
  assert.equal(badSchema.status, 400);
  assert.equal(badSchema.data.error, 'UNSUPPORTED_SCHEMA');

  const badWebFlag = await call({ prompt: 'Search first.', add_context_from_internet: 'yes' });
  assert.equal(badWebFlag.status, 400);
  assert.equal(badWebFlag.data.error, 'INVALID_INPUT');

  const unknownModel = await call({ prompt: 'Hi.', model: 'gpt-4o' });
  assert.equal(unknownModel.status, 400);
  assert.equal(unknownModel.data.error, 'MODEL_MAPPING_REQUIRED');

  assert.equal(runtime.model.calls.length, 0);
});

test('structured and file-based happy paths reach the provider and return its answer', async () => {
  const runtime = createRuntime();
  runtime.addUser('nurse');

  const structured = await runtime.call({
    user: 'nurse',
    body: {
      prompt: 'Summarize the visit.',
      response_json_schema: {
        type: 'object',
        properties: { summary: { type: 'string' }, note: { type: ['string', 'null'] } },
        required: ['summary'],
      },
    },
  });
  assert.equal(structured.status, 200);
  assert.deepEqual(structured.data, { summary: 'All clear.' });
  const structuredCall = runtime.model.calls[0];
  assert.equal(structuredCall.model, 'claude-sonnet-5-5');
  assert.equal(structuredCall.tools[0].name, 'return_result');

  const filed = await runtime.call({
    user: 'nurse',
    body: { prompt: 'What does this document say?', file_urls: ['https://base44.app/files/note.pdf'] },
  });
  assert.equal(filed.status, 200);
  assert.equal(filed.data, 'Plain answer.');
  const fileCall = runtime.model.calls[1];
  const document = fileCall.messages[0].content.find((block) => block.type === 'document');
  assert.ok(document, 'the fetched file reached the provider as a document block');
  assert.equal(document.source.media_type, 'application/pdf');
  assert.equal(Buffer.from(document.source.data, 'base64').toString('utf8'), Buffer.from(PDF_BYTES).toString('utf8'));
});

test('a web-grounded call rides the broker and returns the grounded answer', async () => {
  // Wave 4 (D230): the broker passes the flag through to the helper, whose
  // request carries the web_search server tool; the grounded text comes
  // back as the plain string the frontend wrappers already return.
  const webModel = fakeModel({
    script: async () => new Response(JSON.stringify({
      content: [
        { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: 'CMS home health updates' } },
        {
          type: 'web_search_tool_result', tool_use_id: 'srv_1',
          content: [{ type: 'web_search_result', title: 'CMS', url: 'https://www.cms.gov/example', encrypted_content: 'blob' }],
        },
        { type: 'text', text: 'Grounded answer.' },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 3, output_tokens: 2, server_tool_use: { web_search_requests: 1 } },
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  const runtime = createRuntime({ model: webModel });
  runtime.addUser('nurse');
  const ok = await runtime.call({ user: 'nurse', body: { prompt: 'Search first.', add_context_from_internet: true } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data, 'Grounded answer.');
  assert.equal(webModel.calls.length, 1);
  assert.deepEqual(webModel.calls[0].tools, [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }]);
  const [entry] = provenance(runtime).filter((line) => line.outcome === 'ok');
  assert.equal(entry.actor_email, 'nurse@agency.test');
});

test('a web-grounded plain answer keeps the sources its text cites', async () => {
  // The citation URL rides in the text block's citations, not in its
  // text; the helper appends the ones the text does not name and the
  // broker returns that string untouched (PR #478 review).
  const webModel = fakeModel({
    script: async () => new Response(JSON.stringify({
      content: [
        { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: 'CMS home health updates' } },
        { type: 'text', text: 'The rule changed.', citations: [{ type: 'web_search_result_location', url: 'https://www.cms.gov/example', title: 'CMS', encrypted_index: 'e1' }] },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 3, output_tokens: 2, server_tool_use: { web_search_requests: 1 } },
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  const runtime = createRuntime({ model: webModel });
  runtime.addUser('nurse');
  const ok = await runtime.call({ user: 'nurse', body: { prompt: 'Search first.', add_context_from_internet: true } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data, 'The rule changed.\n\nSources:\n- https://www.cms.gov/example');
});

test('a provider throttle passes through at 429 so the frontend rate-limit path keys on it', async () => {
  const throttled = fakeModel({
    script: async () => new Response(JSON.stringify({ error: { type: 'rate_limit_error', message: 'slow down' } }), {
      status: 429,
      headers: { 'content-type': 'application/json', 'retry-after': '30' },
    }),
  });
  const runtime = createRuntime({ model: throttled });
  runtime.addUser('nurse');
  const refused = await runtime.call({ user: 'nurse', body: { prompt: 'Summarize.' } });
  // Not the shared 503 throttle body: aiFeatureError's rate-limit branch and
  // aiCall's retry policy both key on the 429 status reaching the client.
  assert.equal(refused.status, 429);
  assert.equal(refused.data.error, 'AI_PROVIDER_REJECTED');
});
