/**
 * Routes that render WITHOUT an app login.
 *
 * `/join` and `/signer` (and `/followup`) are capability links: possession of
 * the high-entropy token in the URL is the authorization, so an external
 * patient or physician must never be bounced to the login screen. `/privacy`
 * is the canonical pre-auth privacy policy; `/privacypolicy` is the public
 * compatibility URL already registered with the Apple listing.
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
