import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * getUserActivityLog — admin/super-admin read of ONE user's phone activity:
 * their call log, texts (metadata only), and audit trail, so the platform owner
 * can review what a given nurse has been doing.
 *
 * Privacy: phone numbers are masked to the last 4 digits (the nurse's private
 * cell can appear as a real call endpoint, so it must never be returned in
 * full), and SMS message bodies are NEVER returned — only a length. This matches
 * how the audit log itself is written.
 *
 * Body: { target_user_email, limit? }
 */

const SUPER_ADMIN_EMAIL = ((typeof Deno !== 'undefined' && Deno.env.get('SUPER_ADMIN_EMAIL')) || '').trim().toLowerCase() || null;
const sameEmail = (a, b) =>
  String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/** Mirrors maskPhone() in src/components/voice/phoneUtils.js — last-4 only. */
function maskLast4(raw) {
  if (!raw) return '';
  const d = String(raw).replace(/[^\d]/g, '');
  if (d.length < 4) return '••••';
  return `(•••) •••-${d.slice(-4)}`;
}

/** Mask any number-ish fields inside an audit `details` object (shallow). */
function maskDetails(details) {
  if (!details || typeof details !== 'object') return details;
  const out = {};
  for (const [k, v] of Object.entries(details)) {
    if (typeof v === 'string' && /number|phone|cell|msisdn|displayed/i.test(k) && /\d/.test(v)) {
      out[k] = maskLast4(v);
    } else {
      out[k] = v;
    }
  }
  return out;
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
      (SUPER_ADMIN_EMAIL && sameEmail(user.email, SUPER_ADMIN_EMAIL));
    if (!isAdmin) {
      return Response.json({ error: 'Administrator access required.' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const targetEmail = String(body.target_user_email || '').trim();
    if (!targetEmail) return Response.json({ error: 'target_user_email is required.' }, { status: 400 });
    const limit = Math.min(Number(body.limit) || 100, 500);

    const targets = await base44.asServiceRole.entities.User.filter({ email: targetEmail }).catch(() => []);
    const target = targets[0];
    if (!target) return Response.json({ error: 'User not found.' }, { status: 404 });

    const [callRows, smsRows, activityRows] = await Promise.all([
      base44.asServiceRole.entities.CallLog.filter({ nurse_email: targetEmail }, '-created_date', limit).catch(() => []),
      base44.asServiceRole.entities.SmsMessage.filter({ nurse_email: targetEmail }, '-created_date', limit).catch(() => []),
      base44.asServiceRole.entities.UserActivity.filter({ user_email: targetEmail }, '-created_date', limit).catch(() => []),
    ]);

    const calls = callRows.map((c) => ({
      id: c.id,
      created_date: c.created_date,
      direction: c.direction,
      call_mode: c.call_mode,
      status: c.status,
      duration_seconds: c.duration_seconds ?? null,
      disposition: c.disposition || null,
      has_voicemail: !!c.has_voicemail,
      from_masked: maskLast4(c.from_number),
      to_masked: maskLast4(c.to_number),
      displayed_masked: maskLast4(c.displayed_number),
      patient_id: c.patient_id || null,
    }));

    const texts = smsRows.map((m) => ({
      id: m.id,
      created_date: m.created_date,
      direction: m.direction,
      status: m.status,
      from_masked: maskLast4(m.from_number),
      to_masked: maskLast4(m.to_number),
      body_length: m.body ? String(m.body).length : 0,
      patient_id: m.patient_id || null,
    }));

    const activity = activityRows.map((a) => ({
      id: a.id,
      created_date: a.created_date,
      action: a.action,
      entity_type: a.entity_type || null,
      entity_id: a.entity_id || null,
      status: a.status || null,
      page: a.page || null,
      details: maskDetails(a.details),
    }));

    return Response.json({
      success: true,
      user: {
        email: target.email,
        full_name: target.full_name || null,
        role: target.role || null,
        account_type: target.account_type || null,
        duty_status: target.duty_status || null,
        work_phone_number: target.work_phone_number || null,
        personal_cell_masked: maskLast4(target.personal_cell_e164),
      },
      counts: { calls: calls.length, texts: texts.length, activity: activity.length },
      calls,
      texts,
      activity,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('getUserActivityLog error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});