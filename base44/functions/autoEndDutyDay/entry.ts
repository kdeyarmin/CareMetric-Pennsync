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
 * Auth: runs as a scheduled job (service role). If INTERNAL_FN_SECRET is set, a
 * non-scheduled caller must present it via x-internal-secret, otherwise only an
 * admin user may invoke it manually.
 */

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Optional hardening: when INTERNAL_FN_SECRET is set, accept the matching
    // header (the scheduler) OR an authenticated admin; otherwise run openly so
    // it works as a zero-config scheduled job.
    const internalSecret = (Deno.env.get('INTERNAL_FN_SECRET') || '').trim();
    if (internalSecret) {
      const header = (req.headers.get('x-internal-secret') || '').trim();
      if (!header || !timingSafeEqual(header, internalSecret)) {
        const user = await base44.auth.me().catch(() => null);
        const isAdmin = user && (user.role === 'admin' || user.account_type === 'super_admin');
        if (!isAdmin) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

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