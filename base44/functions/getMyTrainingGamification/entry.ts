import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

function publicLeaderboardRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_name: row.user_name || '',
    total_points: Number(row.total_points) || 0,
    badges_earned: Number(row.badges_earned) || 0,
    courses_completed: Number(row.courses_completed) || 0,
    current_streak: Number(row.current_streak) || 0,
    longest_streak: Number(row.longest_streak) || 0,
    perfect_scores: Number(row.perfect_scores) || 0,
    average_score: Number.isFinite(Number(row.average_score)) ? Number(row.average_score) : null,
    last_activity: row.last_activity || null,
  };
}

function publicBadgeRow(row) {
  const rarity = String(row?.trigger_context?.rarity || 'common').trim().toLowerCase();
  return {
    id: row.id,
    badge_name: row.badge_name || '',
    badge_type: row.badge_type || '',
    earned_at: row.earned_at || null,
    points_awarded: Number(row.points_awarded) || 0,
    trigger_context: {
      rarity: ['common', 'uncommon', 'rare', 'epic', 'legendary'].includes(rarity)
        ? rarity
        : 'common',
    },
  };
}

// Self-service achievement broker. UserBadge and Leaderboard contain user
// identifiers and cannot safely expose an app-wide leaderboard until tenant
// membership is immutable and server-owned. This endpoint deliberately ignores
// any caller-supplied user id and returns only the authenticated user's rows.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const ownerEmail = normalizeEmail(user.email);
    const [leaderboardRows, badgeRows] = await Promise.all([
      base44.asServiceRole.entities.Leaderboard
        .filter({ user_id: user.email }, '-updated_date', 50),
      base44.asServiceRole.entities.UserBadge
        .filter({ user_id: user.email, displayed: true }, '-earned_at', 100),
    ]);

    // Do not rely on the backend filter alone after crossing the service-role
    // boundary. An exact in-memory ownership check fails closed if a provider
    // regression ever returns rows outside the requested predicate.
    const ownLeaderboard = (leaderboardRows || []).filter(
      (row) => normalizeEmail(row?.user_id) === ownerEmail,
    );
    const ownBadges = (badgeRows || []).filter(
      (row) => normalizeEmail(row?.user_id) === ownerEmail && row?.displayed !== false,
    );

    return Response.json({
      leaderboard: publicLeaderboardRow(ownLeaderboard[0] || null),
      badges: ownBadges.slice(0, 50).map(publicBadgeRow),
      team_rank_available: false,
    });
  } catch (error) {
    console.error('getMyTrainingGamification failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
