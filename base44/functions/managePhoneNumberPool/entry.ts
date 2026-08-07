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
 * managePhoneNumberPool — admin-only CRUD + assignment for the Telnyx number
 * pool (the PhoneNumber entity). One backend entry point keeps the pool inventory
 * and the actual masking mapping (User.work_phone_number) consistent, with the
 * same uniqueness rules as provisionNurseWorkNumber.
 *
 * Body: { action, ... }
 *   - 'add'     { e164, label?, twilio_phone_number_sid? } → add a number to the pool
 *   - 'remove'  { id }                                    → delete an AVAILABLE number
 *   - 'assign'  { id, target_user_email, personal_cell_e164? } → give a nurse this work number
 *   - 'release' { id }                                    → unassign (clears the nurse's work number)
 *
 * The number itself is not PHI; the personal cell is masked to last-4 in audit.
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

// Mirrors maskPhone() in src/components/voice/phoneUtils.js — last-4 only.
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
    const isAdmin =
      user.role === 'admin' ||
      user.account_type === 'super_admin' ||
      user.account_type === 'agency_admin';
    if (!isAdmin) {
      return Response.json({ error: 'Only administrators can manage the number pool.' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');
    const audit = (action2, details) =>
      base44.asServiceRole.entities.UserActivity.create({
        user_email: user.email, user_name: user.full_name,
        action: action2, entity_type: 'PhoneNumber',
        details: { ...details, timestamp: new Date().toISOString() }, status: 'success',
      }).catch((err) => console.error('audit failed:', err));

    if (action === 'add') {
      const e164 = normalizeE164(body.e164);
      if (!e164) return Response.json({ error: 'Enter a valid phone number.' }, { status: 400 });
      const existing = await base44.asServiceRole.entities.PhoneNumber.filter({ e164 }, undefined, 5000).catch(() => []);
      if (existing.length > 0) {
        return Response.json({ error: `${e164} is already in the pool.` }, { status: 409 });
      }
      // Reflect reality: if a nurse already holds this number, mark it assigned.
      const holders = await base44.asServiceRole.entities.User.filter({ work_phone_number: e164 }, undefined, 5000).catch(() => []);
      const holder = holders[0];
      const row = await base44.asServiceRole.entities.PhoneNumber.create({
        e164,
        label: typeof body.label === 'string' ? body.label.trim() : '',
        twilio_phone_number_sid: body.twilio_phone_number_sid || '',
        status: holder ? 'assigned' : 'available',
        assigned_to_email: holder ? holder.email : '',
      });
      await audit('phone_number_added', { e164, assigned_to_email: holder?.email || null });
      return Response.json({ success: true, id: row.id, e164, status: row.status });
    }

    if (action === 'remove') {
      const id = String(body.id || '');
      if (!id) return Response.json({ error: 'Missing number id.' }, { status: 400 });
      const rows = await base44.asServiceRole.entities.PhoneNumber.filter({ id }, undefined, 5000).catch(() => []);
      const row = rows[0];
      if (!row) return Response.json({ error: 'Number not found.' }, { status: 404 });
      if (row.status === 'assigned') {
        return Response.json({ error: 'Release this number from its nurse before removing it.' }, { status: 409 });
      }
      await base44.asServiceRole.entities.PhoneNumber.delete(id);
      await audit('phone_number_removed', { e164: row.e164 });
      return Response.json({ success: true });
    }

    if (action === 'assign') {
      const id = String(body.id || '');
      if (!id) return Response.json({ error: 'Missing number id.' }, { status: 400 });
      const targetEmail = String(body.target_user_email || '').trim();
      if (!targetEmail) return Response.json({ error: 'Choose a nurse to assign.' }, { status: 400 });

      const rows = await base44.asServiceRole.entities.PhoneNumber.filter({ id }, undefined, 5000).catch(() => []);
      const row = rows[0];
      if (!row) return Response.json({ error: 'Number not found.' }, { status: 404 });
      const e164 = normalizeE164(row.e164);
      if (!e164) return Response.json({ error: 'Pool number is malformed.' }, { status: 400 });

      // The office fax, outbound fax, and main office lines are reserved:
      // handing one to a nurse would break fax transmission/masking or office
      // call routing.
      const agencySettings = await resolveAgencySettings(base44, user?.agency_name);
      const reserved = [
        normalizeE164(agencySettings?.office_fax_number_e164),
        normalizeE164(agencySettings?.outbound_fax_number_e164),
        normalizeE164(agencySettings?.main_office_number_e164),
      ].filter(Boolean);
      if (reserved.includes(e164)) {
        return Response.json({ error: `${e164} is a reserved office/fax line — it can't be a personal work number.` }, { status: 409 });
      }

      const cellNum = body.personal_cell_e164 ? normalizeE164(body.personal_cell_e164) : null;
      if (body.personal_cell_e164 && !cellNum) {
        return Response.json({ error: 'Invalid personal cell number.' }, { status: 400 });
      }

      const targets = await base44.asServiceRole.entities.User.filter({ email: targetEmail }, undefined, 5000).catch(() => []);
      const target = targets[0];
      if (!target) return Response.json({ error: 'Target nurse not found.' }, { status: 404 });

      // Agency admins may only assign numbers to staff in their own agency.
      if (user.account_type !== 'super_admin' && user.agency_name && (user.account_type === 'agency_admin' || user.role === 'admin')) {
        if (!user.agency_name || target.agency_name !== user.agency_name) {
          return Response.json({ error: 'Forbidden: target user is outside your agency.' }, { status: 403 });
        }
      }

      // Work numbers must be unique across nurses.
      const holders = await base44.asServiceRole.entities.User.filter({ work_phone_number: e164 }, undefined, 5000).catch(() => []);
      const conflict = holders.find((u) => u.email !== targetEmail);
      if (conflict) {
        return Response.json({ error: `${e164} is already assigned to ${conflict.email}.` }, { status: 409 });
      }

      // Update the nurse's masking record.
      const update = { work_phone_number: e164 };
      if (cellNum) update.personal_cell_e164 = cellNum;
      if (row.twilio_phone_number_sid) update.twilio_phone_number_sid = row.twilio_phone_number_sid;
      if (target.duty_status === undefined || target.duty_status === null) update.duty_status = 'off_duty';
      await base44.asServiceRole.entities.User.update(target.id, update);

      // Free any OTHER pool entry this nurse used to hold, so one nurse maps to
      // one pool number.
      const priorRows = await base44.asServiceRole.entities.PhoneNumber.filter({ assigned_to_email: targetEmail }, undefined, 5000).catch(() => []);
      for (const pr of priorRows) {
        if (pr.id !== id) {
          await base44.asServiceRole.entities.PhoneNumber.update(pr.id, { status: 'available', assigned_to_email: '' }).catch(() => {});
        }
      }
      await base44.asServiceRole.entities.PhoneNumber.update(id, { status: 'assigned', assigned_to_email: targetEmail });

      await audit('phone_number_assigned', {
        e164, target_user_email: targetEmail,
        personal_cell_masked: cellNum ? maskLast4(cellNum) : null,
      });
      return Response.json({ success: true, e164, target_user_email: targetEmail });
    }

    if (action === 'release') {
      const id = String(body.id || '');
      if (!id) return Response.json({ error: 'Missing number id.' }, { status: 400 });
      const rows = await base44.asServiceRole.entities.PhoneNumber.filter({ id }, undefined, 5000).catch(() => []);
      const row = rows[0];
      if (!row) return Response.json({ error: 'Number not found.' }, { status: 404 });
      const e164 = normalizeE164(row.e164) || row.e164;

      // Clear the nurse's work number only if it still matches this pool number.
      if (row.assigned_to_email) {
        const targets = await base44.asServiceRole.entities.User.filter({ email: row.assigned_to_email }, undefined, 5000).catch(() => []);
        const target = targets[0];
        // Agency admins may only release numbers held by their own agency's staff.
        if (user.account_type !== 'super_admin' && user.agency_name && (user.account_type === 'agency_admin' || user.role === 'admin')) {
          if (!user.agency_name || !target || target.agency_name !== user.agency_name) {
            return Response.json({ error: 'Forbidden: number holder is outside your agency.' }, { status: 403 });
          }
        }
        if (target && normalizeE164(target.work_phone_number) === e164) {
          await base44.asServiceRole.entities.User.update(target.id, { work_phone_number: '' }).catch(() => {});
        }
      } else if (user.account_type !== 'super_admin' && user.agency_name && (user.account_type === 'agency_admin' || user.role === 'admin')) {
        // Unassigned pool rows are agency-shared infrastructure — still allow
        // release/reset, but refuse if we somehow lack agency_name.
        if (!user.agency_name) {
          return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
        }
      }
      await base44.asServiceRole.entities.PhoneNumber.update(id, { status: 'available', assigned_to_email: '' });
      await audit('phone_number_released', { e164, prior_user_email: row.assigned_to_email || null });
      return Response.json({ success: true, e164 });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    console.error('managePhoneNumberPool error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});