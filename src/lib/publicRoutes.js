/**
 * Routes that render WITHOUT an app login.
 *
 * `/join` and `/signer` (and `/followup`) are capability links: possession of
 * the high-entropy token in the URL is the authorization, so an external
 * patient or physician must never be bounced to the login screen. `/privacy` is
 * the pre-auth privacy policy required to be reachable in-app.
 *
 * The match is on the first path SEGMENT. A `startsWith('/join')` prefix test
 * also matches '/joinsomething' (and '/privacy' matches '/privacypolicy'),
 * which sends those URLs into the public branch where no route matches — the
 * user gets a blank white screen instead of the normal not-found page.
 */
export const PUBLIC_TOKEN_SEGMENTS = Object.freeze(['join', 'signer', 'followup', 'privacy', 'consent']);

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
