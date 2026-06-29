/* eslint-disable no-console */
/**
 * logger — the app's single logging seam.
 *
 * The codebase already follows a clean convention: only `console.warn` /
 * `console.error` in app code, never `console.log`/`debug`/`info`. This module
 * formalizes that and adds two things the bare console can't:
 *
 *   1. **Environment gating.** `debug`/`info` only reach the console in dev
 *      (`import.meta.env.DEV`); they are silent in production builds. `warn` and
 *      `error` always pass through, preserving today's behavior.
 *   2. **A telemetry seam.** `setErrorReporter(fn)` registers an optional sink
 *      that `error()` and `warn()` forward to as `(level, args)`. It defaults to
 *      a no-op, so nothing changes today — but wiring real backend telemetry
 *      later (e.g. POST to a Base44 function) becomes a one-function change here
 *      instead of touching every call site. A throwing/missing reporter never
 *      breaks the caller.
 *
 * Prefer `logger.*` over bare `console.*` in app code. The `no-console` lint
 * rule (allowing only `warn`/`error`) enforces the no-debug-logs half of the
 * convention; this file is the one sanctioned console wrapper.
 */

// import.meta.env is provided by Vite at build time and by Vitest in tests; it
// can be absent under a bare `node --test`, so read it defensively.
const isDev = Boolean(import.meta?.env?.DEV);

let errorReporter = null;

/**
 * Register (or clear, with `null`) the optional telemetry sink. The sink is
 * called as `reporter(level, args)` for `warn` and `error`. Returns nothing.
 */
export function setErrorReporter(fn) {
  errorReporter = typeof fn === "function" ? fn : null;
}

function report(level, args) {
  if (!errorReporter) return;
  try {
    errorReporter(level, args);
  } catch {
    // A failing telemetry sink must never break the app or recurse back into
    // the logger. Swallow it.
  }
}

export const logger = {
  debug(...args) {
    if (isDev) console.debug(...args);
  },
  info(...args) {
    if (isDev) console.info(...args);
  },
  warn(...args) {
    console.warn(...args);
    report("warn", args);
  },
  error(...args) {
    console.error(...args);
    report("error", args);
  },
};

export default logger;
