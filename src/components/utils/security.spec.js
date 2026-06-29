import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RateLimiter,
  SessionManager,
  isSafeExternalUrl,
  secureRandomInt,
  generateSecureToken,
  generateSecurePassword,
} from './security';

describe('secureRandomInt', () => {
  it('returns an integer in [0, max)', () => {
    for (let i = 0; i < 500; i++) {
      const n = secureRandomInt(10);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(10);
    }
  });

  it('covers the full range over many samples (no off-by-one truncation)', () => {
    const seen = new Set();
    for (let i = 0; i < 2000; i++) seen.add(secureRandomInt(5));
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('rejects a non-positive, non-integer, or out-of-range max (no infinite loop)', () => {
    expect(() => secureRandomInt(0)).toThrow();
    expect(() => secureRandomInt(-1)).toThrow();
    expect(() => secureRandomInt(2.5)).toThrow();
    // max > 2^32-1 would make the rejection-sampling limit floor to 0 → infinite
    // loop; it must fail fast instead.
    expect(() => secureRandomInt(0x100000000)).toThrow();
    expect(() => secureRandomInt(2 ** 40)).toThrow();
  });
});

describe('generateSecureToken', () => {
  it('produces a URL-safe token of the requested length', () => {
    const t = generateSecureToken(32);
    expect(t).toHaveLength(32);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(generateSecureToken(16)).toHaveLength(16);
  });

  it('is effectively unique across calls (high entropy)', () => {
    const tokens = new Set();
    for (let i = 0; i < 1000; i++) tokens.add(generateSecureToken(32));
    expect(tokens.size).toBe(1000);
  });
});

describe('generateSecurePassword', () => {
  it('has the requested length and one char from each class', () => {
    for (let i = 0; i < 50; i++) {
      const pw = generateSecurePassword(12);
      expect(pw).toHaveLength(12);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[0-9]/);
      expect(pw).toMatch(/[!@#$%^&*]/);
    }
  });

  it('does not repeat across calls', () => {
    const pws = new Set();
    for (let i = 0; i < 200; i++) pws.add(generateSecurePassword(12));
    expect(pws.size).toBe(200);
  });
});

describe('isSafeExternalUrl', () => {
  it('accepts http and https URLs', () => {
    expect(isSafeExternalUrl('https://cms.gov/guideline')).toBe(true);
    expect(isSafeExternalUrl('http://example.com/x')).toBe(true);
  });

  it('accepts site- and protocol-relative URLs', () => {
    expect(isSafeExternalUrl('/Patients')).toBe(true);
    expect(isSafeExternalUrl('//cdn.example.com/a.png')).toBe(true);
  });

  it('rejects dangerous schemes (XSS via href)', () => {
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('JavaScript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
    expect(isSafeExternalUrl('vbscript:msgbox(1)')).toBe(false);
  });

  it('rejects empty / non-string input', () => {
    expect(isSafeExternalUrl('')).toBe(false);
    expect(isSafeExternalUrl('   ')).toBe(false);
    expect(isSafeExternalUrl(null)).toBe(false);
    expect(isSafeExternalUrl(undefined)).toBe(false);
    expect(isSafeExternalUrl(42)).toBe(false);
  });
});

describe('RateLimiter', () => {
  it('enforces the limit per key', () => {
    const limiter = new RateLimiter(2, 60000);
    expect(limiter.canMakeRequest('alice')).toBe(true);
    expect(limiter.canMakeRequest('alice')).toBe(true);
    // Third call for the same key in-window is blocked.
    expect(limiter.canMakeRequest('alice')).toBe(false);
  });

  it('isolates keys: one user hitting the cap does not reset another user', () => {
    // Regression test: previously the cleanup filter dropped every other key's
    // in-window history, so any call from a second user reset the first user's
    // count to zero on the shared limiter — bypassing the per-user limit.
    const limiter = new RateLimiter(2, 60000);

    expect(limiter.canMakeRequest('alice')).toBe(true);
    expect(limiter.canMakeRequest('alice')).toBe(true);
    expect(limiter.canMakeRequest('alice')).toBe(false); // alice is capped

    // Bob making a call must NOT clear alice's tracked history.
    expect(limiter.canMakeRequest('bob')).toBe(true);

    // Alice is still capped after bob's activity.
    expect(limiter.canMakeRequest('alice')).toBe(false);
  });

  it('frees a key once its requests age out of the window', () => {
    vi.useFakeTimers();
    try {
      const limiter = new RateLimiter(1, 1000);
      expect(limiter.canMakeRequest('alice')).toBe(true);
      expect(limiter.canMakeRequest('alice')).toBe(false);
      vi.advanceTimersByTime(1001);
      expect(limiter.canMakeRequest('alice')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('SessionManager activity listeners', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stopMonitoring detaches activity listeners so they stop re-arming timers', () => {
    const onTimeout = vi.fn();
    const onWarning = vi.fn();
    const mgr = new SessionManager(15);

    const resetSpy = vi.spyOn(mgr, 'resetTimeout');
    mgr.startMonitoring(onTimeout, onWarning);
    resetSpy.mockClear(); // ignore the initial reset from startMonitoring

    // Activity fires resetTimeout while monitoring.
    window.dispatchEvent(new Event('click'));
    expect(resetSpy).toHaveBeenCalledTimes(1);

    // After stopMonitoring, the listener must be gone (no further resets).
    mgr.stopMonitoring();
    resetSpy.mockClear();
    window.dispatchEvent(new Event('click'));
    expect(resetSpy).not.toHaveBeenCalled();
  });

  it('repeated startMonitoring does not stack duplicate listeners', () => {
    const mgr = new SessionManager(15);
    mgr.startMonitoring(vi.fn(), vi.fn());
    mgr.startMonitoring(vi.fn(), vi.fn());

    const resetSpy = vi.spyOn(mgr, 'resetTimeout');
    window.dispatchEvent(new Event('click'));
    // Exactly one handler should be attached, not two.
    expect(resetSpy).toHaveBeenCalledTimes(1);

    mgr.stopMonitoring();
  });
});
