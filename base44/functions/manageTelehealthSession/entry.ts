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

// Server-owned telehealth session broker. Every action is scoped to the
// authenticated clinician (host_email); admins may see/manage all sessions.
//
// Paused at source. `create` does make the room name, host and join-token hash
// server-owned, which is half of what createTelehealthToken's pause waits for —
// but not the immutable binding record, so nothing stops a caller-shaped row
// from existing beside the ones minted here and `loadOwned`'s `host_email`
// compare still reads a mutable field as authority. Two further gaps are this
// module's own: `user.role` is read without withTrustedClaims, and `admin` is
// the platform tier whose reach the exit decisions removed, so `action: 'list'`
// with `all` answers `{}` — every agency's sessions, projecting `patient_name`
// alongside `assessment`, `plan` and `notes`. Keep this literal true until the
// binding record exists and the list action carries a tenant predicate.
const TELEHEALTH_PROVIDER_MIGRATION_PAUSED = true;

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const randomHex = (n: number) => hex(crypto.getRandomValues(new Uint8Array(n)).buffer);
const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
const FIELDS = ['room_name', 'patient_id', 'patient_name', 'host_email', 'host_name', 'status', 'scheduled_at',
  'started_at', 'ended_at', 'duration_minutes', 'visit_type', 'chief_complaint', 'assessment', 'plan', 'notes',
  'follow_up_needed', 'follow_up_timeframe', 'join_token_hash', 'invite_link'];
const UPDATABLE = ['status', 'notes', 'chief_complaint', 'assessment', 'plan', 'follow_up_needed', 'follow_up_timeframe', 'participant_list', 'vitals_captured', 'medications_reviewed', 'prescriptions_sent'];

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
  const isAdmin = user.role === 'admin';
  const entities = base44.asServiceRole.entities;
  const body = await req.json().catch(() => ({}));
  const { action } = body;

  const loadOwned = async (id: string) => {
    const s = id ? await entities.TelehealthSession.get(id).catch(() => null) : null;
    if (!s || (!isAdmin && String(s.host_email).toLowerCase() !== user.email.toLowerCase())) return null;
    return s;
  };

  if (action === 'list') {
    const query: Record<string, unknown> = isAdmin && body.all ? {} : { host_email: user.email };
    if (body.patient_id) query.patient_id = body.patient_id;
    const page = await entities.TelehealthSession.filter(query, { sort: '-scheduled_at', limit: 50, fields: FIELDS });
    return Response.json({ sessions: page.items || [] });
  }

  if (action === 'create') {
    const patientName = String(body.patient_name || '').trim().slice(0, 200);
    if (!patientName) return Response.json({ error: 'Patient name is required' }, { status: 400 });
    const token = randomHex(32);
    const session = await entities.TelehealthSession.create({
      room_name: `th-${randomHex(12)}`,
      patient_id: body.patient_id || undefined,
      patient_name: patientName,
      host_email: user.email,
      host_name: user.full_name || user.email,
      status: 'scheduled',
      scheduled_at: body.scheduled_at || new Date().toISOString(),
      visit_type: body.visit_type || 'routine_followup',
      chief_complaint: body.chief_complaint || undefined,
      join_token_hash: await sha256(token),
    });
    return Response.json({ session, join_token: token });
  }

  const session = await loadOwned(body.session_id);
  if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });

  if (action === 'update') {
    const patch: Record<string, unknown> = {};
    for (const k of UPDATABLE) if (k in (body.data || {})) patch[k] = body.data[k];
    if (patch.status === 'active' && !session.started_at) patch.started_at = new Date().toISOString();
    if (patch.status === 'completed') {
      patch.ended_at = new Date().toISOString();
      if (session.started_at) patch.duration_minutes = Math.round((Date.now() - Date.parse(session.started_at)) / 60000);
    }
    return Response.json({ session: await entities.TelehealthSession.update(session.id, patch) });
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 });
});