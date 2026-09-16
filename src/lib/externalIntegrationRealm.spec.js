import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@base44/sdk';
import { runWithRetry, drainTimedOutAI } from './aiCall';
import { createAIScheduler } from './aiScheduler';
import { lockBase44FunctionRevision } from './functionRevisionPolicy';
import { BROWSER_CONTRACT } from '../../services/integration-runtime/caller-binding.mjs';
import { createTenantSdkRealmGate } from './tenantSdkRealmGate';
import { rotateBrowserAuthorityEpoch } from './browserAuthorityEpoch';
import { EXTERNAL_INTEGRATION_APP, EXTERNAL_INTEGRATION_ORIGIN, readExternalIntegrationConfig, routeExternalCoreOperations } from './externalIntegrationTransport';

const revision = 'a'.repeat(40);
const authority = '["user-a","agency-a","member-a",1]';
function harness(fetcher) {
  const gate = createTenantSdkRealmGate();
  const native = { integrations: { Core: { InvokeLLM: vi.fn(), UploadFile: vi.fn().mockResolvedValue({ file_url: 'unchanged-legacy-file' }) } },
    auth: { logout: vi.fn(), setToken: vi.fn() } };
  const config = readExternalIntegrationConfig({ VITE_EXTERNAL_INTEGRATIONS: 'enabled-v2',
    VITE_EXTERNAL_INTEGRATION_ORIGIN: EXTERNAL_INTEGRATION_ORIGIN, VITE_EXTERNAL_INTEGRATION_OPERATIONS: 'InvokeLLM',
    VITE_EXTERNAL_INTEGRATION_REVISION: revision }, EXTERNAL_INTEGRATION_APP);
  const fetch = vi.fn(async (url, options) => {
    const body = JSON.parse(options.body);
    if (fetcher) await fetcher(options);
    const response = Response.json({ success: true, result: 'synthetic response', execution: 'external', base44ExecutionDependency: true,
      contract: BROWSER_CONTRACT, app_id: EXTERNAL_INTEGRATION_APP, revision, request_id: body.request_id, operation: body.operation });
    Object.defineProperty(response, 'url', { value: url }); return response;
  });
  const routed = routeExternalCoreOperations(native, config, {
    fetcher: fetch,
    getSession: () => ({ token: 'synthetic-session-token-value', context: { user_id: 'user-a', agency_id: 'agency-a',
      membership_id: 'member-a', membership_version: 1, tenant_role: 'clinician', is_platform_owner: false } }),
    captureLease: gate.captureLease, assertLeaseCurrent: gate.assertLeaseCurrent, getLeaseSignal: gate.getLeaseAbortSignal,
  });
  return { gate, native, fetch, client: gate.wrapClient(routed) };
}
describe('external integrations remain inside the existing tenant SDK realm', () => {
  beforeEach(() => localStorage.clear());
  it('closed realms invoke neither external requests nor the original paid SDK', async () => {
    const h = harness();
    await expect(h.client.integrations.Core.InvokeLLM({ prompt: 'invented' })).rejects.toMatchObject({ code: 'TENANT_SDK_REALM_CLOSED' });
    expect(h.fetch).not.toHaveBeenCalled(); expect(h.native.integrations.Core.InvokeLLM).not.toHaveBeenCalled();
  });
  it('open realm routes selected work but keeps existing public-file behavior unchanged', async () => {
    const h = harness(); expect(h.gate.open(authority)).toBe(true);
    await expect(h.client.integrations.Core.InvokeLLM({ prompt: 'invented' })).resolves.toBe('synthetic response');
    await expect(h.client.integrations.Core.UploadFile({ file: 'legacy' })).resolves.toEqual({ file_url: 'unchanged-legacy-file' });
    expect(h.fetch).toHaveBeenCalledTimes(1); expect(h.native.integrations.Core.InvokeLLM).not.toHaveBeenCalled();
    expect(h.native.integrations.Core.UploadFile).toHaveBeenCalledTimes(1);
  });
  it('a cached descriptor method cannot cross terminal realm closure', async () => {
    const h = harness(); expect(h.gate.open(authority)).toBe(true);
    const cached = Object.getOwnPropertyDescriptor(h.client.integrations.Core, 'InvokeLLM').value;
    h.gate.close(); expect(h.gate.open(authority)).toBe(false);
    await expect(cached({ prompt: 'invented' })).rejects.toMatchObject({ code: 'TENANT_SDK_REALM_CLOSED' });
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it('an in-flight external response is withheld and aborted after cross-tab authority changes', async () => {
    let resolveProvider; let signal;
    const h = harness(options => { signal = options.signal; return new Promise(resolve => { resolveProvider = resolve; }); });
    expect(h.gate.open(authority)).toBe(true);
    const operation = h.client.integrations.Core.InvokeLLM({ prompt: 'invented' });
    const rejected = expect(operation).rejects.toMatchObject({ code: 'STALE_TENANT_SDK_OPERATION' });
    await vi.waitFor(() => expect(resolveProvider).toBeTypeOf('function'));
    rotateBrowserAuthorityEpoch(); expect(h.gate.isOpen()).toBe(false); expect(signal.aborted).toBe(true);
    resolveProvider(); await rejected;
    expect(h.fetch).toHaveBeenCalledTimes(1); expect(h.native.integrations.Core.InvokeLLM).not.toHaveBeenCalled();
  });
});


describe('installed Base44 SDK transport composition', () => {
  beforeEach(() => localStorage.clear());

  it('routes the real dynamic SDK Core proxy through revision and realm guards', async () => {
    const gate = createTenantSdkRealmGate();
    const raw = lockBase44FunctionRevision(createClient({
      appId: EXTERNAL_INTEGRATION_APP,
      serverUrl: 'https://base44.app',
      token: 'synthetic-session-token-value',
      requiresAuth: false,
      analytics: { enabled: false },
    }), null);
    const config = readExternalIntegrationConfig({
      VITE_EXTERNAL_INTEGRATIONS: 'enabled-v2',
      VITE_EXTERNAL_INTEGRATION_ORIGIN: EXTERNAL_INTEGRATION_ORIGIN,
      VITE_EXTERNAL_INTEGRATION_OPERATIONS: 'InvokeLLM',
      VITE_EXTERNAL_INTEGRATION_REVISION: revision,
    }, EXTERNAL_INTEGRATION_APP);
    const xhr = vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(() => {
      throw new Error('An external operation must not fall back to the native SDK network');
    });
    const fetcher = vi.fn(async (url, options) => {
      const body = JSON.parse(options.body);
      const response = Response.json({ success: true, result: 'synthetic installed-SDK result',
        execution: 'external', base44ExecutionDependency: true, contract: BROWSER_CONTRACT,
        app_id: EXTERNAL_INTEGRATION_APP, revision, request_id: body.request_id, operation: body.operation });
      Object.defineProperty(response, 'url', { value: url });
      return response;
    });
    try {
      const routed = routeExternalCoreOperations(raw, config, {
        fetcher,
        getSession: () => ({ token: 'synthetic-session-token-value', context: {
          user_id: 'user-a', agency_id: 'agency-a', membership_id: 'member-a',
          membership_version: 1, tenant_role: 'clinician', is_platform_owner: false,
        } }),
        captureLease: gate.captureLease,
        assertLeaseCurrent: gate.assertLeaseCurrent,
        getLeaseSignal: gate.getLeaseAbortSignal,
      });
      expect(routeExternalCoreOperations(raw, { enabled: false }, {})).toBe(raw);
      const client = gate.wrapClient(routed);
      await expect(client.integrations.Core.InvokeLLM({ prompt: 'invented' }))
        .rejects.toMatchObject({ code: 'TENANT_SDK_REALM_CLOSED' });
      expect(fetcher).not.toHaveBeenCalled();
      expect(gate.open(authority)).toBe(true);
      const selected = client.integrations.Core.InvokeLLM;
      await expect(selected({ prompt: 'invented' })).resolves.toBe('synthetic installed-SDK result');
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(xhr).not.toHaveBeenCalled();
      gate.close();
      await expect(selected({ prompt: 'invented' })).rejects.toMatchObject({ code: 'TENANT_SDK_REALM_CLOSED' });
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      xhr.mockRestore();
    }
  });
});


describe('existing AI timeout preserves and reconciles the exact external operation', () => {
  beforeEach(() => localStorage.clear());

  it('shared timeout and scheduler retain the request ID through the real realm promise wrapper', async () => {
    let finish;
    const h = harness(() => new Promise(resolve => { finish = resolve; }));
    expect(h.gate.open(authority)).toBe(true);
    const scheduler = createAIScheduler({ maxConcurrent: 1 });
    const error = await scheduler.schedule(() => runWithRetry(
      () => h.client.integrations.Core.InvokeLLM({ prompt: 'synthetic slow request' }),
      { timeoutMs: 5, retries: 2, backoffMs: 0, shouldRetry: () => true },
    )).catch(value => value);
    expect(error.code).toBe('AI_TIMEOUT');
    expect(error.retryable).toBe(false);
    expect(error.operationMayHaveExecuted).toBe(true);
    const original = JSON.parse(h.fetch.mock.calls[0][1].body);
    expect(error.requestId).toBe(original.request_id);
    expect(error.reconcile).toBeTypeOf('function');
    expect(Object.keys(error)).not.toContain('reconcile');
    expect(JSON.stringify(error)).not.toContain('synthetic-session-token-value');
    expect(scheduler.stats().active).toBe(1);
    const resumed = error.reconcile();
    expect(h.fetch).toHaveBeenCalledTimes(1);
    finish();
    await expect(resumed).resolves.toBe('synthetic response');
    await drainTimedOutAI(error);
    await vi.waitFor(() => expect(scheduler.stats().active).toBe(0));
    expect(h.native.integrations.Core.InvokeLLM).not.toHaveBeenCalled();
  });

  it('a normal repeated AI action resumes a late completed timeout instead of starting a paid replacement', async () => {
    let finish;
    const h = harness(() => new Promise(resolve => { finish = resolve; }));
    expect(h.gate.open(authority)).toBe(true);
    const error = await runWithRetry(() => h.client.integrations.Core.InvokeLLM({ prompt: 'same input' }),
      { timeoutMs: 5, retries: 0 }).catch(value => value);
    expect(error.code).toBe('AI_TIMEOUT');
    finish(); await drainTimedOutAI(error);
    await expect(h.client.integrations.Core.InvokeLLM({ prompt: 'same input' })).resolves.toBe('synthetic response');
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.native.integrations.Core.InvokeLLM).not.toHaveBeenCalled();
  });

  it('an explicit request reference cannot silently ignore changed retry parameters', async () => {
    let finish;
    const h = harness(() => new Promise(resolve => { finish = resolve; }));
    expect(h.gate.open(authority)).toBe(true);
    const error = await runWithRetry(() => h.client.integrations.Core.InvokeLLM({ prompt: 'original input' }),
      { timeoutMs: 5, retries: 0 }).catch(value => value);
    await expect(h.client.integrations.Core.InvokeLLM({ prompt: 'different input' }, { requestId: error.requestId }))
      .rejects.toMatchObject({ code: 'EXTERNAL_RECONCILIATION', retryable: false });
    expect(h.fetch).toHaveBeenCalledTimes(1);
    finish(); await drainTimedOutAI(error);
  });

  it('a retained timeout callback cannot cross a revoked realm or disclose late results', async () => {
    let finish;
    const h = harness(() => new Promise(resolve => { finish = resolve; }));
    expect(h.gate.open(authority)).toBe(true);
    const error = await runWithRetry(() => h.client.integrations.Core.InvokeLLM({ prompt: 'synthetic' }),
      { timeoutMs: 5, retries: 0 }).catch(value => value);
    expect(error.reconcile).toBeTypeOf('function');
    h.gate.close(); finish(); await drainTimedOutAI(error);
    expect(() => error.reconcile()).toThrow();
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });
});
