import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { secrets } from 'base44:runtime';
import { AI_POLICY_KEY, readAiPolicy, signAiPolicy } from '../../shared/aiResponsibilityPolicy.ts';

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

export default async function(req) {
  const headers = { 'Cache-Control': 'no-store' };
  let stage = 'initialization';
  try {
    if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
    const inboundApp = req.headers.get('Base44-App-Id');
    if (inboundApp && inboundApp !== PENNSYNC_PRODUCTION_APP_ID) return Response.json({ error: 'Forbidden' }, { status: 403, headers });
    stage = 'authentication';
    const client = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await client.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
    stage = 'administrator configuration';
    const owner = String(secrets.get('SUPER_ADMIN_EMAIL') || '').trim().toLowerCase();
    if (!owner || user.role !== 'admin' || String(user.email || '').trim().toLowerCase() !== owner || user.is_active === false || user.disabled === true || user.is_service === true || user.is_verified === false) return Response.json({ error: 'Only the configured platform administrator can manage this setting.' }, { status: 403, headers });
    stage = 'request validation';
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'bypass_previously_acknowledged') || ('bypass_previously_acknowledged' in body && typeof body.bypass_previously_acknowledged !== 'boolean')) return Response.json({ error: 'Invalid request' }, { status: 400, headers });
    const entities = client.asServiceRole.entities;
    const dataEnv = req.headers.get('X-Data-Env');
    stage = 'policy retrieval';
    let policy = await readAiPolicy(entities, dataEnv);
    if ('bypass_previously_acknowledged' in body) {
      const signed = await signAiPolicy({ policy_key: AI_POLICY_KEY, bypass_previously_acknowledged: body.bypass_previously_acknowledged, changed_by_user_id: user.id, changed_at: new Date().toISOString() }, dataEnv);
      if (policy) await entities.AIResponsibilityPolicy.update(policy.id, signed);
      else await entities.AIResponsibilityPolicy.create(signed);
      policy = await readAiPolicy(entities, dataEnv);
      if (policy?.bypass_previously_acknowledged !== body.bypass_previously_acknowledged) throw new Error('Policy save was not confirmed');
    }
    return Response.json({ bypass_previously_acknowledged: policy?.bypass_previously_acknowledged === true }, { headers });
  } catch (error) {
    console.error('Consent policy request failed', error?.message);
    return Response.json({ error: `The consent setting could not be verified or saved (${stage}).` }, { status: 500, headers });
  }
}