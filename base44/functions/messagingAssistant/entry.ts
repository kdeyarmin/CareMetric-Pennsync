import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

// <<<BEGIN SHARED HELPER: pennsyncProductionAppId — generated, edit base44/_shared/backendHelpers.mjs>>>
const PENNSYNC_PRODUCTION_APP_ID = '694ec16e72e01b60d22f7cbf';
// <<<END SHARED HELPER: pennsyncProductionAppId>>>
// <<<BEGIN SHARED HELPER: base44ClientRequest — generated, edit base44/_shared/backendHelpers.mjs>>>
function pinnedBase44Request(req, expectedAppId, forwardUserCredential) {
  if (typeof expectedAppId !== 'string' || expectedAppId === '') {
    throw new Error('pinned Base44 request requires an expected Base44-App-Id');
  }
  // Read the inbound headers without ever throwing on the SHAPE of req. A production
  // request is always a real Request with a Headers bag; a bare object with no usable
  // headers (a test fixture, a malformed direct call) carries no inbound header, which
  // is the absent case handled below. Only a PRESENT, different app id throws, and that
  // requires a real header an attacker would have to set — so a real Request always
  // reaches this read and the refusal is never skipped by the tolerance.
  const inbound =
    req && req.headers && typeof req.headers.get === 'function' ? req.headers : null;
  const read = (name) => (inbound ? inbound.get(name) : null);
  const received = read('Base44-App-Id');
  // Refuse only an ACTIVE mismatch: a caller presenting a DIFFERENT app id is the
  // tenant-redirect attack, and that is the case the refusal exists for. An ABSENT
  // header is not a mismatch and selects no other tenant — it only means the request
  // did not arrive through the platform, which always injects this header. We SET the
  // pinned constant below either way, so absent falls back to the correct app exactly
  // as the dropped Base44-Api-Url falls back to the default serverUrl. Throwing on
  // absent would turn every anonymous denial into a 500 instead of a clean 403.
  if (received !== null && received !== expectedAppId) {
    throw new Error(
      'Base44-App-Id mismatch: expected ' + expectedAppId + ', received ' + received
    );
  }
  const headers = new Headers();
  // Load-bearing: SET the constant (never forward the inbound value). The SDK reads
  // appId from this header and throws of its own accord when it is absent, so pinning
  // requires setting it here — dropping the inbound header alone would not suffice.
  headers.set('Base44-App-Id', expectedAppId);
  const serviceAuth = read('Base44-Service-Authorization');
  if (serviceAuth !== null) headers.set('Base44-Service-Authorization', serviceAuth);
  if (forwardUserCredential) {
    const authorization = read('Authorization');
    if (authorization !== null) headers.set('Authorization', authorization);
    const dataEnv = read('X-Data-Env');
    if (dataEnv === 'dev' || dataEnv === 'prod') headers.set('X-Data-Env', dataEnv);
  }
  // Cosmetic URL: serverUrl comes from the dropped Base44-Api-Url, not from here.
  // No method: the SDK request factory reads only headers.get(...), never the
  // method, so the request defaults to GET. An explicit POST would be inert for the
  // SDK and would read as an outbound delivery primitive to the inventory scanner
  // once this block is inlined into the fax status pollers.
  return new Request('https://base44.app', { headers });
}
function userScopedClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, true);
}
function serviceRoleClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, false);
}
// <<<END SHARED HELPER: base44ClientRequest>>>
// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

/**
 * Compatibility dispatcher for the historical messaging assistant.
 *
 * Released by the owner on 2026-10-08 ("turn everything on"). The historical
 * endpoint mixed two PHI purposes behind one broad input surface and decided
 * no authority of its own. It is now a thin router that owns NO authority and
 * reads NO record: an authenticated, active caller names one of two actions
 * and the request is forwarded, with the caller's own credential, to the
 * purpose-bound broker that owns it:
 *
 *   summarize_thread -> summarizeMessageThread   { agency_id, thread_id }
 *   suggest_content  -> generateMessageSuggestions
 *                       { agency_id, patient_id, thread_id?, current_message? }
 *
 * That broker re-derives everything from service-owned rows: the exact active
 * membership, the caller's binding in the thread's immutable participant set,
 * and chart access through the care-team assignment table. Only the fields the
 * named broker accepts are forwarded, so this router cannot widen either
 * broker's input surface.
 */
const SECURE_MESSAGE_DOMAIN_PAUSED = false;

const MAX_BODY_BYTES = 8_000;
const ACTIONS: Record<string, { target: string; fields: string[] }> = {
  summarize_thread: {
    target: 'summarizeMessageThread',
    fields: ['agency_id', 'thread_id'],
  },
  suggest_content: {
    target: 'generateMessageSuggestions',
    fields: ['agency_id', 'patient_id', 'thread_id', 'current_message'],
  },
};

class PublicError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'PublicError';
    this.status = status;
  }
}

function json(payload: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(payload, {
    status,
    headers: { 'Cache-Control': 'no-store', ...headers },
  });
}

const secureMessageUnavailable = () => json({
  error: 'Secure messaging is temporarily unavailable',
  code: 'secure_message_tenant_broker_required',
}, 503);

function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function parseRequest(req: Request) {
  const declaredLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new PublicError(413, 'Request body is too large');
  }
  let raw = '';
  try {
    raw = await req.text();
  } catch {
    throw new PublicError(400, 'Invalid JSON body');
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new PublicError(413, 'Request body is too large');
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new PublicError(400, 'Invalid JSON body');
  }
  if (!plainObject(body)) throw new PublicError(400, 'Request body must be an object');
  const action = typeof body.action === 'string' ? body.action : '';
  const route = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : null;
  if (!route) throw new PublicError(400, 'Invalid action');
  const unsupported = Object.keys(body).filter((key) => key !== 'action' && !route.fields.includes(key));
  if (unsupported.length > 0) throw new PublicError(400, 'Request contains unsupported fields');
  const params: Record<string, unknown> = {};
  for (const field of route.fields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) params[field] = body[field];
  }
  return { target: route.target, params };
}

function brokerPayload(value: unknown) {
  if (!plainObject(value)) return {};
  return plainObject(value.data) ? value.data : value;
}

Deno.serve(async (req) => {
  if (SECURE_MESSAGE_DOMAIN_PAUSED) return secureMessageUnavailable();
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, { Allow: 'POST' });

  try {
    // Authenticate before the body is read. Authorization itself belongs to
    // the purpose-bound broker this request is forwarded to.
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await base44.auth.me().catch(() => null);
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user) return json({ error: 'Unauthorized' }, 401);
    if (user.disabled === true || user.is_service === true) return json({ error: 'Forbidden' }, 403);

    const { target, params } = await parseRequest(req);
    try {
      const response = await base44.functions.invoke(target, params);
      return json(brokerPayload(response), 200);
    } catch (error) {
      const record = plainObject(error) ? error : {};
      const response = plainObject(record.response) ? record.response : {};
      const status = Number(response.status || record.status || 0);
      const data = brokerPayload(response.data ?? record.data);
      const message = typeof data.error === 'string' && data.error ? data.error : 'Request failed';
      const forwarded = Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502;
      return json({ error: message }, forwarded);
    }
  } catch (error) {
    if (error instanceof PublicError) return json({ error: error.message }, error.status);
    console.error('messagingAssistant failed');
    return json({ error: 'Internal server error' }, 500);
  }
});
