// React unmount effects can leave a real macrotask queued behind them.
// @radix-ui/react-focus-scope is the one that bites: its cleanup returns
// without restoring focus and instead queues `setTimeout(..., 0)`, which
// builds a `new CustomEvent(...)` and dispatches it on the scope's container
// (react-focus-scope/dist/index.mjs, the AUTOFOCUS_ON_UNMOUNT path).
//
// Vitest tears down the file's jsdom environment as soon as the last test
// settles. If that timer is still pending, it fires against the RESTORED Node
// globals, so `CustomEvent` resolves to Node's built-in rather than jsdom's;
// dispatching a Node event on a jsdom element throws
//   TypeError: Failed to execute 'dispatchEvent' on 'EventTarget':
//   parameter 1 is not of type 'Event'.
// Because the throw happens inside a timer it is an unhandled error, not a test
// failure: every test passes, `retry` cannot clear it, and the run still exits
// non-zero. Whether the timer wins that race depends on how busy the worker is,
// which is why it only ever showed up on CI.
//
// Yielding one macrotask after cleanup lets those timers run while the jsdom
// window is still alive. Equal-delay timers fire in the order they were
// scheduled, so a 0ms yield queued after cleanup always drains the ones cleanup
// queued.
//
// The scheduler is captured at module load — before any spec can call
// `vi.useFakeTimers()` — so this can never hang a suite that leaves fake timers
// installed. A timer scheduled ON a fake clock is discarded when that clock is
// uninstalled, so it cannot outlive the environment either way.
const scheduleMacrotask = globalThis.setTimeout.bind(globalThis);

/** Resolve after one real macrotask, draining timers queued during unmount. */
export function flushUnmountTimers() {
  return new Promise((resolve) => {
    scheduleMacrotask(resolve, 0);
  });
}
