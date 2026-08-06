import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


// Financial visibility gate. MIRRORS src/lib/permissions.canViewFinancials
// (isAdminLike) — backend Deno modules can't import src/lib, so the admin
// checks are duplicated here. Keep in sync.
function canViewFinancials(user) {
  if (!user) return false;
  return (
    user.role === 'admin' ||
    user.account_type === 'agency_admin' ||
    user.account_type === 'super_admin'
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
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { patientId, sort = '-created_date', limit = 50, assessmentDateFrom, assessmentDateTo } = body || {};
    // Bounded like the other service reads — an unbounded list would silently
    // truncate at the SDK page default; a runaway limit would time out.
    const boundedLimit = Math.min(Math.max(Number(limit) || 50, 1), 1000);

    // Optional assessment-date range so report callers can scope server-side
    // instead of date-filtering a newest-N page (which undercounts any period
    // holding more than N uploads). Bounds compare lexicographically, which is
    // correct for both "YYYY-MM-DD" and ISO datetime storage: the lower bound
    // stays date-only (a date-only stored value sorts BEFORE "…T00:00:00"),
    // the upper bound gets the end-of-day suffix so datetime values match.
    const query = {};
    if (patientId) query.patient_id = patientId;
    if (assessmentDateFrom || assessmentDateTo) {
      query.assessment_date = {};
      if (assessmentDateFrom) query.assessment_date.$gte = String(assessmentDateFrom).slice(0, 10);
      if (assessmentDateTo) query.assessment_date.$lte = `${String(assessmentDateTo).slice(0, 10)}T23:59:59.999`;
    }

    // Reads run as the requesting user, so the entity's row-level access still
    // applies; this function only removes financial COLUMNS on top of that.
    const records = Object.keys(query).length
      ? await base44.entities.OASISUpload.filter(query, sort, boundedLimit)
      : await base44.entities.OASISUpload.list(sort, boundedLimit);

    const allowed = canViewFinancials(user);
    const uploads = allowed ? records : (records || []).map(stripFinancial);
    return Response.json({ uploads, financialsRestricted: !allowed });
  } catch (error) {
    console.error('listOASISUploads failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});