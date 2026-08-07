import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


// saveFollowUpRuleConfig — the ONLY write path for the agency's follow-up
// review configuration (mirrors savePDGMRateConfig). The FollowUpRuleConfig
// entity is service-role-write only, so browsers can't write it directly;
// this function gates on admin and sanitizes the payload shape.

const SEVERITIES = new Set(['critical', 'high', 'medium']);

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    const isAdmin = user?.role === 'admin' || user?.account_type === 'agency_admin' || user?.account_type === 'super_admin';
    if (!user || !isAdmin) {
      return Response.json({ error: 'Forbidden: admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));

    // Guard against empty payloads: an accidental invocation with no body
    // would wipe the agency's existing config with empty defaults.
    if (!body || Object.keys(body).length === 0) {
      return Response.json({ error: 'Request body is required (disabled_rules, severity_overrides, or custom_items)' }, { status: 400 });
    }

    const disabled_rules = Array.isArray(body.disabled_rules)
      ? body.disabled_rules.filter((r: unknown) => typeof r === 'string').slice(0, 100)
      : [];

    const severity_overrides: Record<string, string> = {};
    if (body.severity_overrides && typeof body.severity_overrides === 'object') {
      for (const [key, val] of Object.entries(body.severity_overrides)) {
        if (typeof key === 'string' && SEVERITIES.has(String(val))) {
          severity_overrides[key] = String(val);
        }
      }
    }

    const custom_items = Array.isArray(body.custom_items)
      ? body.custom_items
          .filter((c: Record<string, unknown>) => c && typeof c.title === 'string' && c.title.trim() && typeof c.question === 'string' && c.question.trim())
          .slice(0, 50)
          .map((c: Record<string, unknown>) => ({
            title: String(c.title).slice(0, 200),
            question: String(c.question).slice(0, 1000),
            category: c.category === 'reimbursement' ? 'reimbursement' : 'compliance',
            severity: SEVERITIES.has(String(c.severity)) ? String(c.severity) : 'medium',
            why: String(c.why || '').slice(0, 1000),
            citation: String(c.citation || '').slice(0, 200),
            impact: String(c.impact || '').slice(0, 300),
            hint: String(c.hint || '').slice(0, 300),
            response_type: c.response_type === 'document' ? 'document' : 'text',
          }))
      : [];

    const agencyName = String(user.agency_name || '').trim();
    const isAgencyScoped = user.account_type !== 'super_admin'
      && agencyName
      && (user.account_type === 'agency_admin' || user.role === 'admin');
    // Only agency_admin accounts require agency_name. Bare role:admin with no
    // agency is platform-wide and may manage the unscoped legacy config row.
    // (The prior `isAgencyScoped && !agencyName` check was dead — isAgencyScoped
    // already requires a truthy agencyName.)
    if (user.account_type === 'agency_admin' && !agencyName) {
      return Response.json({ error: 'Forbidden: agency_name is required' }, { status: 403 });
    }

    const payload = {
      disabled_rules,
      severity_overrides,
      custom_items,
      updated_by_email: user.email,
      ...(agencyName ? { agency_name: agencyName } : {}),
    };

    // Prefer the caller's agency row; never overwrite another tenant's newest row.
    let existing = [];
    if (agencyName) {
      existing = await base44.asServiceRole.entities.FollowUpRuleConfig
        .filter({ agency_name: agencyName }, '-created_date', 1).catch(() => []);
    }
    if (!existing?.length && !isAgencyScoped) {
      // Only touch a legacy unscoped row when it is unambiguously the only
      // candidate — never clobber another tenant's newest row.
      const newest = await base44.asServiceRole.entities.FollowUpRuleConfig
        .list('-created_date', 5).catch(() => []);
      const legacy = (newest || []).filter((r) => !String(r?.agency_name || '').trim());
      if (legacy.length === 1) existing = legacy;
      else if ((newest || []).length === 1 && !String(newest[0]?.agency_name || '').trim()) {
        existing = newest;
      } else {
        existing = [];
      }
    }
    const current = existing && existing[0];
    const saved = current
      ? await base44.asServiceRole.entities.FollowUpRuleConfig.update(current.id, payload)
      : await base44.asServiceRole.entities.FollowUpRuleConfig.create(payload);

    return Response.json({ success: true, id: saved.id });
  } catch (error) {
    console.error('saveFollowUpRuleConfig error:', error);
    return Response.json({ error: 'Failed to save follow-up rule configuration' }, { status: 500 });
  }
});