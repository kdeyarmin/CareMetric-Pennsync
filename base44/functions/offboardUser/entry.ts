import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * offboardUser — full server-side staff offboarding.
 *
 * Client-side User.update(is_active:false) alone is insufficient:
 *   1. Patient.assigned_nurses still grants PHI via RLS
 *   2. Work numbers keep routing to the offboarded nurse
 *   3. On-call shifts remain assigned
 *   4. Layout blocks the browser shell, but entity API access needs platform policy
 *
 * Body: { user_id, reason }  OR  { action: 'reactivate', user_id }
 */

/**
 * Ceiling for the patient-assignment sweep. This is a guard against an
 * unbounded read, not a page size: reaching it means the sweep may be
 * incomplete, which the response reports via results.sweep_truncated.
 */
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


const PATIENT_SWEEP_LIMIT = 5000;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const currentUser = await base44.auth.me();
    {
      const _agencyAdminGate = agencyAdminMissingAgencyResponse(currentUser);
      if (_agencyAdminGate) return _agencyAdminGate;
    }
    if (!currentUser) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const isAdmin = currentUser.role === 'admin'
      || currentUser.account_type === 'agency_admin'
      || currentUser.account_type === 'super_admin';
    if (!isAdmin) {
      return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
    }

    // Offboarding clears is_active but deliberately leaves role/account_type
    // intact (history and audit joins key off them), so an offboarded admin
    // still satisfies the isAdmin gate above. The platform does not yet reject
    // entity-API calls from an inactive session, so refuse them here rather
    // than letting a deactivated administrator keep driving this function.
    if (currentUser.is_active === false) {
      return Response.json({ error: 'Unauthorized - account is deactivated' }, { status: 403 });
    }

    const callerIsSuperAdmin = currentUser.account_type === 'super_admin';

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'offboard');

    if (action === 'reactivate') {
      return await reactivateUser(base44, currentUser, body, callerIsSuperAdmin);
    }
    return await offboardUser(base44, currentUser, body, callerIsSuperAdmin);
  } catch (error) {
    console.error('offboardUser error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});

async function offboardUser(base44, currentUser, params, callerIsSuperAdmin) {
  const { user_id, reason } = params;
  if (!user_id) {
    return Response.json({ error: 'user_id is required' }, { status: 400 });
  }
  const note = String(reason || '').trim();
  if (!note) {
    return Response.json({ error: 'offboarding reason is required' }, { status: 400 });
  }

  const targetUsers = await base44.asServiceRole.entities.User.filter({ id: user_id }, undefined, 5000);
  const targetUser = targetUsers?.[0];
  if (!targetUser) {
    return Response.json({ error: 'User not found' }, { status: 404 });
  }
  if (targetUser.email === currentUser.email) {
    return Response.json({ error: 'You cannot offboard your own account.' }, { status: 400 });
  }

  const targetIsPrivileged = targetUser.account_type === 'super_admin'
    || targetUser.account_type === 'agency_admin'
    || targetUser.role === 'admin';
  if (targetIsPrivileged && !callerIsSuperAdmin) {
    return Response.json({ error: 'Only a super admin can offboard another administrator.' }, { status: 403 });
  }

  // Agency-scoped admins (agency_admin, or role:admin with an agency) may only
  // offboard staff in their own agency. Platform-wide: super_admin, or
  // role:admin without agency_name.
  const callerIsAgencyScoped = currentUser.account_type !== 'super_admin'
    && currentUser.agency_name
    && (currentUser.account_type === 'agency_admin' || currentUser.role === 'admin');
  if (callerIsAgencyScoped) {
    if (targetUser.agency_name !== currentUser.agency_name) {
      return Response.json({ error: 'Forbidden: target user is outside your agency.' }, { status: 403 });
    }
  }

  const at = new Date().toISOString();
  const targetEmail = targetUser.email;

  await base44.asServiceRole.entities.User.update(user_id, {
    is_active: false,
    duty_status: 'off_duty',
    personal_cell_e164: '',
    scheduled_off_duty_start: '',
    scheduled_off_duty_end: '',
    work_phone_number: '',
    twilio_phone_number_sid: '',
    offboarded_at: at,
    offboarded_by: currentUser.email,
    offboarding_reason: note.slice(0, 1000),
  });

  const results = {
    user_deactivated: true,
    patients_unassigned: 0,
    work_numbers_released: 0,
    on_call_shifts_cleared: 0,
    invitations_cancelled: 0,
    scheduled_sms_canceled: 0,
    scheduled_faxes_canceled: 0,
    signature_reminders_canceled: 0,
    // A revocation sweep that partly failed must not read as a clean one: these
    // counts land in the UserActivity audit record below, where an auditor
    // treats them as proof that PHI access was actually withdrawn.
    failures: 0,
    sweep_truncated: false,
  };

  /** Run one revocation write, counting it only if it actually succeeded. */
  const revoke = async (label, id, fn) => {
    try {
      await fn();
      return true;
    } catch (err) {
      console.error(`${label} failed`, id, err?.message || err);
      results.failures += 1;
      return false;
    }
  };

  try {
    // Server-side array-contains match (same shape as getScopedPatientAlerts /
    // getDashboardData) rather than listing every patient and filtering here.
    const patients = await base44.asServiceRole.entities.Patient.filter(
      { assigned_nurses: targetEmail },
      '-updated_date',
      PATIENT_SWEEP_LIMIT,
    ).catch((err) => {
      // An empty result and a failed query are not the same thing: swallowing
      // this into [] reports "no assignments to revoke" and the sweep comes
      // back clean while PHI access is untouched.
      console.error('patient sweep query failed:', err?.message || err);
      results.failures += 1;
      return null;
    });
    if ((patients || []).length >= PATIENT_SWEEP_LIMIT) {
      // Hitting the ceiling means there may be assignments we never saw, and an
      // unseen assignment is still live PHI access. Say so instead of implying
      // the sweep was complete.
      results.sweep_truncated = true;
      console.error('patient unassign sweep hit the row ceiling; assignments may remain', targetEmail);
    }
    for (const p of (patients || [])) {
      const nurses = Array.isArray(p.assigned_nurses) ? p.assigned_nurses : [];
      if (!nurses.includes(targetEmail)) continue;
      const next = nurses.filter((e) => e !== targetEmail);
      const ok = await revoke('patient unassign', p.id, () =>
        base44.asServiceRole.entities.Patient.update(p.id, { assigned_nurses: next }));
      if (ok) results.patients_unassigned += 1;
    }
  } catch (err) {
    console.error('patient unassign sweep failed:', err?.message || err);
    results.failures += 1;
  }

  try {
    const poolRows = await base44.asServiceRole.entities.PhoneNumber.filter(
      { assigned_to_email: targetEmail },
      undefined,
      5000,
    ).catch((err) => {
      console.error('phone pool query failed:', err?.message || err);
      results.failures += 1;
      return null;
    });
    for (const row of (poolRows || [])) {
      const ok = await revoke('phone release', row.id, () =>
        base44.asServiceRole.entities.PhoneNumber.update(row.id, {
          status: 'available',
          assigned_to_email: '',
        }));
      if (ok) results.work_numbers_released += 1;
    }
  } catch (err) {
    console.error('phone pool release failed:', err?.message || err);
    results.failures += 1;
  }

  try {
    const shifts = await base44.asServiceRole.entities.OnCallShift.filter(
      { assigned_user_email: targetEmail },
      undefined,
      5000,
    ).catch((err) => {
      console.error('on-call query failed:', err?.message || err);
      results.failures += 1;
      return null;
    });
    for (const shift of (shifts || [])) {
      const priorNotes = shift.notes ? String(shift.notes) : '';
      const clearedNote = `Cleared on offboard ${at} by ${currentUser.email}`;
      const ok = await revoke('on-call clear', shift.id, () =>
        base44.asServiceRole.entities.OnCallShift.update(shift.id, {
          assigned_user_email: '',
          assigned_user_name: '',
          notes: [priorNotes, clearedNote].filter(Boolean).join(' | ').slice(0, 1000),
        }));
      if (ok) results.on_call_shifts_cleared += 1;
    }
  } catch (err) {
    console.error('on-call clear failed:', err?.message || err);
    results.failures += 1;
  }

  try {
    const invites = await base44.asServiceRole.entities.UserInvitation.filter(
      { email: targetEmail, status: 'pending' },
      undefined,
      5000,
    ).catch((err) => {
      console.error('invitation query failed:', err?.message || err);
      results.failures += 1;
      return null;
    });
    for (const inv of (invites || [])) {
      const ok = await revoke('invitation cancel', inv.id, () =>
        base44.asServiceRole.entities.UserInvitation.update(inv.id, { status: 'cancelled' }));
      if (ok) results.invitations_cancelled += 1;
    }
  } catch (err) {
    console.error('invitation cancel failed:', err?.message || err);
    results.failures += 1;
  }

  // Cancel outbound schedules that would still fire after phone/work number clear.
  // dispatchScheduledSms uses the row's stored from_number — clearing User.work_phone
  // alone does not stop pending PHI texts.
  try {
    const pendingSms = await base44.asServiceRole.entities.ScheduledSms.filter(
      { nurse_email: targetEmail, status: 'pending' },
      undefined,
      5000,
    ).catch((err) => {
      console.error('scheduled SMS query failed:', err?.message || err);
      results.failures += 1;
      return null;
    });
    const canceledAt = at;
    for (const row of (pendingSms || [])) {
      const ok = await revoke('scheduled SMS cancel', row.id, () =>
        base44.asServiceRole.entities.ScheduledSms.update(row.id, {
          status: 'canceled',
          canceled_at: canceledAt,
          canceled_by: currentUser.email,
        }));
      if (ok) results.scheduled_sms_canceled += 1;
    }
  } catch (err) {
    console.error('scheduled SMS cancel failed:', err?.message || err);
    results.failures += 1;
  }

  try {
    const pendingFaxes = await base44.asServiceRole.entities.ScheduledFax.filter(
      { created_by: targetEmail, status: 'pending' },
      undefined,
      5000,
    ).catch((err) => {
      console.error('scheduled fax query failed:', err?.message || err);
      results.failures += 1;
      return null;
    });
    for (const row of (pendingFaxes || [])) {
      const ok = await revoke('scheduled fax cancel', row.id, () =>
        base44.asServiceRole.entities.ScheduledFax.update(row.id, {
          status: 'cancelled',
          // Durable cancel stamp — claim may overwrite status to 'processing'
          // but must not clear canceled_at (parity with ScheduledSms).
          canceled_at: at,
          canceled_by: currentUser.email,
        }));
      if (ok) results.scheduled_faxes_canceled += 1;
    }
  } catch (err) {
    console.error('scheduled fax cancel failed:', err?.message || err);
    results.failures += 1;
  }

  try {
    const pendingSigReminders = await base44.asServiceRole.entities.ScheduledSignatureReminder.filter(
      { requested_by: targetEmail, status: 'pending' },
      undefined,
      5000,
    ).catch((err) => {
      console.error('signature reminder query failed:', err?.message || err);
      results.failures += 1;
      return null;
    });
    for (const row of (pendingSigReminders || [])) {
      const ok = await revoke('signature reminder cancel', row.id, () =>
        base44.asServiceRole.entities.ScheduledSignatureReminder.update(row.id, {
          status: 'canceled',
          canceled_at: at,
          canceled_by: currentUser.email,
        }));
      if (ok) results.signature_reminders_canceled += 1;
    }
  } catch (err) {
    console.error('signature reminder cancel failed:', err?.message || err);
    results.failures += 1;
  }

  await base44.asServiceRole.entities.UserActivity.create({
    user_email: currentUser.email,
    user_name: currentUser.full_name,
    action: 'user_offboarded',
    details: {
      target_user_email: targetEmail,
      target_user_id: user_id,
      reason: note.slice(0, 200),
      ...results,
      platform_session_revocation: 'client_shell_blocked; entity_api_policy_pending',
    },
    page: 'UserManagement',
    entity_type: 'User',
    entity_id: user_id,
  }).catch((err) => console.error('offboard audit failed:', err?.message || err));

  // The account is deactivated either way, but a caller who is told the cleanup
  // succeeded will not go looking for leftover access. Report partial sweeps.
  const clean = results.failures === 0 && !results.sweep_truncated;
  return Response.json({
    success: true,
    complete: clean,
    message: clean
      ? 'User offboarded: account deactivated, patients unassigned, work number released, on-call cleared.'
      : 'User deactivated, but some access revocation did not complete. Review the offboarding audit entry and re-run.',
    results,
  });
}

async function reactivateUser(base44, currentUser, params, callerIsSuperAdmin) {
  const { user_id } = params;
  if (!user_id) {
    return Response.json({ error: 'user_id is required' }, { status: 400 });
  }

  const targetUsers = await base44.asServiceRole.entities.User.filter({ id: user_id }, undefined, 5000);
  const targetUser = targetUsers?.[0];
  if (!targetUser) {
    return Response.json({ error: 'User not found' }, { status: 404 });
  }

  const targetIsPrivileged = targetUser.account_type === 'super_admin'
    || targetUser.account_type === 'agency_admin'
    || targetUser.role === 'admin';
  // No self-exemption here on purpose. Reactivating yourself is exactly the
  // move an offboarded administrator would make to undo their own offboarding,
  // and offboardUser() already refuses self-targeting for the same reason.
  if (targetIsPrivileged && !callerIsSuperAdmin) {
    return Response.json({
      error: 'Only a super admin can reactivate an administrator account, including your own.',
    }, { status: 403 });
  }

  // Agency-scoped admins may only reactivate staff in their own agency.
  const callerIsAgencyScoped = currentUser.account_type !== 'super_admin'
    && currentUser.agency_name
    && (currentUser.account_type === 'agency_admin' || currentUser.role === 'admin');
  if (callerIsAgencyScoped) {
    if (targetUser.agency_name !== currentUser.agency_name) {
      return Response.json({ error: 'Forbidden: target user is outside your agency.' }, { status: 403 });
    }
  }

  await base44.asServiceRole.entities.User.update(user_id, {
    is_active: true,
    duty_status: 'available',
    offboarded_at: '',
    offboarded_by: '',
    offboarding_reason: '',
  });

  await base44.asServiceRole.entities.UserActivity.create({
    user_email: currentUser.email,
    user_name: currentUser.full_name,
    action: 'user_reactivated',
    details: { target_user_email: targetUser.email, target_user_id: user_id },
    page: 'UserManagement',
    entity_type: 'User',
    entity_id: user_id,
  }).catch(() => {});

  return Response.json({ success: true, message: 'User reactivated successfully' });
}
