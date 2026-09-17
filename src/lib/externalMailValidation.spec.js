import { expect, it, vi } from 'vitest';
import { EXTERNAL_INTEGRATION_APP, EXTERNAL_INTEGRATION_ORIGIN, readExternalIntegrationConfig,
  routeExternalCoreOperations, ExternalIntegrationError } from './externalIntegrationTransport';

it('malformed routed mail preserves the sanitized nonretryable external error contract before network work', async () => {
  const config = readExternalIntegrationConfig({ VITE_EXTERNAL_INTEGRATIONS: 'enabled-v2',
    VITE_EXTERNAL_INTEGRATION_ORIGIN: EXTERNAL_INTEGRATION_ORIGIN, VITE_EXTERNAL_INTEGRATION_OPERATIONS: 'SendEmail',
    VITE_EXTERNAL_INTEGRATION_REVISION: 'a'.repeat(40) }, EXTERNAL_INTEGRATION_APP);
  const fetcher = vi.fn(); const native = vi.fn(); const lease = {};
  const client = routeExternalCoreOperations({ integrations: { Core: { SendEmail: native } } }, config, {
    fetcher, captureLease: () => lease, assertLeaseCurrent: () => {}, getLeaseSignal: () => new AbortController().signal,
    getSession: () => ({ token: 'synthetic-session-token-value', context: { user_id: 'user-a', agency_id: 'agency-a',
      membership_id: 'member-a', membership_version: 1, tenant_role: 'agency_admin', is_platform_owner: false } }),
  });
  for (const to of [null, undefined, 'invalid', [], ['invalid']]) {
    const params = { subject: 'test', body: 'test', content_type: 'text/html' };
    if (to !== undefined) params.to = to;
    const error = await client.integrations.Core.SendEmail(params).catch(value => value);
    expect(error).toBeInstanceOf(ExternalIntegrationError);
    expect(error).toMatchObject({ code: 'EXTERNAL_INVALID_INPUT', retryable: false, operationMayHaveExecuted: false, requestId: null });
    expect(error.message).toBe('This request is not supported by the external integration.');
  }
  expect(fetcher).not.toHaveBeenCalled(); expect(native).not.toHaveBeenCalled();
});
