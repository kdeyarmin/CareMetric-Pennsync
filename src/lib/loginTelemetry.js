import { base44 } from '@/api/base44Client';
import { usesIndependentBackend } from '@/lib/independentStagingSession';

/**
 * Login tracking (owner decision, 2026-10-08: record sign-ins again).
 *
 * The browser only ASKS: trackUserLogin names the person from the
 * authenticated session, stamps the time on the server, refuses any field but a
 * coarse device category, and records at most one sign-in per half hour per
 * person. This side keeps it to one request per browser tab session, never
 * blocks the shell, and never surfaces a failure — a missing login row is a
 * telemetry gap, not an error the user can act on.
 *
 * The independent backend has no such capability, so nothing is sent there.
 */

const SESSION_KEY_PREFIX = 'pennsync_login_recorded:';

function deviceType() {
  try {
    const width = window.innerWidth || 0;
    if (width && width < 768) return 'mobile';
    if (width && width < 1024) return 'tablet';
    return 'desktop';
  } catch {
    return undefined;
  }
}

function alreadyRecorded(key) {
  try {
    return window.sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function markRecorded(key) {
  try {
    window.sessionStorage.setItem(key, '1');
  } catch {
    // Storage blocked: the server's own half-hour dedupe still bounds repeats.
  }
}

/** Record the signed-in user's sign-in once per tab session. Never throws. */
export async function recordLoginOnce(user) {
  try {
    if (usesIndependentBackend) return false;
    const userId = typeof user?.id === 'string' ? user.id : '';
    if (!userId || user?.is_active === false) return false;
    const key = `${SESSION_KEY_PREFIX}${userId}`;
    if (alreadyRecorded(key)) return false;
    markRecorded(key);
    const device = deviceType();
    await base44.functions.invoke('trackUserLogin', device ? { device_type: device } : {});
    return true;
  } catch {
    return false;
  }
}
