import { withTimeout } from '@/lib/aiCall';

/**
 * Await one protected, server-side AI operation and return its response body.
 *
 * The server owns each operation's prompt, model and response contract; the
 * browser sends only source material. `invoke` starts the request, and it is
 * supplied by a per-function wrapper in `src/functions/` that names its backend
 * function as a string literal. That keeps every browser route to a function
 * statically reviewable: `tools-check-backend-transpile.mjs` requires each
 * wrapper to name exactly one function, and the client-boundary scan in
 * `base44/functionTests/patientCareTeamAssignmentContract.test.js` refuses a
 * computed target anywhere in production source. So this helper takes the
 * started request, never a function NAME.
 */
export default async function protectedAiRequest(invoke, timeoutMs = 300000) {
  try {
    return await withTimeout(invoke().then(response => response.data), timeoutMs);
  } catch (error) {
    // An unsuccessful response may follow a billed invocation. Do not replay it.
    error.retryable = false;
    throw error;
  }
}
