// The least trusted input the app takes: a URL somebody arrived on.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LINK_TYPES, readLinkParams } from '@/lib/ownedBackendLinkParams';

describe('reading an invitation or recovery link', () => {
  it('reads only the two kinds it can act on', () => {
    expect(LINK_TYPES).toEqual(['invite', 'recovery']);
    for (const type of LINK_TYPES) {
      expect(readLinkParams(`?type=${type}&token_hash=abcdef123456`)).toEqual({ type, tokenHash: 'abcdef123456' });
    }
    // `magiclink` and `signup` would each be a way to a session with no password
    // and `email_change` moves the address the target is built around, so none of
    // them is a link this app reads -- the client refuses them too, and this is
    // what keeps a SCREEN from appearing for one.
    for (const type of ['magiclink', 'signup', 'email_change', 'invite ', 'INVITE', '']) {
      expect(readLinkParams(`?type=${type}&token_hash=abcdef123456`)).toBeNull();
    }
  });

  it('refuses a token it could not use, so no screen asks for a password first', () => {
    for (const token of ['', 'abc', 'a'.repeat(513), 'has space', '../../etc/passwd', 'semi;colon']) {
      expect(readLinkParams(`?type=invite&token_hash=${encodeURIComponent(token)}`)).toBeNull();
    }
    expect(readLinkParams('?type=invite')).toBeNull();
    expect(readLinkParams('')).toBeNull();
    expect(readLinkParams(undefined)).toBeNull();
    expect(readLinkParams(null)).toBeNull();
  });

  it('carries no address, so a forwarded link names nobody', () => {
    const link = readLinkParams('?type=invite&token_hash=abcdef123456&email=nurse%40agency.example');
    expect(link).toEqual({ type: 'invite', tokenHash: 'abcdef123456' });
    expect(Object.keys(link)).toEqual(['type', 'tokenHash']);
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
    const module = await load('/Dashboard?type=recovery&token_hash=abcdef123456&tab=open#section');
    expect(module.pendingLink).toEqual({ type: 'recovery', tokenHash: 'abcdef123456' });
    // A token left in the address bar is a token in history, in a bookmark, in a
    // screenshot and in the next page's referrer.
    expect(window.location.search).toBe('?tab=open');
    expect(window.location.hash).toBe('#section');
    expect(window.location.pathname).toBe('/Dashboard');
  });

  it('removes a malformed pair as well, rather than leaving it because it is unusable', async () => {
    const module = await load('/?type=invite&token_hash=abc');
    expect(module.pendingLink).toBeNull();
    expect(window.location.search).toBe('');
  });

  it('scrubs every shape a secret can arrive in, including ones it never reads', async () => {
    // A REVIEWER'S FINDING, in the direction that leaves the most behind. The
    // first version removed `type` and `token` only, so a link carrying
    // `token_hash` had its type taken and its secret left in the address bar, and
    // a server-redeemed link, whose session arrives in the FRAGMENT, was neither
    // read nor stripped -- an access token and a refresh token sitting in history
    // with no screen to show for it.
    for (const [href, search, hash] of [
      ['/?type=invite&token=abcdef123456', '', ''],
      ['/?code=abcdef123456&tab=open', '?tab=open', ''],
      ['/#access_token=aaaaaabbbbbb&refresh_token=cccccc&type=invite&expires_in=3600', '', ''],
      ['/Dashboard?tab=open#/visits/3?access_token=aaaaaabbbbbb', '?tab=open', '#/visits/3'],
      // A stray `?` INSIDE a parameter list is not the start of a query, and
      // splitting there left everything after it unfiltered -- a completeness gap
      // against this module's own promise, found by a reviewer.
      ['/#access_token=aaaaaabbbbbb?tab=open', '', '#tab=open'],
    ]) {
      const module = await load(href);
      expect(module.pendingLink).toBeNull();
      expect(window.location.search).toBe(search);
      expect(window.location.hash).toBe(hash);
    }
  });

  it('leaves an ordinary fragment alone, because a route is not a secret', async () => {
    const module = await load('/Dashboard#/visits/3');
    expect(module.pendingLink).toBeNull();
    expect(window.location.hash).toBe('#/visits/3');
  });

  it('leaves a URL with no link alone', async () => {
    const module = await load('/Dashboard?tab=open');
    expect(module.pendingLink).toBeNull();
    expect(window.location.search).toBe('?tab=open');
  });
});
