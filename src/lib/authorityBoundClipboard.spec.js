import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('authority-bound clipboard', () => {
  let installAuthorityBoundClipboard;
  let openTenantSdkRealm;
  let rotateBrowserAuthorityEpoch;

  beforeEach(async () => {
    localStorage.clear();
    vi.resetModules();
    ({ openTenantSdkRealm } = await import('@/lib/tenantSdkRealmGate'));
    ({ rotateBrowserAuthorityEpoch } = await import('@/lib/browserAuthorityEpoch'));
    ({ installAuthorityBoundClipboard } = await import('@/lib/authorityBoundClipboard'));
  });

  it('does not invoke the native clipboard outside a tenant realm', () => {
    const nativeWriteText = vi.fn();
    const clipboard = { writeText: nativeWriteText };
    installAuthorityBoundClipboard(clipboard);

    expect(() => clipboard.writeText('private text')).toThrow(/workspace authority/i);
    expect(nativeWriteText).not.toHaveBeenCalled();
  });

  it('allows a current user-initiated copy and blocks a queued stale copy', async () => {
    const nativeWriteText = vi.fn().mockResolvedValue(undefined);
    const clipboard = { writeText: nativeWriteText };
    installAuthorityBoundClipboard(clipboard);
    expect(openTenantSdkRealm('authority-a')).toBe(true);

    await expect(clipboard.writeText('current text')).resolves.toBeUndefined();
    rotateBrowserAuthorityEpoch();
    expect(() => clipboard.writeText('stale text')).toThrow(/workspace authority/i);
    expect(nativeWriteText).toHaveBeenCalledTimes(1);
  });

  it('fails installation closed when a present clipboard method is immutable', () => {
    const clipboard = {};
    Object.defineProperty(clipboard, 'writeText', {
      configurable: false,
      value: vi.fn(),
      writable: false,
    });

    expect(installAuthorityBoundClipboard(clipboard)).toBeNull();
  });
});
