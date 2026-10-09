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


// Server-owned telehealth session broker. Released by the owner on 2026-10-08
// ("approve everything. I want everything to work perfectly").
//
// TelehealthSession's RLS denies every client operation, so this broker is the
// only writer: room names, hosts and join-token hashes are minted here and
// never accepted from the browser. Every action names its agency and is
// authorized against the caller's exact active AgencyMembership in it (the
// protected platform owner may act in any agency). Rows carry agency_id and
// host_user_id, and authority is read from those, never from the mutable
// host_email. A clinician sees and manages their own sessions; an agency_admin
// or manager may list every session in their agency. The stored join-token hash
// never leaves the server.
const TELEHEALTH_PROVIDER_MIGRATION_PAUSED = false;

// <<<BEGIN SHARED HELPER: protectedUserAuthz — generated, edit base44/_shared/backendHelpers.mjs>>>
const normalizeProtectedEmail = (value) => String(value || '').trim().toLowerCase();
const isProtectedAdmin = (user) => !!user && user.role === 'admin';
function isProtectedSuperAdmin(user) {
  const configuredEmail = normalizeProtectedEmail(Deno.env.get('SUPER_ADMIN_EMAIL'));
  return !!configuredEmail
    && isProtectedAdmin(user)
    && normalizeProtectedEmail(user.email) === configuredEmail;
}
// <<<END SHARED HELPER: protectedUserAuthz>>>

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
const FIELDS = ['id', 'agency_id', 'room_name', 'patient_id', 'patient_name', 'host_email', 'host_name', 'host_user_id',
  'status', 'scheduled_at', 'started_at', 'ended_at', 'duration_minutes', 'visit_type', 'chief_complaint', 'assessment',
  'plan', 'notes', 'follow_up_needed', 'follow_up_timeframe', 'invite_link', 'participant_list', 'vitals_captured',
  'medications_reviewed', 'prescriptions_sent', 'created_date'];
const UPDATABLE = ['status', 'notes', 'chief_complaint', 'assessment', 'plan', 'follow_up_needed', 'follow_up_timeframe', 'participant_list', 'vitals_captured', 'medications_reviewed', 'prescriptions_sent'];
// Both sets are the entity schema's own enums (base44/entities/TelehealthSession.jsonc).
const STATUSES = new Set(['scheduled', 'active', 'completed', 'cancelled']);
const VISIT_TYPES = new Set(['routine_followup', 'urgent_care', 'medication_review', 'care_plan_review', 'admission_assessment', 'discharge_planning']);
const AGENCY_WIDE_ROLES = new Set(['agency_admin', 'manager']);
const CHART_ROLES = new Set(['agency_admin', 'manager', 'clinician', 'social_worker', 'spiritual_care']);
const MAX_ID = 200;
// Physiological sanity bounds for live vital capture (wider than "normal";
// anything outside is a typo, not a reading).
const VITAL_BOUNDS: Record<string, [number, number]> = {
  heart_rate: [10, 300],
  blood_pressure_systolic: [40, 300],
  blood_pressure_diastolic: [20, 200],
  temperature: [80, 115],
  respiratory_rate: [3, 80],
  oxygen_saturation: [50, 100],
  pain_level: [0, 10],
};

const exactId = (value: unknown) => (typeof value === 'string' && value.length > 0 && value.length <= MAX_ID
  && value.trim() === value && !value.startsWith('$')) ? value : '';
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/** The stored hash stays on the server; everything else the UI shows passes. */
function project(row: Record<string, any>) {
  const out: Record<string, unknown> = {};
  for (const field of FIELDS) if (row?.[field] !== undefined) out[field] = row[field];
  out.has_join_link = Boolean(row?.join_token_hash || row?.invite_link);
  return out;
}

async function resolveAuthority(entities: any, user: any, agencyId: string) {
  if (isProtectedSuperAdmin(user)) return { agencyId, tenantRole: 'platform_owner', agencyWide: true };
  const rows = await entities.AgencyMembership.filter(
    { agency_id: agencyId, user_id: user.id, status: 'active' }, undefined, 2,
  );
  // Ceiling of 2: a duplicate active grant is ambiguous and refused, not resolved.
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const row = rows[0];
  if (row?.agency_id !== agencyId || row?.user_id !== user.id || row?.status !== 'active') return null;
  if (!CHART_ROLES.has(String(row.tenant_role)) && row.tenant_role !== 'office_staff') return null;
  return { agencyId, tenantRole: String(row.tenant_role), agencyWide: AGENCY_WIDE_ROLES.has(String(row.tenant_role)) };
}

/** Same chart rule the patient brokers apply: agency-wide role, creator, or an active care-team seat. */
async function canOpenChart(entities: any, authority: any, user: any, patientId: string) {
  const patients = await entities.Patient.filter({ id: patientId }, undefined, 2);
  const patient = Array.isArray(patients) && patients.length === 1 ? patients[0] : null;
  if (!patient || patient.id !== patientId || patient.agency_id !== authority.agencyId) return null;
  if (authority.agencyWide) return patient;
  if (!CHART_ROLES.has(authority.tenantRole)) return null;
  if (patient.created_by_user_id === user.id) return patient;
  const seats = await entities.PatientCareTeamAssignment.filter(
    { agency_id: authority.agencyId, patient_id: patientId, user_id: user.id }, '-updated_date', 5,
  );
  const active = (Array.isArray(seats) ? seats : []).some((seat: any) => seat?.status === 'active'
    && seat.agency_id === authority.agencyId && seat.patient_id === patientId && seat.user_id === user.id);
  return active ? patient : null;
}

function patientDisplayName(patient: Record<string, any>) {
  return [patient.first_name, patient.last_name].filter((part) => typeof part === 'string' && part.trim()).join(' ').trim();
}

Deno.serve(async (req) => {
  if (TELEHEALTH_PROVIDER_MIGRATION_PAUSED) {
    return json({
      error: 'Telehealth provider access is temporarily unavailable while session authority is migrated.',
      code: 'telehealth_provider_migration_pending',
    }, 503);
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await base44.auth.me().catch(() => null);
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user?.id || !user?.email) return json({ error: 'Unauthorized' }, 401);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid request body' }, 400);
    const agencyId = exactId(body.agency_id);
    if (!agencyId) return json({ error: 'agency_id is required' }, 400);
    const entities = base44.asServiceRole.entities;
    const authority = await resolveAuthority(entities, user, agencyId);
    if (!authority) return json({ error: 'No active membership for agency' }, 403);
    const { action } = body;

    if (action === 'list') {
      const query: Record<string, unknown> = { agency_id: agencyId };
      // A chart's own visit history (the patient chart's telehealth panel) is
      // shown to whoever may open that chart; otherwise a caller sees the
      // visits they host, or, for an agency-wide role asking for `all`, the
      // agency's.
      let chartWide = false;
      if (body.patient_id != null) {
        const patientId = exactId(body.patient_id);
        if (!patientId) return json({ error: 'patient_id is invalid' }, 400);
        query.patient_id = patientId;
        chartWide = !!(await canOpenChart(entities, authority, user, patientId));
      }
      if (!chartWide && !(authority.agencyWide && body.all === true)) query.host_user_id = user.id;
      const rows = await entities.TelehealthSession.filter(query, '-scheduled_at', 50, 0, [...FIELDS, 'join_token_hash']);
      const sessions = (Array.isArray(rows) ? rows : [])
        .filter((row: any) => row?.agency_id === agencyId
          && (query.host_user_id === undefined || row.host_user_id === user.id))
        .map(project);
      return json({ sessions });
    }

    if (action === 'create') {
      let patientId = '';
      let patientName = String(body.patient_name || '').trim().slice(0, 200);
      if (body.patient_id != null && body.patient_id !== '') {
        patientId = exactId(body.patient_id);
        if (!patientId) return json({ error: 'patient_id is invalid' }, 400);
        const patient = await canOpenChart(entities, authority, user, patientId);
        if (!patient) return json({ error: 'This chart is not open to you' }, 403);
        patientName = patientDisplayName(patient) || patientName;
      }
      if (!patientName) return json({ error: 'Patient name is required' }, 400);
      const scheduledAt = body.scheduled_at == null ? new Date().toISOString() : String(body.scheduled_at);
      if (!Number.isFinite(Date.parse(scheduledAt))) return json({ error: 'scheduled_at is invalid' }, 400);
      const visitType = body.visit_type == null ? 'routine_followup' : String(body.visit_type);
      if (!VISIT_TYPES.has(visitType)) return json({ error: 'visit_type is invalid' }, 400);
      const token = randomHex(32);
      const session = await entities.TelehealthSession.create({
        agency_id: agencyId,
        room_name: `th-${randomHex(12)}`,
        patient_id: patientId || undefined,
        patient_name: patientName,
        host_user_id: user.id,
        host_email: normalizeProtectedEmail(user.email),
        host_name: user.full_name || user.email,
        status: 'scheduled',
        scheduled_at: new Date(scheduledAt).toISOString(),
        visit_type: visitType,
        chief_complaint: typeof body.chief_complaint === 'string' ? body.chief_complaint.slice(0, 2000) : undefined,
        join_token_hash: await sha256(token),
      });
      return json({ session: project(session), join_token: token });
    }

    const sessionId = exactId(body.session_id);
    if (!sessionId) return json({ error: 'session_id is required' }, 400);
    const found = await entities.TelehealthSession.filter({ id: sessionId, agency_id: agencyId }, undefined, 2);
    const session = Array.isArray(found) && found.length === 1 ? found[0] : null;
    if (!session || session.id !== sessionId || session.agency_id !== agencyId
      || (!authority.agencyWide && session.host_user_id !== user.id)) {
      return json({ error: 'Session not found' }, 404);
    }

    if (action === 'get') return json({ session: project(session) });

    if (action === 'update') {
      const data = body.data && typeof body.data === 'object' && !Array.isArray(body.data) ? body.data : {};
      const patch: Record<string, unknown> = {};
      for (const k of UPDATABLE) if (k in data) patch[k] = data[k];
      if (patch.status !== undefined && !STATUSES.has(String(patch.status))) return json({ error: 'status is invalid' }, 400);
      if (patch.participant_list !== undefined && (!Array.isArray(patch.participant_list)
        || patch.participant_list.length > 20
        || patch.participant_list.some((entry: unknown) => typeof entry !== 'string' || entry.length > 320))) {
        return json({ error: 'participant_list is invalid' }, 400);
      }
      if (patch.status === 'active' && !session.started_at) patch.started_at = new Date().toISOString();
      if (patch.status === 'completed') {
        patch.ended_at = new Date().toISOString();
        if (session.started_at) patch.duration_minutes = Math.round((Date.now() - Date.parse(session.started_at)) / 60000);
      }
      return json({ session: project(await entities.TelehealthSession.update(session.id, patch)) });
    }

    if (action === 'record_vitals') {
      // Live vital capture (owner decision, 2026-10-08). The session gate above
      // already requires the host or an agency-wide role in this agency; a
      // chart-bound session additionally needs the chart to be open to the
      // caller now. Values are range-checked here, and the merge into
      // vitals_captured is a compare-and-swap on the row's updated_date, so a
      // co-participant's reading recorded a moment earlier is never lost.
      if (session.status !== 'active') return json({ error: 'Vitals can be recorded only during a live visit' }, 409);
      if (session.patient_id && !(await canOpenChart(entities, authority, user, String(session.patient_id)))) {
        return json({ error: 'This chart is not open to you' }, 403);
      }
      const input = body.vitals && typeof body.vitals === 'object' && !Array.isArray(body.vitals) ? body.vitals : null;
      if (!input || Object.keys(input).length === 0
        || Object.keys(input).some((key) => !Object.hasOwn(VITAL_BOUNDS, key))) {
        return json({ error: `vitals may contain only ${Object.keys(VITAL_BOUNDS).join(', ')}` }, 400);
      }
      const reading: Record<string, number> = {};
      for (const [key, raw] of Object.entries(input)) {
        const value = typeof raw === 'number' ? raw : Number.NaN;
        const [min, max] = VITAL_BOUNDS[key];
        if (!Number.isFinite(value) || value < min || value > max) {
          return json({ error: `${key.replace(/_/g, ' ')} must be between ${min} and ${max}` }, 400);
        }
        reading[key] = value;
      }
      let current = session;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (attempt > 0) {
          const again = await entities.TelehealthSession.filter({ id: session.id, agency_id: agencyId }, undefined, 2);
          current = Array.isArray(again) && again.length === 1 ? again[0] : null;
          if (!current || current.id !== session.id || current.agency_id !== agencyId) return json({ error: 'Session not found' }, 404);
          if (current.status !== 'active') return json({ error: 'Vitals can be recorded only during a live visit' }, 409);
        }
        const prior = current.vitals_captured && typeof current.vitals_captured === 'object' && !Array.isArray(current.vitals_captured)
          ? current.vitals_captured
          : {};
        const merged = { ...prior, ...reading, recorded_at: new Date().toISOString() };
        const result = await entities.TelehealthSession.updateMany(
          { id: current.id, agency_id: agencyId, updated_date: current.updated_date },
          { $set: { vitals_captured: merged } },
        );
        if (result && result.success === true && result.updated === 1) {
          return json({ session: project({ ...current, vitals_captured: merged }) });
        }
      }
      return json({ error: 'The visit changed while saving vitals. Please try again.' }, 409);
    }

    return json({ error: 'Unknown action' }, 400);
  } catch {
    console.error('manageTelehealthSession failed');
    return json({ error: 'Telehealth session request failed' }, 500);
  }
});
