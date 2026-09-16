import { IntegrationError, OPERATIONS, exactObject, fail, limitedBytes } from './safety.mjs';
import { authorize, createStore, performDurable, publicReadiness } from './runtime.mjs';
import { createProviders, validateParams } from './providers.mjs';

export function createHandler(config, dependencies = {}) {
  const store = dependencies.store || createStore(config, dependencies.fetcher);
  const provider = dependencies.provider || createProviders(config, store, dependencies.fetcher);
  const authority = dependencies.authority || ((c, r, a) => authorize(c, r, a, dependencies.fetcher));
  let running = 0;
  return async function handle(req) {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', Vary: 'Origin' };
    const origin = req.headers.get('origin');
    const json = (value, status = 200) => Response.json(value, { status, headers });
    let counted = false;
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
      if (req.method !== 'POST' || url.pathname !== '/v1/integrations' || url.search) fail(404, 'NOT_FOUND');
      if (!config.released || !config.configured) fail(503, 'EXTERNAL_INTEGRATIONS_NOT_RELEASED');
      if (running >= 8) fail(429, 'SERVICE_BUSY');
      running++; counted = true;
      if (!/^application\/json(?:\s*;.*)?$/i.test(req.headers.get('content-type') || '')) fail(415, 'JSON_REQUIRED');
      let input;
      try { input = JSON.parse((await limitedBytes(req, 12 * 1024 * 1024)).toString('utf8')); }
      catch (error) { if (error instanceof IntegrationError) throw error; fail(400, 'INVALID_JSON'); }
      exactObject(input, ['agency_id', 'request_id', 'operation', 'params']);
      if (!OPERATIONS.includes(input.operation) || !config.operations.includes(input.operation)) fail(409, 'OPERATION_NOT_RELEASED');
      validateParams(input.operation, input.params, config);
      const result = await performDurable({ config, req, agencyId: input.agency_id, operation: input.operation,
        params: input.params, requestId: input.request_id, provider, store, authority });
      return json({ success: true, result, execution: 'external', base44ExecutionDependency: true });
    } catch (error) {
      const safe = error instanceof IntegrationError;
      // Never return exception text, provider payloads, prompts or credentials.
      return json({ success: false, error: safe ? error.code : 'INTEGRATION_UNAVAILABLE', retryable: false }, safe ? error.status : 503);
    } finally { if (counted) running--; }
  };
}
