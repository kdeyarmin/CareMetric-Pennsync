import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: schedulerAuth — generated, edit base44/_shared/backendHelpers.mjs>>>
const SCHEDULER_SECRET_HEADER = 'x-internal-secret';
function isSchedulerAdmin(user) {
  return !!user && (
    user.role === 'admin' || user.account_type === 'agency_admin' ||
    user.account_type === 'super_admin'
  );
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
  if (providedSecret === expectedSecret) return null;
  return Response.json(
    { error: user ? 'Forbidden: admin or scheduler secret required' : 'Unauthorized: scheduler secret required' },
    { status: user ? 403 : 401 },
  );
}
// <<<END SHARED HELPER: schedulerAuth>>>

/**
 * autoEndDutyDay — scheduled end-of-day sweep. Flips every nurse who is still
 * toggled 'on_duty' back to 'off_duty', so the next morning everyone starts off
 * and must explicitly toggle on when they begin working. Schedule this to run
 * daily at the agency's auto-off hour (default 5pm Eastern; see
 * AgencySettings.auto_off_duty_hour / duty_timezone).
 *
 * The inbound call/SMS webhook ALSO treats a nurse as off duty in real time once
 * the clock passes the auto-off hour, so calls/texts route to the office at 5pm
 * even before this sweep runs — this function just persists that so the toggle
 * and the morning default reflect reality.
 *
 * Auth: runs as a scheduled job (service role). Admins may invoke it manually,
 * and unattended scheduler runs must send `x-internal-secret`.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Zero-config scheduled job: admins may trigger it manually, and unattended
    // scheduler runs must send `x-internal-secret`.
    const user = await base44.auth.me().catch(() => null);
    const authError = getSchedulerAuthError(req, user);
    if (authError) return authError;

    // Find everyone still toggled on and flip them off.
    const onDuty = await base44.asServiceRole.entities.User.filter({ duty_status: 'on_duty' }).catch(() => []);
    let flipped = 0;
    for (const u of onDuty) {
      const ok = await base44.asServiceRole.entities.User.update(u.id, { duty_status: 'off_duty', duty_on_since: null })
        .then(() => true)
        .catch((err) => { console.error('autoEndDutyDay update failed:', err?.message); return false; });
      if (ok) flipped += 1;
    }

    if (flipped > 0) {
      await base44.asServiceRole.entities.UserActivity.create({
        user_email: 'system',
        action: 'duty_auto_ended',
        details: { flipped, timestamp: new Date().toISOString() },
        status: 'success',
      }).catch(() => {});
    }

    return Response.json({ success: true, flipped, checked: onDuty.length });
  } catch (error) {
    console.error('autoEndDutyDay error:', error?.message);
    return Response.json({ error: 'Failed to end duty day' }, { status: 500 });
  }
});