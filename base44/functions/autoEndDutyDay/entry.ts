import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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
 * Auth: runs as a scheduled job (service role). The no-identity cron path is
 * allowed; only an admin user may invoke it manually.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Zero-config scheduled job: the no-identity cron path is allowed (platform
    // invocation restriction is the control); an authenticated non-admin may not
    // trigger the sweep manually.
    const user = await base44.auth.me().catch(() => null);
    const isAdmin = user && (user.role === 'admin' || user.account_type === 'super_admin');
    if (user && !isAdmin) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Find everyone still toggled on and flip them off.
    const onDuty = await base44.asServiceRole.entities.User.filter({ duty_status: 'on_duty' }).catch(() => []);
    let flipped = 0;
    for (const u of onDuty) {
      const ok = await base44.asServiceRole.entities.User.update(u.id, { duty_status: 'off_duty', duty_on_since: null })
        .then(() => true)
        .catch((err) => { console.error('autoEndDutyDay update failed for', u.id, err?.message); return false; });
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