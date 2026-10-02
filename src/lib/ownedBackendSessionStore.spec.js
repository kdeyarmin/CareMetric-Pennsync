// The only thing an owned build keeps on the device, and the least trusted place
// the app reads from: whatever is in this key was last written by this browser,
// which is not the same as by this app.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  OWNED_SESSION_STORAGE_KEY as KEY, clearStoredOwnedSession, createOwnedSessionPort,
  storedOwnedSessionEmail,
} from '@/lib/ownedBackendSessionStore';

const EMAIL = 'nurse@agency.example';
const TOKEN = 'refresh-token-value';
const record = (overrides = {}) => JSON.stringify({ v: 1, email: EMAIL, refresh_token: TOKEN, ...overrides });

describe('the device record', () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { localStorage.clear(); });

  it('keeps the address and the rotated token, and nothing else', () => {
    expect(createOwnedSessionPort(EMAIL).write(TOKEN)).toBe(true);
    expect(JSON.parse(localStorage.getItem(KEY))).toEqual({ v: 1, email: EMAIL, refresh_token: TOKEN });
    expect(storedOwnedSessionEmail()).toBe(EMAIL);
    expect(createOwnedSessionPort(EMAIL).read()).toBe(TOKEN);
  });

  it('normalises the address it is keyed on, as the sign-in form does', () => {
    createOwnedSessionPort('  Nurse@Agency.Example ').write(TOKEN);
    expect(storedOwnedSessionEmail()).toBe(EMAIL);
    expect(createOwnedSessionPort(EMAIL).read()).toBe(TOKEN);
  });

  it('answers nobody else, so a client for one address cannot resume another', () => {
    createOwnedSessionPort(EMAIL).write(TOKEN);
    expect(createOwnedSessionPort('someone.else@agency.example').read()).toBeNull();
  });

  it('removes a record that is not exactly a record, rather than reading part of it', () => {
    // Honouring part of a record somebody else wrote is how a stored session
    // becomes an injected one, so an unknown field is a refusal and not something
    // to ignore. Each case is also REMOVED: leaving it would let it sit here until
    // something else happened to clear it.
    for (const value of [
      'not json', '', '[]', 'null', '"string"',
      record({ v: 2 }),
      record({ extra: 'field' }),
      JSON.stringify({ v: 1, email: EMAIL }),
      record({ email: 'Nurse@Agency.Example' }),
      record({ email: 'no-at-sign' }),
      record({ email: `${'a'.repeat(330)}@b.example` }),
      record({ refresh_token: 'short' }),
      record({ refresh_token: 'has space in it' }),
      record({ refresh_token: 'a'.repeat(513) }),
      record({ refresh_token: 42 }),
      // An access token is not a thing this record can hold under any name, and a
      // record carrying one was not written by this module.
      record({ access_token: 'a.b.c' }),
      `${'a'.repeat(4097)}`,
    ]) {
      localStorage.setItem(KEY, value);
      expect(storedOwnedSessionEmail()).toBeNull();
      expect(localStorage.getItem(KEY)).toBeNull();
    }
  });

  it('writes nothing when there is nothing usable to keep', () => {
    const port = createOwnedSessionPort(EMAIL);
    port.write(TOKEN);
    for (const value of [null, undefined, '', 'short', 'has space', 42, {}]) {
      expect(port.write(value)).toBe(false);
      // A stale record beside a session the app cannot resume is a credential for a
      // session nothing is tracking, so the old value goes rather than surviving.
      expect(localStorage.getItem(KEY)).toBeNull();
      port.write(TOKEN);
    }
  });

  it('clears unconditionally, including somebody else`s record', () => {
    createOwnedSessionPort(EMAIL).write(TOKEN);
    createOwnedSessionPort('someone.else@agency.example').clear();
    expect(localStorage.getItem(KEY)).toBeNull();
    // And clearing nothing is not an error, because every sign-out reaches here.
    expect(() => clearStoredOwnedSession()).not.toThrow();
  });

  it('survives a browser that refuses storage, because signing in each time still works', () => {
    const own = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('denied', 'SecurityError'); },
    });
    try {
      const port = createOwnedSessionPort(EMAIL);
      expect(storedOwnedSessionEmail()).toBeNull();
      expect(port.read()).toBeNull();
      expect(port.write(TOKEN)).toBe(false);
      expect(() => port.clear()).not.toThrow();
    } finally {
      if (own) Object.defineProperty(window, 'localStorage', own);
      else delete window.localStorage;
    }
  });
});
