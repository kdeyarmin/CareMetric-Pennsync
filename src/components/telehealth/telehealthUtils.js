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
