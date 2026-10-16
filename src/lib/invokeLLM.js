import { base44 } from "@/api/base44Client";
import { runWithRetry } from "@/lib/aiCall";

/**
 * Standardized, non-React wrapper around the app's own `invokeDirectLLM`
 * broker function (base44/functions/invokeDirectLLM), which runs the direct
 * Anthropic helper server-side. Applies the shared timeout + retry policy
 * from `src/lib/aiCall.js`.
 *
 * This is the drop-in replacement for direct `InvokeLLM` calls at the many AI
 * sites that live in event handlers, loops, or utilities where the stateful
 * `useAICall` hook can't be used. It has the same call signature as InvokeLLM,
 * so migrating is a same-arity swap:
 *
 *   const result = await invokeLLM({ prompt, response_json_schema });
 *
 * Pass policy overrides as the optional second argument:
 *
 *   await invokeLLM(params, { retries: 1, timeoutMs: 45000 });
 *
 * Components that also want managed loading/error/data state should use the
 * `useAICall` hook (src/hooks/useAICall.js), which wraps the same policy.
 */
export function invokeLLM(params, options) {
  return runWithRetry(
    () => base44.functions.invoke('invokeDirectLLM', params).then((response) => response.data),
    options,
  );
}

/**
 * Variant of {@link invokeLLM} for long-running, file-based AI calls — audio
 * transcription, PDF/image OCR — which can legitimately run far longer than the
 * 30s default and previously ran as unbounded direct SDK calls. Applies a
 * generous single-attempt budget (5 min, no retry) so a slow-but-valid request
 * isn't prematurely cut off and re-run. Same call signature; override via the
 * optional second argument.
 *
 *   await invokeLLMWithFile({ prompt, file_urls });
 */
export function invokeLLMWithFile(params, options) {
  return invokeLLM(params, { timeoutMs: 300000, retries: 0, ...options });
}
