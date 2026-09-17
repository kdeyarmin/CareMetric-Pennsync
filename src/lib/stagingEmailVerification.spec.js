// @vitest-environment-options {"url":"https://caremetric-pennsync-staging-2026-09-d54f1ef7.base44.app"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isStagingEmailVerificationAvailable, verifyStagingEmail } from './stagingEmailVerification';

const appId = '6a9881683dc68a0bd54f1ef7';
const origin = 'https://caremetric-pennsync-staging-2026-09-d54f1ef7.base44.app';
const input = { email: ' test@example.com ', code: '123456' };
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv('VITE_BASE44_APP_ID', appId);
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('staging native email verification boundary', () => {
  it.each(['694ec16e72e01b60d22f7cbf', '', undefined])('blocks non-staging build identity %s even on staging', async (identity) => {
    vi.stubEnv('VITE_BASE44_APP_ID', identity);
    expect(isStagingEmailVerificationAvailable()).toBe(false);
    await expect(verifyStagingEmail(input)).rejects.toThrow('only available in staging');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['https://app.caremetricai.com', 'http://localhost:5173', `${origin}.example.com`, 'http://caremetric-pennsync-staging-2026-09-d54f1ef7.base44.app'])('blocks mismatched host %s', async (wrongOrigin) => {
    vi.stubGlobal('location', { origin: wrongOrigin });
    expect(isStagingEmailVerificationAvailable()).toBe(false);
    await expect(verifyStagingEmail(input)).rejects.toThrow('only available in staging');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks embedded screens', async () => {
    vi.stubGlobal('top', {});
    await expect(verifyStagingEmail(input)).rejects.toThrow('only available in staging');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed when frame inspection is denied instead of breaking sign-in', async () => {
    vi.stubGlobal('top', {});
    Object.defineProperty(globalThis, 'top', {
      configurable: true,
      get() { throw new DOMException('Frame access denied', 'SecurityError'); },
    });
    expect(isStagingEmailVerificationAvailable()).toBe(false);
    await expect(verifyStagingEmail(input)).rejects.toThrow('only available in staging');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { email: 'not-an-email', code: '123456' },
    { email: 'test@example.com', code: '12345' },
    { email: 'test@example.com', code: 'abcdef' },
    { email: 'test@example.com', code: '1234567' },
    { email: 'test@example.com', code: 123456 },
  ])('rejects invalid input before network I/O (%j)', async (invalid) => {
    await expect(verifyStagingEmail(invalid)).rejects.toThrow('six-digit');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses only the fixed native endpoint, omits credentials, and discards the returned token', async () => {
    history.replaceState({}, '', '?app_id=production&server_url=https://attacker.example');
    localStorage.setItem('base44_access_token', 'existing-session');
    const storedBefore = { ...localStorage };
    const log = vi.spyOn(console, 'log');
    const error = vi.spyOn(console, 'error');
    const postMessage = vi.spyOn(window, 'postMessage');
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ access_token: 'discard-this-token' }) });
    const controller = new AbortController();
    expect(isStagingEmailVerificationAvailable()).toBe(true);
    await expect(verifyStagingEmail({ ...input, signal: controller.signal })).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`https://base44.app/api/apps/${appId}/auth/verify-otp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-App-Id': appId },
      body: JSON.stringify({ email: 'test@example.com', otp_code: '123456' }),
      credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error', signal: controller.signal,
    });
    expect({ ...localStorage }).toEqual(storedBefore);
    expect(sessionStorage.length).toBe(0);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
    history.replaceState({}, '', '/');
  });

  it.each([400, 401, 403, 422, 429, 500])('never exposes error response content (HTTP %s)', async (status) => {
    const json = vi.fn(async () => ({ message: 'sensitive-code-or-token' }));
    fetchMock.mockResolvedValue({ ok: false, status, json });
    await expect(verifyStagingEmail(input)).rejects.not.toThrow('sensitive-code-or-token');
    expect(json).not.toHaveBeenCalled();
  });

  it.each([{}, { access_token: '' }, { access_token: 42 }])('does not claim verification from an ambiguous response', async (body) => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => body });
    await expect(verifyStagingEmail(input)).rejects.toThrow('could not be confirmed');
  });
});
