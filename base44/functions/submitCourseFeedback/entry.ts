import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Records (or updates) the current user's rating for a published course.
// One feedback record per user/course — re-submitting updates the existing row.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { courseId, rating, comment = '', wouldRecommend = null, difficulty = null } = await req.json();
    if (!courseId) {
      return Response.json({ error: 'courseId is required' }, { status: 400 });
    }
    const numericRating = Number(rating);
    if (!Number.isFinite(numericRating) || numericRating < 1 || numericRating > 5) {
      return Response.json({ error: 'rating must be between 1 and 5' }, { status: 400 });
    }

    const [course] = await base44.asServiceRole.entities.TrainingCourse.filter({ id: courseId });
    if (!course) {
      return Response.json({ error: 'Course not found' }, { status: 404 });
    }
    if (course.status !== 'published') {
      return Response.json({ error: 'Course is not available for feedback' }, { status: 400 });
    }

    // Only learners who actually completed the course may rate it, so catalog
    // averages can't be corrupted by callers who never took the course.
    const userAssignments = await base44.asServiceRole.entities.TrainingAssignment.filter(
      { course_id: courseId, assigned_to_user_id: user.email },
      '-created_date',
      25
    );
    let hasCompleted = userAssignments.some(
      (a) => a.status === 'completed' || a.pass_fail_result === 'passed'
    );
    if (!hasCompleted) {
      const certs = await base44.asServiceRole.entities.TrainingCertificate.filter(
        { course_id: courseId, user_id: user.email },
        '-issued_at',
        5
      );
      hasCompleted = certs.length > 0;
    }
    if (!hasCompleted) {
      return Response.json(
        { error: 'You can only rate courses you have completed.' },
        { status: 403 }
      );
    }

    const payload = {
      course_id: courseId,
      course_title: course.title,
      user_id: user.email,
      user_name: user.full_name || user.email,
      rating: Math.round(numericRating),
      comment: String(comment || '').slice(0, 2000),
      ...(wouldRecommend !== null ? { would_recommend: !!wouldRecommend } : {}),
      ...(difficulty ? { difficulty } : {}),
    };

    const existing = await base44.asServiceRole.entities.TrainingFeedback.filter(
      { course_id: courseId, user_id: user.email },
      '-created_date',
      5
    );

    let record;
    if (existing[0]) {
      record = await base44.asServiceRole.entities.TrainingFeedback.update(existing[0].id, payload);
    } else {
      record = await base44.asServiceRole.entities.TrainingFeedback.create(payload);
    }

    return Response.json({ success: true, feedback_id: record.id, updated: !!existing[0] });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});