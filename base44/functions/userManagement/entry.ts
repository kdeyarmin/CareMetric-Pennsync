import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


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

/**
 * Unified User Management Function
 * Handles: user creation, invitation, password reset, invitation management
 * Replaces: createUserWithTempPassword, resetUserPassword, resendInvitation, checkExpiredInvitations
 */

// Cryptographically strong temporary password drawn from a CSPRNG (not
// Math.random). Guarantees at least one character from each class (upper,
// lower, digit, symbol) so it satisfies minimum-complexity policies, then
// shuffles so the guaranteed characters aren't in fixed positions.
function generateTempPassword(length = 16) {
  const classes = [
    'ABCDEFGHJKMNPQRSTUVWXYZ', // upper (no I/O)
    'abcdefghjkmnpqrstuvwxyz', // lower (no l)
    '23456789',                // digits (no 0/1)
    '!@#$%',                   // symbols
  ];
  const all = classes.join('');
  const pick = (set) => set[randomInt(set.length)];

  // One from each class, then fill the remainder from the full set.
  const chars = classes.map(pick);
  while (chars.length < Math.max(length, classes.length)) chars.push(pick(all));

  // Fisher–Yates shuffle with CSPRNG-derived indices.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

// Uniform random integer in [0, max) from a CSPRNG, rejection-sampled to avoid
// modulo bias.
function randomInt(max) {
  const limit = Math.floor(0xffffffff / max) * max;
  const buf = new Uint32Array(1);
  let x;
  do {
    crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return x % max;
}

function getAppBaseUrl() {
  const fromEnv = String(Deno.env.get('APP_PUBLIC_URL') || Deno.env.get('APP_URL') || '').trim().replace(/\/+$/, '');
  if (fromEnv) {
    try { return new URL(fromEnv).origin; } catch { /* fall through */ }
  }
  return 'https://caremetricai.base44.app';
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { action, ...params } = await req.json();

    // Verify admin for most actions
    const currentUser = await base44.auth.me();
    if (isDeactivatedUser(currentUser)) return DEACTIVATED_USER_RESPONSE();
    const isAdmin = currentUser?.role === 'admin'
      || currentUser?.account_type === 'agency_admin'
      || currentUser?.account_type === 'super_admin';
    // Granting the privileged 'admin' (facility admin) role requires super admin,
    // matching the hardened sibling functions (createUserWithTempPassword,
    // fixUserAccount): a plain facility admin must not be able to mint another
    // facility admin without super-admin oversight.
    const callerIsSuperAdmin = currentUser?.account_type === 'super_admin';

    switch (action) {
      case 'invite_user':
        return await inviteUser(base44, currentUser, params, isAdmin, callerIsSuperAdmin);

      case 'resend_invitation':
        return await resendInvitation(base44, currentUser, params, isAdmin);

      case 'reset_password':
        return await resetPassword(base44, currentUser, params, isAdmin, callerIsSuperAdmin);

      case 'check_expired_invitations':
        // Gate like every other action: this reads all invitations and emails
        // all admins, so it must not be callable by a non-admin.
        if (!isAdmin) {
          return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
        }
        return await checkExpiredInvitations(base44);

      case 'cancel_invitation':
        return await cancelInvitation(base44, currentUser, params, isAdmin);

      case 'update_user':
        return await updateUser(base44, currentUser, params, isAdmin, callerIsSuperAdmin);

      default:
        return Response.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('User management error:', error);
    // Return a generic message and keep the detail server-side only (matches
    // validateSignerToken / resetUserPassword) — the top-level catch wraps the
    // whole handler including pre-authorization failures, so leaking error.message
    // here would aid reconnaissance.
    return Response.json({
      error: 'Internal server error'
    }, { status: 500 });
  }
});

async function inviteUser(base44, currentUser, params, isAdmin, callerIsSuperAdmin) {
  if (!isAdmin) {
    return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
  }
  if (currentUser.account_type === 'agency_admin' && !currentUser.agency_name) {
    return Response.json({ error: 'Forbidden: agency_name is required to invite staff.' }, { status: 403 });
  }

  const { email, full_name, role, care_scope, phone, credentials } = params;

  if (!email || !full_name) {
    return Response.json({ error: 'Email and full name are required' }, { status: 400 });
  }

  // Same role model as updateUser: only 'admin' (facility admin) or 'user' (nurse)
  // may be invited; super admin is an account_type, not granted via invitation.
  if (role !== undefined && !(typeof role === 'string' && ['admin', 'user'].includes(role))) {
    return Response.json({ error: "role must be 'admin' (facility admin) or 'user' (nurse)" }, { status: 400 });
  }

  // Only a super admin may grant the privileged facility-admin role (consistent
  // with createUserWithTempPassword); a plain admin may invite nurses only.
  if (role === 'admin' && !callerIsSuperAdmin) {
    return Response.json({ error: 'Only a super admin can invite a user with the admin role.' }, { status: 403 });
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const invitation = await base44.asServiceRole.entities.UserInvitation.create({
    email,
    full_name,
    role: role || 'user',
    care_scope: care_scope || 'home_health',
    phone: phone || null,
    credentials: credentials || null,
    invited_by: currentUser.email,
    agency_name: currentUser.agency_name || null,
    status: 'pending',
    expires_at: expiresAt.toISOString(),
    last_sent_at: now.toISOString(),
    resend_count: 0
  });

  // Send invitation email
  try {
    const signupUrl = getAppBaseUrl();
    await base44.asServiceRole.integrations.Core.SendEmail({
      to: email,
      subject: 'You’re invited to join PennSync by CareMetric',
      from_name: 'PennSync by CareMetric',
      body: renderBrandedEmail({
        preheader: 'You’ve been invited to join PennSync by CareMetric. Create your account to get started.',
        eyebrow: 'You’re invited',
        title: `Welcome, ${full_name}!`,
        intro: 'You’ve been invited to join PennSync by CareMetric — an AI-powered home health documentation and analytics platform. Create your account to get started.',
        sections: [
          { rows: [['Email', email], ['Role', role || 'user']] },
          { button: { href: signupUrl, label: 'Create your account' } },
          { callout: { tone: 'warn', text: `This invitation expires in 7 days (on ${expiresAt.toLocaleDateString()}).` } },
        ],
      }),
    });
  } catch (emailError) {
    console.error('Email send failed (non-critical):', emailError.message);
  }

  // Log activity
  await base44.asServiceRole.entities.UserActivity.create({
    user_email: currentUser.email,
    user_name: currentUser.full_name,
    action: 'user_invited',
    details: { invited_email: email, invited_name: full_name, role },
    page: 'UserManagement',
    entity_type: 'UserInvitation',
    entity_id: invitation.id
  });

  return Response.json({ 
    success: true, 
    message: 'Invitation sent successfully',
    invitation_id: invitation.id,
    expires_at: expiresAt.toISOString()
  });
}

async function resendInvitation(base44, currentUser, params, isAdmin) {
  if (!isAdmin) {
    return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
  }

  const { invitation_id } = params;
  if (!invitation_id) {
    return Response.json({ error: 'invitation_id is required' }, { status: 400 });
  }

  const invitations = await base44.asServiceRole.entities.UserInvitation.filter({ id: invitation_id }, undefined, 5000);
  if (!invitations || invitations.length === 0) {
    return Response.json({ error: 'Invitation not found' }, { status: 404 });
  }

  const invitation = invitations[0];
  // Never resurrect an already-accepted invitation back to 'pending' — that would
  // re-open the auto-approval path for a user who has already been onboarded.
  if (invitation.status === 'accepted') {
    return Response.json({ error: 'This invitation has already been accepted and cannot be resent.' }, { status: 400 });
  }
  // 'cancelled' is a deliberate revocation (e.g. offboardUser) — do not re-arm it.
  if (invitation.status === 'cancelled') {
    return Response.json({
      error: 'This invitation was cancelled and cannot be resent. Create a new invitation instead.',
    }, { status: 409 });
  }

  // Agency admins may only resend invites for their own agency.
  if (currentUser.account_type === 'agency_admin' && !String(currentUser.agency_name || '').trim()) {
    return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
  }
  if (currentUser.account_type !== 'super_admin' && (currentUser.account_type === 'agency_admin' || (currentUser.role === 'admin' && currentUser.agency_name))) {
    if (!currentUser.agency_name) {
      return Response.json({ error: 'Forbidden: invitation is outside your agency.' }, { status: 403 });
    }
    let inviteAgency = invitation.agency_name || null;
    if (!inviteAgency && invitation.invited_by) {
      const inviters = await base44.asServiceRole.entities.User
        .filter({ email: invitation.invited_by }, undefined, 5)
        .catch(() => []);
      inviteAgency = inviters?.[0]?.agency_name || null;
    }
    if (inviteAgency !== currentUser.agency_name) {
      return Response.json({ error: 'Forbidden: invitation is outside your agency.' }, { status: 403 });
    }
  }

  const now = new Date();
  const newExpiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const prior = {
    status: invitation.status,
    expires_at: invitation.expires_at,
    last_sent_at: invitation.last_sent_at || null,
    resend_count: invitation.resend_count || 0,
  };

  // Send email FIRST, then stamp — otherwise a SendEmail failure still extends
  // expiry and looks like a successful resend.
  const signupUrl = getAppBaseUrl();
  try {
    await base44.asServiceRole.integrations.Core.SendEmail({
      to: invitation.email,
      subject: 'Reminder: your invitation to PennSync by CareMetric',
      from_name: 'PennSync by CareMetric',
      body: renderBrandedEmail({
        preheader: 'A reminder that you’ve been invited to join PennSync by CareMetric.',
        eyebrow: 'Invitation reminder',
        title: `Hello ${invitation.full_name},`,
        intro: 'This is a friendly reminder that you’ve been invited to join PennSync by CareMetric. Your invitation is still waiting — create your account to get started.',
        sections: [
          { rows: [['Email', invitation.email], ['Role', invitation.role || 'user']] },
          { button: { href: signupUrl, label: 'Create your account' } },
          { callout: { tone: 'warn', text: `This invitation expires in 7 days (on ${newExpiresAt.toLocaleDateString()}).` } },
        ],
      }),
    });
  } catch (emailError) {
    console.error('Failed to resend invitation email:', emailError?.message || emailError);
    return Response.json({ error: 'Failed to send invitation email. Please try again.' }, { status: 502 });
  }

  try {
    await base44.asServiceRole.entities.UserInvitation.update(invitation_id, {
      status: 'pending',
      expires_at: newExpiresAt.toISOString(),
      last_sent_at: now.toISOString(),
      resend_count: prior.resend_count + 1
    });
  } catch (stampError) {
    console.error('Invitation stamp failed after email sent:', stampError?.message || stampError);
    // Email already went out — leave prior row; report soft success with warning.
  }

  // Log activity
  await base44.asServiceRole.entities.UserActivity.create({
    user_email: currentUser.email,
    user_name: currentUser.full_name,
    action: 'invitation_resent',
    details: {
      invited_email: invitation.email,
      resend_count: prior.resend_count + 1,
      new_expires_at: newExpiresAt.toISOString()
    },
    page: 'UserManagement',
    entity_type: 'UserInvitation',
    entity_id: invitation_id
  });

  return Response.json({ 
    success: true, 
    message: 'Invitation resent successfully',
    new_expires_at: newExpiresAt.toISOString()
  });
}

async function resetPassword(base44, currentUser, params, isAdmin, callerIsSuperAdmin) {
  if (!isAdmin) {
    return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
  }

  const { userEmail } = params;
  if (!userEmail) {
    return Response.json({ error: 'User email is required' }, { status: 400 });
  }

  const users = await base44.asServiceRole.entities.User.filter({ email: userEmail }, undefined, 5000);
  if (!users || users.length === 0) {
    return Response.json({ error: 'User not found' }, { status: 404 });
  }

  const targetUser = users[0];

  // Privilege boundary: a facility admin must not be able to reset a privileged
  // account's password (that would hand them a temp password and let them log in
  // AS a super admin / peer admin — a side-door escalation the role-field guards
  // in updateUser/fixUserAccount exist to prevent). Only a super admin may reset
  // another admin's or a super admin's password.
  const targetIsPrivileged = targetUser.account_type === 'super_admin'
    || targetUser.account_type === 'agency_admin'
    || targetUser.role === 'admin';
  if (targetIsPrivileged && !callerIsSuperAdmin) {
    return Response.json({ error: 'Only a super admin can reset another administrator\'s password.' }, { status: 403 });
  }

  // Agency admins may only reset staff in their own agency.
  if (currentUser.account_type === 'agency_admin' && !currentUser.agency_name) {
    return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
  }
  if (currentUser.account_type !== 'super_admin' && currentUser.agency_name && (currentUser.account_type === 'agency_admin' || currentUser.role === 'admin')) {
    if (targetUser.agency_name !== currentUser.agency_name) {
      return Response.json({ error: 'Forbidden: target user is outside your agency.' }, { status: 403 });
    }
  }

  // Generate a temporary password from a CSPRNG with a guaranteed length and
  // character mix. `Math.random().toString(36).slice(-8)` is non-cryptographic
  // and can yield far fewer than 8 chars (e.g. when the fraction is short),
  // producing a weak, short credential.
  const tempPassword = generateTempPassword();

  // Update password
  await base44.asServiceRole.auth.updateUserPassword(userEmail, tempPassword);

  // Send email
  await base44.asServiceRole.integrations.Core.SendEmail({
    to: userEmail,
    from_name: 'PennSync by CareMetric',
    subject: 'Your PennSync by CareMetric password has been reset',
    body: renderBrandedEmail({
      preheader: 'An administrator has reset your password. Here is your temporary password.',
      eyebrow: 'Password reset',
      title: `Hello ${targetUser.full_name || 'there'},`,
      intro: 'Your password has been reset by an administrator. Use the temporary password below to sign in.',
      sections: [
        { rows: [['Temporary password', tempPassword]] },
        { callout: { tone: 'warn', text: 'For your security, please sign in and change your password immediately.' } },
        { note: 'If you did not request this password reset, please contact your administrator immediately.' },
      ],
    }),
  });

  // Log activity
  await base44.asServiceRole.entities.UserActivity.create({
    user_email: currentUser.email,
    user_name: currentUser.full_name,
    action: 'password_reset',
    details: { target_user: userEmail, reset_by: currentUser.email },
    page: 'UserManagement',
    entity_type: 'User',
    entity_id: targetUser.id
  });

  return Response.json({
    success: true,
    message: 'Password reset successfully. Temporary password sent via email.'
  });
}

async function checkExpiredInvitations(base44) {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Explicit high limit: an unlimited filter() stops at the server's default
  // page (~50), which would silently hide the overflow from the admin list.
  const pendingInvitations = await base44.asServiceRole.entities.UserInvitation.filter({
    status: 'pending'
  }, undefined, 5000);

  const expired = [];
  const expiringSoon = [];

  for (const invitation of pendingInvitations) {
    const expiresAt = new Date(invitation.expires_at);
    
    if (now > expiresAt) {
      expired.push(invitation);
      await base44.asServiceRole.entities.UserInvitation.update(invitation.id, {
        status: 'expired'
      });
    } else if (tomorrow > expiresAt) {
      // One-shot admin digest per invitation (mirrors checkExpiredInvitations).
      if (!invitation.expiring_soon_notified_at) {
        expiringSoon.push(invitation);
      }
    }
  }

  // Notify admins if needed — scoped per admin agency (super_admins see all).
  if (expired.length > 0 || expiringSoon.length > 0) {
    const allUsers = await base44.asServiceRole.entities.User.list('-created_date', 5000).catch(() => []);
    const admins = (Array.isArray(allUsers) ? allUsers : []).filter((u) =>
      u && u.email && (
        u.role === 'admin' ||
        u.account_type === 'agency_admin' ||
        u.account_type === 'super_admin'
      )
    );
    let emailsSent = 0;

    for (const admin of admins) {
      const scopedExpired = admin.account_type === 'super_admin'
        ? expired
        : expired.filter((inv) => !inv.agency_name || inv.agency_name === admin.agency_name);
      const scopedExpiring = admin.account_type === 'super_admin'
        ? expiringSoon
        : expiringSoon.filter((inv) => !inv.agency_name || inv.agency_name === admin.agency_name);
      if (scopedExpired.length === 0 && scopedExpiring.length === 0) continue;
      const sections = [];
      if (scopedExpired.length > 0) {
        sections.push({
          heading: `Expired invitations (${scopedExpired.length})`,
          bullets: scopedExpired.map(inv => `${inv.full_name} (${inv.email}) — expired ${new Date(inv.expires_at).toLocaleString()}`),
        });
      }
      if (scopedExpiring.length > 0) {
        sections.push({
          heading: `Expiring soon — within 24 hours (${scopedExpiring.length})`,
          bullets: scopedExpiring.map(inv => `${inv.full_name} (${inv.email}) — expires ${new Date(inv.expires_at).toLocaleString()}`),
        });
      }
      sections.push({ note: 'You can resend any of these invitations from the User Management page in PennSync.' });

      try {
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: admin.email,
          from_name: 'PennSync by CareMetric',
          subject: `Invitation status: ${scopedExpired.length} expired, ${scopedExpiring.length} expiring soon`,
          body: renderBrandedEmail({
            preheader: `${scopedExpired.length} expired and ${scopedExpiring.length} expiring-soon invitation(s) need your attention.`,
            eyebrow: 'Invitation status',
            title: `Hello ${admin.full_name},`,
            intro: 'Here is the current status of pending user invitations that need your attention.',
            sections,
          }),
        });
        emailsSent += 1;
      } catch (emailError) {
        console.error('Failed to send email to admin:', emailError?.message || emailError);
      }
    }
    if (emailsSent > 0 && expiringSoon.length > 0) {
      const stampedAt = new Date().toISOString();
      await Promise.allSettled(
        expiringSoon.map((inv) =>
          base44.asServiceRole.entities.UserInvitation.update(inv.id, {
            expiring_soon_notified_at: stampedAt,
          })
        )
      );
    }
  }

  return Response.json({ 
    success: true,
    expired: expired.length,
    expiring_soon: expiringSoon.length
  });
}

async function updateUser(base44, currentUser, params, isAdmin, callerIsSuperAdmin) {
  if (!isAdmin) {
    return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
  }

  const { user_id, full_name, phone, credential_type, role } = params;
  if (!user_id) {
    return Response.json({ error: 'user_id is required' }, { status: 400 });
  }

  // The app's role model has three tiers: super admin, facility admin, nurse.
  // Super admin is an account_type (managed via SuperAdminConfig/ensureSuperAdmin),
  // NOT settable through this role field — which is exactly the privilege boundary
  // we want. So the only assignable `role` values are the two the user-management
  // UI offers: 'admin' (facility admin) and 'user' (nurse). Reject anything else
  // rather than writing an arbitrary/garbage or privilege-implying role string.
  const ASSIGNABLE_ROLES = new Set(['admin', 'user']);
  if (role !== undefined && !(typeof role === 'string' && ASSIGNABLE_ROLES.has(role))) {
    return Response.json({ error: "role must be 'admin' (facility admin) or 'user' (nurse)" }, { status: 400 });
  }

  // Only a super admin may promote a user to the privileged facility-admin role
  // (consistent with createUserWithTempPassword / fixUserAccount).
  if (role === 'admin' && !callerIsSuperAdmin) {
    return Response.json({ error: 'Only a super admin can grant the admin role.' }, { status: 403 });
  }

  // Privilege boundary: a facility admin must not be able to mutate a privileged
  // account (demote a peer admin to 'user', or rewrite the super admin's record)
  // — only a super admin may edit another admin's or a super admin's account.
  const targetUsers = await base44.asServiceRole.entities.User.filter({ id: user_id }, undefined, 5000);
  const targetUser = targetUsers?.[0];
  if (!targetUser) {
    return Response.json({ error: 'User not found' }, { status: 404 });
  }
  const targetIsPrivileged = targetUser.account_type === 'super_admin'
    || targetUser.account_type === 'agency_admin'
    || targetUser.role === 'admin';
  if (targetIsPrivileged && !callerIsSuperAdmin && targetUser.email !== currentUser.email) {
    return Response.json({ error: 'Only a super admin can modify another administrator\'s account.' }, { status: 403 });
  }

  // Agency-scoped admins may only update staff in their own agency.
  if (currentUser.account_type === 'agency_admin' && !currentUser.agency_name) {
    return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
  }
  const isAgencyScoped = currentUser.account_type !== 'super_admin'
    && currentUser.agency_name
    && (currentUser.account_type === 'agency_admin' || currentUser.role === 'admin');
  if (isAgencyScoped && targetUser.agency_name !== currentUser.agency_name) {
    return Response.json({ error: 'Forbidden: target user is outside your agency.' }, { status: 403 });
  }

  // Only include fields that were actually provided so we never wipe values.
  const updates = {};
  if (typeof full_name === 'string' && full_name.trim()) updates.full_name = full_name.trim();
  if (typeof phone === 'string') updates.phone = phone;
  // User.credential_type is an enum ["RN","LPN"]. An empty string passed the old
  // `typeof === 'string'` guard and was forwarded verbatim, so Base44 rejected or
  // dropped it and the caller was told the update succeeded. Reject an
  // out-of-enum value outright; treat "" as "field not supplied".
  if (typeof credential_type === 'string' && credential_type.trim()) {
    const credential = credential_type.trim();
    if (!['RN', 'LPN'].includes(credential)) {
      return Response.json({ error: 'credential_type must be RN or LPN.' }, { status: 400 });
    }
    updates.credential_type = credential;
  }
  if (typeof role === 'string' && role) updates.role = role;

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: 'No fields to update' }, { status: 400 });
  }

  await base44.asServiceRole.entities.User.update(user_id, updates);

  await base44.asServiceRole.entities.UserActivity.create({
    user_email: currentUser.email,
    user_name: currentUser.full_name,
    action: 'user_updated',
    details: { target_user_id: user_id, updated_fields: Object.keys(updates) },
    page: 'UserManagement',
    entity_type: 'User',
    entity_id: user_id
  });

  return Response.json({ success: true, message: 'User updated successfully' });
}

async function cancelInvitation(base44, currentUser, params, isAdmin) {
  if (!isAdmin) {
    return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
  }

  const { invitation_id } = params;
  if (!invitation_id) {
    return Response.json({ error: 'invitation_id is required' }, { status: 400 });
  }

  const invitations = await base44.asServiceRole.entities.UserInvitation.filter({ id: invitation_id }, undefined, 5000);
  if (!invitations || invitations.length === 0) {
    return Response.json({ error: 'Invitation not found' }, { status: 404 });
  }
  const invitation = invitations[0];
  if (invitation.status === 'accepted') {
    return Response.json({ error: 'Accepted invitations cannot be cancelled.' }, { status: 400 });
  }
  if (invitation.status === 'cancelled') {
    return Response.json({ success: true, message: 'Invitation already cancelled' });
  }

  // Agency admins may only cancel invites for their own agency.
  if (currentUser.account_type === 'agency_admin' && !String(currentUser.agency_name || '').trim()) {
    return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
  }
  if (currentUser.account_type !== 'super_admin' && (currentUser.account_type === 'agency_admin' || (currentUser.role === 'admin' && currentUser.agency_name))) {
    if (!currentUser.agency_name) {
      return Response.json({ error: 'Forbidden: invitation is outside your agency.' }, { status: 403 });
    }
    let inviteAgency = invitation.agency_name || null;
    if (!inviteAgency && invitation.invited_by) {
      const inviters = await base44.asServiceRole.entities.User
        .filter({ email: invitation.invited_by }, undefined, 5)
        .catch(() => []);
      inviteAgency = inviters?.[0]?.agency_name || null;
    }
    if (inviteAgency !== currentUser.agency_name) {
      return Response.json({ error: 'Forbidden: invitation is outside your agency.' }, { status: 403 });
    }
  }

  // Soft-cancel (preserve audit history). Hard-delete destroyed the trail and
  // diverged from offboardUser, which correctly sets status: 'cancelled'.
  await base44.asServiceRole.entities.UserInvitation.update(invitation_id, {
    status: 'cancelled',
  });

  await base44.asServiceRole.entities.UserActivity.create({
    user_email: currentUser.email,
    user_name: currentUser.full_name,
    action: 'invitation_cancelled',
    details: { invited_email: invitation.email, invitation_id },
    page: 'UserManagement',
    entity_type: 'UserInvitation',
    entity_id: invitation_id,
  }).catch(() => {});

  return Response.json({ 
    success: true, 
    message: 'Invitation cancelled successfully' 
  });
}