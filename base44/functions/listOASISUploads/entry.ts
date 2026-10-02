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

// Fail closed until reads are brokered through immutable tenant/patient
// authority and a source-projected response that excludes legacy OASIS/PDGM AI.
const OASIS_UPLOAD_LIST_ENABLED = false;

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
  if (!OASIS_UPLOAD_LIST_ENABLED) {
    return Response.json({
      success: false,
      available: false,
      reason: 'oasis_upload_listing_paused',
      message: 'OASIS upload listing is unavailable pending tenant-scoped server authorization and a safe response projection.',
      uploads: [],
      financialsRestricted: true,
    }, { status: 409 });
  }

  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
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

    // PDGM reimbursement is globally fail-closed, so legacy estimator/revenue
    // fields are stripped for every role, including built-in admins.
    const uploads = (records || []).map(stripFinancial);
    return Response.json({ uploads, financialsRestricted: true });
  } catch (error) {
    console.error('listOASISUploads failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
