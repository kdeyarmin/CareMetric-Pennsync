import { beforeEach, describe, expect, it, vi } from 'vitest';

// The asynchronous delivery contract of downloadCsv: on platforms where the
// shared download helper delivers via a Promise (the iOS share path), the
// wrapper returns a Promise for the same boolean, routes rejections to
// onError, and never rejects itself — so awaiting callers see the settled
// result and fire-and-forget callers cannot produce an unhandled rejection.
vi.mock('@/lib/downloadBlob', () => ({
  downloadAuthorityBoundBlob: vi.fn(),
}));

import { downloadAuthorityBoundBlob } from '@/lib/downloadBlob';
import { downloadCsv } from '@/lib/downloadCsv';

describe('downloadCsv asynchronous delivery', () => {
  beforeEach(() => {
    vi.mocked(downloadAuthorityBoundBlob).mockReset();
  });

  it('resolves true when asynchronous delivery succeeds', async () => {
    vi.mocked(downloadAuthorityBoundBlob).mockResolvedValue(true);
    await expect(downloadCsv('a.csv', 'x,y')).resolves.toBe(true);
  });

  it('resolves false on share dismissal WITHOUT calling onError', async () => {
    const onError = vi.fn();
    vi.mocked(downloadAuthorityBoundBlob).mockResolvedValue(false);
    await expect(downloadCsv('a.csv', 'x,y', { onError })).resolves.toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  it('resolves false and routes an asynchronous failure to onError', async () => {
    const failure = new Error('share failed');
    const onError = vi.fn();
    vi.mocked(downloadAuthorityBoundBlob).mockRejectedValue(failure);
    await expect(downloadCsv('a.csv', 'x,y', { onError })).resolves.toBe(false);
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('keeps the synchronous contract when delivery is synchronous', () => {
    vi.mocked(downloadAuthorityBoundBlob).mockReturnValue(true);
    expect(downloadCsv('a.csv', 'x,y')).toBe(true);
  });
});
