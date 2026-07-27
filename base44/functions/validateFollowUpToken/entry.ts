import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// validateFollowUpToken — public fetch-by-token for the provider follow-up
// response portal (mirrors validateSignerToken).
//
// No app login: the capability token in the mailed/faxed link IS the
// authorization. Data access runs via service role, but the response is
// scoped strictly to what the provider needs to answer the request:
// the OPEN items of the token's referral plus minimal patient identifiers.
// Deliberately excluded: everything else on the referral (full extracted_data,
// insurance identifiers, analysis results) and ALL revenue/coding mechanics —
// the provider sees the request questions, never payment math.

async function sha256Hex(input) {
  const data = new TextEncoder().encode(String(input));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  try {
    const { token } = await req.json().catch(() => ({}));
    if (!token || typeof token !== 'string') {
      return Response.json({ valid: false, error: 'Token is required' }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    // Tokens are stored ONLY as their SHA-256 hash (generateFollowUpPortalToken,
    // mirroring generateSignerToken): hash the presented plaintext before lookup.
    // No legacy-plaintext fallback — the entity has no pre-hashing data.
    const tokenHash = await sha256Hex(token);
    const rows = await base44.asServiceRole.entities.ProviderFollowUpToken.filter({ token: tokenHash }, undefined, 5000);
    const record = rows && rows[0];
    // A submitted token is deactivated by submitFollowUpResponse in the same
    // update that stamps submitted_at — without this exception a provider
    // re-opening their link always got the 401 error instead of the portal's
    // friendly "this request was already completed" state.
    const alreadySubmitted = !!record?.submitted_at;
    if (!record || (record.is_active !== true && !alreadySubmitted)) {
      return Response.json({ valid: false, error: 'This link is no longer valid.' }, { status: 401 });
    }

    // Expiry — an unparseable expires_at counts as expired (fail closed).
    // Enforced for EVERY token, submitted or not: exempting submitted tokens
    // let a completed link keep returning the patient's name/DOB/referral items
    // indefinitely to anyone holding the URL. Within the original validity
    // window a submitted token still resolves to the friendly "completed"
    // state; past it, the link is simply expired like any other.
    const expiresMs = Date.parse(record.expires_at);
    if (!Number.isFinite(expiresMs) || expiresMs < Date.now()) {
      if (!alreadySubmitted) {
        await base44.asServiceRole.entities.ProviderFollowUpToken.update(record.id, { is_active: false, status: 'expired' }).catch(() => {});
      }
      return Response.json({ valid: false, error: 'This link has expired. Please contact the agency for a new one.' }, { status: 401 });
    }

    const referrals = await base44.asServiceRole.entities.Referral.filter({ id: record.referral_id }, undefined, 5000);
    const referral = referrals && referrals[0];
    const followUp = referral?.follow_up_requests;
    if (!referral || !followUp || !Array.isArray(followUp.items)) {
      return Response.json({ valid: false, error: 'This request is no longer available.' }, { status: 404 });
    }

    // Access audit trail.
    await base44.asServiceRole.entities.ProviderFollowUpToken.update(record.id, {
      access_count: (record.access_count || 0) + 1,
      last_accessed_at: new Date().toISOString(),
    }).catch(() => {});

    // Scope the payload to the request itself — per-item question/why/hint and
    // status. No revenue, no coding tables, no extracted_data.
    const items = followUp.items.map((it, idx) => ({
      item_id: it.id,
      number: idx + 1,
      title: it.title,
      question: it.provider_request?.question || it.needed,
      hint: it.provider_request?.hint || '',
      why: it.why,
      citation: it.citation,
      response_type: it.provider_request?.response_type || 'text',
      item_status: it.item_status || 'open',
    }));

    return Response.json({
      valid: true,
      patient_name: referral.patient_name || '',
      patient_dob: referral.patient_dob || '',
      referral_date: referral.referral_date || '',
      provider_name: record.provider_name || '',
      request_status: followUp.status || 'sent',
      already_submitted: !!record.submitted_at,
      items,
      expiresAt: record.expires_at,
    });
  } catch (error) {
    console.error('validateFollowUpToken error:', error);
    // Generic message — no internals leak to the public endpoint.
    return Response.json({ valid: false, error: 'Unable to validate this link.' }, { status: 500 });
  }
});
