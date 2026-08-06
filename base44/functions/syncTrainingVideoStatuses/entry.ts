import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: schedulerAuth — generated, edit base44/_shared/backendHelpers.mjs>>>
const SCHEDULER_SECRET_HEADER = 'x-internal-secret';
function isSchedulerAdmin(user) {
  return !!user && (
    user.role === 'admin' || user.account_type === 'agency_admin' ||
    user.account_type === 'super_admin'
  );
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
    const base44 = createClientFromRequest(req);

    const me = await base44.auth.me().catch(() => null);
    const authError = getSchedulerAuthError(req, me);
    if (authError) return authError;
    if (isDeactivatedUser(me)) return DEACTIVATED_USER_RESPONSE();

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