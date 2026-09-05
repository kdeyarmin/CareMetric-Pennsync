import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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
    const base44 = createClientFromRequest(req);
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
