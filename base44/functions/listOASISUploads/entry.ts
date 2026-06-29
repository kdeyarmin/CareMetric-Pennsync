import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Financial visibility gate. MIRRORS src/lib/permissions.canViewFinancials
// (isAdminLike) — backend Deno modules can't import src/lib, so the literal
// owner email and admin checks are duplicated here. Keep in sync.
const SUPER_ADMIN_EMAIL = ((typeof Deno !== 'undefined' && Deno.env.get('SUPER_ADMIN_EMAIL')) || '').trim().toLowerCase() || null;
function canViewFinancials(user) {
  if (!user) return false;
  return (
    user.role === 'admin' ||
    user.account_type === 'agency_admin' ||
    user.account_type === 'super_admin' ||
    String(user.email || '').trim().toLowerCase() === SUPER_ADMIN_EMAIL
  );
}

// Recursively drop any object key whose name implies money (revenue / payment /
// reimbursement) so an OASISUpload returned to a non-financial user (a nurse)
// carries NO dollar figures, while every clinical field — scores, functional
// impairment level, clinical group, compliance, documentation, extracted_data —
// is preserved. This is the server-side backing for the client FinancialGate:
// it closes the vector where financial fields persisted on the OASISUpload
// record (estimated_payment, scores.revenue_optimization, analysis_results'
// revenue_* fields) were visible in the raw API response via dev tools.
const FINANCIAL_KEY = /revenue|payment|reimburs/i;
function stripFinancial(value) {
  if (Array.isArray(value)) return value.map(stripFinancial);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (FINANCIAL_KEY.test(k)) continue;
      out[k] = stripFinancial(v);
    }
    return out;
  }
  return value;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { patientId, sort = '-created_date', limit = 50 } = body || {};

    // Reads run as the requesting user, so the entity's row-level access still
    // applies; this function only removes financial COLUMNS on top of that.
    const records = patientId
      ? await base44.entities.OASISUpload.filter({ patient_id: patientId }, sort, limit)
      : await base44.entities.OASISUpload.list(sort, limit);

    const allowed = canViewFinancials(user);
    const uploads = allowed ? records : (records || []).map(stripFinancial);
    return Response.json({ uploads, financialsRestricted: !allowed });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});