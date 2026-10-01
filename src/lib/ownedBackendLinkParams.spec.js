// The least trusted input the app takes: a URL somebody arrived on.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LINK_TYPES, readLinkParams } from '@/lib/ownedBackendLinkParams';

describe('reading an invitation or recovery link', () => {
  it('reads only the two kinds it can act on', () => {
    expect(LINK_TYPES).toEqual(['invite', 'recovery']);
    for (const type of LINK_TYPES) {
      expect(readLinkParams(`?type=${type}&token=abcdef123456`)).toEqual({ type, token: 'abcdef123456' });
    }
    // `magiclink` and `signup` would each be a way to a session with no password
    // and `email_change` moves the address the target is built around, so none of
    // them is a link this app reads -- the client refuses them too, and this is
    // what keeps a SCREEN from appearing for one.
    for (const type of ['magiclink', 'signup', 'email_change', 'invite ', 'INVITE', '']) {
      expect(readLinkParams(`?type=${type}&token=abcdef123456`)).toBeNull();
    }
  });

  it('refuses a token it could not use, so no screen asks for a password first', () => {
    for (const token of ['', 'abc', 'a'.repeat(513), 'has space', '../../etc/passwd', 'semi;colon']) {
      expect(readLinkParams(`?type=invite&token=${encodeURIComponent(token)}`)).toBeNull();
    }
    expect(readLinkParams('?type=invite')).toBeNull();
    expect(readLinkParams('')).toBeNull();
    expect(readLinkParams(undefined)).toBeNull();
    expect(readLinkParams(null)).toBeNull();
  });

  it('carries no address, so a forwarded link names nobody', () => {
    const link = readLinkParams('?type=invite&token=abcdef123456&email=nurse%40agency.example');
    expect(link).toEqual({ type: 'invite', token: 'abcdef123456' });
    expect(Object.keys(link)).toEqual(['type', 'token']);
  });
});

describe('scrubbing the link out of the live URL', () => {
  afterEach(() => { vi.resetModules(); });

  const load = async (href) => {
    vi.resetModules();
    window.history.replaceState({}, '', href);
    return import('@/lib/ownedBackendLinkParams');
  };

  it('takes the pair and removes both parameters, keeping everything else', async () => {
    const module = await load('/Dashboard?type=recovery&token=abcdef123456&tab=open#section');
    expect(module.pendingLink).toEqual({ type: 'recovery', token: 'abcdef123456' });
    // A token left in the address bar is a token in history, in a bookmark, in a
    // screenshot and in the next page's referrer.
    expect(window.location.search).toBe('?tab=open');
    expect(window.location.hash).toBe('#section');
    expect(window.location.pathname).toBe('/Dashboard');
  });

  it('removes a malformed pair as well, rather than leaving it because it is unusable', async () => {
    const module = await load('/?type=invite&token=abc');
    expect(module.pendingLink).toBeNull();
    expect(window.location.search).toBe('');
  });

  it('leaves a URL with no link alone', async () => {
    const module = await load('/Dashboard?tab=open');
    expect(module.pendingLink).toBeNull();
    expect(window.location.search).toBe('?tab=open');
  });
});
