/**
 * The one thing an owned-backend build keeps on the device: a rotated refresh
 * token and the address it belongs to.
 *
 * WHY THIS EXISTS AT ALL, since the owned client was built to store nothing. The
 * Base44 path keeps its access token in `localStorage` (`base44_access_token`,
 * plus a legacy duplicate under `token`), written and read by the SDK's own
 * `saveAccessToken`/`getAccessToken`, so a reload, a new tab or a browser restart
 * comes back signed in. The owned client held its session in a closure and
 * nothing else, so the same reload asked for a password again — and the app
 * expires a READY realm after five minutes whatever the backend
 * (`AuthContext.jsx`'s realm-expiry effect), so on the owned path that was a
 * password every five minutes of work. Persisting is what restores the Base44
 * behaviour; it is not a new convenience.
 *
 * WHY A REFRESH TOKEN RATHER THAN THE ACCESS TOKEN, which is what Base44 stores.
 * This is strictly LESS exposed than the behaviour it restores: a refresh token
 * is single-use, rotates on every exchange, and is revoked by signing out, while
 * a stored bearer is usable against the API for its whole life by anybody who
 * reads it. So the access token stays in the client's closure, where it was, and
 * only this travels to the device.
 *
 * WHAT IS DELIBERATELY NOT HERE. No access token, under any name — the writer
 * takes the two values positionally and serialises those two fields only, so
 * there is no path by which a grant could be stored whole. No tenant, no
 * membership and no agency: what a person may open is re-established from the
 * store on every boot, and a cached answer to that question is the one thing
 * this must never become.
 */

/** The single key. Named for the product so a device holding both is readable. */
export const OWNED_SESSION_STORAGE_KEY = 'pennsync_owned_session';
/** Bumped if the record's shape ever changes; an unknown version is dropped. */
const VERSION = 1;
const FIELDS = ['v', 'email', 'refresh_token'];
/**
 * Bounds, not validation of meaning.
 *
 * The address is compared against the one the person types, so its shape only
 * has to be conservative enough that a hostile value cannot be long or strange.
 * GoTrue's refresh tokens are short opaque strings; the bound is generous and the
 * alphabet is not, because this value is sent to the provider as a credential.
 */
const EMAIL = /^[^\s@]+@[^\s@]+$/;
const REFRESH = /^[A-Za-z0-9_-]{8,512}$/;

const store = () => {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    // A browser with storage denied is a browser that signs in each time, which
    // is the behaviour this module exists to improve rather than to require.
    return null;
  }
};

/** Remove the record. Safe to call when there is none, and never throws. */
export function clearStoredOwnedSession() {
  try { store()?.removeItem(OWNED_SESSION_STORAGE_KEY); } catch { /* nothing to do */ }
}

/**
 * The record, or null — and a value that is not exactly a record is REMOVED.
 *
 * A malformed or tampered record cannot be used, and leaving it would let it sit
 * on the device until something else happened to clear it. An unknown field is a
 * refusal rather than something to ignore, because honouring part of a record
 * somebody else wrote is how a stored session becomes an injected one.
 */
function readRecord() {
  const raw = (() => { try { return store()?.getItem(OWNED_SESSION_STORAGE_KEY) ?? null; } catch { return null; } })();
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4096) {
    if (raw !== null) clearStoredOwnedSession();
    return null;
  }
  let value;
  try { value = JSON.parse(raw); } catch { clearStoredOwnedSession(); return null; }
  const ok = value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => FIELDS.includes(key)) && FIELDS.every(key => key in value)
    && value.v === VERSION
    && typeof value.email === 'string' && value.email.length <= 320 && EMAIL.test(value.email)
    && value.email === value.email.trim().toLowerCase()
    && typeof value.refresh_token === 'string' && REFRESH.test(value.refresh_token);
  if (!ok) { clearStoredOwnedSession(); return null; }
  return value;
}

/**
 * Whose session is on this device, or null. The TOKEN is not returned.
 *
 * This is what a boot needs: the address decides which client to construct, and
 * the client then asks its own port for the credential, so the secret never
 * passes through the code that decides what to do with it.
 */
export function storedOwnedSessionEmail() {
  return readRecord()?.email ?? null;
}

/**
 * A port over this device's record for ONE address, for the authority client.
 *
 * `read` answers null for anybody else's record, so a client constructed for one
 * address can never be resumed on another's credential — the check is here as
 * well as in the client because this is the half that touches the device.
 */
export function createOwnedSessionPort(email) {
  const owner = String(email ?? '').trim().toLowerCase();
  return Object.freeze({
    read() {
      const record = readRecord();
      return record && record.email === owner ? record.refresh_token : null;
    },
    write(refreshToken) {
      if (typeof refreshToken !== 'string' || !REFRESH.test(refreshToken) || !EMAIL.test(owner)) {
        // Nothing usable to keep, so leave nothing: a stale record beside a live
        // session is a credential for a session the app has stopped tracking.
        clearStoredOwnedSession();
        return false;
      }
      // A browser with no storage stored nothing, so it must not answer true: the
      // optional call short-circuited to `undefined` and an unconditional `true`
      // after it reported a record that does not exist.
      const target = store();
      if (!target) return false;
      try {
        target.setItem(OWNED_SESSION_STORAGE_KEY,
          JSON.stringify({ v: VERSION, email: owner, refresh_token: refreshToken }));
        return true;
      } catch { return false; }
    },
    clear() {
      // Unconditional, not "only if it is mine": every path that reaches here is
      // a sign-out or a refusal, and both mean this device holds no session.
      clearStoredOwnedSession();
    },
  });
}
