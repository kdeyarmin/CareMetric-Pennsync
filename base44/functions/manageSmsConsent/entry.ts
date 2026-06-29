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

const VALID_STATUSES = ['opted_in', 'opted_out', 'unknown'];

/** Normalize a raw phone string to +E.164, or null if it doesn't look valid. */
function normalizeE164(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  const digits = trimmed.replace(/[^\d]/g, "");

  // US-centric normalization (matches other phone utilities in the repo).
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;

  // Already E.164-ish international form.
  if (trimmed.startsWith("+") && digits.length >= 8 && digits.length <= 15 && digits[0] !== "0") {
    return `+${digits}`;
  }

  return null;
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
      return Response.json({ error: 'Only administrators can manage SMS consent' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'list');

    if (action === 'list') {
      const rows = await base44.asServiceRole.entities.SmsConsent.list('-captured_at', 500);
      const list = Array.isArray(rows) ? rows : [];

      const totals = { opted_in: 0, opted_out: 0, unknown: 0 };
      for (const r of list) {
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
    return Response.json({ error: error.message }, { status: 500 });
  }
});