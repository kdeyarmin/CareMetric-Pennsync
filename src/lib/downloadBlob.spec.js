import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gate = vi.hoisted(() => ({
  lease: { id: 'lease-1' },
  capture: vi.fn(),
  assertCurrent: vi.fn(),
}));
vi.mock('@/lib/tenantSdkRealmGate', () => ({
  captureTenantSdkRealmLease: gate.capture,
  assertTenantSdkRealmLeaseCurrent: gate.assertCurrent,
}));

import { downloadAuthorityBoundBlob } from './downloadBlob';

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

let createObjectURL;
let revokeObjectURL;
let clickedAnchors;

function setNavigator({ userAgent, maxTouchPoints = 0, share, canShare }) {
  Object.defineProperty(window, 'navigator', {
    value: { userAgent, maxTouchPoints, share, canShare },
    configurable: true,
  });
}

beforeEach(() => {
  gate.capture.mockReset().mockReturnValue(gate.lease);
  gate.assertCurrent.mockReset();
  clickedAnchors = [];
  createObjectURL = vi.fn(() => 'blob:pennsync-test');
  revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
    clickedAnchors.push(this);
  });
  setNavigator({ userAgent: DESKTOP_UA });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('downloadAuthorityBoundBlob', () => {
  it('rejects a non-Blob and an unsafe filename before any dispatch', () => {
    expect(() => downloadAuthorityBoundBlob('nope', 'a.pdf')).toThrow(TypeError);
    expect(() => downloadAuthorityBoundBlob(new Blob(['x']), '  ')).toThrow(TypeError);
    expect(gate.capture).toHaveBeenCalledTimes(1);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('desktop: clicks a download anchor under the lease and returns true', () => {
    const result = downloadAuthorityBoundBlob(new Blob(['pdf'], { type: 'application/pdf' }), 'report.pdf');
    expect(result).toBe(true);
    expect(gate.capture).toHaveBeenCalledTimes(1);
    expect(gate.assertCurrent).toHaveBeenCalledWith(gate.lease);
    expect(clickedAnchors).toHaveLength(1);
    expect(clickedAnchors[0].getAttribute('download')).toBe('report.pdf');
    expect(clickedAnchors[0].getAttribute('href')).toBe('blob:pennsync-test');
  });

  it('does NOT revoke the object URL synchronously (Safari cancels the fetch)', () => {
    vi.useFakeTimers();
    downloadAuthorityBoundBlob(new Blob(['pdf'], { type: 'application/pdf' }), 'report.pdf');
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(59_999);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:pennsync-test');
  });

  it('iOS with file sharing: shares the File and never touches the anchor path', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    setNavigator({ userAgent: IOS_UA, maxTouchPoints: 5, share, canShare });
    const result = await downloadAuthorityBoundBlob(new Blob(['pdf'], { type: 'application/pdf' }), 'order.pdf');
    expect(result).toBe(true);
    expect(share).toHaveBeenCalledTimes(1);
    const payload = share.mock.calls[0][0];
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0].name).toBe('order.pdf');
    expect(payload.files[0].type).toBe('application/pdf');
    expect(clickedAnchors).toHaveLength(0);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('iOS share dismissed: resolves false (no success toast, no error)', async () => {
    const abort = new Error('dismissed');
    abort.name = 'AbortError';
    const share = vi.fn().mockRejectedValue(abort);
    setNavigator({ userAgent: IOS_UA, maxTouchPoints: 5, share, canShare: () => true });
    const result = await downloadAuthorityBoundBlob(new Blob(['pdf'], { type: 'application/pdf' }), 'order.pdf');
    expect(result).toBe(false);
    expect(clickedAnchors).toHaveLength(0);
  });

  it('iOS share refused (activation expired): rejects, with no anchor fallback', async () => {
    const refused = new Error('not allowed');
    refused.name = 'NotAllowedError';
    const share = vi.fn().mockRejectedValue(refused);
    setNavigator({ userAgent: IOS_UA, maxTouchPoints: 5, share, canShare: () => true });
    // No anchor fallback: the webviews this path exists for have no
    // blob-anchor download handler, so a fallback click would report a
    // delivery that never happened. The awaiting caller gets the error.
    await expect(
      downloadAuthorityBoundBlob(new Blob(['pdf'], { type: 'application/pdf' }), 'order.pdf'),
    ).rejects.toBe(refused);
    expect(clickedAnchors).toHaveLength(0);
  });

  it('iOS without file sharing: uses the anchor download path', () => {
    setNavigator({ userAgent: IOS_UA, maxTouchPoints: 5, share: undefined, canShare: undefined });
    const result = downloadAuthorityBoundBlob(new Blob(['pdf'], { type: 'application/pdf' }), 'order.pdf');
    expect(result).toBe(true);
    expect(clickedAnchors).toHaveLength(1);
  });

  it('aborts before dispatch when the tenant lease is no longer current', () => {
    gate.assertCurrent.mockImplementation(() => { throw new Error('lease stale'); });
    expect(() => downloadAuthorityBoundBlob(new Blob(['pdf']), 'report.pdf')).toThrow('lease stale');
    expect(clickedAnchors).toHaveLength(0);
  });
});
