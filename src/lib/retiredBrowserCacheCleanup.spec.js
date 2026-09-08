import { describe, expect, it, vi } from 'vitest';

import { retireLegacyBrowserCaches } from './retiredBrowserCacheCleanup';

describe('retired browser cache cleanup', () => {
  it('unregisters every unsupported worker and deletes only retired offline caches', async () => {
    const firstUnregister = vi.fn(async () => true);
    const secondUnregister = vi.fn(async () => true);
    const cacheDelete = vi.fn(async () => true);

    const result = await retireLegacyBrowserCaches({
      navigatorRef: {
        serviceWorker: {
          getRegistrations: async () => [
            { unregister: firstUnregister },
            { unregister: secondUnregister },
          ],
        },
      },
      cachesRef: {
        keys: async () => ['base44-offline-v1', 'base44-offline-shell', 'current-assets'],
        delete: cacheDelete,
      },
    });

    expect(firstUnregister).toHaveBeenCalledOnce();
    expect(secondUnregister).toHaveBeenCalledOnce();
    expect(cacheDelete.mock.calls).toEqual([
      ['base44-offline-v1'],
      ['base44-offline-shell'],
    ]);
    expect(result).toMatchObject({
      registrationsFound: 2,
      registrationsRemoved: 2,
      cachesFound: 2,
      cachesRemoved: 2,
      errors: [],
    });
  });

  it('reports blocked cleanup without touching clinical storage or rejecting startup', async () => {
    const error = new Error('blocked');
    const result = await retireLegacyBrowserCaches({
      navigatorRef: {
        serviceWorker: {
          getRegistrations: async () => [{ unregister: async () => { throw error; } }],
        },
      },
      cachesRef: {
        keys: async () => ['base44-offline-v1'],
        delete: async () => false,
      },
    });

    expect(result.registrationsRemoved).toBe(0);
    expect(result.cachesRemoved).toBe(0);
    expect(result.errors).toEqual([error]);
  });
});
