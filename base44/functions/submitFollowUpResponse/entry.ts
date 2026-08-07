import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// submitFollowUpResponse — public submit endpoint for the provider follow-up
// response portal (mirrors submitSignerSignature).
//
// The write happens SERVER-SIDE behind the capability token: the browser never
// touches the Referral entity. Responses are merged only into the matching
// items of the token's own referral; the token is single-use (deactivated on
// submission) so a mailed link can't be replayed to alter answers later.

async function sha256Hex(input) {
  const data = new TextEncoder().encode(String(input));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  try {
    const { token, responses, completed_by, credential } = await req.json().catch(() => ({}));
    if (!token || typeof token !== 'string') {
      return Response.json({ error: 'Token is required' }, { status: 400 });
    }
    if (!Array.isArray(responses) || responses.length === 0) {
      return Response.json({ error: 'At least one response is required' }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    // Tokens are stored ONLY as their SHA-256 hash (generateFollowUpPortalToken,
    // mirroring generateSignerToken): hash the presented plaintext before lookup.
    // No legacy-plaintext fallback — the entity has no pre-hashing data.
    const tokenHash = await sha256Hex(token);
    const rows = await base44.asServiceRole.entities.ProviderFollowUpToken.filter({ token: tokenHash }, undefined, 5000);
    const record = rows && rows[0];
    if (!record || record.is_active === false) {
      return Response.json({ error: 'This link is no longer valid.' }, { status: 401 });
    }
    const expiresMs = Date.parse(record.expires_at);
    if (!Number.isFinite(expiresMs) || expiresMs < Date.now()) {
      await base44.asServiceRole.entities.ProviderFollowUpToken.update(record.id, { is_active: false, status: 'expired' }).catch(() => {});
      return Response.json({ error: 'This link has expired.' }, { status: 401 });
    }
    if (record.submitted_at || record.submit_claimed_by) {
      return Response.json({ error: 'This request was already submitted.' }, { status: 409 });
    }

    const referrals = await base44.asServiceRole.entities.Referral.filter({ id: record.referral_id }, undefined, 5000);
    const referral = referrals && referrals[0];
    const followUp = referral?.follow_up_requests;
    if (!referral || !followUp || !Array.isArray(followUp.items)) {
      return Response.json({ error: 'This request is no longer available.' }, { status: 404 });
    }

    const now = new Date().toISOString();
    const byItemId = new Map();
    for (const r of responses) {
      if (r && typeof r.item_id === 'string' && typeof r.response_text === 'string' && r.response_text.trim()) {
        // Cap response length defensively — this is a public endpoint.
        byItemId.set(r.item_id, r.response_text.trim().slice(0, 4000));
      }
    }

    let answered = 0;
    const items = followUp.items.map((it) => {
      const text = byItemId.get(it.id);
      if (text === undefined) return it;
      answered += 1;
      return {
        ...it,
        item_status: 'answered',
        response: {
          text,
          completed_by: String(completed_by || '').slice(0, 200) || null,
          credential: String(credential || '').slice(0, 50) || null,
        },
        answered_at: now,
      };
    });
    if (answered === 0) {
      return Response.json({ error: 'No responses matched the requested items.' }, { status: 400 });
    }

    // Claim BEFORE the Referral merge (non-terminal). Terminal fields
    // (submitted_at / delivered / inactive) are stamped only AFTER the merge
    // succeeds — otherwise a failed Referral write permanently loses the response.
    const claimToken = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `followup-submit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      await base44.asServiceRole.entities.ProviderFollowUpToken.update(record.id, {
        submit_claimed_by: claimToken,
      });
    } catch {
      return Response.json({ error: 'This request was already submitted.' }, { status: 409 });
    }
    const claimCheck = await base44.asServiceRole.entities.ProviderFollowUpToken
      .filter({ id: record.id }, undefined, 1).catch(() => []);
    if (!claimCheck[0] || claimCheck[0].submit_claimed_by !== claimToken) {
      return Response.json({ error: 'This request was already submitted.' }, { status: 409 });
    }
    if (claimCheck[0].submitted_at) {
      return Response.json({ error: 'This request was already submitted.' }, { status: 409 });
    }

    try {
      await base44.asServiceRole.entities.Referral.update(referral.id, {
        follow_up_requests: {
          ...followUp,
          items,
          status: 'received',
          received_at: now,
        },
      });
    } catch (mergeErr) {
      // Release the claim so the provider can retry.
      await base44.asServiceRole.entities.ProviderFollowUpToken.update(record.id, {
        submit_claimed_by: null,
      }).catch(() => {});
      console.error('submitFollowUpResponse Referral merge failed:', mergeErr?.message || mergeErr);
      return Response.json({ error: 'Unable to save responses. Please try again.' }, { status: 500 });
    }

    await base44.asServiceRole.entities.ProviderFollowUpToken.update(record.id, {
      is_active: false,
      status: 'delivered',
      submitted_at: now,
    }).catch(() => {});

    // Tell the requesting staff member the provider responded.
    if (referral.created_by) {
      await base44.asServiceRole.entities.Notification.create({
        user_email: referral.created_by,
        title: '📥 Provider responded to follow-up request',
        message: `${record.provider_name || 'The provider'} answered ${answered} item(s) for ${referral.patient_name || 'a referral'}. Review and mark items resolved.`,
        type: 'info',
        priority: 'medium',
        metadata: { related_entity: 'Referral', related_entity_id: referral.id },
        is_read: false,
        action_url: `/ReferralFollowUp?id=${referral.id}`,
      }).catch(() => {});
    }

    return Response.json({ success: true, answered });
  } catch (error) {
    console.error('submitFollowUpResponse error:', error);
    return Response.json({ error: 'Unable to submit responses.' }, { status: 500 });
  }
});
