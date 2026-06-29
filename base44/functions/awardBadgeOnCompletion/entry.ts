import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { attempt_id } = await req.json();

    // Get the attempt
    const attempt = await base44.entities.TrainingAttempt.filter({ id: attempt_id });
    if (!attempt || attempt.length === 0) {
      return Response.json({ error: 'Attempt not found' }, { status: 404 });
    }

    const attemptData = attempt[0];

    // Authorization: a user may only earn badges from their OWN attempt. The
    // attempt was read with the user-scoped client, but enforce ownership
    // explicitly so a forwarded/guessed attempt_id can't award to this account.
    // Fail closed: do NOT short-circuit when attemptData.user_id is falsy — a
    // legacy/imported attempt with a missing user_id must not award to whoever
    // forwards its id; treat an unknown owner as not-this-user.
    if (user.role !== 'admin' && attemptData.user_id !== user.email) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Idempotency (complete): once an attempt has been processed, re-running is a
    // no-op — this covers attempts that earn NO badge too, which would otherwise
    // re-bump streak/courses on every replay. The UserBadge check below is a
    // backstop for attempts processed before this marker field existed.
    if (attemptData.badges_processed_at) {
      return Response.json({ success: true, already_awarded: true, badges_awarded: 0, badges: [] });
    }
    const priorBadges = await base44.entities.UserBadge
      .filter({ user_id: user.email }, '-earned_at', 500).catch(() => []);
    if (priorBadges.some((b) => b?.trigger_context?.attempt_id === attemptData.id)) {
      return Response.json({ success: true, already_awarded: true, badges_awarded: 0, badges: [] });
    }

    // Claim the attempt BEFORE awarding. The marker was previously written only at
    // the very end, so two concurrent requests for the same attempt both passed the
    // check above and double-bumped streak/courses/points (the UserBadge backstop
    // only dedups badge rows, not the leaderboard increments). Writing it first
    // shrinks the race window to near-zero. (Base44 has no conditional update, so
    // this isn't a perfect CAS; a mid-run failure after this point forfeits this
    // attempt's badges rather than risking a double award — the safer trade.)
    await base44.entities.TrainingAttempt.update(attemptData.id, {
      badges_processed_at: new Date().toISOString(),
    }).catch((e) => console.error('Failed to claim attempt badges_processed_at:', e?.message));

    const badgesAwarded = [];

    // Get or create leaderboard entry
    let leaderboard = await base44.entities.Leaderboard.filter({ user_id: user.email });
    if (!leaderboard || leaderboard.length === 0) {
      leaderboard = [await base44.entities.Leaderboard.create({
        user_id: user.email,
        user_name: user.full_name,
        total_points: 0,
        badges_earned: 0,
        courses_completed: 0,
        current_streak: 0,
        longest_streak: 0,
        perfect_scores: 0
      })];
    }
    const leaderboardEntry = leaderboard[0];

    // Get all available badges
    const allBadges = await base44.entities.SkillBadge.filter({ active: true });

    // Resolve the assignment and whether this attempt actually PASSED up front, so
    // achievement badges (high score, early completion, streak) and the
    // streak/courses counters are never awarded for a failed attempt.
    const assignment = await base44.entities.TrainingAssignment.filter({ id: attemptData.assignment_id });
    const passingScore = (assignment && assignment[0]?.passing_score_required) ?? 80;
    const passed = attemptData.pass_fail_result
      ? attemptData.pass_fail_result === 'passed'
      : (Number(attemptData.score) || 0) >= passingScore;

    // Check for Perfect Score (100%) — a perfect score is always a pass.
    if (attemptData.score === 100) {
      const perfectBadge = allBadges.find(b => b.badge_type === 'perfect_score');
      if (perfectBadge) {
        const userBadge = await base44.entities.UserBadge.create({
          user_id: user.email,
          user_name: user.full_name,
          badge_id: perfectBadge.id,
          badge_name: perfectBadge.name,
          badge_type: perfectBadge.badge_type,
          earned_at: new Date().toISOString(),
          points_awarded: perfectBadge.points,
          trigger_context: {
            attempt_id: attemptData.id,
            course_id: attemptData.course_id,
            score: attemptData.score
          }
        });
        badgesAwarded.push(userBadge);

        // Update leaderboard perfect scores
        await base44.entities.Leaderboard.update(leaderboardEntry.id, {
          perfect_scores: (leaderboardEntry.perfect_scores || 0) + 1
        });
      }
    }

    // Check for High Score (90%+) — only when the attempt also passed (a course
    // whose passing_score_required exceeds 90 can score 90-99 and still fail).
    if (passed && attemptData.score >= 90 && attemptData.score < 100) {
      const highScoreBadge = allBadges.find(b => b.badge_type === 'high_score');
      if (highScoreBadge) {
        const userBadge = await base44.entities.UserBadge.create({
          user_id: user.email,
          user_name: user.full_name,
          badge_id: highScoreBadge.id,
          badge_name: highScoreBadge.name,
          badge_type: highScoreBadge.badge_type,
          earned_at: new Date().toISOString(),
          points_awarded: highScoreBadge.points,
          trigger_context: {
            attempt_id: attemptData.id,
            course_id: attemptData.course_id,
            score: attemptData.score
          }
        });
        badgesAwarded.push(userBadge);
      }
    }

    // Check for Early Completion (completed before due date) — only for a passing
    // attempt; finishing a FAILED in-service early must not earn the badge/points.
    if (passed && assignment && assignment.length > 0) {
      const dueDate = new Date(assignment[0].due_date);
      const completedDate = new Date(attemptData.submitted_at);
      const daysEarly = Math.ceil((dueDate - completedDate) / (1000 * 60 * 60 * 24));

      if (daysEarly > 0) {
        const earlyBadge = allBadges.find(b => b.badge_type === 'early_completion');
        if (earlyBadge) {
          const userBadge = await base44.entities.UserBadge.create({
            user_id: user.email,
            user_name: user.full_name,
            badge_id: earlyBadge.id,
            badge_name: earlyBadge.name,
            badge_type: earlyBadge.badge_type,
            earned_at: new Date().toISOString(),
            points_awarded: earlyBadge.points,
            trigger_context: {
              attempt_id: attemptData.id,
              course_id: attemptData.course_id,
              days_early: daysEarly
            }
          });
          badgesAwarded.push(userBadge);
        }
      }
    }

    // Only a PASSING attempt advances the streak / course count (passed/passingScore
    // resolved above). A failed attempt must not inflate current_streak /
    // courses_completed or trip a streak badge.
    // Update streak (unchanged on a failed attempt rather than incremented)
    const newStreak = passed
      ? (leaderboardEntry.current_streak || 0) + 1
      : (leaderboardEntry.current_streak || 0);
    const longestStreak = Math.max(newStreak, leaderboardEntry.longest_streak || 0);

    // Check for Streak Badge (5, 10, 20, 50 completions) — only when a pass
    // actually advanced the streak.
    const streakMilestones = [5, 10, 20, 50];
    if (passed && streakMilestones.includes(newStreak)) {
      const streakBadge = allBadges.find(b => b.badge_type === 'streak');
      if (streakBadge) {
        const userBadge = await base44.entities.UserBadge.create({
          user_id: user.email,
          user_name: user.full_name,
          badge_id: streakBadge.id,
          badge_name: `${newStreak} Course Streak`,
          badge_type: streakBadge.badge_type,
          earned_at: new Date().toISOString(),
          points_awarded: streakBadge.points * (newStreak / 5),
          trigger_context: {
            streak_count: newStreak
          }
        });
        badgesAwarded.push(userBadge);
      }
    }

    // Calculate total points from badges
    const totalPointsFromBadges = badgesAwarded.reduce((sum, badge) => sum + (badge.points_awarded || 0), 0);

    // Update leaderboard
    await base44.entities.Leaderboard.update(leaderboardEntry.id, {
      total_points: (leaderboardEntry.total_points || 0) + totalPointsFromBadges,
      badges_earned: (leaderboardEntry.badges_earned || 0) + badgesAwarded.length,
      courses_completed: (leaderboardEntry.courses_completed || 0) + (passed ? 1 : 0),
      current_streak: newStreak,
      longest_streak: longestStreak,
      last_activity: new Date().toISOString()
    });

    // Send notification for each badge earned
    for (const badge of badgesAwarded) {
      await base44.entities.Notification.create({
        user_email: user.email,
        title: '🎉 New Badge Earned!',
        message: `Congratulations! You earned the "${badge.badge_name}" badge and ${badge.points_awarded} points!`,
        type: 'info',
        priority: 'low',
        action_url: '/LearningCenter',
        action_label: 'View Learning',
        metadata: {
          badge_id: badge.badge_id,
          badge_name: badge.badge_name,
          points: badge.points_awarded
        }
      });
    }

    // (badges_processed_at is claimed up front, before any awards — see above.)

    return Response.json({
      success: true,
      badges_awarded: badgesAwarded.length,
      badges: badgesAwarded,
      total_points_earned: totalPointsFromBadges,
      new_streak: newStreak
    });

  } catch (error) {
    console.error('Badge awarding failed:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});