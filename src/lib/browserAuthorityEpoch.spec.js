import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TENANT_BROWSER_AUTHORITY_EPOCH_KEY,
  TENANT_BROWSER_AUTHORITY_REVOCATION_PREFIX,
  browserAuthorityEpochMatches,
  ensureBrowserAuthorityEpoch,
  invalidateBrowserAuthorityEpoch,
  isBrowserAuthorityEpochStorageKey,
  readBrowserAuthorityEpoch,
  rotateBrowserAuthorityEpoch,
} from '@/lib/browserAuthorityEpoch';

describe('shared browser authority epoch', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('revokes the pinned epoch without replacing a newer tab epoch', () => {
    const first = ensureBrowserAuthorityEpoch();
    expect(browserAuthorityEpochMatches(first)).toBe(true);

    invalidateBrowserAuthorityEpoch(first);
    expect(readBrowserAuthorityEpoch()).toBe(first);
    expect(browserAuthorityEpochMatches(first)).toBe(false);

    const second = rotateBrowserAuthorityEpoch();
    expect(second).not.toBe(first);
    invalidateBrowserAuthorityEpoch(first);
    expect(readBrowserAuthorityEpoch()).toBe(second);
    expect(browserAuthorityEpochMatches(second)).toBe(true);
  });

  it('classifies only current-pointer and real revocation storage events', () => {
    expect(isBrowserAuthorityEpochStorageKey(TENANT_BROWSER_AUTHORITY_EPOCH_KEY)).toBe(true);
    expect(isBrowserAuthorityEpochStorageKey(
      `${TENANT_BROWSER_AUTHORITY_REVOCATION_PREFIX}epoch-a`,
    )).toBe(true);
    expect(isBrowserAuthorityEpochStorageKey(
      'pennsync_tenant_browser_authority_probe_v1:epoch-a',
    )).toBe(false);
  });

  it('fails closed when shared storage silently declines persistence', () => {
    const fakeStorage = {
      getItem: vi.fn(() => null),
      removeItem: vi.fn(),
      setItem: vi.fn(),
    };
    vi.spyOn(window, 'localStorage', 'get').mockReturnValue(fakeStorage);

    expect(() => rotateBrowserAuthorityEpoch()).toThrow(/shared browser authority storage/i);
  });

  it('never restores a stale epoch when another tab rotates during the writability probe', () => {
    const values = new Map([[TENANT_BROWSER_AUTHORITY_EPOCH_KEY, 'epoch-a']]);
    const fakeStorage = {
      getItem: vi.fn((key) => values.get(key) ?? null),
      removeItem: vi.fn((key) => values.delete(key)),
      setItem: vi.fn((key, value) => {
        values.set(key, value);
        if (key.startsWith('pennsync_tenant_browser_authority_probe_v1:')) {
          values.set(TENANT_BROWSER_AUTHORITY_EPOCH_KEY, 'epoch-b');
        }
      }),
    };
    vi.spyOn(window, 'localStorage', 'get').mockReturnValue(fakeStorage);

    expect(() => ensureBrowserAuthorityEpoch()).toThrow(/shared browser authority storage/i);
    expect(values.get(TENANT_BROWSER_AUTHORITY_EPOCH_KEY)).toBe('epoch-b');
    expect(fakeStorage.setItem).not.toHaveBeenCalledWith(
      TENANT_BROWSER_AUTHORITY_EPOCH_KEY,
      'epoch-a',
    );
  });

  it('does not erase a revocation observed immediately after publishing a new epoch', () => {
    const values = new Map([[TENANT_BROWSER_AUTHORITY_EPOCH_KEY, 'epoch-a']]);
    const fakeStorage = {
      getItem: vi.fn((key) => values.get(key) ?? null),
      removeItem: vi.fn((key) => values.delete(key)),
      setItem: vi.fn((key, value) => {
        values.set(key, value);
        if (key === TENANT_BROWSER_AUTHORITY_EPOCH_KEY) {
          values.set(`${TENANT_BROWSER_AUTHORITY_REVOCATION_PREFIX}${value}`, '1');
        }
      }),
    };
    vi.spyOn(window, 'localStorage', 'get').mockReturnValue(fakeStorage);

    const next = rotateBrowserAuthorityEpoch();

    expect(values.get(`${TENANT_BROWSER_AUTHORITY_REVOCATION_PREFIX}${next}`)).toBe('1');
    expect(browserAuthorityEpochMatches(next)).toBe(false);
  });

  it('fails closed when a browser blocks access to shared storage', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });

    expect(() => ensureBrowserAuthorityEpoch()).toThrow(/shared browser authority storage/i);
  });

  it('reports a live epoch stale instead of throwing if storage access disappears', () => {
    const epoch = ensureBrowserAuthorityEpoch();
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });

    expect(browserAuthorityEpochMatches(epoch)).toBe(false);
  });
});
