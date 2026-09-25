import { BROWSER_CONTRACT, requireExpectedCaller, validateCallerBinding } from './caller-binding.mjs';
import { BROWSER_FORBIDDEN_OPERATIONS, IntegrationError, ID, OPERATIONS, UUID, exactObject, fail } from './safety.mjs';
import { authorize, createStore, hasBase44ExecutionDependency, performDurable, publicReadiness } from './runtime.mjs';
import { createProviders, validateParams } from './providers.mjs';
import { bearerFingerprint, createAdmission, readRequestBody } from './admission.mjs';

export function createHandler(config, dependencies = {}) {
  const store = dependencies.store || createStore(config, dependencies.fetcher);
  const rawProvider = dependencies.provider || createProviders(config, store, dependencies.fetcher);
  const provider = async (operation, params, context) => {
    const beganAt = Date.now();
    const result = await rawProvider(operation, params, context);
    // The lease starts before signing latency, not after response delivery.
    return operation === 'CreateFileSignedUrl' ? { ...result, expires_at_ms: beganAt + 60000 } : result;
  };
  const authority = dependencies.authority || ((c, r, a) => authorize(c, r, a, dependencies.fetcher));
  const admission = dependencies.admission || createAdmission();
  return async function handle(req) {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', Vary: 'Origin' };
    const origin = req.headers.get('origin');
    const json = (value, status = 200) => Response.json(value, { status, headers });
    let releaseBody = null;
    try {
      const url = new URL(req.url);
      if (origin) {
        if (!config.origins.includes(origin)) fail(403, 'ORIGIN_NOT_ALLOWED');
        headers['Access-Control-Allow-Origin'] = origin;
      }
      if (req.method === 'OPTIONS') {
        const requested = (req.headers.get('access-control-request-headers') || '').toLowerCase().split(',').map(h => h.trim()).filter(Boolean);
        if (!origin || req.headers.get('access-control-request-method') !== 'POST'
          || requested.some(h => !['authorization', 'content-type'].includes(h))) fail(403, 'PREFLIGHT_NOT_ALLOWED');
        headers['Access-Control-Allow-Methods'] = 'POST';
        headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
        return new Response(null, { status: 204, headers });
      }
      if (req.method === 'GET' && url.pathname === '/healthz') return json({ status: 'alive', release: config.released ? 'enabled' : 'paused', revision: config.revision });
      if (req.method === 'GET' && url.pathname === '/readyz') {
        const readiness = publicReadiness(config); return json(readiness, readiness.ready ? 200 : 503);
      }
      const browserRequest = url.pathname === '/v2/integrations';
      if (req.method !== 'POST' || !['/v1/integrations', '/v2/integrations'].includes(url.pathname) || url.search) fail(404, 'NOT_FOUND');
      if (!config.released || !config.configured) fail(503, 'EXTERNAL_INTEGRATIONS_NOT_RELEASED');
      if (browserRequest && (config.browserReleased !== true || !config.browserOperations?.length)) fail(503, 'BROWSER_INTEGRATIONS_NOT_RELEASED');
      if (browserRequest && !/^[a-f0-9]{40}$/.test(config.revision || '')) fail(503, 'BROWSER_REVISION_UNBOUND');
      const fingerprint = bearerFingerprint(req);
      admission.request(fingerprint);
      if (!/^application\/json(?:\s*;.*)?$/i.test(req.headers.get('content-type') || '')) fail(415, 'JSON_REQUIRED');
      let input;
      releaseBody = admission.body(fingerprint);
      try { input = JSON.parse((await readRequestBody(req, 12 * 1024 * 1024, dependencies.bodyDeadlineMs ?? 5000)).toString('utf8')); }
      catch (error) { if (error instanceof IntegrationError) throw error; fail(400, 'INVALID_JSON'); }
      finally { releaseBody(); releaseBody = null; }
      exactObject(input, browserRequest
        ? ['agency_id', 'request_id', 'operation', 'params', 'contract', 'revision', 'binding']
        : ['agency_id', 'request_id', 'operation', 'params']);
      // A global owner scope is new to v2; keep legacy v1 explicitly scoped.
      if (!browserRequest && (typeof input.agency_id !== 'string' || !ID.test(input.agency_id))) fail(400, 'AGENCY_REQUIRED');
      const expected = browserRequest ? validateCallerBinding(input.binding) : null;
      if (browserRequest && (input.contract !== BROWSER_CONTRACT || input.agency_id !== expected.agency_id)) fail(400, 'INVALID_BROWSER_CONTRACT');
      if (browserRequest && input.revision !== config.revision) fail(409, 'BROWSER_REVISION_CHANGED');
      if (browserRequest && (typeof input.request_id !== 'string' || !UUID.test(input.request_id))) fail(400, 'INVALID_BROWSER_REQUEST_ID');
      if (!OPERATIONS.includes(input.operation) || !config.operations.includes(input.operation)) fail(409, 'OPERATION_NOT_RELEASED');
      if (browserRequest && !config.browserOperations.includes(input.operation)) fail(409, 'BROWSER_OPERATION_NOT_RELEASED');
      // `loadConfig` already refuses to build such a config, so in this service
      // this line is unreachable from the environment. It is here so the refusal
      // is a property of the REQUEST rather than of how the config was made, and
      // a test drives it with a hand-built config to prove it is not decorative.
      if (browserRequest && BROWSER_FORBIDDEN_OPERATIONS.includes(input.operation)) fail(409, 'BROWSER_FORBIDDEN_OPERATION');
      validateParams(input.operation, input.params, config);
      const result = await performDurable({ config, req, agencyId: input.agency_id, operation: input.operation,
        params: input.params, requestId: input.request_id, provider, store,
        requestBinding: browserRequest ? { contract: BROWSER_CONTRACT, revision: config.revision, caller: expected } : null,
        authority: (c, r, a) => admission.authority(fingerprint, async () => {
          const actor = await authority(c, r, a);
          if (browserRequest) requireExpectedCaller(actor.binding, expected);
          return actor;
        }),
        admit: actor => admission.operation(actor.subject) });
      return json({ success: true, result, execution: 'external', base44ExecutionDependency: hasBase44ExecutionDependency(config),
        ...(browserRequest ? { contract: BROWSER_CONTRACT, app_id: config.appId, revision: config.revision,
          request_id: input.request_id, operation: input.operation } : {}) });
    } catch (error) {
      const safe = error instanceof IntegrationError;
      return json({ success: false, error: safe ? error.code : 'INTEGRATION_UNAVAILABLE', retryable: false }, safe ? error.status : 503);
    } finally { releaseBody?.(); }
  };
}
