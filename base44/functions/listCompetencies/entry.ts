import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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
    const base44 = createClientFromRequest(req);
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
