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

/**
 * Every parameter a provider link can carry a secret in, scrubbed from the query
 * AND the fragment on load whether or not this app acts on it.
 *
 * WHICH SHAPE WE SEND IS A DECISION, and this list is the other half of it. A
 * default GoTrue invitation mails `{{ .ConfirmationURL }}`, which redeems the
 * link server-side and lands on the app with `access_token` and `refresh_token`
 * IN THE FRAGMENT -- so the link IS a session, which is the one property this
 * whole path exists to deny. Ours therefore link with `{{ .TokenHash }}`, which
 * arrives as `?type=...&token_hash=...` and is redeemed here, by a client that
 * revokes what it buys. The other shapes are still scrubbed rather than trusted:
 * a link somebody configured the other way must leave nothing in the address bar,
 * and it reaches no screen because nothing below reads those names.
 */
const SCRUBBED = Object.freeze(['token', 'token_hash', 'access_token', 'refresh_token',
  'provider_token', 'provider_refresh_token', 'code', 'type', 'expires_in', 'expires_at']);

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
 * @returns {{type: string, tokenHash: string} | null}
 */
export function readLinkParams(search) {
  let params;
  try { params = new URLSearchParams(String(search ?? '')); } catch { return null; }
  const type = params.get('type');
  // `token_hash` and nothing else. A bare `token` is the shape a server-side
  // redemption uses, and accepting it here would mean accepting a link whose
  // other half puts a session in the URL.
  const tokenHash = params.get('token_hash');
  if (!LINK_TYPES.includes(type) || typeof tokenHash !== 'string' || !TOKEN.test(tokenHash)) return null;
  return Object.freeze({ type, tokenHash });
}

/**
 * A fragment with every scrubbed name removed, and whether anything went.
 *
 * The fragment needs its own pass: it never reaches a server, so nothing else
 * strips it, and it is where a server-side redemption leaves a whole session. It
 * can also be an ordinary route (`#/visits/3`), optionally with a query of its
 * own, so a fragment carrying no `=` is left exactly as it is.
 */
export function scrubFragment(hash) {
  const raw = String(hash ?? '').replace(/^#/, '');
  if (!raw.includes('=')) return { hash: raw ? `#${raw}` : '', removed: false };
  // A fragment is EITHER a route with an optional query of its own, or a bare
  // parameter list. The first `?` only begins a query when what precedes it is a
  // route rather than a parameter: `#access_token=…?tab=open` is one parameter
  // list with a stray `?` in it, and splitting there left the secret in the half
  // nothing filtered. A reviewer found that against this function's own docstring.
  const cut = raw.indexOf('?');
  const route = cut !== -1 && !raw.slice(0, cut).includes('=');
  const path = route ? raw.slice(0, cut) : '';
  const params = new URLSearchParams(route ? raw.slice(cut + 1) : raw.replace(/\?/g, '&'));
  let removed = false;
  for (const name of SCRUBBED) if (params.has(name)) { params.delete(name); removed = true; }
  if (!removed) return { hash: `#${raw}`, removed };
  // What is KEPT is re-serialised, so an escaped space comes back as `+`. Harmless
  // for a router that decodes, and noted rather than fixed: preserving the
  // original encoding means string surgery on a URL, which is more to get wrong
  // than the thing it would preserve.
  const rest = params.toString();
  // The `?` belongs to a route, so a bare parameter list keeps none.
  const kept = rest ? (path ? `${path}?${rest}` : rest) : path;
  return { hash: kept ? `#${kept}` : '', removed: true };
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
  // Removed whether or not the pair was USABLE, and whether or not this app reads
  // the name: a malformed token is still a token, and a shape we do not act on is
  // the one most worth taking out of the address bar, because nothing downstream
  // will. Leaving a parameter behind because this module would not use it is the
  // worst of both.
  let removed = false;
  for (const name of SCRUBBED) {
    if (url.searchParams.has(name)) { url.searchParams.delete(name); removed = true; }
  }
  const fragment = scrubFragment(url.hash);
  if (!removed && !fragment.removed) return found;
  try {
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${fragment.hash}`);
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
