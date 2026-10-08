import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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

// Returns only the signed-in clinician's own upcoming telehealth sessions.
//
// Released by the owner on 2026-10-08 ("approve everything"). TelehealthSession
// denies every client operation, so its only writer is manageTelehealthSession,
// which stamps agency_id and host_user_id server-side. This reads by those
// stamped ids (never the mutable host_email) inside an agency where the caller
// holds exactly one active membership.
const TELEHEALTH_PROVIDER_MIGRATION_PAUSED = false;

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

Deno.serve(async (req) => {
  if (TELEHEALTH_PROVIDER_MIGRATION_PAUSED) {
    return Response.json({
      error: 'Telehealth provider access is temporarily unavailable while session authority is migrated.',
      code: 'telehealth_provider_migration_pending',
    }, { status: 503 });
  }

  const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
  const user = await base44.auth.me().catch(() => null);
  if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
  if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const agencyId = typeof body?.agency_id === 'string' && body.agency_id.length <= 200 ? body.agency_id : '';
  if (!agencyId) return Response.json({ error: 'agency_id is required' }, { status: 400 });

  const entities = base44.asServiceRole.entities;
  // Ceiling of 2: a duplicate active grant is ambiguous and refused.
  const mine = await entities.AgencyMembership.filter(
    { agency_id: agencyId, user_id: user.id, status: 'active' }, undefined, 2,
  );
  if (!Array.isArray(mine) || mine.length !== 1 || mine[0]?.user_id !== user.id || mine[0]?.agency_id !== agencyId) {
    return Response.json({ error: 'No active membership for agency' }, { status: 403 });
  }

  // The pinned SDK takes positional arguments (query, sort, limit, skip,
  // fields) and returns an array; the options-object form returned nothing.
  const rows = await entities.TelehealthSession.filter(
    {
      agency_id: agencyId,
      host_user_id: user.id,
      status: { $in: ['scheduled', 'active'] },
      scheduled_at: { $gte: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
    },
    'scheduled_at',
    5,
    0,
    ['id', 'agency_id', 'host_user_id', 'patient_name', 'scheduled_at', 'status', 'visit_type'],
  );
  const sessions = (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.agency_id === agencyId && row?.host_user_id === user.id)
    .map(({ id, patient_name, scheduled_at, status, visit_type }) => ({ id, patient_name, scheduled_at, status, visit_type }));

  return Response.json({ sessions }, { headers: { 'Cache-Control': 'no-store' } });
});
