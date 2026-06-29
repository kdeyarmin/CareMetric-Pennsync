// Ensures only one SpeechRecognition is listening at a time across the Smart Note
// UI. Browsers typically allow a single active recognizer, so starting a second
// (e.g. a per-question mic while the main "Live Dictation" is running, or two
// question mics) silently fails. Each starter registers a stop() callback;
// claiming dictation stops whoever held it before.
let activeStop = null;

/** Claim the single dictation slot, stopping any other active recognizer. */
export function claimDictation(stop) {
  if (activeStop && activeStop !== stop) {
    try { activeStop(); } catch { /* already stopped */ }
  }
  activeStop = stop;
}

/** Release the slot if `stop` still holds it (no-op if another already claimed it). */
export function releaseDictation(stop) {
  if (activeStop === stop) activeStop = null;
}
