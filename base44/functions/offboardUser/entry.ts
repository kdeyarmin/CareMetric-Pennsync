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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const currentUser = await base44.auth.me();
    if (!currentUser) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAdmin = currentUser.role === 'admin'
      || currentUser.account_type === 'agency_admin'
      || currentUser.account_type === 'super_admin';
    if (!isAdmin) {
      return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
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
  };

  try {
    const patients = await base44.asServiceRole.entities.Patient.list('-updated_date', 5000).catch(() => []);
    for (const p of (patients || [])) {
      const nurses = Array.isArray(p.assigned_nurses) ? p.assigned_nurses : [];
      if (!nurses.includes(targetEmail)) continue;
      const next = nurses.filter((e) => e !== targetEmail);
      await base44.asServiceRole.entities.Patient.update(p.id, { assigned_nurses: next }).catch((err) => {
        console.error('patient unassign failed', p.id, err?.message || err);
      });
      results.patients_unassigned += 1;
    }
  } catch (err) {
    console.error('patient unassign sweep failed:', err?.message || err);
  }

  try {
    const poolRows = await base44.asServiceRole.entities.PhoneNumber.filter(
      { assigned_to_email: targetEmail },
      undefined,
      5000,
    ).catch(() => []);
    for (const row of (poolRows || [])) {
      await base44.asServiceRole.entities.PhoneNumber.update(row.id, {
        status: 'available',
        assigned_to_email: '',
      }).catch((err) => console.error('phone release failed', row.id, err?.message || err));
      results.work_numbers_released += 1;
    }
  } catch (err) {
    console.error('phone pool release failed:', err?.message || err);
  }

  try {
    const shifts = await base44.asServiceRole.entities.OnCallShift.filter(
      { assigned_user_email: targetEmail },
      undefined,
      5000,
    ).catch(() => []);
    for (const shift of (shifts || [])) {
      const priorNotes = shift.notes ? String(shift.notes) : '';
      const clearedNote = `Cleared on offboard ${at} by ${currentUser.email}`;
      await base44.asServiceRole.entities.OnCallShift.update(shift.id, {
        assigned_user_email: '',
        assigned_user_name: '',
        notes: [priorNotes, clearedNote].filter(Boolean).join(' | ').slice(0, 1000),
      }).catch((err) => console.error('on-call clear failed', shift.id, err?.message || err));
      results.on_call_shifts_cleared += 1;
    }
  } catch (err) {
    console.error('on-call clear failed:', err?.message || err);
  }

  try {
    const invites = await base44.asServiceRole.entities.UserInvitation.filter(
      { email: targetEmail, status: 'pending' },
      undefined,
      5000,
    ).catch(() => []);
    for (const inv of (invites || [])) {
      await base44.asServiceRole.entities.UserInvitation.update(inv.id, { status: 'cancelled' }).catch(() => {});
      results.invitations_cancelled += 1;
    }
  } catch (err) {
    console.error('invitation cancel failed:', err?.message || err);
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

  return Response.json({
    success: true,
    message: 'User offboarded: account deactivated, patients unassigned, work number released, on-call cleared.',
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
  if (targetIsPrivileged && !callerIsSuperAdmin && targetUser.email !== currentUser.email) {
    return Response.json({ error: 'Only a super admin can reactivate another administrator.' }, { status: 403 });
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
