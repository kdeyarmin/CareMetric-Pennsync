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


/**
 * autoEndDutyDay — scheduled end-of-day sweep. Flips nurses still toggled
 * 'on_duty' back to 'off_duty' once their agency's auto-off hour has passed
 * (or their on-duty toggle is from a prior calendar day). Schedule hourly (or
 * at least daily) so multi-tenant agencies with different duty_timezone /
 * auto_off_duty_hour values each flip at the right local time.
 *
 * The inbound call/SMS webhook ALSO treats a nurse as off duty in real time once
 * the clock passes the auto-off hour, so calls/texts route to the office even
 * before this sweep runs — this function just persists that so the toggle and
 * the morning default reflect reality.
 *
 * Auth: runs as a scheduled job (service role). Admins may invoke it manually,
 * and unattended scheduler runs must send `x-internal-secret`.
 */

// Mirrors src/components/voice/dutyUtils.js (single-file Deno deploy).
const DEFAULT_AUTO_OFF_HOUR = 17;
const DEFAULT_DUTY_TIMEZONE = 'America/New_York';

function dutyHourInZone(date, timeZone) {
  try {
    const h = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || undefined, hour12: false, hour: '2-digit',
    }).format(date);
    let n = parseInt(h, 10);
    if (n === 24) n = 0;
    return Number.isNaN(n) ? null : n;
  } catch {
    return null;
  }
}

function dateKeyInZone(date, timeZone) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || undefined, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(date);
  }
}

function isPastAutoOffHour(settings, now = new Date()) {
  const s = settings || {};
  if (s.auto_off_duty_enabled === false) return false;
  const hour = Number.isFinite(Number(s.auto_off_duty_hour))
    ? Number(s.auto_off_duty_hour)
    : DEFAULT_AUTO_OFF_HOUR;
  const tz = s.duty_timezone || s.business_hours_timezone || DEFAULT_DUTY_TIMEZONE;
  const h = dutyHourInZone(now, tz);
  if (h == null) return false;
  return h >= hour;
}

/** True when duty_on_since is from a prior calendar day in the duty timezone. */
function isStaleDutyDay(user, settings, now = new Date()) {
  if (!user?.duty_on_since) return false;
  const tz = (settings && (settings.duty_timezone || settings.business_hours_timezone))
    || DEFAULT_DUTY_TIMEZONE;
  const onKey = dateKeyInZone(new Date(user.duty_on_since), tz);
  const nowKey = dateKeyInZone(now, tz);
  if (!onKey || !nowKey) return false;
  return onKey !== nowKey;
}

/**
 * Resolve AgencySettings for a user.agency_name hint.
 * Multi-tenant miss → empty settings (defaults to 5pm ET), never another agency's row.
 */
function resolveSettingsForAgency(allSettings, agencyName) {
  const key = String(agencyName || '').trim();
  const rows = allSettings || [];
  if (key) {
    const byCode = rows.find((r) => String(r.agency_code || '').trim() === key);
    if (byCode) return byCode;
    const byOffice = rows.find((r) => String(r.office_name || '').trim() === key);
    if (byOffice) return byOffice;
    // Multi-tenant: do not fall through to another agency's settings.
    if (rows.length > 1) return {};
  }
  if (rows.length === 1) return rows[0];
  if (rows.length > 1) return {};
  return rows[0] || {};
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Zero-config scheduled job: admins may trigger it manually, and unattended
    // scheduler runs must send `x-internal-secret`.
    const user = await base44.auth.me().catch(() => null);
    const authError = getSchedulerAuthError(req, user);
    if (authError) return authError;
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    const now = new Date();
    const [onDuty, allSettings] = await Promise.all([
      base44.asServiceRole.entities.User.filter({ duty_status: 'on_duty' }, '-created_date', 5000).catch(() => []),
      base44.asServiceRole.entities.AgencySettings.list('-created_date', 200).catch(() => []),
    ]);

    let flipped = 0;
    let skipped = 0;
    for (const u of onDuty || []) {
      const settings = resolveSettingsForAgency(allSettings, u.agency_name);
      // Explicit disable: leave toggled on (webhook also honors this).
      if (settings.auto_off_duty_enabled === false) {
        skipped += 1;
        continue;
      }
      const shouldEnd = isPastAutoOffHour(settings, now) || isStaleDutyDay(u, settings, now);
      if (!shouldEnd) {
        skipped += 1;
        continue;
      }
      const ok = await base44.asServiceRole.entities.User.update(u.id, {
        duty_status: 'off_duty',
        duty_on_since: null,
      })
        .then(() => true)
        .catch((err) => { console.error('autoEndDutyDay update failed:', err?.message); return false; });
      if (ok) flipped += 1;
    }

    if (flipped > 0) {
      await base44.asServiceRole.entities.UserActivity.create({
        user_email: 'system',
        action: 'duty_auto_ended',
        details: { flipped, skipped, checked: (onDuty || []).length, timestamp: now.toISOString() },
        status: 'success',
      }).catch(() => {});
    }

    return Response.json({
      success: true,
      flipped,
      skipped,
      checked: (onDuty || []).length,
    });
  } catch (error) {
    console.error('autoEndDutyDay error:', error?.message);
    return Response.json({ error: 'Failed to end duty day' }, { status: 500 });
  }
});
