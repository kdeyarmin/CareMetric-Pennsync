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
 * Build the public patient join link for a session.
 * @param {string} origin - e.g. window.location.origin
 * @param {string} roomName
 * @param {string} joinToken
 * @returns {string}
 */
export function buildPatientJoinLink(origin, roomName, joinToken) {
  const params = new URLSearchParams({ room: roomName, t: joinToken });
  return `${origin}/join?${params.toString()}`;
}
