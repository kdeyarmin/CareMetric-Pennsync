import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * recordSmsConsent — let a nurse/admin record a patient's texting consent
 * (opt-in or opt-out) captured verbally or in writing, into the SmsConsent
 * ledger with an audit trail. This complements the automatic STOP/START capture
 * in the inbound webhook so consent can be set BEFORE the first outbound text
 * (TCPA: you need consent on file before texting).
 *
 * Body: { phone_e164, consent_status: 'opted_in'|'opted_out', patient_id?, notes? }
 */

function normalizeE164(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d]/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (String(raw).trim().startsWith('+') && digits.length >= 8 && digits.length <= 15 && digits[0] !== '0') return `+${digits}`;
  return null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const phone = normalizeE164(body.phone_e164);
    const status = String(body.consent_status || '');
    if (!phone) return Response.json({ error: 'A valid phone number is required.' }, { status: 400 });
    if (status !== 'opted_in' && status !== 'opted_out') {
      return Response.json({ error: "consent_status must be 'opted_in' or 'opted_out'." }, { status: 400 });
    }

    // A consumer-initiated STOP (keyword_stop, captured by the inbound webhook) is
    // a hard legal revocation — only the consumer can lift it by texting START.
    // The send-gate resolves consent from the single newest row, so without this a
    // staff-recorded manual opt-in would become "latest" and silently re-enable
    // texting to a number that legally opted out (TCPA violation). Refuse it.
    if (status === 'opted_in') {
      const latest = await base44.asServiceRole.entities.SmsConsent
        .filter({ phone_e164: phone }, '-captured_at', 1)
        .catch(() => []);
      if (latest[0]?.consent_status === 'opted_out' && latest[0]?.consent_source === 'keyword_stop') {
        return Response.json({
          error: 'This number sent STOP and must text START to re-subscribe; a manual opt-in cannot override a consumer opt-out.',
          consent_status: 'opted_out',
        }, { status: 409 });
      }
    }

    const row = await base44.asServiceRole.entities.SmsConsent.create({
      patient_id: body.patient_id || null,
      phone_e164: phone,
      consent_status: status,
      consent_source: status === 'opted_in' ? 'manual_opt_in' : 'manual_opt_out',
      captured_by: user.email,
      captured_at: new Date().toISOString(),
      notes: typeof body.notes === 'string' ? body.notes.slice(0, 500) : `Recorded by ${user.email}`,
    });

    await base44.asServiceRole.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: status === 'opted_in' ? 'sms_consent_recorded' : 'sms_consent_revoked',
      entity_type: 'SmsConsent',
      entity_id: row.id,
      details: { phone: phone, consent_status: status, patient_id: body.patient_id || null, timestamp: new Date().toISOString() },
      status: 'success',
    }).catch((err) => console.error('audit failed:', err));

    return Response.json({ success: true, consent_status: status, phone_e164: phone });
  } catch (error) {
    console.error('recordSmsConsent error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});