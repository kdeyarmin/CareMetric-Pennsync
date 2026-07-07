import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// saveFollowUpRuleConfig — the ONLY write path for the agency's follow-up
// review configuration (mirrors savePDGMRateConfig). The FollowUpRuleConfig
// entity is service-role-write only, so browsers can't write it directly;
// this function gates on admin and sanitizes the payload shape.

const SEVERITIES = new Set(['critical', 'high', 'medium']);

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
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

    const payload = {
      disabled_rules,
      severity_overrides,
      custom_items,
      updated_by_email: user.email,
    };

    const existing = await base44.asServiceRole.entities.FollowUpRuleConfig.list('-created_date', 1).catch(() => []);
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