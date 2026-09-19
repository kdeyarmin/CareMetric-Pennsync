// HTTP surface for the ported business API.
//
// Exactly three routes exist: health, readiness, and one release-gated
// function dispatch. There is no generic entity, query or proxy route, and no
// path by which a caller can name a database function, table or origin.
import { resolveAuthority } from './authority.mjs';
import { ApiError, ID, MAX_BODY, exactObject, fail, isObject, readBody } from './contracts.mjs';
import { HANDLERS } from './handlers.mjs';
import { integrationCapability } from './integrations.mjs';
import { publicReadiness } from './runtime.mjs';

const FUNCTION_PATH = /^\/v1\/functions\/([A-Za-z][A-Za-z0-9_]{0,63})$/;
/** No path, quote or control character can reach a Content-Disposition header. */
const FILENAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.pdf$/;

export function createHandler(config, dependencies = {}) {
  const authority = dependencies.authority
    || ((c, r, a) => resolveAuthority(c, r, a, dependencies.fetcher));
  const handlers = dependencies.handlers || HANDLERS;
  return async function handle(req) {
    const headers = {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      Vary: 'Origin',
    };
    const json = (value, status = 200) => Response.json(value, { status, headers });
    try {
      const url = new URL(req.url);
      const origin = req.headers.get('origin');
      if (origin) {
        if (!config.origins.includes(origin)) fail(403, 'ORIGIN_NOT_ALLOWED');
        headers['Access-Control-Allow-Origin'] = origin;
      }
      if (req.method === 'OPTIONS') {
        const requested = (req.headers.get('access-control-request-headers') || '')
          .toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
        if (!origin || req.headers.get('access-control-request-method') !== 'POST'
          || requested.some(header => !['authorization', 'content-type'].includes(header))) {
          fail(403, 'PREFLIGHT_NOT_ALLOWED');
        }
        headers['Access-Control-Allow-Methods'] = 'POST';
        headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
        return new Response(null, { status: 204, headers });
      }
      if (req.method === 'GET' && url.pathname === '/healthz') {
        return json({ status: 'alive', release: config.released ? 'enabled' : 'paused', revision: config.revision });
      }
      if (req.method === 'GET' && url.pathname === '/readyz') {
        const readiness = publicReadiness(config);
        return json(readiness, readiness.ready ? 200 : 503);
      }
      const match = FUNCTION_PATH.exec(url.pathname);
      if (req.method !== 'POST' || !match || url.search) fail(404, 'NOT_FOUND');
      const name = match[1];
      // Release is checked before the body is read, so a paused deployment
      // never consumes a request it cannot serve.
      if (!config.released || !config.authorityConfigured) fail(503, 'PENNSYNC_API_NOT_RELEASED');
      if (!Object.hasOwn(handlers, name)) fail(404, 'NOT_FOUND');
      if (!config.functions.includes(name)) fail(409, 'FUNCTION_NOT_RELEASED');
      if (!/^application\/json(?:\s*;.*)?$/i.test(req.headers.get('content-type') || '')) fail(415, 'JSON_REQUIRED');

      let input;
      try { input = JSON.parse((await readBody(req, MAX_BODY, dependencies.bodyDeadlineMs ?? 5000)).toString('utf8')); }
      catch (error) { if (error instanceof ApiError) throw error; fail(400, 'INVALID_JSON'); }
      exactObject(input, ['agency_id', 'params']);
      if (typeof input.agency_id !== 'string' || !ID.test(input.agency_id)) fail(400, 'AGENCY_REQUIRED');

      const actor = await authority(config, req, input.agency_id);
      // Bound here, not in the handler: the capability closes over this
      // request's Authorization header so a brokered call carries the caller's
      // own authority, while the handler is handed a function rather than a
      // token it could read, log or forward.
      const integration = (dependencies.integration || integrationCapability)(
        { config, req, agencyId: input.agency_id }, dependencies.fetcher);
      const result = await handlers[name].handle({ actor, params: input.params ?? {}, config, integration });
      // A ported document answers with the bytes its Base44 original answered
      // with, so a migrated caller is not asked to decode something new. Only a
      // handler that declares itself binary may take this path, and the shape it
      // returns is checked rather than trusted.
      if (handlers[name].binary) {
        if (!isObject(result) || result.binary !== true || !(result.body instanceof ArrayBuffer)
          || result.contentType !== 'application/pdf' || !FILENAME.test(result.filename || '')) {
          fail(503, 'PENNSYNC_API_UNAVAILABLE');
        }
        return new Response(result.body, {
          status: 200,
          headers: {
            ...headers,
            'Content-Type': result.contentType,
            'Content-Disposition': `attachment; filename="${result.filename}"`,
          },
        });
      }
      return json({ success: true, result, execution: 'pennsync-api', base44ExecutionDependency: false });
    } catch (error) {
      // Only reviewed codes reach a caller; an unexpected failure is opaque.
      const safe = error instanceof ApiError;
      return json({ success: false, error: safe ? error.code : 'PENNSYNC_API_UNAVAILABLE', retryable: false },
        safe ? error.status : 503);
    }
  };
}
