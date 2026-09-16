import { beforeEach, describe, expect, it, vi } from 'vitest';
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
