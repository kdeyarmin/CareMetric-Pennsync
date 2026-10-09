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

/**
 * notifySignerOfPackage — send a package's first signing link.
 *
 * A thin call into the one reviewed issuer, generateSignerToken, made with the
 * caller's OWN credential: the issuer decides chart access, hashes and caps
 * the link, derives the recipient from the request, emails through the
 * released delivery gate and records provenance. This function adds no
 * authority and no delivery path of its own, so it cannot bypass any of them.
 *
 * Body: { agency_id, package_id, signer_id, request_id }
 */
const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };
const FIELDS = ['agency_id', 'package_id', 'signer_id', 'request_id'];

function exactIdentifier(value: unknown) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200
    && value.trim() === value && !value.startsWith('$') ? value : null;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: NO_STORE });
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
    if (user.is_active === false) {
      return Response.json({ error: 'Unauthorized - account is deactivated' }, { status: 403, headers: NO_STORE });
    }
    const raw = await req.text();
    if (raw.length > 4_000) return Response.json({ error: 'Request body is too large' }, { status: 413, headers: NO_STORE });
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw || '{}'); } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400, headers: NO_STORE }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some((key) => !FIELDS.includes(key))
      || FIELDS.some((key) => !exactIdentifier(body[key]))) {
      return Response.json({ error: 'Exact agency, package, signer, and request ids are required' }, { status: 400, headers: NO_STORE });
    }
    try {
      const result = await base44.functions.invoke('generateSignerToken', {
        agency_id: body.agency_id, package_id: body.package_id, signer_id: body.signer_id,
        request_id: body.request_id, rotate: false,
      });
      const status = Number(result?.status) || 200;
      return Response.json(result?.data ?? result, { status, headers: NO_STORE });
    } catch (error) {
      const status = Number(error?.response?.status ?? error?.status);
      const data = error?.response?.data ?? error?.data;
      if (Number.isInteger(status) && status >= 400 && data && typeof data === 'object') {
        return Response.json(data, { status, headers: NO_STORE });
      }
      return Response.json({ error: 'The signing link could not be sent' }, { status: 502, headers: NO_STORE });
    }
  } catch {
    return Response.json({ error: 'The signing link could not be sent' }, { status: 500, headers: NO_STORE });
  }
});
