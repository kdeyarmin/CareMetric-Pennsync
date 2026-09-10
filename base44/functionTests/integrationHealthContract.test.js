import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const source = await readFile(
  new URL('../functions/checkAllIntegrations/entry.ts', import.meta.url),
  'utf8',
);
const panelSource = await readFile(
  new URL('../../src/components/admin/IntegrationsHealthPanel.jsx', import.meta.url),
  'utf8',
);
const WORKFLOW_GATES = {
  release_auto_retry_failed_faxes: 'WORKFLOW_RELEASE_AUTO_RETRY_FAILED_FAXES',
  release_check_stale_follow_up_requests: 'WORKFLOW_RELEASE_CHECK_STALE_FOLLOW_UP_REQUESTS',
  release_poll_fax_statuses: 'WORKFLOW_RELEASE_POLL_FAX_STATUSES',
  release_process_inbound_faxes: 'WORKFLOW_RELEASE_PROCESS_INBOUND_FAXES',
  release_process_scheduled_faxes: 'WORKFLOW_RELEASE_PROCESS_SCHEDULED_FAXES',
};

async function loadHandler({ env = {}, client } = {}) {
  const rewritten = source.replace(
    /import\s+\{\s*createClientFromRequest\s*\}\s+from\s+'npm:[^']+';/,
    'const createClientFromRequest = () => globalThis.__integrationHealthClient;',
  );
  const temporaryModule = join(
    tmpdir(),
    `integration_health_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(temporaryModule, transpileTs(rewritten).outputText);

  let handler;
  globalThis.__integrationHealthClient = client || {
    auth: { me: async () => ({ id: 'admin-a', role: 'admin', is_active: true }) },
    functions: {
      invoke: async () => ({
        data: {
          success: true,
          checks: [{ id: 'telnyx_api_live', status: 'warn' }],
          stats: { messaging_ready: false, voice_ready: false, fax_ready: false },
        },
      }),
    },
  };
  globalThis.Deno = {
    serve: (candidate) => { handler = candidate; },
    env: { get: (name) => env[name] },
  };
  try {
    await import(pathToFileURL(temporaryModule).href);
  } finally {
    await unlink(temporaryModule).catch(() => {});
  }
  assert.equal(typeof handler, 'function');
  return handler;
}

test('provider probes are bounded, parallel, and never report non-2xx as working', () => {
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /setTimeout\(\(\) => controller\.abort\(\), PROBE_TIMEOUT_MS\)/);
  // Base44's function runtime rejects the 'error' redirect mode (every probe
  // threw before sending), so probes use 'manual' and refuse any 3xx explicitly.
  assert.match(source, /redirect: 'manual'/);
  assert.doesNotMatch(source, /redirect: 'error'/);
  assert.doesNotMatch(source, /redirect: 'follow'/);
  assert.match(source, /res\.type === 'opaqueredirect' \|\| \(status >= 300 && status < 400\)/);
  assert.match(source, /await Promise\.all\(\[/);
  assert.match(source, /if \(res\.ok\) return \{ status: 'ok'/);
  assert.doesNotMatch(source, /Other non-2xx[\s\S]*status: 'ok'/);
  for (const status of ['401', '403', '429', '500']) {
    assert.ok(source.includes(status), `missing explicit ${status} handling`);
  }
});

const PROVIDER_KEYS = {
  OPENAI_API_KEY: 'openai-probe-key-secret',
  ANTHROPIC_API_KEY: 'anthropic-probe-key-secret',
  HEYGEN_API_KEY: 'heygen-probe-key-secret',
};
const PROVIDER_IDS = ['openai_transcription', 'anthropic_soap', 'heygen'];

async function runProviderProbes(fetchImpl) {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return fetchImpl(url, options);
  };
  try {
    const handler = await loadHandler({ env: PROVIDER_KEYS });
    const response = await handler({});
    const report = await response.json();
    assert.equal(response.status, 200);
    const byId = Object.fromEntries(report.integrations.map((item) => [item.id, item]));
    return { calls, byId, serialized: JSON.stringify(report) };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('provider probes send with a supported no-follow redirect mode', async () => {
  const { calls, byId } = await runProviderProbes(async () => new Response(null, { status: 200 }));
  assert.equal(calls.length, PROVIDER_IDS.length);
  for (const call of calls) {
    assert.equal(call.options.redirect, 'manual', `${call.url} must not follow or use redirect: 'error'`);
    assert.ok(call.options.signal, `${call.url} must stay bounded by the abort signal`);
  }
  for (const id of PROVIDER_IDS) {
    assert.equal(byId[id].status, 'ok', id);
    assert.equal(byId[id].configured, true, id);
    assert.equal(byId[id].probe, 'authenticated-read', id);
  }
});

test('a redirected provider probe is refused and never reported as working', async () => {
  const { byId, serialized } = await runProviderProbes(async () => new Response(null, {
    status: 302,
    headers: { location: 'https://redirect-target.example/steal' },
  }));
  for (const id of PROVIDER_IDS) {
    assert.equal(byId[id].status, 'fail', id);
    assert.match(byId[id].detail, /redirect \(HTTP 302\); it was not followed/, id);
  }
  assert.doesNotMatch(serialized, /redirect-target\.example/);
  for (const value of Object.values(PROVIDER_KEYS)) assert.doesNotMatch(serialized, new RegExp(value));
});

test('rejected credentials, timeouts, and runtime errors are classified without echoing details', async () => {
  const rejected = await runProviderProbes(async () => new Response(null, { status: 401 }));
  for (const id of PROVIDER_IDS) {
    assert.equal(rejected.byId[id].status, 'fail', id);
    assert.match(rejected.byId[id].detail, /rejected the configured credential \(HTTP 401\)/, id);
  }

  const timedOut = await runProviderProbes(async () => {
    throw new DOMException('provider timeout echoed heygen-probe-key-secret', 'AbortError');
  });
  for (const id of PROVIDER_IDS) {
    assert.equal(timedOut.byId[id].status, 'warn', id);
    assert.match(timedOut.byId[id].detail, /did not answer the read-only probe within 5 seconds/, id);
  }
  assert.doesNotMatch(timedOut.serialized, /probe-key-secret|provider timeout echoed/);

  const runtimeError = await runProviderProbes(async () => {
    throw new TypeError('runtime failure echoed openai-probe-key-secret');
  });
  for (const id of PROVIDER_IDS) {
    assert.equal(runtimeError.byId[id].status, 'warn', id);
    assert.match(runtimeError.byId[id].detail, /Could not complete the bounded .* read-only probe/, id);
  }
  assert.doesNotMatch(runtimeError.serialized, /probe-key-secret|runtime failure echoed/);
});

test('legacy non-runtime providers are not treated as credential requirements', () => {
  for (const secret of [
    'GOOGLE_GEMINI_API_KEY',
    'DEEPGRAM_API_KEY',
    'RESEND_API_KEY',
    'NOTIFYRE_API_KEY',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
  ]) {
    assert.doesNotMatch(source, new RegExp(`env\\('${secret}'\\)`), secret);
  }
  for (const id of ['gemini', 'deepgram', 'resend', 'notifyre', 'twilio']) {
    assert.doesNotMatch(source, new RegExp(`id: ['"]${id}['"]`), id);
  }
  assert.match(source, /id: 'base44_llm'/);
  assert.match(source, /Core\.InvokeLLM capability/);
  assert.match(source, /id: 'base44_email'/);
  assert.match(source, /Core\.SendEmail/);
});

test('health reports exact public-link configuration and outbound release state', () => {
  assert.match(source, /id: 'app_public_url'/);
  assert.match(source, /APP_PUBLIC_URL is missing or is not an exact HTTPS origin/);
  assert.match(source, /parsed\.protocol !== 'https:'/);
  assert.match(source, /id: 'outbound_delivery_release'/);
  assert.match(source, /OUTBOUND_DELIVERY_RELEASE_ENV = 'OUTBOUND_DELIVERY_RELEASE'/);
  assert.match(source, /OUTBOUND_DELIVERY_RELEASE_VALUE = 'enabled-v1'/);
  assert.match(source, /release_state: outboundDeliveryIsReleased \? 'released' : 'paused'/);
  assert.match(source, /provider health is not delivery proof/i);
  assert.match(source, /outbound_actions_performed: false/);
});

test('every implemented workflow release gate is reported and rendered explicitly', () => {
  for (const [id, envName] of Object.entries(WORKFLOW_GATES)) {
    assert.match(source, new RegExp(`id: ['"]${id}['"]`), id);
    assert.match(source, new RegExp(envName), envName);
  }
  assert.match(source, /releaseValue === 'enabled-v1'/);
  assert.match(source, /release_state: released \? 'released' : 'paused'/);
  assert.match(panelSource, /item\.release_state === "released"/);
  assert.match(panelSource, /item\.release_state === "paused"/);
  assert.doesNotMatch(panelSource, /No global gate/);
});

test('workflow-critical configuration remains in the capability response', () => {
  assert.match(source, /id: 'workflow_internal_auth'/);
  assert.match(source, /INTERNAL_FN_SECRET is missing or too short/);
  assert.match(source, /id: 'signature_hmac'/);
  assert.match(source, /SIGNATURE_HMAC_SECRET is missing or too short/);
  assert.match(source, /id: 'outcome_pipeline_release'/);
  assert.match(source, /OUTCOME_PIPELINE_RELEASE/);
});

test('an empty or malformed Telnyx check cannot become Working', () => {
  assert.match(source, /wellFormedChecks = checks\.length > 0/);
  assert.match(source, /hasRequiredChecks = \[\.\.\.TELNYX_REQUIRED_CHECK_IDS\]/);
  assert.match(source, /validStats =/);
  assert.match(source, /validResult = data\?\.success === true && wellFormedChecks && hasRequiredChecks && validStats/);
  assert.match(source, /hasFail = !validResult/);
  assert.doesNotMatch(source, /Telnyx test could not run:.*message/);
});

test('malformed, partial, duplicate, or invalid-status Telnyx reports fail closed', async () => {
  let delegatedResult;
  const client = {
    auth: { me: async () => ({ id: 'admin-a', role: 'admin', is_active: true }) },
    functions: { invoke: async () => delegatedResult },
  };
  const handler = await loadHandler({ client });
  const malformed = [
    { data: { success: true, checks: [{}], stats: { messaging_ready: false, voice_ready: false, fax_ready: false } } },
    { data: { success: true, checks: [{ id: 'telnyx_api_live', status: 'ok' }], stats: { messaging_ready: true, voice_ready: false, fax_ready: false } } },
    { data: { success: true, checks: [
      { id: 'telnyx_api_key', status: 'ok' },
      { id: 'telnyx_api_key', status: 'ok' },
      { id: 'telnyx_api_live', status: 'ok' },
    ], stats: { messaging_ready: true, voice_ready: false, fax_ready: false } } },
    { data: { success: true, checks: [
      { id: 'telnyx_api_key', status: 'healthy' },
      { id: 'telnyx_api_live', status: 'ok' },
    ], stats: { messaging_ready: true, voice_ready: false, fax_ready: false } } },
    { data: { success: true, checks: [
      { id: 'telnyx_api_key', status: 'ok' },
      { id: 'telnyx_api_live', status: 'ok' },
    ], stats: {} } },
  ];

  for (const result of malformed) {
    delegatedResult = result;
    const response = await handler({});
    const report = await response.json();
    const telnyx = report.integrations.find((item) => item.id === 'telnyx');
    assert.equal(telnyx.status, 'fail');
    assert.equal(telnyx.configured, false);
  }

  delegatedResult = { data: {
    success: true,
    checks: [
      { id: 'telnyx_api_key', status: 'ok' },
      { id: 'telnyx_api_live', status: 'ok' },
    ],
    stats: { messaging_ready: true, voice_ready: false, fax_ready: false },
  } };
  const response = await handler({});
  const report = await response.json();
  const telnyx = report.integrations.find((item) => item.id === 'telnyx');
  assert.equal(telnyx.status, 'ok');
  assert.equal(telnyx.configured, true);
});

test('integration health rejects unavailable admin identities before any delegated probe', async () => {
  for (const user of [
    null,
    { id: 'admin-a', role: 'admin', is_active: false },
    { id: 'admin-a', role: 'admin', is_active: true, disabled: true },
    { id: 'admin-a', role: 'admin', is_active: true, is_service: true },
    { id: 'admin-a', role: 'admin', is_active: true, is_verified: false },
    { id: 'user-a', role: 'user', is_active: true },
  ]) {
    let delegatedCalls = 0;
    const client = {
      auth: { me: async () => user },
      functions: { invoke: async () => { delegatedCalls += 1; return {}; } },
    };
    const handler = await loadHandler({ client });
    const response = await handler({});
    assert.equal(response.status, user ? 403 : 401);
    assert.equal(delegatedCalls, 0);
  }
});

test('missing optional provider keys produce no direct provider requests or phantom failures', async () => {
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('provider fetch must not run');
  };
  try {
    const handler = await loadHandler({
      env: {
        APP_PUBLIC_URL: 'https://staging.example.test',
        INTERNAL_FN_SECRET: 'i'.repeat(32),
        SIGNATURE_HMAC_SECRET: 's'.repeat(32),
      },
    });
    const response = await handler({});
    const report = await response.json();
    assert.equal(response.status, 200);
    assert.equal(fetchCalls, 0);
    assert.equal(report.probe_policy.outbound_actions_performed, false);
    assert.equal(report.probe_policy.credential_values_exposed, false);

    const byId = Object.fromEntries(report.integrations.map((item) => [item.id, item]));
    assert.equal(byId.app_public_url.status, 'ok');
    assert.equal(byId.base44_email.configured, true);
    assert.equal(byId.base44_email.delivery_verified, false);
    assert.equal(byId.openai_transcription.status, 'warn');
    assert.equal(byId.anthropic_soap.status, 'warn');
    assert.equal(byId.outbound_delivery_release.release_state, 'paused');
    assert.equal(byId.outbound_delivery_release.configured, false);
    assert.equal(byId.outbound_delivery_release.status, 'warn');
    assert.deepEqual(byId.outbound_delivery_release.excluded_actions, [
      'createUserWithTempPassword', 'resendInvitation',
      'userManagement.invite_user', 'userManagement.resend_invitation',
    ]);
    assert.match(byId.outbound_delivery_release.detail, /manual account invitations remain available/);
    for (const id of Object.keys(WORKFLOW_GATES)) {
      assert.equal(byId[id].release_state, 'paused');
      assert.equal(byId[id].status, 'warn');
    }
    for (const id of ['gemini', 'deepgram', 'resend', 'notifyre', 'twilio']) {
      assert.equal(byId[id], undefined);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('workflow gates release only on their exact reviewed value', async () => {
  const handler = await loadHandler({
    env: {
      APP_PUBLIC_URL: 'https://staging.example.test',
      WORKFLOW_RELEASE_POLL_FAX_STATUSES: 'enabled-v1',
      WORKFLOW_RELEASE_PROCESS_SCHEDULED_FAXES: 'enabled',
    },
  });
  const response = await handler({});
  const report = await response.json();
  const byId = Object.fromEntries(report.integrations.map((item) => [item.id, item]));

  assert.equal(byId.release_poll_fax_statuses.release_state, 'released');
  assert.equal(byId.release_poll_fax_statuses.status, 'ok');
  assert.equal(byId.release_process_scheduled_faxes.release_state, 'paused');
  assert.equal(byId.release_process_scheduled_faxes.status, 'warn');
});

test('global outbound delivery releases only on its exact reviewed value', async () => {
  for (const value of [
    undefined,
    '',
    '   ',
    'enabled',
    'ENABLED-V1',
    'enabled-v1x',
    ' enabled-v1',
    'enabled-v1 ',
  ]) {
    const handler = await loadHandler({
      env: { OUTBOUND_DELIVERY_RELEASE: value },
    });
    const response = await handler({});
    const report = await response.json();
    const release = report.integrations.find((item) => item.id === 'outbound_delivery_release');
    assert.equal(release.release_state, 'paused');
    assert.equal(release.status, 'warn');
  }

  const handler = await loadHandler({
    env: { OUTBOUND_DELIVERY_RELEASE: 'enabled-v1' },
  });
  const response = await handler({});
  const report = await response.json();
  const release = report.integrations.find((item) => item.id === 'outbound_delivery_release');
  assert.equal(release.release_state, 'released');
  assert.equal(release.configured, true);
  assert.equal(release.status, 'ok');
  assert.doesNotMatch(JSON.stringify(release), /OUTBOUND_DELIVERY_RELEASE_VALUE/);
});

test('missing APP_PUBLIC_URL is a fail-closed capability, without exposing errors', async () => {
  const handler = await loadHandler();
  const response = await handler({});
  const report = await response.json();
  const appUrl = report.integrations.find((item) => item.id === 'app_public_url');
  assert.equal(response.status, 200);
  assert.equal(appUrl.configured, false);
  assert.equal(appUrl.status, 'fail');
  assert.match(appUrl.detail, /fails closed/);
});

test('hosted workflow checks log only the sanitized capability report', () => {
  assert.match(source, /checkAllIntegrations result:/);
  assert.match(source, /JSON\.stringify\(report\)/);
  assert.doesNotMatch(source, /JSON\.stringify\(Deno\.env/);
  assert.doesNotMatch(source, /detail:.*error\?\.message/);
  assert.match(source, /credential_values_exposed: false/);
});
