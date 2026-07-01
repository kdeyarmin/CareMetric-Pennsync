/**
 * Format a whole number of seconds as `m:ss` (e.g. 75 → "1:15").
 *
 * Canonical replacement for the identical helper that the audio-recorder and
 * session-timeout components each defined locally. Intended for short durations
 * (recording length, countdowns) where an hours component isn't needed.
 *
 * @param {number} seconds
 * @returns {string}
 */
export function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
