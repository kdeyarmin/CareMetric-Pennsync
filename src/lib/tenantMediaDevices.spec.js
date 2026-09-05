import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeTenantSdkRealm, openTenantSdkRealm } from './tenantSdkRealmGate';
import { getAuthorityBoundUserMedia } from './tenantMediaDevices';

describe('authority-bound media acquisition', () => {
  afterEach(() => {
    closeTenantSdkRealm();
    vi.unstubAllGlobals();
  });

  it('stops a permission result that arrives after the tenant realm closes', async () => {
    openTenantSdkRealm('media-authority');
    let grant;
    const stop = vi.fn();
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(() => new Promise((resolve) => { grant = resolve; })),
      },
    });

    const pending = getAuthorityBoundUserMedia({ audio: true });
    closeTenantSdkRealm();
    grant({ getTracks: () => [{ stop }] });

    await expect(pending).rejects.toMatchObject({ code: 'STALE_TENANT_SDK_OPERATION' });
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
