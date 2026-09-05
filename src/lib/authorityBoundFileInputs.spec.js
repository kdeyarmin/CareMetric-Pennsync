import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('authority-bound native file inputs', () => {
  let removeGuard;
  let openTenantSdkRealm;
  let poisonTenantSdkRealm;
  let rotateBrowserAuthorityEpoch;

  beforeEach(async () => {
    vi.resetModules();
    ({ rotateBrowserAuthorityEpoch } = await import('@/lib/browserAuthorityEpoch'));
    ({ openTenantSdkRealm, poisonTenantSdkRealm } = await import('@/lib/tenantSdkRealmGate'));
    const { installAuthorityBoundFileInputGuard } = await import(
      '@/lib/authorityBoundFileInputs'
    );
    removeGuard = installAuthorityBoundFileInputGuard(document);
  });

  afterEach(() => {
    removeGuard?.();
    poisonTenantSdkRealm();
    document.body.replaceChildren();
  });

  it('blocks file-picker activation without an open tenant realm', () => {
    const input = document.createElement('input');
    input.type = 'file';
    document.body.appendChild(input);
    const handler = vi.fn();
    input.addEventListener('click', handler);

    const allowed = input.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(allowed).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('allows a selection only for the exact realm that launched its picker', () => {
    expect(openTenantSdkRealm('authority-a')).toBe(true);
    const input = document.createElement('input');
    input.type = 'file';
    document.body.appendChild(input);
    const changeHandler = vi.fn();
    input.addEventListener('change', changeHandler);

    input.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

    expect(changeHandler).toHaveBeenCalledTimes(1);
  });

  it('blocks the queued selection synchronously after a cross-tab epoch rotation', () => {
    expect(openTenantSdkRealm('authority-a')).toBe(true);
    const input = document.createElement('input');
    input.type = 'file';
    document.body.appendChild(input);
    const changeHandler = vi.fn();
    input.addEventListener('change', changeHandler);

    input.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    rotateBrowserAuthorityEpoch();
    const allowed = input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

    expect(allowed).toBe(false);
    expect(changeHandler).not.toHaveBeenCalled();
  });

  it('rejects an unleased change even while a tenant realm is open', () => {
    expect(openTenantSdkRealm('authority-a')).toBe(true);
    const input = document.createElement('input');
    input.type = 'file';
    document.body.appendChild(input);
    const changeHandler = vi.fn();
    input.addEventListener('change', changeHandler);

    input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

    expect(changeHandler).not.toHaveBeenCalled();
  });
});
