import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


// Returns per-course rating aggregates (average + count) plus the current user's
// own ratings. Aggregation happens server-side so the client never downloads
// every individual feedback row (perf + avoids exposing other users' feedback).

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const feedback = await base44.asServiceRole.entities.TrainingFeedback.list('-created_date', 5000);

    const agg = {};
    const mine = {};
    for (const f of feedback) {
      if (!f.course_id) continue;
      if (!agg[f.course_id]) agg[f.course_id] = { sum: 0, count: 0 };
      agg[f.course_id].sum += Number(f.rating) || 0;
      agg[f.course_id].count += 1;
      if (f.user_id === user.email) mine[f.course_id] = f.rating;
    }

    const summaries = {};
    for (const [courseId, s] of Object.entries(agg)) {
      summaries[courseId] = { avg: s.count ? s.sum / s.count : 0, count: s.count };
    }

    return Response.json({ summaries, mine });
  } catch (error) {
    console.error('getCourseFeedbackSummary failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});