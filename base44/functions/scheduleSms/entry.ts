import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * scheduleSms — a nurse queues a text to be sent later (e.g. an appointment
 * reminder). It is NOT sent now: a pending ScheduledSms row is created and the
 * dispatchScheduledSms cron picks it up when due, re-checking consent and the
 * agency kill switch at send time. The patient only ever sees the nurse's work
 * number. PHI minimization: the body is never written to the audit log.
 */

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

const MIN_LEAD_MS = 60 * 1000;
const MAX_SCHEDULE_MS = 365 * 24 * 60 * 60 * 1000;

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
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

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

    // TCPA: refuse to schedule without prior express consent on file. The
    // dispatcher re-checks at send time (including unknown → block).
    const consents = await base44.asServiceRole.entities.SmsConsent
      .filter({ phone_e164: destination }, '-captured_at', 1).catch(() => []);
    const consentStatus = consents[0]?.consent_status || 'unknown';
    if (consentStatus === 'opted_out') {
      return Response.json({ error: 'This patient has opted out of text messages (replied STOP).' }, { status: 403 });
    }
    if (consentStatus !== 'opted_in') {
      return Response.json({
        error: 'No texting consent is on file for this number. Record opt-in before scheduling.',
        reason: 'consent_required',
      }, { status: 403 });
    }

    // Prefer phone→patient resolution. Authorize EVERY resolved row (including
    // phone matches) so a foreign chart with the same number cannot be linked.
    let resolvedPatientId = null;
    const canAccessPatient = async (claimed) => {
      if (!claimed) return false;
      const isSuperAdmin = user.account_type === 'super_admin';
      const isAgencyScopedAdmin =
        user.account_type === 'agency_admin'
        || (user.role === 'admin' && !!user.agency_name && !isSuperAdmin);
      const isPlatformAdmin = isSuperAdmin || (user.role === 'admin' && !user.agency_name);
      const isAssigned = Array.isArray(claimed.assigned_nurses)
        && claimed.assigned_nurses.includes(user.email);
      if (isPlatformAdmin || claimed.created_by === user.email || isAssigned) return true;
      if (!isAgencyScopedAdmin) return false;
      if (!user.agency_name) return false;
      const agencyUsers = await base44.asServiceRole.entities.User
        .list('-created_date', 5000).catch(() => []);
      const agencyEmails = new Set(
        (agencyUsers || [])
          .filter((u) => u.agency_name === user.agency_name && u.email)
          .map((u) => u.email),
      );
      return (claimed.created_by && agencyEmails.has(claimed.created_by))
        || (Array.isArray(claimed.assigned_nurses)
          && claimed.assigned_nurses.some((e) => agencyEmails.has(e)));
    };

    if (destination) {
      const d = destination.replace(/[^\d]/g, '').slice(-10);
      if (d.length === 10) {
        const a = d.slice(0, 3), b = d.slice(3, 6), c = d.slice(6);
        const variants = [destination, `+1${d}`, `1${d}`, d, `(${a}) ${b}-${c}`, `${a}-${b}-${c}`];
        for (const variant of variants) {
          const matches = await base44.asServiceRole.entities.Patient
            .filter({ phone: variant }, undefined, 10).catch(() => []);
          for (const match of matches || []) {
            if (match?.id && await canAccessPatient(match)) {
              resolvedPatientId = match.id;
              break;
            }
          }
          if (resolvedPatientId) break;
        }
      }
    }
    if (patient_id) {
      if (resolvedPatientId && resolvedPatientId !== patient_id) {
        return Response.json({
          error: 'patient_id does not match the destination phone number',
          reason: 'patient_phone_mismatch',
        }, { status: 400 });
      }
      if (!resolvedPatientId) {
        const [claimed] = await base44.asServiceRole.entities.Patient
          .filter({ id: patient_id }, '', 1).catch(() => []);
        if (!claimed) {
          return Response.json({ error: 'Patient not found' }, { status: 404 });
        }
        if (!(await canAccessPatient(claimed))) {
          return Response.json({ error: 'Forbidden' }, { status: 403 });
        }
        resolvedPatientId = patient_id;
      } else {
        resolvedPatientId = patient_id;
      }
    } else if (resolvedPatientId) {
      // Phone match already authorized above.
    }

    const row = await base44.entities.ScheduledSms.create({
      to_number: destination,
      from_number: fromNumber,
      body,
      patient_id: resolvedPatientId || null,
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
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});