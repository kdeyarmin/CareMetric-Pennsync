// Helpers for the patient-facing telehealth join flow.
//
// A telehealth visit is shared with the patient as a "capability link": the
// invite URL carries a high-entropy, per-session token (?t=...). Possession of
// that link is what authorizes the patient to join the room's audio/video — no
// patient account or staff login required. The backend (createTelehealthToken)
// validates the token and only mints a Telnyx Video token scoped to that one room.

/**
 * Generate a high-entropy (192-bit) token used to gate patient access to a
 * single telehealth session. Hex-encoded so it is URL-safe.
 * @returns {string}
 */
export function generateJoinToken() {
  const bytes = new Uint8Array(24);
  (globalThis.crypto || crypto).getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * SHA-256 (hex) of a join token. Only this hash is persisted on the
 * TelehealthSession (join_token_hash) — the raw token lives in the link handed
 * to the patient, so a database read can't be replayed into room access.
 * @param {string} token
 * @returns {Promise<string>}
 */
export async function hashJoinToken(token) {
  const digest = await (globalThis.crypto || crypto).subtle.digest(
    'SHA-256',
    new TextEncoder().encode(String(token)),
  );
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Build the public patient join link for a session.
 * @param {string} appBaseUrl - absolute app base URL, including any hosted mount path
 * @param {string} roomName
 * @param {string} joinToken
 * @returns {string}
 */
export function buildPatientJoinLink(appBaseUrl, roomName, joinToken) {
  const params = new URLSearchParams({ room: roomName, t: joinToken });
  return `${String(appBaseUrl).replace(/\/+$/, '')}/join?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// In-visit video token renewal.
//
// createTelehealthToken mints a Telnyx client token that lives at most an hour
// (3600 s is Telnyx's maximum token_ttl_secs). A visit that runs longer must
// hand the room a fresh token before the old one expires, or a reconnect after
// a network blip fails. The fresh token comes from the same backend call with
// action 'refresh', which re-runs the visit's authorization, and is applied
// with the SDK's room.updateClientToken. Everything here is time arithmetic
// and a timer loop with injected clocks, so it is testable without a browser.

/** What createTelehealthToken has always minted, for a reply that omits it. */
export const DEFAULT_TOKEN_TTL_SECS = 3600;
/** Renew this long before expiry. */
export const TOKEN_REFRESH_LEAD_MS = 5 * 60 * 1000;
/** Never schedule a renewal sooner than this. */
export const TOKEN_REFRESH_MIN_DELAY_MS = 15 * 1000;
/** Ceiling on the back-off between failed renewal attempts. */
export const TOKEN_REFRESH_MAX_RETRY_MS = 60 * 1000;

/**
 * When the token in a createTelehealthToken reply expires, in this browser's
 * clock. The server's token_expires_at and the skew-free receivedAt + ttl are
 * both honoured and the EARLIER wins, so a client clock running behind cannot
 * push the renewal past the real expiry.
 * @param {{ token_expires_at?: string|null, token_ttl_secs?: number }} reply
 * @param {number} receivedAtMs
 * @returns {number}
 */
export function tokenExpiryMs(reply, receivedAtMs) {
  const ttl = Number(reply?.token_ttl_secs);
  const ttlSecs = Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_TOKEN_TTL_SECS;
  const fromTtl = receivedAtMs + ttlSecs * 1000;
  const fromServer = typeof reply?.token_expires_at === 'string' ? Date.parse(reply.token_expires_at) : NaN;
  return Number.isFinite(fromServer) ? Math.min(fromServer, fromTtl) : fromTtl;
}

/**
 * How long to wait before renewing a token that expires at `expiresAtMs`:
 * TOKEN_REFRESH_LEAD_MS early, or halfway through a token too short-lived for
 * that, and never sooner than TOKEN_REFRESH_MIN_DELAY_MS.
 * @param {number} expiresAtMs
 * @param {number} nowMs
 * @returns {number}
 */
export function tokenRefreshDelayMs(expiresAtMs, nowMs) {
  const remaining = expiresAtMs - nowMs;
  if (!Number.isFinite(remaining)) return TOKEN_REFRESH_MIN_DELAY_MS;
  const target = remaining > 2 * TOKEN_REFRESH_LEAD_MS ? remaining - TOKEN_REFRESH_LEAD_MS : remaining / 2;
  return Math.max(TOKEN_REFRESH_MIN_DELAY_MS, Math.floor(target));
}

/**
 * Back-off after a failed renewal: 5 s doubling to a minute, never past the
 * current token's expiry. null once the token has expired — there is nothing
 * left to keep alive, and the visit's own reconnect handling takes over.
 * @param {number} expiresAtMs
 * @param {number} nowMs
 * @param {number} attempt - 0 for the first retry
 * @returns {number|null}
 */
export function tokenRefreshRetryDelayMs(expiresAtMs, nowMs, attempt) {
  const remaining = expiresAtMs - nowMs;
  if (!Number.isFinite(remaining) || remaining <= 0) return null;
  const backoff = Math.min(TOKEN_REFRESH_MAX_RETRY_MS, 5000 * 2 ** Math.max(0, attempt));
  return Math.max(1000, Math.min(backoff, Math.floor(remaining / 2)));
}

/**
 * A refusal retrying cannot fix: the visit ended, the guest link expired, the
 * caller is no longer authorized, or the public link's capability was revoked.
 * @param {any} error
 * @returns {boolean}
 */
export function isDefinitiveTokenRefusal(error) {
  const status = Number(error?.status ?? error?.response?.status);
  if ([400, 401, 403, 404, 409, 410].includes(status)) return true;
  return error?.code === 'PUBLIC_CAPABILITY_REALM_CLOSED' || error?.code === 'STALE_PUBLIC_CAPABILITY_OPERATION';
}

/**
 * Keep a connected room's token fresh.
 *
 *   const refresher = createTokenRefresher({ refresh, apply, onGiveUp });
 *   refresher.track(firstReply, Date.now());   // after joining
 *   refresher.stop();                          // on leave/unmount
 *
 * `refresh()` resolves to a createTelehealthToken reply ({ token,
 * token_expires_at, token_ttl_secs }); `apply(token)` hands it to the room.
 * A transient failure is retried with back-off until the current token
 * expires; a definitive refusal, or running out of time, calls onGiveUp once.
 * @param {{
 *   refresh: () => Promise<any>,
 *   apply: (token: string) => Promise<void>|void,
 *   onGiveUp?: (error: any) => void,
 *   now?: () => number,
 *   setTimer?: (fn: () => void, ms: number) => any,
 *   clearTimer?: (id: any) => void,
 * }} options
 */
export function createTokenRefresher({
  refresh, apply, onGiveUp,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
}) {
  let timer = null;
  let stopped = false;
  let expiresAt = NaN;

  const clear = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const giveUp = (error) => {
    if (stopped) return;
    stopped = true;
    clear();
    onGiveUp?.(error);
  };

  let arm;
  const track = (reply, receivedAtMs) => {
    if (stopped) return;
    expiresAt = tokenExpiryMs(reply, receivedAtMs);
    arm(tokenRefreshDelayMs(expiresAt, now()), 0);
  };

  const run = async (attempt) => {
    if (stopped) return;
    let reply;
    try {
      reply = await refresh();
      if (stopped) return;
      const token = reply?.token;
      if (typeof token !== 'string' || !token) throw new Error('The renewal returned no token');
      await apply(token);
    } catch (error) {
      if (stopped) return;
      const retry = isDefinitiveTokenRefusal(error) ? null : tokenRefreshRetryDelayMs(expiresAt, now(), attempt);
      if (retry === null) giveUp(error);
      else arm(retry, attempt + 1);
      return;
    }
    track(reply, now());
  };

  arm = (delay, attempt) => {
    clear();
    if (stopped) return;
    timer = setTimer(() => {
      timer = null;
      run(attempt);
    }, delay);
  };

  return {
    track,
    stop() {
      stopped = true;
      clear();
    },
    /** The current token's expiry (ms since epoch), for diagnostics and tests. */
    expiresAt: () => expiresAt,
  };
}
