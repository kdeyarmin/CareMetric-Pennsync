import { useCallback, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { runWithRetry } from "@/lib/aiCall";

/**
 * Standardized wrapper around `base44.integrations.Core.InvokeLLM` providing a
 * shared timeout/retry policy plus loading/error/data state. Stale responses are
 * ignored (only the most recent `run` updates state), which prevents an earlier slow
 * call from overwriting a newer result.
 *
 * Usage:
 *   const ai = useAICall({ timeoutMs: 30000, retries: 2 });
 *   const result = await ai.run({ prompt, response_json_schema });
 *   // ai.loading, ai.error, ai.data, ai.reset()
 *
 * `run` rejects on failure (after retries) so callers can still try/catch; it also
 * records the error in `ai.error` for rendering.
 */
export function useAICall(defaults = {}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  // Keep latest defaults without making `run` change identity every render.
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;
  const reqIdRef = useRef(0);

  const run = useCallback(async (params, options = {}) => {
    const id = (reqIdRef.current += 1);
    setLoading(true);
    setError(null);
    try {
      const result = await runWithRetry(
        () => base44.integrations.Core.InvokeLLM(params),
        { ...defaultsRef.current, ...options }
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
