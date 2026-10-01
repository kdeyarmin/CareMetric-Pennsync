/**
 * The invitation or recovery link's parameters, read once and SCRUBBED.
 *
 * Read at module load and removed from the URL in the same breath, which is the
 * discipline the quarantined signer and provider-follow-up routes already follow:
 * a token left in the address bar is a token in history, in a bookmark, in a
 * screenshot and in whatever the next page sends as a referrer.
 *
 * WHAT IS DELIBERATELY NOT HERE. No address. A link identifies an account to the
 * project, and the person accepting it knows their own address, so the screen asks
 * for it rather than carrying it in a URL. That also means a forwarded link names
 * nobody.
 *
 * Nothing here decides anything: the pair is handed to
 * `ownedBackendAuth.setPasswordFromLink`, which refuses any type but the two it
 * exchanges and bounds the token itself. This module's job is to read a URL
 * safely, and a URL is the least trusted input the app takes.
 */

/** The two link kinds a screen may act on. Mirrors the client's own set. */
export const LINK_TYPES = Object.freeze(['invite', 'recovery']);
/**
 * The token's shape, as the client bounds it.
 *
 * Kept here as well as there on purpose: this is what decides whether a SCREEN
 * appears at all, and a screen that appeared for an unusable token would ask
 * somebody to choose a password and then refuse it.
 */
const TOKEN = /^[A-Za-z0-9_-]{6,512}$/;

/**
 * Read the pair out of a URL, without touching it.
 *
 * Exported for the tests, and for a caller that has a URL rather than a window.
 *
 * @param {string} search a query string, with or without its leading `?`.
 * @returns {{type: string, token: string} | null}
 */
export function readLinkParams(search) {
  let params;
  try { params = new URLSearchParams(String(search ?? '')); } catch { return null; }
  const type = params.get('type');
  const token = params.get('token');
  if (!LINK_TYPES.includes(type) || typeof token !== 'string' || !TOKEN.test(token)) return null;
  return Object.freeze({ type, token });
}

/**
 * Take the pair out of the live URL and remove both parameters from it.
 *
 * Returns null in a build with no window, and leaves the URL alone when there is
 * nothing to take — so a history entry is only ever rewritten when something was
 * actually removed.
 */
function takeFromLocation() {
  if (typeof window === 'undefined' || !window.location) return null;
  const url = new URL(window.location.href);
  const found = readLinkParams(url.search);
  // Removed whether or not the pair was USABLE: a malformed token is still a
  // token, and leaving it behind because this module would not act on it is the
  // worst of both.
  const had = url.searchParams.has('type') || url.searchParams.has('token');
  if (!had) return found;
  url.searchParams.delete('type');
  url.searchParams.delete('token');
  try {
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  } catch { /* A build with no history still gets the value; the URL keeps it. */ }
  return found;
}

/**
 * The pair this page was opened with, or null.
 *
 * A module-level constant because the scrub must happen once, before anything
 * renders, and because a second read would find the URL already cleaned and
 * conclude there was no link.
 */
export const pendingLink = takeFromLocation();
