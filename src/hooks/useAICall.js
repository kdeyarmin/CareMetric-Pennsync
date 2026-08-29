import { useCallback, useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { runWithRetry } from "@/lib/aiCall";
import { aiScheduler } from "@/lib/aiScheduler";

/**
 * Standardized wrapper around `base44.integrations.Core.InvokeLLM` providing a
 * shared timeout/retry policy plus loading/error/data state. Stale responses are
 * ignored (only the most recent `run` updates state), which prevents an earlier slow
 * call from overwriting a newer result.
 *
 * Every call also goes through the app-wide AI budget (`@/lib/aiScheduler`), which
 * caps how many LLM calls are in flight at once and lets user-initiated work jump
 * ahead of background work. Pass `priority: 'background'` for a call that fires
 * automatically (on mount, on data change) rather than from a user action:
 *
 *   const ai = useAICall({ priority: 'background' });      // default for this hook
 *   await ai.run(params, { priority: 'interactive' });     // ...overridden per call
 *
 * Usage:
 *   const ai = useAICall({ timeoutMs: 30000, retries: 2 });
 *   const result = await ai.run({ prompt, response_json_schema });
 *   // ai.loading, ai.error, ai.data, ai.reset()
 *
 * `run` rejects on failure (after retries) so callers can still try/catch; it also
 * records the error in `ai.error` for rendering.
 *
 * Opt-in cancellation: pass `cancelOnUnmount: true` (per call or as a hook default)
 * and a call still QUEUED when the component unmounts is dropped instead of billed.
 * It rejects with an AI_CANCELLED error (see `isAICancellation`), so only use it
 * where the caller's catch path handles that — a catch that unconditionally shows
 * an error toast would surface one for a call nobody is waiting for any more.
 */
export function useAICall(defaults = {}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  // Keep latest defaults without making `run` change identity every render.
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;
  const reqIdRef = useRef(0);

  // Aborts queued (not yet started) calls once this component is gone.
  const unmountedRef = useRef(null);
  if (unmountedRef.current === null) unmountedRef.current = new AbortController();
  const abortTimerRef = useRef(null);
  useEffect(() => {
    // StrictMode (dev) runs cleanup and then re-runs this effect on a component
    // that never left the screen. Deferring the abort by a macrotask lets that
    // remount cancel it, so a still-queued call isn't dropped for a live card;
    // a real unmount has nothing to cancel it and aborts as intended.
    clearTimeout(abortTimerRef.current);
    if (unmountedRef.current.signal.aborted) unmountedRef.current = new AbortController();
    const controller = unmountedRef.current;
    return () => {
      abortTimerRef.current = setTimeout(() => controller.abort(), 0);
    };
  }, []);

  const run = useCallback(async (params, options = {}) => {
    const id = (reqIdRef.current += 1);
    const {
      priority = "interactive",
      cancelOnUnmount = false,
      ...retryOptions
    } = { ...defaultsRef.current, ...options };
    setLoading(true);
    setError(null);
    try {
      const result = await aiScheduler.schedule(
        () => runWithRetry(() => base44.integrations.Core.InvokeLLM(params), retryOptions),
        { priority, signal: cancelOnUnmount ? unmountedRef.current.signal : undefined }
      );
      if (id === reqIdRef.current) setData(result);
      return result;
    } catch (err) {
      if (id === reqIdRef.current) setError(err);
      throw err;
    } finally {
      if (id === reqIdRef.current) setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    reqIdRef.current += 1;
    setData(null);
    setError(null);
    setLoading(false);
  }, []);

  return { run, data, error, loading, reset };
}
