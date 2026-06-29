import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Returns per-course rating aggregates (average + count) plus the current user's
// own ratings. Aggregation happens server-side so the client never downloads
// every individual feedback row (perf + avoids exposing other users' feedback).

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
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
    return Response.json({ error: error.message }, { status: 500 });
  }
});