/**
 * Routes that render WITHOUT an app login.
 *
 * `/join` remains a capability route. `/signer` and `/followup` remain public
 * only so old external links reach explicit static-unavailable containment
 * pages; those pages scrub and do not validate their token. `/privacy` is the
 * canonical pre-auth privacy policy; `/privacy-policy` is its public
 * hyphenated alias, and `/privacypolicy` is the compatibility URL already
 * registered with the Apple listing.
 *
 * The match is on the first path SEGMENT. A `startsWith('/join')` prefix test
 * also matches '/joinsomething'. Keep every intentionally public compatibility
 * URL as its own exact segment so a look-alike path cannot bypass the auth gate.
 */
export const PUBLIC_TOKEN_SEGMENTS = Object.freeze([
  'join',
  'signer',
  'followup',
  'privacy',
  'privacy-policy',
  'privacypolicy',
  'consent',
]);

const SEGMENTS = new Set(PUBLIC_TOKEN_SEGMENTS);

/**
 * Does this pathname belong to a public (no-login) route?
 * @param {string} pathname e.g. "/join/abc123"
 * @returns {boolean}
 */
export function isPublicTokenPath(pathname) {
  if (typeof pathname !== 'string') return false;
  // ["", "join", "abc123"] — index 1 is the first segment.
  const segment = pathname.toLowerCase().split('/')[1] || '';
  return SEGMENTS.has(segment);
}

/**
 * Exact, render-local identity for a public capability/privacy route. Include
 * the router entry key so even a second navigation to the same URL revokes the
 * prior page's async work. This value is held only in memory and is never
 * logged or rendered.
 */
export function getPublicCapabilitySnapshot(location) {
  if (!location || !isPublicTokenPath(location.pathname)) return null;
  const pathname = typeof location.pathname === 'string' ? location.pathname : '';
  const search = typeof location.search === 'string' ? location.search : '';
  const hash = typeof location.hash === 'string' ? location.hash : '';
  const key = typeof location.key === 'string' ? location.key : '';
  return JSON.stringify([pathname, search, hash, key]);
}
