// The ported service's path to the brokered Core integrations.
//
// Twelve of the functions still to port call `base44.integrations.Core` and
// read no entity row: an LLM invocation, an extraction, a split. They do not
// need the record store, which is what the port queue counted them against
// until the modules were read. What they need is this — a way to reach the
// integration runtime that already brokers those providers.
//
// Two properties shape the module:
//
// 1. **A handler never receives a credential.** `app.mjs` builds a capability
//    bound to the caller's own request and passes that function in; the bearer
//    stays in this module's closure. A handler calls `integration(operation,
//    params)` and cannot read, log or forward the token that authorizes it.
//    The runtime resolves authority from that bearer itself, so a brokered call
//    carries exactly the caller's authority — never the service's.
//
// 2. **The runtime's words never reach the caller.** Its failures are mapped to
//    a fixed code here. A provider message, an upstream URL or a stack would
//    otherwise cross a trust boundary on the way back.
import { MAX_UPSTREAM_BYTES, UUID, fail, isObject, readJson } from './contracts.mjs';
import { DELIVERY_OPERATIONS } from './outbound-delivery.mjs';

/** The runtime's server-to-server route. `/v2` is the browser transport and is revision-bound. */
export const INTEGRATION_PATH = '/v1/integrations';
/**
 * Fixed origins, as `authority.mjs` does it. An operator-supplied URL would let
 * a misconfiguration point the caller's bearer at a host we do not run.
 */
export const INTEGRATION_TARGETS = Object.freeze([
  'https://pennsync-integrations-production.up.railway.app',
  'http://127.0.0.1:54331',
]);
/**
 * What a ported handler may ask for. The runtime brokers more than this; this
 * is the subset the ports in this service actually use, so releasing a handler
 * cannot widen the surface by accident.
 */
export const BROKERED_OPERATIONS = Object.freeze(['InvokeLLM', 'ExtractDataFromUploadedFile']);
/**
 * What THIS deployment may ask for. `BROKERED_OPERATIONS` is the unconditional
 * set and stays the ratchet D56 made it; `DELIVERY_OPERATIONS` is added only
 * while the operator has released outbound delivery, so an unreleased
 * deployment's surface is byte-for-byte what it was before the senders existed.
 *
 * Derived per call rather than at startup on purpose: the gate is asked at the
 * moment of the call, so there is no cached answer for a restart to disagree
 * with.
 */
export const brokeredOperations = config =>
  config?.deliveryReleased === true
    ? [...BROKERED_OPERATIONS, ...DELIVERY_OPERATIONS]
    : BROKERED_OPERATIONS;
const REQUEST_TIMEOUT_MS = 30000;

export const validIntegrationTarget = value =>
  typeof value === 'string' && INTEGRATION_TARGETS.includes(value);

/**
 * A call bound to one caller and one agency.
 *
 * `req` is read for its Authorization header and nothing else, and never
 * escapes this closure. The returned function is what a handler sees.
 */
export function integrationCapability({ config, req, agencyId }, fetcher = fetch) {
  const bearer = req?.headers?.get('authorization') || '';
  return async function integration(operation, params) {
    if (!brokeredOperations(config).includes(operation)) fail(409, 'INTEGRATION_OPERATION_NOT_BROKERED');
    if (!config.integrationsConfigured) fail(503, 'INTEGRATIONS_NOT_CONFIGURED');
    if (!isObject(params)) fail(400, 'INTEGRATION_PARAMS_REQUIRED');
    // Authority was resolved from this same header before any handler ran, so
    // its absence here means the request shape changed, not that a caller is
    // anonymous. Fail rather than call the runtime unauthenticated.
    if (!/^Bearer\s+\S+$/i.test(bearer)) fail(401, 'AUTHORIZATION_REQUIRED');

    // A fresh id per call. The runtime treats it as an idempotency key, and the
    // Base44 originals had no idempotency either: each invocation was new work.
    // Reusing one across retries would replay a previous answer instead.
    const requestId = crypto.randomUUID();
    if (!UUID.test(requestId)) fail(503, 'PENNSYNC_API_UNAVAILABLE');

    let response;
    try {
      response = await fetcher(`${config.integrationsUrl}${INTEGRATION_PATH}`, {
        method: 'POST',
        headers: { Authorization: bearer, 'Content-Type': 'application/json' },
        body: JSON.stringify({ agency_id: agencyId, request_id: requestId, operation, params }),
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch { fail(503, 'INTEGRATION_UNREACHABLE'); }

    let body;
    // Bounded, not `response.json()`: provider and model output is not a size
    // boundary this service controls.
    try { body = await readJson(response, MAX_UPSTREAM_BYTES); } catch { fail(503, 'INTEGRATION_UNREADABLE'); }
    if (!response.ok || !isObject(body) || body.success !== true) {
      // Deliberately not `body.error`: the runtime's code is its own vocabulary
      // and may carry provider detail. One code crosses back, whatever failed.
      fail(response.status === 409 ? 409 : 503, 'INTEGRATION_REFUSED');
    }
    return body.result;
  };
}
