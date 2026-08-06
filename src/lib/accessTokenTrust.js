/**
 * Pure trust evaluation for `?access_token=` handoffs (login CSRF / session fixation).
 *
 * Outcomes:
 *   - accept  — persist the URL token as the session immediately
 *   - reject  — drop the URL token (do not stash)
 *   - pending — stash for explicit user confirm (logged-out empty/untrusted
 *               referrer with no matching planted `auth_state`)
 *
 * Fully closing phishing for email-style handoffs still needs Base44 to issue
 * a state/nonce on every return URL; `pending` is the in-repo mitigation when
 * that nonce is absent.
 */

/**
 * @param {object} opts
 * @param {string|null|undefined} opts.urlState - `auth_state` from the landing URL
 * @param {string|null|undefined} opts.plantedState - `base44_login_state` from sessionStorage
 * @param {string} [opts.referrer] - document.referrer
 * @param {boolean} opts.hasExistingToken - whether a session token is already stored
 * @param {(host: string) => boolean} opts.isTrustedBackendHost
 * @param {string|null|undefined} [opts.pageHost] - window.location.host
 * @returns {'accept'|'reject'|'pending'}
 */
export function evaluateAccessTokenTrust({
  urlState = null,
  plantedState = null,
  referrer = '',
  hasExistingToken = false,
  isTrustedBackendHost,
  pageHost = null,
} = {}) {
  if (typeof isTrustedBackendHost !== 'function') {
    throw new TypeError('isTrustedBackendHost is required');
  }

  if (plantedState) {
    if (urlState && urlState === plantedState) return 'accept';
    // Planted a return state but the URL doesn't match — reject when we have
    // evidence of a (mismatched) handoff or would overwrite a live session.
    if (urlState || hasExistingToken) return 'reject';
    // Planted but return URL lost auth_state: fall through to referrer rules
    // (may become pending for empty referrer — user confirms once).
  }

  const ref = String(referrer || '');
  if (!ref) {
    if (hasExistingToken) return 'reject';
    return 'pending';
  }

  try {
    const refHost = new URL(ref).host.toLowerCase();
    if (pageHost && refHost === String(pageHost).toLowerCase()) return 'accept';
    if (isTrustedBackendHost(refHost)) return 'accept';
    // Foreign referrer: never auto-accept. Logged-in → reject; logged-out →
    // pending confirm so a phishing page's Referrer can't silently log them in.
    return hasExistingToken ? 'reject' : 'pending';
  } catch {
    return hasExistingToken ? 'reject' : 'pending';
  }
}
