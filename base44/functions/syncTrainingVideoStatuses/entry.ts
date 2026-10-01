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
// <<<BEGIN SHARED HELPER: schedulerAuth — generated, edit base44/_shared/backendHelpers.mjs>>>
const SCHEDULER_SECRET_HEADER = 'x-internal-secret';
function isSchedulerAdmin(user) {
  return !!user && user.role === 'admin';
}
// Constant-time string compare for the shared-secret check (mirrors
// createTelehealthToken's timingSafeEqual). A plain === short-circuits on the
// first differing character, so response timing could leak how much of the
// secret matched. Dependency-free char-code XOR so the identical source runs
// under Deno (consumers) and Node (tests).
function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
function getSchedulerAuthError(req, user) {
  if (isSchedulerAdmin(user)) return null;
  const expectedSecret = String(Deno.env.get('INTERNAL_FN_SECRET') || '').trim();
  if (!expectedSecret) {
    return Response.json(
      { error: 'Server misconfigured: INTERNAL_FN_SECRET is required for scheduled/internal functions' },
      { status: 500 },
    );
  }
  const providedSecret = String(req.headers.get(SCHEDULER_SECRET_HEADER) || '').trim();
  if (timingSafeEqualStr(providedSecret, expectedSecret)) return null;
  return Response.json(
    { error: user ? 'Forbidden: admin or scheduler secret required' : 'Unauthorized: scheduler secret required' },
    { status: user ? 403 : 401 },
  );
}
// <<<END SHARED HELPER: schedulerAuth>>>

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


// ───────────────────────────────────────────────────────────────────────────
// Scheduled reconcile for in-flight HeyGen training videos. manageTrainingVideos
// only finalizes a 'processing' module when an admin has Video Studio open and
// the UI polls `status`. This job closes that gap: it polls HeyGen once for
// every module still 'processing' (e.g. videos kicked off at course-creation
// time) and finalizes the completed/failed ones — so videos finish without
// anyone watching. Mirrors the status-poll logic in manageTrainingVideos and the
// scheduled-job auth pattern of processTrainingRenewals.
// ───────────────────────────────────────────────────────────────────────────

const HEYGEN_BASE = 'https://api.heygen.com';
const getHeyGenApiKey = () => Deno.env.get('HEYGEN_API_KEY') || '';

async function heygen(path, method, apiKey) {
  const res = await fetch(`${HEYGEN_BASE}${path}`, {
    method,
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`HeyGen API error ${res.status}`);
  return res.json();
}

// Bounded concurrency so a large backlog doesn't flood the provider.
async function runChunked(items, size, fn) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));

    const me = await base44.auth.me().catch(() => null);
    const authError = getSchedulerAuthError(req, me);
    if (authError) return authError;
    if (isDeactivatedUser(me)) return DEACTIVATED_USER_RESPONSE();

    if (Deno.env.get('CENTRAL_LEARNING_RELEASE') === 'hub-runtime-v1') {
      return Response.json({ success: true, skipped: true, reason: 'central_learning', checked: 0, completed: 0, failed: 0 });
    }

    const heygenApiKey = getHeyGenApiKey();
    if (!heygenApiKey) {
      return Response.json({ success: true, heygen_configured: false, checked: 0, completed: 0, failed: 0 });
    }

    const svc = base44.asServiceRole.entities;
    const processing = (await svc.TrainingModule.filter({ video_status: 'processing' }, '-updated_date', 1000))
      .filter((m) => m.video_job_id);

    let completed = 0;
    let failed = 0;

    await runChunked(processing, 5, async (m) => {
      try {
        const r = await heygen(`/v1/video_status.get?video_id=${encodeURIComponent(String(m.video_job_id))}`, 'GET', heygenApiKey);
        const d = r.data || {};
        if (d.status === 'completed') {
          await svc.TrainingModule.update(m.id, {
            video_url: d.video_url,
            video_thumbnail_url: d.thumbnail_url,
            video_duration_seconds: d.duration,
            video_status: 'completed',
            video_generated_at: new Date().toISOString(),
            video_error: '',
            type: 'video',
          });
          completed += 1;
        } else if (d.status === 'failed') {
          const err = (d.error && (d.error.message || d.error)) || 'Generation failed';
          await svc.TrainingModule.update(m.id, { video_status: 'failed', video_error: String(err) });
          failed += 1;
        }
        // pending / processing / waiting → leave as processing for the next run
      } catch (_e) {
        // transient poll error — keep processing, retry next run
      }
    });

    return Response.json({ success: true, heygen_configured: true, checked: processing.length, completed, failed });
  } catch (error) {
    console.error('syncTrainingVideoStatuses failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});