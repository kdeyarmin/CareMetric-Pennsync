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

// Inbox broker: returns only verified messages the signed-in user participates
// in for an agency they hold an active membership in, plus that agency's
// active staff directory for composing new threads.
//
// Released with the rest of the secure-message v2 domain by the owner on
// 2026-10-08 ("approve everything. I want everything to work perfectly"). The
// deployment serves one agency. Every row returned is a verified_v2 message the
// caller participates in, inside an agency where the caller holds exactly one
// active membership; sendMessage is the only writer and stamps provenance.
const SECURE_MESSAGE_DOMAIN_PAUSED = false;

const secureMessageUnavailable = () => Response.json({
  error: 'Secure messaging is temporarily unavailable',
  code: 'secure_message_tenant_broker_required',
}, { status: 503 });

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

Deno.serve(async (req) => {
  if (SECURE_MESSAGE_DOMAIN_PAUSED) return secureMessageUnavailable();

  const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
  const user = await base44.auth.me().catch(() => null);
  if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
  if (!user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const agencyId = typeof body.agency_id === 'string' ? body.agency_id : '';
  if (!agencyId) return Response.json({ error: 'agency_id is required' }, { status: 400 });

  const entities = base44.asServiceRole.entities;
  // Ceiling of 2, not 1: the check below refuses anything but exactly one
  // active membership, so it has to be able to SEE a duplicate rather than be
  // handed the first of two.
  const mine = await entities.AgencyMembership.filter(
    { agency_id: agencyId, user_id: user.id, status: 'active' }, undefined, 2,
  );
  if (mine.length !== 1) return Response.json({ error: 'No active membership for agency' }, { status: 403 });

  // The pinned SDK takes positional arguments (query, sort, limit, skip,
  // fields) and returns an array. The options-object form this used to pass
  // exists only in a later SDK, so here it returned undefined and threw.
  const messages = await entities.Message.filter(
    { agency_id: agencyId, provenance_status: 'verified_v2', participant_user_ids: user.id },
    '-created_date',
    300,
    0,
    ['id', 'thread_id', 'thread_subject', 'patient_id', 'sender_user_id', 'sender_name', 'message_text', 'priority', 'created_date', 'read_by_user_ids', 'participant_user_ids'],
  );

  const members = await entities.AgencyMembership.filter(
    { agency_id: agencyId, status: 'active' },
    undefined,
    500,
    0,
    ['user_id', 'user_email_normalized', 'tenant_role'],
  );
  const memberRows = Array.isArray(members) ? members : [];
  // Matches the membership page's own ceiling above. Unlimited, this read was
  // capped at the server default (~50), so every member past the first fifty
  // fell out of `nameById` and the directory showed their raw address instead
  // of their name — a silent truncation, not an error.
  const users = memberRows.length === 0 ? [] : await entities.User.filter(
    { id: { $in: memberRows.map((m) => m.user_id) } }, undefined, 500,
  );
  const nameById = new Map((Array.isArray(users) ? users : []).map((u) => [u.id, u.full_name || u.email]));

  return Response.json({
    me: user.id,
    // Belt and braces over the participant filter: a row is returned only when
    // its own participant list names the caller.
    messages: (Array.isArray(messages) ? messages : [])
      .filter((m) => Array.isArray(m.participant_user_ids) && m.participant_user_ids.includes(user.id)),
    directory: memberRows
      .filter((m) => m.user_id !== user.id)
      .map((m) => ({ id: m.user_id, name: nameById.get(m.user_id) || m.user_email_normalized, role: m.tenant_role })),
  });
});