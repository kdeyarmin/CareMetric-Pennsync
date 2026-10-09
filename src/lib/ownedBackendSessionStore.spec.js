// The only thing an owned build keeps on the device, and the least trusted place
// the app reads from: whatever is in this key was last written by this browser,
// which is not the same as by this app.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  OWNED_SESSION_STORAGE_KEY as KEY, clearStoredOwnedSession, createOwnedSessionPort,
  ownedSessionEventChangesIdentity, storedOwnedSessionEmail,
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

  it('forgets only what it spent, so a losing tab leaves the winner signed in', () => {
    // The two-tab boot a reviewer measured. Both tabs read the same record, one
    // exchanges it and writes the rotated token, and the loser is refused. The
    // loser's clean-up must take its OWN spent token and nothing else: with an
    // unconditional clear the winner's record went, the provider still honoured it
    // and the next boot asked for a password anyway.
    const port = createOwnedSessionPort(EMAIL);
    port.write(TOKEN);
    const rotated = 'rotated-token-aaaa';
    port.write(rotated);
    expect(port.clearSpent(TOKEN)).toBe(false);
    expect(port.read()).toBe(rotated);
    // What it did spend goes, and saying so is the point: the caller that wrote a
    // record of its own wants to know this did not take it away.
    expect(port.clearSpent(rotated)).toBe(true);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(port.clearSpent(rotated)).toBe(false);
  });

  it('will not let one address`s spent token forget another`s record', () => {
    // `clear` is deliberately unconditional and `clearSpent` deliberately is not,
    // so the address is checked here as well as the token.
    createOwnedSessionPort(EMAIL).write(TOKEN);
    expect(createOwnedSessionPort('someone.else@agency.example').clearSpent(TOKEN)).toBe(false);
    expect(localStorage.getItem(KEY)).not.toBeNull();
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

describe('which storage events change who this browser is', () => {
  it('a same-address write readRecord would REJECT is a removal, not a rotation', () => {
    const old = record();
    for (const bad of [
      record({ scope: 'all' }),
      record({ refresh_token: 'short' }),
      record({ v: 2 }),
      record({ email: 'Nurse@Agency.example' }),
    ]) {
      expect(ownedSessionEventChangesIdentity({ key: KEY, oldValue: old, newValue: bad })).toBe(true);
    }
  });

  const rec = (email, token) => JSON.stringify({ v: 1, email, refresh_token: token });
  it('a rotation for the same address does not', () => {
    expect(ownedSessionEventChangesIdentity({ oldValue: rec(EMAIL, 'a-token-12345'), newValue: rec(EMAIL, 'b-token-12345') })).toBe(false);
  });
  it('a removal, an appearance and another address all do', () => {
    expect(ownedSessionEventChangesIdentity({ oldValue: rec(EMAIL, 'a-token-12345'), newValue: null })).toBe(true);
    expect(ownedSessionEventChangesIdentity({ oldValue: null, newValue: rec(EMAIL, 'a-token-12345') })).toBe(true);
    expect(ownedSessionEventChangesIdentity({ oldValue: rec(EMAIL, 'a-token-12345'), newValue: rec('x@agency.example', 'b-token-12345') })).toBe(true);
  });
  it('anything unreadable fails toward closing', () => {
    expect(ownedSessionEventChangesIdentity({ oldValue: 'junk', newValue: 'junk' })).toBe(true);
    expect(ownedSessionEventChangesIdentity({})).toBe(true);
  });
});
