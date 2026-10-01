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

// The built-in role is platform-protected. Custom account_type and agency
// fields are self-editable and must never grant access to draft/archived policy
// records.
const isProtectedAdmin = (user) => !!user && user.role === 'admin';

function publicPolicy(row) {
  return {
    id: row.id,
    title: row.title || '',
    policy_number: row.policy_number || '',
    category: row.category || null,
    content: row.content || '',
    doc_url: row.doc_url || '',
    version: row.version || '',
    effective_date: row.effective_date || null,
    review_date: row.review_date || null,
    tags: Array.isArray(row.tags) ? row.tags.filter((tag) => typeof tag === 'string') : [],
    applies_to_roles: Array.isArray(row.applies_to_roles)
      ? row.applies_to_roles.filter((role) => typeof role === 'string')
      : [],
    status: row.status || 'active',
    created_date: row.created_date || null,
    updated_date: row.updated_date || null,
  };
}

// Active policies are an authenticated organization-wide reference used by
// course generation and acknowledgment. Only a protected built-in admin may
// request the full catalog (including draft and archived records).
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await base44.auth.me().catch(() => null);
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const mode = body?.mode === undefined ? 'active' : body.mode;
    if (mode !== 'active' && mode !== 'all') {
      return Response.json({ error: 'mode must be active or all' }, { status: 400 });
    }
    if (mode === 'all' && !isProtectedAdmin(user)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const entity = base44.asServiceRole.entities.PolicyLibrary;
    const rows = mode === 'all'
      ? await entity.list('-created_date', 200)
      : await entity.filter({ status: 'active' }, 'title', 200);
    const policies = (rows || [])
      .filter((row) => mode === 'all' || row?.status === 'active')
      .map(publicPolicy);

    return Response.json({ policies });
  } catch (error) {
    console.error('listPolicyLibrary failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
