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
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
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
