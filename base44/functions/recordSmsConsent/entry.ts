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

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// <<<BEGIN SHARED HELPER: protectedUserAuthz — generated, edit base44/_shared/backendHelpers.mjs>>>
const normalizeProtectedEmail = (value) => String(value || '').trim().toLowerCase();
const isProtectedAdmin = (user) => !!user && user.role === 'admin';
function isProtectedSuperAdmin(user) {
  const configuredEmail = normalizeProtectedEmail(Deno.env.get('SUPER_ADMIN_EMAIL'));
  return !!configuredEmail
    && isProtectedAdmin(user)
    && normalizeProtectedEmail(user.email) === configuredEmail;
}
// <<<END SHARED HELPER: protectedUserAuthz>>>

// <<<BEGIN SHARED HELPER: activeMembershipAuthz — generated, edit base44/_shared/backendHelpers.mjs>>>
const normalizeMembershipEmail = (value) => String(value || '').trim().toLowerCase();
async function hasExactActiveAgencyMembership(base44, user) {
  const userId = typeof user?.id === 'string' ? user.id.trim() : '';
  const userEmail = normalizeMembershipEmail(user?.email);
  if (!userId || !userEmail) return false;
  let rows;
  try {
    rows = await base44.asServiceRole.entities.AgencyMembership.filter(
      { user_id: userId, status: 'active' },
      undefined,
      2,
    );
  } catch {
    return false;
  }
  if (!Array.isArray(rows) || rows.length !== 1) return false;
  const row = rows[0];
  return !!row
    && String(row.user_id || '').trim() === userId
    && String(row.status || '') === 'active'
    && normalizeMembershipEmail(row.user_email_normalized) === userEmail
    && typeof row.agency_id === 'string'
    && !!row.agency_id.trim();
}
// <<<END SHARED HELPER: activeMembershipAuthz>>>

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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (user.disabled === true || user.is_service === true || user.is_verified === false) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!isProtectedSuperAdmin(user)
      && !(await hasExactActiveAgencyMembership(base44, user))) {
      return Response.json({ error: 'Forbidden: active agency membership required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const phone = normalizeE164(body.phone_e164);
    const status = String(body.consent_status || '');
    if (!phone) return Response.json({ error: 'A valid phone number is required.' }, { status: 400 });
    if (status !== 'opted_in' && status !== 'opted_out') {
      return Response.json({ error: "consent_status must be 'opted_in' or 'opted_out'." }, { status: 400 });
    }

    // Manual consent must be linked to an authorized chart. The only exception
    // is the protected platform owner, who may repair a legacy unlinked ledger
    // row. Custom User fields are self-editable and never grant this authority.
    const patientIdSupplied = body.patient_id !== undefined && body.patient_id !== null;
    const linkedPatientId = typeof body.patient_id === 'string' ? body.patient_id.trim() : null;
    if (patientIdSupplied && (!linkedPatientId || linkedPatientId.length > 200)) {
      return Response.json({ error: 'patient_id is invalid' }, { status: 400 });
    }
    if (!linkedPatientId && !isProtectedSuperAdmin(user)) {
      return Response.json({ error: 'patient_id is required' }, { status: 400 });
    }
    let authorizedPatientId = null;
    if (linkedPatientId) {
      const patientRows = await base44.asServiceRole.entities.Patient
        .filter({ id: linkedPatientId }, '', 2).catch(() => []);
      const exactPatients = Array.isArray(patientRows)
        ? patientRows.filter((row) => row?.id === linkedPatientId)
        : [];
      if (patientRows.length !== 1 || exactPatients.length !== 1) {
        return Response.json({ error: exactPatients.length ? 'Patient lookup is ambiguous' : 'Patient not found' }, {
          status: exactPatients.length ? 409 : 404,
        });
      }
      const claimed = exactPatients[0];
      const isAssigned = Array.isArray(claimed.assigned_nurses)
        && claimed.assigned_nurses.includes(user.email);
      if (!isProtectedSuperAdmin(user) && claimed.created_by !== user.email && !isAssigned) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
      if (normalizeE164(claimed.phone) !== phone) {
        return Response.json({ error: 'phone_e164 does not match the authorized patient' }, { status: 400 });
      }
      authorizedPatientId = claimed.id;
    }

    // Perform the global ledger read only after chart authorization and phone
    // binding. A consumer-initiated STOP is a hard legal revocation: only the
    // consumer can lift it by texting START.
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
      patient_id: authorizedPatientId,
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
      details: { consent_status: status },
      status: 'success',
    }).catch((err) => console.error('audit failed:', err));

    return Response.json({ success: true, consent_status: status, phone_e164: phone });
  } catch (error) {
    console.error('recordSmsConsent error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
