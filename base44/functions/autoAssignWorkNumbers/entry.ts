import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * autoAssignWorkNumbers — admin-only, one-click bulk provisioning. Gives every
 * user who doesn't yet have a personal voice/SMS work number the next available
 * number from the pool, so an admin never has to assign them one at a time.
 *
 * Each user gets their OWN number for voice + SMS (the masking source of truth is
 * User.work_phone_number). Fax is intentionally NOT per-user — everyone faxes
 * from the single shared office fax number (see sendFax), so there's nothing to
 * provision here for fax.
 *
 * Body (all optional): {
 *   emails?: string[]        // limit to these users; default = all users missing a work number
 * }
 *
 * Mirrors the assign semantics of managePhoneNumberPool: marks the pool number
 * 'assigned', sets User.work_phone_number, defaults the user to off duty (so they
 * aren't bridged before they toggle on), and records the Telnyx number id.
 */

function normalizeE164(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d]/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (String(raw).trim().startsWith('+') && digits.length >= 8 && digits.length <= 15 && digits[0] !== '0') return `+${digits}`;
  return null;
}

const isBlank = (v) => v == null || String(v).trim() === '';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const isAdmin =
      user.role === 'admin' ||
      user.account_type === 'super_admin' ||
      String(user.email || '').trim().toLowerCase() === ((Deno.env.get('SUPER_ADMIN_EMAIL') || '').trim().toLowerCase() || null);
    if (!isAdmin) {
      return Response.json({ error: 'Only administrators can provision work numbers' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const onlyEmails = Array.isArray(body.emails)
      ? body.emails.map((e) => String(e || '').trim().toLowerCase()).filter(Boolean)
      : null;

    // Available pool numbers (FIFO by creation), and the set already in use so we
    // never hand out a number that's actually assigned on a User.
    const pool = await base44.asServiceRole.entities.PhoneNumber.filter({ status: 'available' }, 'created_date', 500).catch(() => []);
    const allUsers = await base44.asServiceRole.entities.User.list('full_name', 2000).catch(() => []);
    const inUse = new Set(
      allUsers.map((u) => normalizeE164(u.work_phone_number)).filter(Boolean),
    );

    // Candidate users: those missing a work number (optionally limited to `emails`).
    const candidates = allUsers.filter((u) => {
      if (!isBlank(u.work_phone_number)) return false;
      if (onlyEmails && !onlyEmails.includes(String(u.email || '').trim().toLowerCase())) return false;
      return true;
    });

    const assigned = [];
    let poolIdx = 0;
    for (const target of candidates) {
      // Find the next pool number that isn't already in use on a User.
      let chosen = null;
      while (poolIdx < pool.length) {
        const cand = pool[poolIdx++];
        const e164 = normalizeE164(cand.e164);
        if (e164 && !inUse.has(e164)) { chosen = { row: cand, e164 }; break; }
      }
      if (!chosen) break; // pool exhausted

      const update = {
        work_phone_number: chosen.e164,
        twilio_phone_number_sid: chosen.row.twilio_phone_number_sid || '',
      };
      if (target.duty_status === undefined || target.duty_status === null) update.duty_status = 'off_duty';
      const ok = await base44.asServiceRole.entities.User.update(target.id, update)
        .then(() => true).catch((err) => { console.error('assign failed for', target.email, err?.message); return false; });
      if (!ok) continue;

      await base44.asServiceRole.entities.PhoneNumber.update(chosen.row.id, {
        status: 'assigned', assigned_to_email: target.email,
      }).catch(() => {});
      inUse.add(chosen.e164);
      assigned.push({ email: target.email, e164: chosen.e164 });
    }

    const poolRemaining = Math.max(0, pool.length - poolIdx);
    const unassignedRemaining = candidates.length - assigned.length;

    if (assigned.length > 0) {
      await base44.asServiceRole.entities.UserActivity.create({
        user_email: user.email, user_name: user.full_name,
        action: 'work_numbers_bulk_assigned',
        details: { count: assigned.length, timestamp: new Date().toISOString() },
        status: 'success',
      }).catch(() => {});
    }

    return Response.json({
      success: true,
      assigned,
      assigned_count: assigned.length,
      users_still_unassigned: unassignedRemaining,
      pool_available_remaining: poolRemaining,
      message: unassignedRemaining > 0
        ? `Assigned ${assigned.length}. ${unassignedRemaining} user(s) still need a number — add more to the pool.`
        : `Assigned ${assigned.length} work number(s).`,
    });
  } catch (error) {
    console.error('autoAssignWorkNumbers error:', error?.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});