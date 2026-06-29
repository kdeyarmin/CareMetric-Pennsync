import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * managePhoneNumberPool — admin-only CRUD + assignment for the Twilio number
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
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (String(raw).trim().startsWith('+') && digits.length >= 8 && digits.length <= 15 && digits[0] !== '0') return `+${digits}`;
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
    const isAdmin =
      user.role === 'admin' ||
      user.account_type === 'super_admin' ||
      user.account_type === 'agency_admin' ||
      String(user.email || '').trim().toLowerCase() === ((Deno.env.get('SUPER_ADMIN_EMAIL') || '').trim().toLowerCase() || null);
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
      const existing = await base44.asServiceRole.entities.PhoneNumber.filter({ e164 }).catch(() => []);
      if (existing.length > 0) {
        return Response.json({ error: `${e164} is already in the pool.` }, { status: 409 });
      }
      // Reflect reality: if a nurse already holds this number, mark it assigned.
      const holders = await base44.asServiceRole.entities.User.filter({ work_phone_number: e164 }).catch(() => []);
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
      const rows = await base44.asServiceRole.entities.PhoneNumber.filter({ id }).catch(() => []);
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

      const rows = await base44.asServiceRole.entities.PhoneNumber.filter({ id }).catch(() => []);
      const row = rows[0];
      if (!row) return Response.json({ error: 'Number not found.' }, { status: 404 });
      const e164 = normalizeE164(row.e164);
      if (!e164) return Response.json({ error: 'Pool number is malformed.' }, { status: 400 });

      const cellNum = body.personal_cell_e164 ? normalizeE164(body.personal_cell_e164) : null;
      if (body.personal_cell_e164 && !cellNum) {
        return Response.json({ error: 'Invalid personal cell number.' }, { status: 400 });
      }

      const targets = await base44.asServiceRole.entities.User.filter({ email: targetEmail }).catch(() => []);
      const target = targets[0];
      if (!target) return Response.json({ error: 'Target nurse not found.' }, { status: 404 });

      // Work numbers must be unique across nurses.
      const holders = await base44.asServiceRole.entities.User.filter({ work_phone_number: e164 }).catch(() => []);
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
      const priorRows = await base44.asServiceRole.entities.PhoneNumber.filter({ assigned_to_email: targetEmail }).catch(() => []);
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
      const rows = await base44.asServiceRole.entities.PhoneNumber.filter({ id }).catch(() => []);
      const row = rows[0];
      if (!row) return Response.json({ error: 'Number not found.' }, { status: 404 });
      const e164 = normalizeE164(row.e164) || row.e164;

      // Clear the nurse's work number only if it still matches this pool number.
      if (row.assigned_to_email) {
        const targets = await base44.asServiceRole.entities.User.filter({ email: row.assigned_to_email }).catch(() => []);
        const target = targets[0];
        if (target && normalizeE164(target.work_phone_number) === e164) {
          await base44.asServiceRole.entities.User.update(target.id, { work_phone_number: '' }).catch(() => {});
        }
      }
      await base44.asServiceRole.entities.PhoneNumber.update(id, { status: 'available', assigned_to_email: '' });
      await audit('phone_number_released', { e164, prior_user_email: row.assigned_to_email || null });
      return Response.json({ success: true, e164 });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    console.error('managePhoneNumberPool error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});