import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * scheduleSms — a nurse queues a text to be sent later (e.g. an appointment
 * reminder). It is NOT sent now: a pending ScheduledSms row is created and the
 * dispatchScheduledSms cron picks it up when due, re-checking consent and the
 * agency kill switch at send time. The patient only ever sees the nurse's work
 * number. PHI minimization: the body is never written to the audit log.
 */

const MIN_LEAD_MS = 60 * 1000;
const MAX_SCHEDULE_MS = 365 * 24 * 60 * 60 * 1000;

function normalizeE164(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d]/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (String(raw).trim().startsWith('+') && digits.length >= 8 && digits.length <= 15 && digits[0] !== '0') return `+${digits}`;
  return null;
}

function getThreadId(a, b) {
  const na = normalizeE164(a) || a;
  const nb = normalizeE164(b) || b;
  return [na, nb].sort().join('|');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { to_number, body, patient_id, send_at, template_label } = await req.json();
    if (!to_number || !body || !send_at) {
      return Response.json({ error: 'Missing required fields: to_number, body, send_at' }, { status: 400 });
    }
    if (typeof body !== 'string' || body.length === 0) {
      return Response.json({ error: 'Message body must be a non-empty string' }, { status: 400 });
    }
    if (body.length > 1600) {
      return Response.json({ error: 'Message is too long (max 1600 characters).' }, { status: 400 });
    }

    const fromNumber = user.work_phone_number;
    if (!fromNumber) {
      return Response.json({ error: 'No work number assigned to your account. Ask an admin to provision one.' }, { status: 400 });
    }

    const destination = normalizeE164(to_number);
    if (!destination) {
      return Response.json({ error: 'Invalid destination phone number' }, { status: 400 });
    }

    // Validate the requested time (mirrors src/components/messaging/scheduledSms.js).
    const t = new Date(send_at).getTime();
    const nowMs = Date.now();
    if (Number.isNaN(t)) return Response.json({ error: "That date/time isn't valid." }, { status: 400 });
    if (t < nowMs + MIN_LEAD_MS) return Response.json({ error: 'Pick a time at least a minute from now.' }, { status: 400 });
    if (t > nowMs + MAX_SCHEDULE_MS) return Response.json({ error: 'Pick a time within 365 days.' }, { status: 400 });
    const sendAtIso = new Date(t).toISOString();

    // TCPA: refuse to schedule to a number that has already opted out. (The
    // dispatcher re-checks at send time in case it changes before then.)
    const consents = await base44.asServiceRole.entities.SmsConsent
      .filter({ phone_e164: destination }, '-captured_at', 1).catch(() => []);
    if (consents[0]?.consent_status === 'opted_out') {
      return Response.json({ error: 'This patient has opted out of text messages (replied STOP).' }, { status: 403 });
    }

    const row = await base44.entities.ScheduledSms.create({
      to_number: destination,
      from_number: fromNumber,
      body,
      patient_id: patient_id || null,
      nurse_email: user.email,
      thread_id: getThreadId(fromNumber, destination),
      send_at: sendAtIso,
      status: 'pending',
      template_label: template_label || null,
      attempts: 0,
      created_by: user.email,
    });

    await base44.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'sms_scheduled',
      entity_type: 'ScheduledSms',
      entity_id: row.id,
      details: {
        to_number: destination,
        from_number: fromNumber,
        patient_id: patient_id || null,
        send_at: sendAtIso,
        body_length: body.length,
        timestamp: new Date().toISOString(),
      },
      status: 'success',
    }).catch((err) => console.error('Failed to log activity:', err));

    return Response.json({ success: true, scheduled_id: row.id, send_at: sendAtIso });
  } catch (error) {
    console.error('scheduleSms error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});