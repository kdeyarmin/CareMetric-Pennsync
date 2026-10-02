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
// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

const CATEGORIES = new Set(['clinical', 'documentation', 'safety', 'communication', 'technical']);
const FREQUENCIES = new Set(['on_hire', 'annual', 'quarterly', 'as_needed']);

function optionalScalar(value, field, allowedValues = null) {
  if (value === undefined || value === null || value === '') return { value: null };
  if (typeof value !== 'string' || value.length > 100) {
    return { error: `${field} must be a short string` };
  }
  const normalized = value.trim();
  if (!normalized) return { value: null };
  if (allowedValues && !allowedValues.has(normalized)) {
    return { error: `${field} is invalid` };
  }
  return { value: normalized };
}

function publicCompetency(row) {
  return {
    id: row.id,
    name: row.name || '',
    role_target: Array.isArray(row.role_target) ? row.role_target.filter((role) => typeof role === 'string') : [],
    description: row.description || '',
    category: row.category || null,
    frequency: row.frequency || null,
    required_observations_count: Number.isFinite(Number(row.required_observations_count))
      ? Number(row.required_observations_count)
      : 1,
    active: row.active === true,
  };
}

function matchesRole(row, requestedRole) {
  if (!requestedRole) return true;
  const normalizedRole = requestedRole.toLowerCase();
  return Array.isArray(row?.role_target)
    && row.role_target.some((role) => String(role || '').trim().toLowerCase() === normalizedRole);
}

// Authenticated read broker for the global competency reference catalog. Direct
// entity access is service-only, so callers cannot mutate the catalog or inject
// datastore operators into a browser-side filter. All provider results are
// rechecked in memory after the service-role boundary.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await base44.auth.me().catch(() => null);
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const roleTarget = optionalScalar(body?.role_target, 'role_target');
    const category = optionalScalar(body?.category, 'category', CATEGORIES);
    const frequency = optionalScalar(body?.frequency, 'frequency', FREQUENCIES);
    const validationError = roleTarget.error || category.error || frequency.error;
    if (validationError) {
      return Response.json({ error: validationError }, { status: 400 });
    }

    const rows = await base44.asServiceRole.entities.Competency
      .filter({ active: true }, 'name', 5000);
    const competencies = (rows || [])
      .filter((row) => row?.active === true)
      .filter((row) => matchesRole(row, roleTarget.value))
      .filter((row) => !category.value || row?.category === category.value)
      .filter((row) => !frequency.value || row?.frequency === frequency.value)
      .map(publicCompetency);

    return Response.json({ competencies });
  } catch (error) {
    console.error('listCompetencies failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
