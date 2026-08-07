import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: resolveAgencySettings — generated, edit base44/_shared/backendHelpers.mjs>>>
async function resolveAgencySettings(base44, agencyName) {
  let settings = [];
  const key = String(agencyName || '').trim();
  if (key) {
    settings = await base44.asServiceRole.entities.AgencySettings
      .filter({ agency_code: key }, '-created_date', 1)
      .catch(() => []);
    if (!settings?.length) {
      settings = await base44.asServiceRole.entities.AgencySettings
        .filter({ office_name: key }, '-created_date', 1)
        .catch(() => []);
    }
  }
  if (!settings?.length) {
    // Fail closed when the agency hint missed (or no hint but multiple tenant
    // rows exist). Newest-row-wins would silently apply another agency's fax
    // line / dial allowlist / wage index / quiet-hour timezone.
    if (key) return null;
    const newest = await base44.asServiceRole.entities.AgencySettings
      .list('-created_date', 5)
      .catch(() => []);
    if ((newest || []).length > 1) return null;
    settings = (newest || []).slice(0, 1);
  }
  return settings?.[0] || null;
}
// <<<END SHARED HELPER: resolveAgencySettings>>>

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


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
  // Already-+ international is decided FIRST and never falls through to the NANP
  // branches. A 10-digit international number ("+49 89 123456") was otherwise
  // rewritten as an unrelated "+1..." US subscriber, which also slipped past the
  // +1-only international cost control. Mirrors src/components/voice/phoneUtils.js.
  if (String(raw).trim().startsWith('+')) {
    return digits.length >= 8 && digits.length <= 15 && digits[0] !== '0' ? `+${digits}` : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

const isBlank = (v) => v == null || String(v).trim() === '';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    // Same admin surface as managePhoneNumberPool / the isAdminLike frontend
    // gate — an agency_admin can reach the panel, so the backend must accept them.
    const isAdmin =
      user.role === 'admin' ||
      user.account_type === 'super_admin' ||
      user.account_type === 'agency_admin';
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
    // The office fax, outbound fax, and main office lines are reserved: they
    // can sit in the pool (e.g. bought in-app), but handing one to a nurse
    // would break fax transmission/masking or office call routing. Treat them
    // as in-use.
    const agencySettings = await resolveAgencySettings(base44, user?.agency_name);
    for (const reserved of [
      agencySettings?.office_fax_number_e164,
      agencySettings?.outbound_fax_number_e164,
      agencySettings?.main_office_number_e164,
    ]) {
      const norm = normalizeE164(reserved);
      if (norm) inUse.add(norm);
    }

    // Agency-scoped admins (agency_admin or role:admin with agency) may only
    // auto-assign within their own agency.
    const isAgencyScoped = user.account_type !== 'super_admin'
      && user.agency_name
      && (user.account_type === 'agency_admin' || user.role === 'admin');
    // Only agency_admin accounts require agency_name. A bare role:admin with no
    // agency is the platform-wide facility admin and may assign across tenants.
    if (user.account_type === 'agency_admin' && !user.agency_name) {
      return Response.json({ error: 'Forbidden: agency_name is required to auto-assign work numbers.' }, { status: 403 });
    }

    // Candidate users: those missing a work number (optionally limited to `emails`).
    const candidates = allUsers.filter((u) => {
      if (!isBlank(u.work_phone_number)) return false;
      if (isAgencyScoped && u.agency_name !== user.agency_name) return false;
      if (onlyEmails && !onlyEmails.includes(String(u.email || '').trim().toLowerCase())) return false;
      return true;
    });

    const assigned = [];
    let poolIdx = 0;
    for (const target of candidates) {
      // Re-read the user before assigning — a concurrent run (or a parallel
      // managePhoneNumberPool assign) may have filled work_phone_number already.
      // Only skip when the re-read succeeds AND shows a number; an empty filter
      // result must not starve every candidate (some stores ignore id filters).
      const freshUser = await base44.asServiceRole.entities.User
        .filter({ id: target.id }, undefined, 1).catch(() => []);
      if (freshUser[0] && !isBlank(freshUser[0].work_phone_number)) continue;

      // Find the next pool number that isn't already in use on a User.
      let chosen = null;
      while (poolIdx < pool.length) {
        const cand = pool[poolIdx++];
        const e164 = normalizeE164(cand.e164);
        if (e164 && !inUse.has(e164)) { chosen = { row: cand, e164 }; break; }
      }
      if (!chosen) break; // pool exhausted

      // Claim the pool row BEFORE writing the user so two concurrent bulk
      // assigns cannot hand the same E.164 to two nurses. Re-read to confirm
      // we still own the claim (loser sees the winner's assigned_to_email).
      try {
        await base44.asServiceRole.entities.PhoneNumber.update(chosen.row.id, {
          status: 'assigned', assigned_to_email: target.email,
        });
      } catch (err) {
        console.error('pool claim failed:', err?.message);
        continue;
      }
      const claimRows = await base44.asServiceRole.entities.PhoneNumber
        .filter({ id: chosen.row.id }, undefined, 1).catch(() => []);
      const claimed = claimRows.find((r) => r.id === chosen.row.id) || claimRows[0];
      if (!claimed || claimed.assigned_to_email !== target.email) {
        continue;
      }

      const update = {
        work_phone_number: chosen.e164,
        twilio_phone_number_sid: chosen.row.twilio_phone_number_sid || '',
      };
      if (target.duty_status === undefined || target.duty_status === null) update.duty_status = 'off_duty';
      const ok = await base44.asServiceRole.entities.User.update(target.id, update)
        .then(() => true).catch((err) => { console.error('work number assignment failed:', err?.message); return false; });
      if (!ok) {
        // Release the pool claim so another run can reuse the number.
        await base44.asServiceRole.entities.PhoneNumber.update(chosen.row.id, {
          status: 'available', assigned_to_email: '',
        }).catch(() => {});
        continue;
      }

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
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});