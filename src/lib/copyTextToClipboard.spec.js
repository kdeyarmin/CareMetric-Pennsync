import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { notifyError } = vi.hoisted(() => ({ notifyError: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: notifyError } }));

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
let writeText;
let removeGuard;
let copyTextToClipboard, installAuthorityBoundClipboard, openTenantSdkRealm, poisonTenantSdkRealm, rotateBrowserAuthorityEpoch;
beforeEach(async () => {
  vi.resetModules();
  ({ copyTextToClipboard } = await import('./copyTextToClipboard'));
  ({ installAuthorityBoundClipboard } = await import('./authorityBoundClipboard'));
  ({ openTenantSdkRealm, poisonTenantSdkRealm } = await import('./tenantSdkRealmGate'));
  ({ rotateBrowserAuthorityEpoch } = await import('./browserAuthorityEpoch'));
  writeText = vi.fn();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  notifyError.mockReset();
});
afterEach(() => {
  removeGuard?.();
  removeGuard = undefined;
  poisonTenantSdkRealm();
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else delete navigator.clipboard;
});

describe('copy confirmation through the native authority guard', () => {
  it('confirms a successful write without changing the copied text', async () => {
    writeText.mockResolvedValue(undefined);
    removeGuard = installAuthorityBoundClipboard();
    expect(openTenantSdkRealm('synthetic-authority')).toBe(true);
    await expect(copyTextToClipboard('Synthetic documentation.')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledExactlyOnceWith('Synthetic documentation.');
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('handles a missing clipboard API without a fallback sink', async () => {
    delete navigator.clipboard;
    await expect(copyTextToClipboard('Synthetic documentation.')).resolves.toBe(false);
    expect(notifyError).toHaveBeenCalledExactlyOnceWith('Could not copy to clipboard. Please try again.');
  });

  it.each(['throw', 'reject'])('handles native %s without exposing error or clipboard details', async failure => {
    const error = new Error('Synthetic private native error');
    writeText.mockImplementation(() => {
      if (failure === 'throw') throw error;
      return Promise.reject(error);
    });
    await expect(copyTextToClipboard('Synthetic private text')).resolves.toBe(false);
    expect(notifyError).toHaveBeenCalledExactlyOnceWith('Could not copy to clipboard. Please try again.');
  });

  it('keeps a synchronous authority denial from reaching the native clipboard', async () => {
    removeGuard = installAuthorityBoundClipboard();
    await expect(copyTextToClipboard('Synthetic documentation.')).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
    expect(notifyError).toHaveBeenCalledTimes(1);
  });

  it('does not confirm a delayed write after the workspace authority changes', async () => {
    let finish;
    writeText.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    removeGuard = installAuthorityBoundClipboard();
    expect(openTenantSdkRealm('synthetic-authority')).toBe(true);
    const result = copyTextToClipboard('Synthetic documentation.');
    rotateBrowserAuthorityEpoch();
    finish();
    await expect(result).resolves.toBe(false);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(notifyError).toHaveBeenCalledTimes(1);
  });
});
