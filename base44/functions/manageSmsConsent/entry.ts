import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * manageSmsConsent — admin-only management surface for the SmsConsent ledger that
 * backs A2P 10DLC / TCPA compliance. Two actions:
 *
 *  - 'list' { search?, limit? }: read the recent SmsConsent rows, compute opt
 *    totals, and return a (optionally phone-filtered) recent slice for display.
 *  - 'set'  { phone_e164, consent_status }: an admin manually records consent for
 *    a number (e.g. honoring a verbal/written opt-out), writing a new SmsConsent
 *    row plus a SecurityLog audit entry.
 *
 * All reads/writes go through base44.asServiceRole. Admin gate mirrors
 * testTelnyxConnection: role 'admin' || account_type 'super_admin' || the owner
 * email. Single-file Deno deploy — helpers are inlined.
 */

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

const VALID_STATUSES = ['opted_in', 'opted_out', 'unknown'];

/** Normalize a raw phone string to +E.164, or null if it doesn't look valid. */
function normalizeE164(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  const digits = trimmed.replace(/[^\d]/g, "");

  // Already E.164-ish international form — decided FIRST. A 10-digit
  // international number ("+49 89 123456") otherwise fell into the NANP branch
  // below and was rewritten as an unrelated "+1..." US subscriber.
  // Mirrors src/components/voice/phoneUtils.js.
  if (trimmed.startsWith("+")) {
    return digits.length >= 8 && digits.length <= 15 && digits[0] !== "0" ? `+${digits}` : null;
  }

  // US-centric normalization (matches other phone utilities in the repo).
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;

  return null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    const isAdmin =
      user.role === 'admin' ||
      user.account_type === 'agency_admin' ||
      user.account_type === 'super_admin';
    if (!isAdmin) {
      return Response.json({ error: 'Only administrators can manage SMS consent' }, { status: 403 });
    }
    if (user.account_type === 'agency_admin' && !user.agency_name) {
      return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'list');
    const isAgencyScoped = user.account_type !== 'super_admin'
      && !!user.agency_name
      && (user.account_type === 'agency_admin' || user.role === 'admin');

    if (action === 'list') {
      let rows = await base44.asServiceRole.entities.SmsConsent.list('-captured_at', 500);
      let list = Array.isArray(rows) ? rows : [];
      // Agency-scope consent rows by linked patient care team when the caller
      // belongs to an agency (super_admin / bare role:admin sees all).
      if (isAgencyScoped) {
        const agencyUsers = await base44.asServiceRole.entities.User
          .filter({ agency_name: user.agency_name }, '-created_date', 5000)
          .catch(() => []);
        const agencyEmails = new Set(
          (Array.isArray(agencyUsers) ? agencyUsers : []).map((u) => u?.email).filter(Boolean)
        );
        const patientIds = new Set();
        const patients = await base44.asServiceRole.entities.Patient
          .list('-created_date', 2000).catch(() => []);
        for (const p of (Array.isArray(patients) ? patients : [])) {
          if ((p.created_by && agencyEmails.has(p.created_by))
            || (Array.isArray(p.assigned_nurses) && p.assigned_nurses.some((e) => agencyEmails.has(e)))) {
            patientIds.add(p.id);
          }
        }
        list = list.filter((r) =>
          (r.patient_id && patientIds.has(r.patient_id))
          || (r.captured_by && agencyEmails.has(r.captured_by))
        );
      }

      // SmsConsent is an append-only ledger, so tallying every row counted a number
      // that texted STOP then START as both an opt-out and an opt-in. Collapse to
      // the newest row per number first (the list is already '-captured_at' ordered,
      // so the first row seen for a number is its live state) — the same rule the
      // send gates use.
      const totals = { opted_in: 0, opted_out: 0, unknown: 0 };
      const latestByPhone = new Map();
      for (const r of list) {
        const key = r?.phone_e164 || '';
        if (!key || latestByPhone.has(key)) continue;
        latestByPhone.set(key, r);
      }
      for (const r of latestByPhone.values()) {
        const s = r?.consent_status;
        if (s === 'opted_in') totals.opted_in += 1;
        else if (s === 'opted_out') totals.opted_out += 1;
        else totals.unknown += 1;
      }

      const search = typeof body.search === 'string' ? body.search.trim().toLowerCase() : '';
      let filtered = list;
      if (search) {
        filtered = list.filter((r) => String(r?.phone_e164 || '').toLowerCase().includes(search));
      }

      const limit = Number.isFinite(Number(body.limit)) && Number(body.limit) > 0 ? Math.floor(Number(body.limit)) : 100;
      const recent = filtered.slice(0, limit).map((r) => ({
        phone_e164: r?.phone_e164 || '',
        consent_status: r?.consent_status || 'unknown',
        consent_source: r?.consent_source || '',
        captured_at: r?.captured_at || '',
        patient_id: r?.patient_id ?? null,
        notes: r?.notes || '',
      }));

      return Response.json({ success: true, totals, recent });
    }

    if (action === 'set') {
      const status = String(body.consent_status || '');
      if (!VALID_STATUSES.includes(status)) {
        return Response.json({ error: "consent_status must be 'opted_in', 'opted_out', or 'unknown'." }, { status: 400 });
      }
      const phone = normalizeE164(body.phone_e164);
      if (!phone) {
        return Response.json({ error: 'A valid E.164 phone number is required.' }, { status: 400 });
      }

      // Agency-scoped admins must bind consent writes to a patient in their
      // agency (or a phone already captured by agency staff) so they cannot
      // overwrite another tenant's TCPA ledger.
      let linkedPatientId = body.patient_id || null;
      if (isAgencyScoped) {
        const agencyUsers = await base44.asServiceRole.entities.User
          .filter({ agency_name: user.agency_name }, '-created_date', 5000)
          .catch(() => []);
        const agencyEmails = new Set(
          (Array.isArray(agencyUsers) ? agencyUsers : []).map((u) => u?.email).filter(Boolean)
        );
        if (linkedPatientId) {
          const [claimed] = await base44.asServiceRole.entities.Patient
            .filter({ id: linkedPatientId }, '', 1).catch(() => []);
          const inAgency = claimed && (
            (claimed.created_by && agencyEmails.has(claimed.created_by))
            || (Array.isArray(claimed.assigned_nurses)
              && claimed.assigned_nurses.some((e) => agencyEmails.has(e)))
          );
          if (!inAgency) {
            return Response.json({ error: 'Forbidden: patient is outside your agency' }, { status: 403 });
          }
        } else {
          const prior = await base44.asServiceRole.entities.SmsConsent
            .filter({ phone_e164: phone }, '-captured_at', 5)
            .catch(() => []);
          const priorInAgency = (Array.isArray(prior) ? prior : []).some((r) =>
            r?.captured_by && agencyEmails.has(r.captured_by)
          );
          if (!priorInAgency) {
            return Response.json({
              error: 'patient_id is required to set consent for a number not already managed by your agency',
            }, { status: 400 });
          }
        }
      }

      // A consumer-initiated STOP (keyword_stop) is a hard legal revocation only the
      // consumer can lift by texting START. The send-gate resolves consent from the
      // single newest row, so an admin_manual opt-in would become "latest" and
      // silently re-enable texting to a number that legally opted out (TCPA). Refuse
      // it — mirror the guard in recordSmsConsent.
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

      const now = new Date().toISOString();
      await base44.asServiceRole.entities.SmsConsent.create({
        phone_e164: phone,
        consent_status: status,
        consent_source: 'admin_manual',
        captured_by: user.email,
        captured_at: now,
        patient_id: linkedPatientId,
        notes: 'Set by admin',
      });

      await base44.asServiceRole.entities.SecurityLog.create({
        timestamp: now,
        user_email: user.email,
        action: 'sms_consent_set_manually',
        details: { phone_e164: phone, consent_status: status },
      }).catch((err) => console.error('SecurityLog write failed:', err));

      return Response.json({ success: true, phone_e164: phone, consent_status: status });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    console.error('manageSmsConsent error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});