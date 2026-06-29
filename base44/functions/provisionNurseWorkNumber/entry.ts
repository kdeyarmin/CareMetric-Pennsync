import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * provisionNurseWorkNumber — admin-only. Assigns a nurse their dedicated Twilio
 * work number and stores their PRIVATE personal cell (the masked bridge target).
 *
 * The Twilio number must already be purchased in your Twilio account with its
 * SMS/Voice webhooks pointed at this app's functions. This call records the
 * mapping in PennSync.
 */

function normalizeE164(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d]/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (String(raw).trim().startsWith('+') && digits.length >= 8 && digits.length <= 15 && digits[0] !== '0') return `+${digits}`;
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
    const isAdmin =
      user.role === 'admin' ||
      user.account_type === 'super_admin' ||
      String(user.email || '').trim().toLowerCase() === ((Deno.env.get('SUPER_ADMIN_EMAIL') || '').trim().toLowerCase() || null);
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

    const targets = await base44.asServiceRole.entities.User.filter({ email: target_user_email });
    const target = targets[0];
    if (!target) {
      return Response.json({ error: 'Target user not found' }, { status: 404 });
    }

    // Work numbers must be unique across nurses.
    if (workNum) {
      const existing = await base44.asServiceRole.entities.User.filter({ work_phone_number: workNum });
      const conflict = existing.find((u) => u.email !== target_user_email);
      if (conflict) {
        return Response.json({ error: `Work number ${workNum} is already assigned to ${conflict.email}` }, { status: 409 });
      }
    }

    const update = {};
    if (workNum) update.work_phone_number = workNum;
    if (cellNum) update.personal_cell_e164 = cellNum;
    if (twilio_phone_number_sid !== undefined) update.twilio_phone_number_sid = twilio_phone_number_sid;
    // Default new nurses to off duty so they aren't bridged before they're ready.
    if (target.duty_status === undefined || target.duty_status === null) update.duty_status = 'off_duty';

    await base44.asServiceRole.entities.User.update(target.id, update);

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
    return Response.json({ error: error.message }, { status: 500 });
  }
});