import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: brandedEmail — generated, edit base44/_shared/backendHelpers.mjs>>>
const BRAND_EMAIL = {
  navy: '#213a76', navyDeep: '#1c2f5e', gold: '#c7901f',
  ink: '#111a2b', slate: '#334155', muted: '#5b6a7f', line: '#e4e9f1',
  wash: '#eef3fc', panel: '#f5f8fd',
  logo: 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/68ee80d98929370f9e8f2932/02eed9872_pennsynclogoupdated.png',
};
// Callout tones. 'info' is on-brand navy; success/warn/urgent reuse the manual
// theme's green/amber/red and are used ONLY for genuine status (never decoration).
const EMAIL_TONES = {
  info:    { bg: '#eef3fc', border: '#88a5e0', text: '#213a76' },
  success: { bg: '#effdf4', border: '#86efac', text: '#15803d' },
  warn:    { bg: '#fff8ec', border: '#fcd68a', text: '#b45309' },
  urgent:  { bg: '#fef2f2', border: '#fca5a5', text: '#b91c1c' },
};
function escapeEmailHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// Allow only absolute http(s)/mailto links in email buttons, then HTML-escape the
// whole attribute value. Rejects dangerous/unusable schemes (javascript:, data:,
// protocol-relative //host, app-relative paths that don't resolve in an inbox) so
// a user-controlled URL can never inject a scheme or break out of the attribute.
// Returns '' for a rejected URL, and the caller then renders no button.
function safeEmailHref(raw) {
  const url = String(raw ?? '').trim();
  const lower = url.toLowerCase();
  const ok = lower.startsWith('https://') || lower.startsWith('http://') || lower.startsWith('mailto:');
  return ok ? escapeEmailHtml(url) : '';
}
function emailParagraph(text) {
  return `<p style="margin:0 0 14px;font-size:15px;line-height:1.62;color:${BRAND_EMAIL.slate};">${escapeEmailHtml(text)}</p>`;
}
function renderEmailSection(section) {
  const s = section || {};
  const parts = [];
  if (s.heading) {
    parts.push(`<h2 style="margin:20px 0 8px;font-size:16px;font-weight:800;color:${BRAND_EMAIL.ink};">${escapeEmailHtml(s.heading)}</h2>`);
  }
  for (const p of (Array.isArray(s.paragraphs) ? s.paragraphs : [])) parts.push(emailParagraph(p));
  if (s.pre) {
    parts.push(`<pre style="margin:4px 0 16px;padding:14px 16px;background:${BRAND_EMAIL.panel};border:1px solid ${BRAND_EMAIL.line};border-radius:10px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:12.5px;line-height:1.5;color:${BRAND_EMAIL.ink};white-space:pre-wrap;word-break:break-word;">${escapeEmailHtml(s.pre)}</pre>`);
  }
  if (Array.isArray(s.rows) && s.rows.length) {
    const rows = s.rows.map((r) =>
      `<tr><td style="padding:5px 0;font-size:13.5px;color:${BRAND_EMAIL.muted};vertical-align:top;white-space:nowrap;">${escapeEmailHtml(r[0])}</td>` +
      `<td style="padding:5px 0 5px 16px;font-size:14px;color:${BRAND_EMAIL.ink};font-weight:600;vertical-align:top;">${escapeEmailHtml(r[1])}</td></tr>`
    ).join('');
    parts.push(`<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:4px 0 16px;background:${BRAND_EMAIL.panel};border:1px solid ${BRAND_EMAIL.line};border-radius:10px;"><tr><td style="padding:8px 16px;"><table role="presentation" cellpadding="0" cellspacing="0" width="100%">${rows}</table></td></tr></table>`);
  }
  if (Array.isArray(s.bullets) && s.bullets.length) {
    const items = s.bullets.map((b) =>
      `<li style="margin:0 0 7px;font-size:14.5px;line-height:1.55;color:${BRAND_EMAIL.slate};">${escapeEmailHtml(b)}</li>`
    ).join('');
    parts.push(`<ul style="margin:0 0 16px;padding-left:20px;">${items}</ul>`);
  }
  if (s.callout && s.callout.text) {
    const t = EMAIL_TONES[s.callout.tone] || EMAIL_TONES.info;
    parts.push(`<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:4px 0 16px;"><tr><td style="padding:13px 16px;background:${t.bg};border-left:4px solid ${t.border};border-radius:8px;font-size:14px;line-height:1.55;color:${t.text};font-weight:600;">${escapeEmailHtml(s.callout.text)}</td></tr></table>`);
  }
  if (s.button && s.button.href) {
    const href = safeEmailHref(s.button.href);
    if (href) {
      parts.push(`<div style="margin:6px 0 18px;"><a href="${href}" target="_blank" rel="noopener" style="display:inline-block;padding:13px 26px;border-radius:8px;background:${BRAND_EMAIL.navy};color:#ffffff;font-weight:700;font-size:15px;line-height:1;text-decoration:none;">${escapeEmailHtml(s.button.label || 'Open PennSync')}</a></div>`);
    }
  }
  if (s.note) {
    parts.push(`<p style="margin:0 0 14px;font-size:12.5px;line-height:1.55;color:${BRAND_EMAIL.muted};">${escapeEmailHtml(s.note)}</p>`);
  }
  return parts.join('');
}
/**
 * Build a branded PennSync email. Returns an HTML string for SendEmail's body.
 * opts: { preheader, eyebrow, tone('brand'|'urgent'), title, intro(string|string[]),
 *         sections[{ heading, paragraphs[], pre, rows[[k,v]], bullets[], callout{text,tone},
 *         button{href,label}, note }], signoffName, footerNote }
 */
function renderBrandedEmail(opts) {
  const o = opts || {};
  const rule = o.tone === 'urgent' ? '#dc2626' : BRAND_EMAIL.gold;
  const intro = Array.isArray(o.intro) ? o.intro : (o.intro ? [o.intro] : []);
  const sections = Array.isArray(o.sections) ? o.sections : [];
  const signoff = o.signoffName === null ? '' : (o.signoffName || 'The PennSync by CareMetric Team');
  const preheader = o.preheader ? escapeEmailHtml(o.preheader) : '';
  const eyebrow = o.eyebrow
    ? `<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:${BRAND_EMAIL.gold};">${escapeEmailHtml(o.eyebrow)}</p>`
    : '';
  const introHtml = intro.map(emailParagraph).join('');
  const sectionsHtml = sections.map(renderEmailSection).join('');
  const signoffHtml = signoff
    ? `<p style="margin:22px 0 2px;font-size:15px;line-height:1.6;color:${BRAND_EMAIL.slate};">Warm regards,<br /><strong style="color:${BRAND_EMAIL.navy};">${escapeEmailHtml(signoff)}</strong></p>`
    : '';
  const footerNote = o.footerNote
    ? `<p style="margin:0 0 8px;font-size:11.5px;line-height:1.5;color:${BRAND_EMAIL.muted};">${escapeEmailHtml(o.footerNote)}</p>`
    : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><meta name="color-scheme" content="light only" /><title>${escapeEmailHtml(o.title || 'PennSync by CareMetric')}</title></head>
<body style="margin:0;padding:0;background:${BRAND_EMAIL.wash};">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;color:${BRAND_EMAIL.wash};">${preheader}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND_EMAIL.wash};"><tr><td align="center" style="padding:28px 14px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border:1px solid ${BRAND_EMAIL.line};border-radius:16px;overflow:hidden;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr><td style="background:linear-gradient(180deg,#25407e 0%,${BRAND_EMAIL.navyDeep} 100%);padding:28px 28px 24px;text-align:center;">
    <img src="${BRAND_EMAIL.logo}" width="54" height="54" alt="PennSync" style="display:inline-block;width:54px;height:54px;border-radius:13px;border:0;" />
    <div style="margin-top:11px;font-size:23px;font-weight:800;letter-spacing:-.3px;color:#ffffff;">Penn<span style="color:${BRAND_EMAIL.gold};">Sync</span></div>
    <div style="margin-top:4px;font-size:10.5px;font-weight:600;letter-spacing:4px;text-transform:uppercase;color:#b6c9ee;">by CareMetric</div>
    <div style="width:58px;height:4px;border-radius:3px;background:${rule};margin:14px auto 0;"></div>
  </td></tr>
  <tr><td style="padding:30px 32px 6px;">
    ${eyebrow}<h1 style="margin:0;font-size:22px;font-weight:800;color:${BRAND_EMAIL.navy};">${escapeEmailHtml(o.title || '')}</h1>
  </td></tr>
  <tr><td style="padding:14px 32px 4px;">${introHtml}${sectionsHtml}${signoffHtml}</td></tr>
  <tr><td style="padding:24px 32px 30px;text-align:center;">
    <div style="height:1px;background:${BRAND_EMAIL.line};margin-bottom:16px;"></div>
    <div style="font-size:13px;font-weight:800;color:${BRAND_EMAIL.navy};">Penn<span style="color:${BRAND_EMAIL.gold};">Sync</span> <span style="font-weight:600;color:${BRAND_EMAIL.muted};">by CareMetric</span></div>
    ${footerNote}<p style="margin:8px 0 0;font-size:11.5px;line-height:1.5;color:${BRAND_EMAIL.muted};">This is an automated message from PennSync by CareMetric — please do not reply to this email.</p>
  </td></tr>
</table></td></tr></table>
</body></html>`;
}
// <<<END SHARED HELPER: brandedEmail>>>

// Operational debug logs are compiled out in production (the FUNCTIONS_DEBUG
// secret was retired). console.error/warn remain ungated for visibility.
const debugLog = (..._args) => {};

// ── On-hire annual enrollment helpers ───────────────────────────────────────
// A new hire should immediately receive the current-year required in-services
// for their business line and role tier. Resolve them to EXACTLY ONE annual
// plan (mirrors autoEnrollAnnualPlans) so shared core courses aren't assigned
// twice, then create the enrollment + per-course assignments idempotently.
const isLicensedNurse = (u) => {
  const c = `${u?.credential_type || ''} ${u?.credentials || ''} ${u?.job_title || ''}`.toUpperCase();
  return c.includes('RN') || c.includes('LPN') || c.includes('NURSE');
};
const userLine = (u) => {
  const bl = u?.business_line;
  if (bl === 'home_health' || bl === 'hospice') return bl;
  const cs = u?.care_scope;
  if (cs === 'hospice') return 'hospice';
  if (cs === 'home_health') return 'home_health';
  return 'home_health';
};
const resolveAnnualPlanForUser = (u, plans) => {
  const line = userLine(u);
  const wantNurses = isLicensedNurse(u);
  const linePlans = plans.filter((p) => p.business_line_scope === line);
  const pool = linePlans.length ? linePlans : plans.filter((p) => p.business_line_scope === 'all');
  if (!pool.length) return null;
  return pool.find((p) => /nurse/i.test(p.name || '') === wantNurses) || pool[0];
};

async function enrollNewHireInAnnualPlan(base44, user) {
  const svc = base44.asServiceRole.entities;
  const today = new Date();
  const year = today.getUTCFullYear();
  const plans = await svc.LearningPlan.filter({ plan_type: 'annual', year, active: true }, '-created_date', 200);
  const plan = resolveAnnualPlanForUser(user, plans);
  if (!plan) return { enrolled: false, reason: 'no_matching_plan' };

  const planItems = await svc.LearningPlanCourse.filter({ plan_id: plan.id }, 'order_index', 300);
  const dueDate = `${year}-12-31`;

  const [existingEnrollment] = await svc.PlanEnrollment.filter({ plan_id: plan.id, user_id: user.email }, '-created_date', 1);
  if (!existingEnrollment) {
    await svc.PlanEnrollment.create({
      plan_id: plan.id,
      plan_name: plan.name,
      user_id: user.email,
      user_name: user.full_name,
      enrolled_at: today.toISOString(),
      enrolled_by: 'system-on-hire',
      status: 'active',
      progress_percentage: 0,
      courses_completed: 0,
      courses_total: planItems.length,
      due_date: dueDate,
    });
  }

  let assignmentsCreated = 0;
  for (const item of planItems) {
    const existing = await svc.TrainingAssignment.filter(
      { plan_id: plan.id, course_id: item.course_id, assigned_to_user_id: user.email, annual_cycle_year: year },
      '-created_date',
      1,
    );
    if (existing.length > 0) continue;
    await svc.TrainingAssignment.create({
      course_id: item.course_id,
      course_title: item.course_title,
      plan_id: plan.id,
      assigned_to_user_id: user.email,
      assigned_to_role: user.job_title || user.credential_type || user.role,
      assigned_to_business_line: user.business_line || '',
      assigned_by: 'system-on-hire',
      assigned_date: today.toISOString(),
      due_date: item.specific_due_date || dueDate,
      annual_cycle_year: year,
      priority: 'high',
      status: 'assigned',
      required: item.is_required !== false,
      passing_score_required: 80,
      waiting_period_hours: 0,
      regenerate_test_on_retake: true,
      retake_required: false,
      renewal_frequency: 'annual',
      attestation_required: false,
      remediation_message: 'Please review the lesson content and complete a new retake.',
      progress_percentage: 0,
      notes: 'Automatically assigned on hire (current-year required in-services).',
      archived_status: false,
    });
    assignmentsCreated++;
  }
  return { enrolled: true, plan_name: plan.name, assignments_created: assignmentsCreated };
}

Deno.serve(async (req) => {
  try {
    debugLog('onUserSignup triggered');
    const base44 = createClientFromRequest(req);
    const { user } = await req.json();
    debugLog('User data received:', user?.email ? '[email present]' : '[no email]');

    if (!user || !user.email) {
      console.error('No user data provided');
      return Response.json({ error: 'No user data provided' }, { status: 400 });
    }

    // Check if user was invited. Match the invitation email case-insensitively:
    // the invitation casing may differ from the signup payload (e.g. an admin
    // invites Jane.Doe@Example.com but the auth event sends jane.doe@example.com).
    // A case-sensitive match would misclassify a genuinely invited user as an
    // uninvited signup — and with invite-only there is no manual-approval rescue.
    debugLog('Checking for invitation...');
    const normalizedEmail = (user.email || '').trim().toLowerCase();
    // Explicit high limit: an unlimited filter() is capped at the server's
    // default page (~50 rows). The signing-up user is matched against this list
    // BELOW by normalized email, so once an agency has more than a page of
    // pending invitations, an invited user whose invitation sorted past the cap
    // is treated as uninvited — they lose the invited role/approval and land in
    // the unregistered path instead.
    const pendingInvitations = await base44.asServiceRole.entities.UserInvitation.filter({
      status: 'pending'
    }, undefined, 5000);
    const invitations = (pendingInvitations || []).filter(
      (inv) => (inv.email || '').trim().toLowerCase() === normalizedEmail
    );
    debugLog('Found invitations:', invitations.length);

    if (invitations && invitations.length > 0) {
      const invitation = invitations[0];

      // status:'pending' only means "actionable until expires_at" — the sweep
      // that flips pending->expired (checkExpiredInvitations) runs on a
      // schedule, so between expiry and the next sweep a stale invitation would
      // still grant its role and auto-approval. Re-check at the point of use and
      // fail closed on a missing/unparseable expiry, matching that sweep.
      const expiresAtMs = Date.parse(invitation.expires_at || '');
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
        await base44.asServiceRole.entities.UserInvitation.update(invitation.id, { status: 'expired' }).catch(() => {});
        return Response.json({ error: 'This invitation has expired. Ask an administrator to send a new one.' }, { status: 403 });
      }

      // Don't trust the body's user.id<->email pairing: confirm the id resolves
      // to the invited email before granting role/approval.
      const actualUsers = await base44.asServiceRole.entities.User.filter({ id: user.id }, undefined, 5000);
      if (!actualUsers?.[0] || actualUsers[0].email !== user.email) {
        return Response.json({ error: 'User id/email mismatch' }, { status: 400 });
      }
      
      // Auto-approve ALL invited users (admin-added users should be automatically approved)
      debugLog('Auto-approving invited user...');
      
      try {
        await base44.asServiceRole.entities.User.update(user.id, {
          // Apply the admin-provided name from the invitation so invited users
          // start with their real name (not an email-derived placeholder).
          // Fall back to whatever the signup already set so we never wipe a name.
          full_name: invitation.full_name || user.full_name,
          role: invitation.role,
          care_scope: invitation.care_scope,
          phone: invitation.phone,
          credentials: invitation.credentials,
          is_approved: true
        });

        const verification = await verifyInvitedUser(base44, user.email);

        if (verification.success) {
          // Soft-close like autoApproveInvitedUser — hard-delete races with
          // resend/offboard flows that still need to see the invite row, and
          // loses audit of who accepted what.
          await base44.asServiceRole.entities.UserInvitation.update(invitation.id, {
            status: 'accepted',
            accepted_at: new Date().toISOString(),
          });
        }

        try {
          await base44.asServiceRole.entities.UserActivity.create({
            user_email: user.email,
            user_name: user.full_name,
            action: 'user_signup_auto_approved',
            details: {
              invitation_id: invitation.id,
              role: invitation.role,
              care_scope: invitation.care_scope,
              invited_by: invitation.invited_by,
              auth_verified: verification.success
            },
            page: 'Signup',
            entity_type: 'User',
            entity_id: user.id
          });
        } catch (logError) {
          console.error('Failed to log activity:', logError);
        }

        // Enroll the new hire into the current-year required in-services for
        // their line/role. Best-effort: a failure here must never block the
        // signup/approval, matching the function's fail-open posture.
        let enrollment = null;
        try {
          enrollment = await enrollNewHireInAnnualPlan(base44, { ...actualUsers[0], ...invitation, email: user.email, full_name: invitation.full_name || user.full_name });
          debugLog('On-hire annual enrollment:', enrollment);
        } catch (enrollError) {
          console.error('On-hire annual enrollment failed:', enrollError);
        }

        debugLog('Auto-approved invited user', verification.success ? '(verified)' : '(verification pending)');
        return Response.json({ success: true, auto_approved: true, auth_verified: verification.success, enrollment });
      } catch (updateError) {
        console.error('Failed to auto-approve user:', updateError);
      }
    }

    // INVITE-ONLY APP: there is no public sign-up. A signup with no matching
    // invitation is unauthorized. The account is left unapproved (is_approved
    // defaults to false) so the app's approval gate blocks it, and it cannot be
    // approved manually — the only path to access is an admin invitation.
    // Admins are sent a security alert so they can invite the person if the
    // attempt was legitimate.
    console.warn('Blocked uninvited sign-up (invite-only app)');

    // Record the blocked attempt for the audit trail.
    try {
      await base44.asServiceRole.entities.UserActivity.create({
        user_email: user.email,
        user_name: user.full_name,
        action: 'uninvited_signup_blocked',
        details: { email: user.email, attempted_at: new Date().toISOString() },
        page: 'Signup',
        entity_type: 'User',
        entity_id: user.id
      });
    } catch (logError) {
      console.error('Failed to log blocked signup:', logError);
    }

    // Defense-in-depth: explicitly ensure this account is NOT approved, so an
    // unexpected platform default can never grant access. Verify the id resolves
    // to this email first (don't trust the body's id<->email pairing). This is
    // fail-closed — it only ever removes access, never grants it.
    try {
      const blockedUsers = await base44.asServiceRole.entities.User.filter({ id: user.id }, undefined, 5000);
      const blockedUser = blockedUsers?.[0];
      if (blockedUser
        && (blockedUser.email || '').trim().toLowerCase() === normalizedEmail
        && blockedUser.is_approved) {
        await base44.asServiceRole.entities.User.update(user.id, { is_approved: false });
        debugLog('Forced is_approved=false for uninvited signup');
      }
    } catch (blockError) {
      console.error('Failed to enforce blocked state for uninvited signup:', blockError);
    }

    debugLog('Fetching admin users...');
    // Platform-wide security alert for blocked uninvited signups (no patient PHI).
    // Use isAdminLike tiers so agency_admin/super_admin accounts are included —
    // role==='admin' alone missed those account types at some agencies.
    const allUsers = await base44.asServiceRole.entities.User.list('-created_date', 5000).catch(() => []);
    const admins = (Array.isArray(allUsers) ? allUsers : []).filter((u) =>
      u && u.email && (
        u.role === 'admin' ||
        u.account_type === 'agency_admin' ||
        u.account_type === 'super_admin'
      )
    );
    debugLog('Found admins:', admins.length);

    const attemptDate = new Date().toLocaleString();
    const blockedSignupEmail = (greetingName) => renderBrandedEmail({
      preheader: 'A sign-up attempt was blocked because the account was not invited.',
      eyebrow: 'Security alert',
      tone: 'urgent',
      title: 'Blocked uninvited sign-up',
      intro: [
        `Hello ${greetingName},`,
        'A sign-up attempt was blocked on PennSync by CareMetric because the account was not invited. PennSync is invite-only — there is no public sign-up, so this account has not been granted access and cannot be approved manually.',
      ],
      sections: [
        {
          heading: 'Attempt details',
          rows: [
            ['Name', user.full_name || 'Not provided'],
            ['Email', user.email],
            ['Attempt date', attemptDate],
          ],
        },
        {
          paragraphs: [
            'If this person should have access, send them an invitation from the Admin Dashboard → User Management. No other action is required — they remain blocked until invited.',
          ],
        },
      ],
      signoffName: 'The PennSync by CareMetric Security Team',
    });

    // Send a security alert to all admins
    const emailPromises = admins.map(admin =>
      base44.asServiceRole.integrations.Core.SendEmail({
        to: admin.email,
        subject: 'Security alert: blocked uninvited sign-up · PennSync by CareMetric',
        from_name: 'PennSync by CareMetric',
        body: blockedSignupEmail(admin.full_name || 'Admin'),
      })
    );

    debugLog('Sending blocked-signup security alert to admins...');
    await Promise.all(emailPromises);
    debugLog('Blocked-signup alert complete');

    return Response.json({
      success: true,
      blocked: true,
      message: `Uninvited sign-up blocked; alerted ${admins.length} admin(s)`
    });

  } catch (error) {
    console.error('Error in onUserSignup:', error);
    console.error('Error stack:', error.stack);
    
    // Return success even if notification fails - don't block signup
    return Response.json({ 
      success: true,
      warning: 'User created but notification failed',
      error: 'Internal server error' 
    });
  }
});

async function verifyInvitedUser(base44, email) {
  try {
    const config = base44.getConfig();
    let users = await base44.asServiceRole.entities.User.filter({ email }, undefined, 5000);
    let authUser = users?.[0];

    if (authUser?.is_verified) {
      return { success: true, already_verified: true };
    }

    const otpExpired = !authUser?.otp_code || !authUser?.otp_expires_at || new Date(authUser.otp_expires_at) <= new Date();

    if (otpExpired) {
      const resendResponse = await fetch(`${config.serverUrl}/api/apps/${config.appId}/auth/resend-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      if (!resendResponse.ok) {
        return { success: false, step: 'resend_failed' };
      }

      users = await base44.asServiceRole.entities.User.filter({ email }, undefined, 5000);
      authUser = users?.[0];
    }

    if (!authUser?.otp_code) {
      return { success: false, step: 'missing_otp_code' };
    }

    const verifyResponse = await fetch(`${config.serverUrl}/api/apps/${config.appId}/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp_code: authUser.otp_code })
    });

    const result = await verifyResponse.json();
    return { success: verifyResponse.ok, result };
  } catch (error) {
    console.error('verifyInvitedUser error:', error);
    return { success: false, step: 'exception', error: String(error?.message || error) };
  }
}