import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ───────────────────────────────────────────────────────────────────────────
// Scheduled reconcile for in-flight HeyGen training videos. manageTrainingVideos
// only finalizes a 'processing' module when an admin has Video Studio open and
// the UI polls `status`. This job closes that gap: it polls HeyGen once for
// every module still 'processing' (e.g. videos kicked off at course-creation
// time) and finalizes the completed/failed ones — so videos finish without
// anyone watching. Mirrors the status-poll logic in manageTrainingVideos and the
// scheduled-job auth pattern of processTrainingRenewals.
// ───────────────────────────────────────────────────────────────────────────

const HEYGEN_API_KEY = Deno.env.get('HEYGEN_API_KEY') || '';
const HEYGEN_BASE = 'https://api.heygen.com';

async function heygen(path, method) {
  const res = await fetch(`${HEYGEN_BASE}${path}`, {
    method,
    headers: { 'x-api-key': HEYGEN_API_KEY, 'Content-Type': 'application/json' },
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
    const isAdmin = me?.role === 'admin' || me?.account_type === 'agency_admin' || me?.account_type === 'super_admin';
    const internalSecret = Deno.env.get('INTERNAL_FN_SECRET');
    if (internalSecret) {
      if (!isAdmin && req.headers.get('x-internal-secret') !== internalSecret) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
    } else if (me && !isAdmin) {
      return Response.json({ error: 'Forbidden: admin access required' }, { status: 403 });
    }

    if (!HEYGEN_API_KEY) {
      return Response.json({ success: true, heygen_configured: false, checked: 0, completed: 0, failed: 0 });
    }

    const svc = base44.asServiceRole.entities;
    const processing = (await svc.TrainingModule.filter({ video_status: 'processing' }, '-updated_date', 1000))
      .filter((m) => m.video_job_id);

    let completed = 0;
    let failed = 0;

    await runChunked(processing, 5, async (m) => {
      try {
        const r = await heygen(`/v1/video_status.get?video_id=${encodeURIComponent(String(m.video_job_id))}`, 'GET');
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
    return Response.json({ error: error.message }, { status: 500 });
  }
});
