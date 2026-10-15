// The last moment someone used PennSync, shared by every tab of this origin
// and surviving a reload.
//
// SessionTimeoutManager used to keep this only in page memory, so the
// 15-minute idle sign-out restarted from zero whenever the page reloaded: the
// iOS shell reloads after the system kills a backgrounded web process, and
// pull-to-refresh, closing and reopening a tab, or a crash reload all did the
// same, putting a long-idle device straight back into a patient's chart. It
// was also per tab, so an idle background tab could sign out the tab someone
// was working in.
//
// A missing value means a fresh session (first load after sign-in, or after
// this shipped), never an expired one, so nobody is signed out by its absence.

export const SESSION_ACTIVITY_KEY = 'pennsync_last_activity_at';

function storage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The recorded last-activity time in ms, or null when there is none. */
export function readSessionActivity(now = Date.now()) {
  try {
    const raw = storage()?.getItem(SESSION_ACTIVITY_KEY);
    if (!raw) return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return null;
    // A clock moved backwards must not leave a stamp in the future that the
    // idle check can never reach.
    return Math.min(value, now);
  } catch {
    return null;
  }
}

export function recordSessionActivity(at = Date.now()) {
  try {
    storage()?.setItem(SESSION_ACTIVITY_KEY, String(at));
  } catch {
    // Storage unavailable (private mode, quota): the in-page timer still runs.
  }
}

export function clearSessionActivity() {
  try {
    storage()?.removeItem(SESSION_ACTIVITY_KEY);
  } catch {
    // Nothing to clear.
  }
}
