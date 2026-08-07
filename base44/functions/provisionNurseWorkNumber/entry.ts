import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// <<<BEGIN SHARED HELPER: requireAgencyAdminAgency — generated, edit base44/_shared/backendHelpers.mjs>>>
function agencyAdminMissingAgencyResponse(user) {
  if (user && user.account_type === 'agency_admin' && !String(user.agency_name || '').trim()) {
    return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
  }
  return null;
}
// <<<END SHARED HELPER: requireAgencyAdminAgency>>>




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

/**
 * provisionNurseWorkNumber — admin-only. Assigns a nurse their dedicated Telnyx
 * work number and stores their PRIVATE personal cell (the masked bridge target).
 *
 * The Telnyx number must already be purchased in your Telnyx account with its
 * SMS/Voice webhooks pointed at this app's functions. This call records the
 * mapping in PennSync.
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

// Mirrors maskPhone() in src/components/voice/phoneUtils.js — reveals only the
// last 4 digits so the nurse's private cell is never written in full to audit.
function maskLast4(e164) {
  const d = (e164 || '').replace(/[^\d]/g, '');
  if (!e164) return 'unknown';
  if (d.length < 4) return '••••';
  return `(•••) •••-${d.slice(-4)}`;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    {
      const _agencyAdminGate = agencyAdminMissingAgencyResponse(user);
      if (_agencyAdminGate) return _agencyAdminGate;
    }
    // Same admin surface as managePhoneNumberPool / the isAdminLike frontend
    // gate — an agency_admin can reach the panel, so the backend must accept them.
    const isAdmin =
      user.role === 'admin' ||
      user.account_type === 'super_admin' ||
      user.account_type === 'agency_admin';
    if (!isAdmin) {
      return Response.json({ error: 'Only administrators can provision work numbers' }, { status: 403 });
    }

    const { target_user_email, work_phone_number, personal_cell_e164, twilio_phone_number_sid } = await req.json();
    if (!target_user_email) {
      return Response.json({ error: 'Missing required field: target_user_email' }, { status: 400 });
    }

    const workNum = work_phone_number ? normalizeE164(work_phone_number) : null;
    const cellNum = personal_cell_e164 ? normalizeE164(personal_cell_e164) : null;
    if (work_phone_number && !workNum) {
      return Response.json({ error: 'Invalid work_phone_number' }, { status: 400 });
    }
    if (personal_cell_e164 && !cellNum) {
      return Response.json({ error: 'Invalid personal_cell_e164' }, { status: 400 });
    }

    const targets = await base44.asServiceRole.entities.User.filter({ email: target_user_email }, undefined, 5000);
    const target = targets[0];
    if (!target) {
      return Response.json({ error: 'Target user not found' }, { status: 404 });
    }

    // Agency admins may only provision numbers for staff in their own agency.
    if (user.account_type !== 'super_admin' && user.agency_name && (user.account_type === 'agency_admin' || user.role === 'admin')) {
      if (!user.agency_name || target.agency_name !== user.agency_name) {
        return Response.json({ error: 'Forbidden: target user is outside your agency.' }, { status: 403 });
      }
    }

    // Work numbers must be unique across nurses.
    if (workNum) {
      const existing = await base44.asServiceRole.entities.User.filter({ work_phone_number: workNum }, undefined, 5000);
      const conflict = existing.find((u) => u.email !== target_user_email);
      if (conflict) {
        return Response.json({ error: `Work number ${workNum} is already assigned to ${conflict.email}` }, { status: 409 });
      }
      // The office fax, outbound fax, and main office lines are reserved:
      // handing one to a nurse would break fax transmission/masking or office
      // call routing.
      const agencySettings = await resolveAgencySettings(base44, target?.agency_name || user?.agency_name);
      const reserved = [
        normalizeE164(agencySettings?.office_fax_number_e164),
        normalizeE164(agencySettings?.outbound_fax_number_e164),
        normalizeE164(agencySettings?.main_office_number_e164),
      ].filter(Boolean);
      if (reserved.includes(workNum)) {
        return Response.json({ error: `${workNum} is a reserved office/fax line — it can't be a personal work number.` }, { status: 409 });
      }
    }

    // If the typed number is tracked in the pool, adopt its stored Telnyx id so
    // the User record stays complete without the admin re-entering it.
    const poolMatches = workNum
      ? await base44.asServiceRole.entities.PhoneNumber.filter({ e164: workNum }, undefined, 5000).catch(() => [])
      : [];
    const poolRow = poolMatches[0] || null;

    const update = {};
    if (workNum) update.work_phone_number = workNum;
    if (cellNum) update.personal_cell_e164 = cellNum;
    if (twilio_phone_number_sid !== undefined) update.twilio_phone_number_sid = twilio_phone_number_sid;
    else if (poolRow?.twilio_phone_number_sid && workNum) update.twilio_phone_number_sid = poolRow.twilio_phone_number_sid;
    // Default new nurses to off duty so they aren't bridged before they're ready.
    if (target.duty_status === undefined || target.duty_status === null) update.duty_status = 'off_duty';

    await base44.asServiceRole.entities.User.update(target.id, update);

    // Keep the pool inventory consistent with the masking mapping (mirrors
    // managePhoneNumberPool 'assign'): mark the matching pool number assigned to
    // this nurse and free any OTHER pool entry they used to hold. Without this,
    // a manually-typed assignment left the pool row 'available' — wrong counts,
    // and the number stayed offered to auto-assign/remove.
    if (workNum) {
      if (poolRow) {
        await base44.asServiceRole.entities.PhoneNumber.update(poolRow.id, {
          status: 'assigned', assigned_to_email: target_user_email,
        }).catch(() => {});
      }
      const priorRows = await base44.asServiceRole.entities.PhoneNumber.filter({ assigned_to_email: target_user_email }, undefined, 5000).catch(() => []);
      for (const pr of priorRows) {
        if (!poolRow || pr.id !== poolRow.id) {
          await base44.asServiceRole.entities.PhoneNumber.update(pr.id, { status: 'available', assigned_to_email: '' }).catch(() => {});
        }
      }
    }

    // Audit — never store the full cell number.
    await base44.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'work_number_provisioned',
      entity_type: 'User',
      entity_id: target.id,
      details: {
        target_user_email,
        work_phone_number: workNum || target.work_phone_number || null,
        personal_cell_masked: cellNum ? maskLast4(cellNum) : null,
        timestamp: new Date().toISOString(),
      },
      status: 'success',
    }).catch((err) => console.error('Failed to log activity:', err));

    return Response.json({ success: true, target_user_email, work_phone_number: workNum || target.work_phone_number || null });
  } catch (error) {
    console.error('provisionNurseWorkNumber error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});