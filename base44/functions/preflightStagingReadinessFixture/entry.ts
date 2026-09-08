import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

/**
 * Read-only eligibility and stale-row preflight for the one reviewed LR-01/LR-02
 * staging fixture. This function never creates, updates, deletes, invokes, or
 * sends anything. A successful response is not authorization for a later write.
 */

const FIXTURE_SET_ID = 'lr01-lr02-two-agency-v1';
const STAGING_APP_ID = '6a9881683dc68a0bd54f1ef7';
const STAGING_ORIGIN = 'https://caremetric-pennsync-staging-2026-09-d54f1ef7.base44.app/';
const RELEASE_SENTINEL = `${STAGING_APP_ID}:${FIXTURE_SET_ID}:read-only-v1`;
const ACTOR_KEYS = ['admin_a', 'clinician_a', 'clinician_a_empty', 'admin_b'] as const;
const TOP_LEVEL_KEYS = new Set(['fixture_set_id', 'target', 'actors']);
const TARGET_KEYS = ['environment', 'app_id', 'origin'];
const ACTOR_BINDING_KEYS = ['user_id', 'email'];
const MAX_BODY_BYTES = 8192;
const MAX_BODY_CHUNKS = 64;
const MAX_IDENTIFIER_LENGTH = 200;
const EXACT_ROW_LIMIT = 2;
const SDK_REQUEST_HEADER_NAMES = [
  'Authorization',
  'Base44-Service-Authorization',
  'Base44-App-Id',
] as const;
const USER_FIELDS = [
  'id',
  'email',
  'role',
  'is_active',
  'disabled',
  'is_service',
  'is_verified',
  'is_approved',
] as const;

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
  Pragma: 'no-cache',
};

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

class PublicError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'PublicError';
    this.status = status;
  }
}

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
  headers: Record<string, string> = {},
) {
  return Response.json(body, {
    status,
    headers: { ...NO_STORE_HEADERS, ...headers },
  });
}

function noStore(response: Response) {
  for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

function exactIdentifier(value: unknown) {
  if (typeof value !== 'string') return null;
  const hasControlCharacter = [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  if (
    !value
    || value.length > MAX_IDENTIFIER_LENGTH
    || value.trim() !== value
    || value.startsWith('$')
    || hasControlCharacter
  ) {
    return null;
  }
  return value;
}

function canonicalEmail(value: unknown) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 320 || !email.includes('@') || /\s/.test(email)) return null;
  return email;
}

function exactHttpsOrigin(value: unknown) {
  if (typeof value !== 'string' || !value || value.trim() !== value) return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== 'https:'
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
      || (parsed.pathname !== '' && parsed.pathname !== '/')
    ) {
      return null;
    }
    return `${parsed.origin}/`;
  } catch {
    return null;
  }
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function requireExactKeys(
  value: unknown,
  expectedKeys: readonly string[],
  message: string,
) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PublicError(400, message);
  }
  const actual = Object.keys(value as Record<string, unknown>).sort();
  const expected = [...expectedKeys].sort();
  if (!sameValue(actual, expected)) throw new PublicError(400, message);
}

function requireRows(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} returned a non-array result`);
  return value as Array<Record<string, unknown>>;
}

function requireRuntimeTarget(req: Request) {
  if (Deno.env.get('STAGING_READINESS_PREFLIGHT_RELEASE') !== RELEASE_SENTINEL) {
    throw new PublicError(503, 'Staging readiness preflight is disabled');
  }
  if (req.headers.get('Base44-App-Id') !== STAGING_APP_ID) {
    throw new PublicError(403, 'Staging readiness preflight target is unavailable');
  }
  if (exactHttpsOrigin(Deno.env.get('APP_PUBLIC_URL')) !== STAGING_ORIGIN) {
    throw new PublicError(503, 'Staging readiness preflight target is unavailable');
  }
  const dataEnvironment = req.headers.get('X-Data-Env');
  if (dataEnvironment !== null && dataEnvironment !== 'prod') {
    throw new PublicError(403, 'Staging readiness preflight data environment is unavailable');
  }
}

function createPinnedSdkRequest(req: Request) {
  const headers = new Headers();
  for (const name of SDK_REQUEST_HEADER_NAMES) {
    const value = req.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Request(STAGING_ORIGIN, { method: 'POST', headers });
}

function isProtectedPlatformOwner(user: Record<string, unknown>) {
  const configuredEmail = canonicalEmail(Deno.env.get('SUPER_ADMIN_EMAIL'));
  return !!configuredEmail
    && user.role === 'admin'
    && canonicalEmail(user.email) === configuredEmail;
}

function eligibleCallerSnapshot(user: Record<string, unknown>) {
  const id = exactIdentifier(user.id);
  const email = canonicalEmail(user.email);
  if (
    !id
    || !email
    || user.is_active !== true
    || (user.disabled !== false && user.disabled !== null)
    || user.is_service !== false
    || user.is_verified !== true
  ) {
    return null;
  }
  return {
    id,
    email,
    role: user.role,
    is_active: true,
    disabled: user.disabled,
    is_service: false,
    is_verified: true,
  };
}

function loadProtectedOwner(
  user: Record<string, unknown> | null,
  expected: Record<string, unknown> | null = null,
) {
  const snapshot = user ? eligibleCallerSnapshot(user) : null;
  if (expected) {
    if (!snapshot || !isProtectedPlatformOwner(user) || !sameValue(snapshot, expected)) {
      throw new PublicError(409, 'Platform owner authority changed during preflight');
    }
    return snapshot;
  }
  if (!user) throw new PublicError(401, 'Unauthorized');
  if (!snapshot || !isProtectedPlatformOwner(user)) throw new PublicError(403, 'Forbidden');
  return snapshot;
}

async function readBoundedBody(req: Request) {
  const statedLength = req.headers.get('content-length');
  if (statedLength !== null) {
    if (!/^(0|[1-9]\d*)$/.test(statedLength)) {
      throw new PublicError(400, 'Invalid Content-Length');
    }
    const length = Number(statedLength);
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new PublicError(400, 'Invalid Content-Length');
    }
    if (length > MAX_BODY_BYTES) throw new PublicError(413, 'Request body is too large');
  }

  const reader = req.body?.getReader();
  if (!reader) throw new PublicError(400, 'Invalid JSON body');
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let chunkCount = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new PublicError(400, 'Invalid request body');
      chunkCount += 1;
      if (chunkCount > MAX_BODY_CHUNKS) {
        await reader.cancel().catch(() => {});
        throw new PublicError(413, 'Request body has too many chunks');
      }
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        throw new PublicError(413, 'Request body is too large');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof PublicError) throw error;
    throw new PublicError(400, 'Invalid request body');
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new PublicError(400, 'Invalid request body encoding');
  }
}

async function parseRequest(
  req: Request,
  owner: { id: string; email: string },
) {
  const raw = await readBoundedBody(req);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new PublicError(400, 'Invalid JSON body');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PublicError(400, 'Request body must be an object');
  }
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !TOP_LEVEL_KEYS.has(key)) || Object.keys(body).length !== 3) {
    throw new PublicError(400, 'Request must contain the exact fixture preflight fields');
  }
  if (body.fixture_set_id !== FIXTURE_SET_ID) {
    throw new PublicError(400, 'Fixture set is not the reviewed staging fixture');
  }
  requireExactKeys(body.target, TARGET_KEYS, 'Target must match the exact reviewed staging target');
  const target = body.target as Record<string, unknown>;
  if (
    target.environment !== 'staging'
    || target.app_id !== STAGING_APP_ID
    || target.origin !== STAGING_ORIGIN
  ) {
    throw new PublicError(400, 'Target must match the exact reviewed staging target');
  }
  requireExactKeys(body.actors, ACTOR_KEYS, 'Actors must match the exact reviewed fixture aliases');

  const rawActors = body.actors as Record<string, unknown>;
  const actors: Record<string, { userId: string; email: string }> = {};
  const ids = new Set<string>();
  const emails = new Set<string>();
  for (const actorKey of ACTOR_KEYS) {
    requireExactKeys(
      rawActors[actorKey],
      ACTOR_BINDING_KEYS,
      'Each fixture actor must contain an exact User id and email',
    );
    const binding = rawActors[actorKey] as Record<string, unknown>;
    const userId = exactIdentifier(binding.user_id);
    const email = canonicalEmail(binding.email);
    if (!userId || !email) {
      throw new PublicError(400, 'Each fixture actor must contain an exact User id and email');
    }
    if (userId === owner.id || email === owner.email) {
      throw new PublicError(400, 'Fixture actors must be distinct from the platform owner');
    }
    if (ids.has(userId) || emails.has(email)) {
      throw new PublicError(400, 'Fixture actors must have distinct User identities');
    }
    ids.add(userId);
    emails.add(email);
    actors[actorKey] = { userId, email };
  }
  return { actors };
}

async function loadExactActor(
  entities: Record<string, any>,
  binding: { userId: string; email: string },
) {
  const rowsById = requireRows(
    await entities.User.filter(
      { id: binding.userId },
      undefined,
      EXACT_ROW_LIMIT,
      undefined,
      USER_FIELDS,
    ),
    'User.filter',
  );
  const rowsByEmail = requireRows(
    await entities.User.filter(
      { email: binding.email },
      undefined,
      EXACT_ROW_LIMIT,
      undefined,
      USER_FIELDS,
    ),
    'User.filter',
  );
  if (
    rowsById.length >= EXACT_ROW_LIMIT
    || rowsByEmail.length >= EXACT_ROW_LIMIT
    || rowsById.some((row) => row?.id !== binding.userId)
    || rowsByEmail.some((row) => canonicalEmail(row?.email) !== binding.email)
  ) {
    throw new PublicError(409, 'Fixture actor identity is ambiguous');
  }
  if (rowsById.length === 0) {
    return {
      state: rowsByEmail.length === 0 ? 'unavailable' : 'identity_mismatch',
      snapshot: rowsByEmail.length === 0
        ? null
        : { id: exactIdentifier(rowsByEmail[0]?.id), email: binding.email },
    };
  }
  if (rowsByEmail.length !== 1 || rowsByEmail[0]?.id !== binding.userId) {
    throw new PublicError(409, 'Fixture actor identity is ambiguous');
  }
  const user = rowsById[0];
  const email = canonicalEmail(user.email);
  const id = exactIdentifier(user.id);
  if (!id || !email || email !== binding.email) {
    return {
      state: 'identity_mismatch',
      snapshot: { id, email, role: user.role ?? null },
    };
  }
  const eligible = user.role === 'user'
    && user.is_active === true
    && (user.disabled === false || user.disabled === null)
    && user.is_service === false
    && user.is_verified === true
    && user.is_approved === true;
  return {
    state: eligible ? 'eligible' : 'ineligible',
    snapshot: {
      id,
      email,
      role: user.role ?? null,
      is_active: user.is_active,
      disabled: user.disabled,
      is_service: user.is_service,
      is_verified: user.is_verified,
      is_approved: user.is_approved,
    },
  };
}

async function loadExistence(
  handler: Record<string, any>,
  query: Record<string, unknown>,
  scopeField: string,
  scopeValue: string,
  fields: readonly string[],
  label: string,
) {
  const rows = requireRows(
    await handler.filter(query, undefined, EXACT_ROW_LIMIT, undefined, fields),
    `${label}.filter`,
  );
  if (rows.some((row) => row?.[scopeField] !== scopeValue)) {
    throw new PublicError(409, `${label} query scope could not be verified`);
  }
  const snapshot = rows.map((row) => {
    const id = exactIdentifier(row.id);
    if (!id) throw new PublicError(409, `${label} integrity check failed`);
    return { id, scope: row[scopeField] };
  }).sort((left, right) => left.id.localeCompare(right.id));
  return { present: rows.length > 0, saturated: rows.length >= EXACT_ROW_LIMIT, snapshot };
}

async function loadFixtureRegistry(entities: Record<string, any>) {
  const rows = requireRows(
    await entities.StagingReadinessFixture.filter(
      { fixture_set_id: FIXTURE_SET_ID },
      undefined,
      EXACT_ROW_LIMIT,
      undefined,
      ['id', 'fixture_set_id', 'environment', 'app_id', 'origin', 'status', 'version'],
    ),
    'StagingReadinessFixture.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) {
    throw new PublicError(409, 'Staging readiness fixture registry is ambiguous');
  }
  if (rows.some((row) => (
    row?.fixture_set_id !== FIXTURE_SET_ID
    || row?.environment !== 'staging'
    || row?.app_id !== STAGING_APP_ID
    || row?.origin !== STAGING_ORIGIN
    || !exactIdentifier(row?.id)
  ))) {
    throw new PublicError(409, 'Staging readiness fixture registry integrity check failed');
  }
  return {
    present: rows.length === 1,
    snapshot: rows.map((row) => ({
      id: row.id,
      fixture_set_id: row.fixture_set_id,
      environment: row.environment,
      app_id: row.app_id,
      origin: row.origin,
      status: row.status ?? null,
      version: row.version ?? null,
    })),
  };
}

async function inspectPreflight(
  entities: Record<string, any>,
  input: { actors: Record<string, { userId: string; email: string }> },
  ownerId: string,
) {
  const ownerMembership = await loadExistence(
    entities.AgencyMembership,
    { user_id: ownerId },
    'user_id',
    ownerId,
    ['id', 'user_id'],
    'AgencyMembership',
  );
  if (ownerMembership.present) {
    throw new PublicError(409, 'Platform owner tenant membership must not exist');
  }

  const fixtureRegistry = await loadFixtureRegistry(entities);
  const actors: Record<string, Record<string, unknown>> = {};
  for (const actorKey of ACTOR_KEYS) {
    const binding = input.actors[actorKey];
    const user = await loadExactActor(entities, binding);
    const membership = await loadExistence(
      entities.AgencyMembership,
      { user_id: binding.userId },
      'user_id',
      binding.userId,
      ['id', 'user_id'],
      'AgencyMembership',
    );
    const patient = await loadExistence(
      entities.Patient,
      { created_by_user_id: binding.userId },
      'created_by_user_id',
      binding.userId,
      ['id', 'created_by_user_id'],
      'Patient',
    );
    const assignment = await loadExistence(
      entities.PatientCareTeamAssignment,
      { user_id: binding.userId },
      'user_id',
      binding.userId,
      ['id', 'user_id'],
      'PatientCareTeamAssignment',
    );
    actors[actorKey] = { user, membership, patient, assignment };
  }
  return { ownerMembership, fixtureRegistry, actors };
}

function publicResult(snapshot: Record<string, any>) {
  const actors = Object.fromEntries(ACTOR_KEYS.map((actorKey) => {
    const actor = snapshot.actors[actorKey];
    return [actorKey, {
      user: actor.user.state,
      membership_collision: actor.membership.present,
      patient_collision: actor.patient.present,
      assignment_collision: actor.assignment.present,
    }];
  }));
  const actorValues = Object.values(actors) as Array<Record<string, unknown>>;
  const eligibleActors = actorValues.filter((actor) => actor.user === 'eligible').length;
  const collisionCategories = actorValues.reduce((total, actor) => (
    total
    + Number(actor.membership_collision === true)
    + Number(actor.patient_collision === true)
    + Number(actor.assignment_collision === true)
  ), snapshot.fixtureRegistry.present ? 1 : 0);
  const immutableAuthorityClear = eligibleActors === ACTOR_KEYS.length
    && collisionCategories === 0;
  return {
    inspection_completed: true,
    mode: 'read_only_preflight',
    status: immutableAuthorityClear ? 'immutable_authority_preflight_passed' : 'blocked',
    immutable_authority_clear: immutableAuthorityClear,
    fixture_set_id: FIXTURE_SET_ID,
    target: {
      environment: 'staging',
      app_id: STAGING_APP_ID,
      origin: STAGING_ORIGIN,
    },
    checks: {
      runtime_target: 'exact_staging_configuration',
      platform_owner_membership: 'absent',
      fixture_registry: snapshot.fixtureRegistry.present ? 'present' : 'absent',
      actors,
    },
    counts: {
      eligible_actors: eligibleActors,
      collision_categories: collisionCategories,
    },
    safeguards: {
      data_mutations_performed: false,
      outbound_actions_performed: false,
      credential_values_exposed: false,
      phi_values_exposed: false,
      later_writes_authorized: false,
    },
    limitations: [
      'does_not_prove_login_credentials',
      'does_not_prove_agency_key_collision_absence',
      'does_not_inspect_legacy_email_or_profile_links',
      'not_a_uniqueness_or_transaction_guarantee',
      'does_not_authorize_later_writes',
      'does_not_clear_lr01_or_lr02',
    ],
  };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405, { Allow: 'POST' });
    }
    requireRuntimeTarget(req);
    const base44 = createClientFromRequest(createPinnedSdkRequest(req));
    const caller = await base44.auth.me().catch(() => null);
    if (isDeactivatedUser(caller)) return noStore(DEACTIVATED_USER_RESPONSE());
    const owner = loadProtectedOwner(caller);
    const input = await parseRequest(req, owner);
    const entities = base44.asServiceRole.entities;
    const initial = await inspectPreflight(entities, input, String(owner.id));

    requireRuntimeTarget(req);
    const recheckedCaller = await base44.auth.me().catch(() => null);
    loadProtectedOwner(recheckedCaller, owner);
    const finalSnapshot = await inspectPreflight(entities, input, String(owner.id));
    if (!sameValue(initial, finalSnapshot)) {
      throw new PublicError(409, 'Staging readiness preflight changed during inspection');
    }
    return jsonResponse(publicResult(finalSnapshot));
  } catch (error) {
    if (error instanceof PublicError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    console.error('preflightStagingReadinessFixture failed');
    return jsonResponse({ error: 'Unable to inspect staging readiness fixture' }, 500);
  }
});
