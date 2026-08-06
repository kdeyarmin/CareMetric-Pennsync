import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ─────────────────────────────────────────────────────────────────────────────
// Branded onboarding email
//
// A professional, PennSync-branded (navy + gold) HTML welcome email sent when an
// admin sets up a new user. It explains how to sign in, how to install the app
// (App Store / Google Play when configured, plus "Add to Home Screen" for the
// PWA), and links to the reference manual that matches the invitee's role
// (Facility Administrator Manual for admins, User Manual for clinical users).
//
// The builder below is a PURE function (no Deno/Base44 APIs) so it can be unit
// tested via `node --test` (see welcomeEmail.test.js). All environment/config is
// passed in by the request handler.
// ─────────────────────────────────────────────────────────────────────────────

// Hosted PennSync app icon (served from Base44 storage — always reachable by
// email clients, unlike a relative/app-local asset).
const BRAND_LOGO_URL =
  'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/68ee80d98929370f9e8f2932/02eed9872_pennsynclogoupdated.png';

// Published CareMetric / PennSync app-store listings (hardcoded — no env
// override). Both verified to resolve (HTTP 200) — note the Android package is
// intentionally "caremetic" (the real listing), not "caremetric".
export const DEFAULT_IOS_APP_URL = 'https://apps.apple.com/us/app/caremetric-ai/id6757097720';
export const DEFAULT_ANDROID_APP_URL = 'https://play.google.com/store/apps/details?id=com.caremetic.ai';

// Support address shown in the email.
export const DEFAULT_SUPPORT_EMAIL = 'info@caremetric.ai';

const BRAND = {
  navy: '#213a76',
  navyDeep: '#1c2f5e',
  gold: '#c7901f',
  goldSoft: '#f6eecb',
  ink: '#111a2b',
  slate: '#334155',
  muted: '#5b6a7f',
  line: '#e4e9f1',
  wash: '#eef3fc',
};

/** Escape user-supplied text before interpolating it into the HTML email. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The scheme+host origin of a URL, dropping any path. Manuals live in the app's
 * `public/` dir and are served at the origin root (`/manuals/...`) — the same
 * path the in-app download links resolve to — so email links must be built from
 * the origin, not from an APP_URL that may carry an `/apps/<id>` path prefix.
 */
export function originOf(url) {
  try {
    return new URL(String(url)).origin;
  } catch {
    return String(url || '').replace(/\/+$/, '');
  }
}

/** Resolve the reference manual that matches a user's role/access level. */
export function manualForRole(role) {
  const r = String(role || '').toLowerCase();
  const isAdmin = r === 'admin' || r === 'agency_admin' || r === 'super_admin';
  if (isAdmin) {
    return {
      title: 'Facility Administrator Manual',
      file: 'PennSync-Facility-Admin-Manual.pdf',
      audience: 'Facility Administrator',
      blurb:
        'Your complete guide — the full clinical User Manual (Part I) plus facility-administration tools: users & staff, office workflows, training administration, compliance, reports & analytics, data management, and system configuration.',
    };
  }
  return {
    title: 'User Manual',
    file: 'PennSync-User-Manual.pdf',
    audience: 'Clinical User',
    blurb:
      'Your complete guide to everyday clinical work in PennSync: the dashboard, patients & Patient 360, OASIS, documentation with Smart Note & Visit Scribe, communication, learning, and personal tools.',
  };
}

/** A padded anchor "button" (inline styles for email-client compatibility). */
function emailButton(href, label, { bg = BRAND.navy, fg = '#ffffff', border = bg } = {}) {
  return (
    `<a href="${href}" target="_blank" rel="noopener" ` +
    `style="display:inline-block;padding:13px 26px;border-radius:8px;` +
    `background:${bg};color:${fg};border:1px solid ${border};` +
    `font-weight:700;font-size:15px;line-height:1;text-decoration:none;">${label}</a>`
  );
}

/** A dark app-store style badge with a small caption above a store name. */
function storeBadge(href, caption, store) {
  return (
    `<a href="${href}" target="_blank" rel="noopener" ` +
    `style="display:inline-block;padding:9px 18px;border-radius:8px;background:${BRAND.ink};` +
    `color:#ffffff;text-decoration:none;min-width:150px;">` +
    `<span style="display:block;font-size:10px;letter-spacing:.4px;color:#c7d0e0;text-transform:uppercase;">${caption}</span>` +
    `<span style="display:block;font-size:17px;font-weight:700;line-height:1.15;">${store}</span></a>`
  );
}

/**
 * Build the branded welcome email.
 * @returns {{ subject: string, body: string }}
 */
export function buildWelcomeEmail(opts = {}) {
  const {
    fullName,
    email,
    role,
    appUrl,
    manualsBaseUrl,
    iosAppUrl,
    androidAppUrl,
    supportEmail,
  } = opts;

  const safeName = escapeHtml(String(fullName || '').trim() || 'there');
  const safeEmail = escapeHtml(email || '');
  const login = escapeHtml(appUrl || '');
  const manual = manualForRole(role);
  // Build the manual link from the app ORIGIN (so it resolves to the same
  // `<origin>/manuals/...` the in-app links use), unless an explicit
  // manualsBaseUrl override is given (e.g. a separate CDN) — used verbatim.
  const manualBase = (manualsBaseUrl || originOf(appUrl) || '').replace(/\/+$/, '');
  const manualUrl = escapeHtml(`${manualBase}/manuals/${manual.file}`);
  const supportRaw = String(supportEmail || 'your administrator');
  const support = supportRaw.includes('@')
    ? `<a href="mailto:${escapeHtml(supportRaw)}" style="color:${BRAND.navy};font-weight:600;text-decoration:none;">${escapeHtml(supportRaw)}</a>`
    : escapeHtml(supportRaw);

  // App-store badges only render when a real store URL is configured, so the
  // email never shows a dead link. The "Add to Home Screen" PWA instructions are
  // always shown because they work today for every deployment.
  const badges = [];
  if (iosAppUrl) badges.push(storeBadge(escapeHtml(iosAppUrl), 'Download on the', 'App Store'));
  if (androidAppUrl) badges.push(storeBadge(escapeHtml(androidAppUrl), 'Get it on', 'Google Play'));
  const badgeRow = badges.length
    ? `<div style="margin:6px 0 16px;">${badges
        .map((b) => `<span style="display:inline-block;margin:6px 10px 6px 0;">${b}</span>`)
        .join('')}</div>`
    : '';

  const subject = 'Welcome to PennSync — your account is ready';

  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light only" />
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.wash};">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;color:${BRAND.wash};">Your PennSync account is ready — sign in, install the app, and download your ${escapeHtml(manual.title)}.</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.wash};">
<tr><td align="center" style="padding:28px 14px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border:1px solid ${BRAND.line};border-radius:16px;overflow:hidden;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

  <!-- Header -->
  <tr><td style="background:${BRAND.navy};background:linear-gradient(180deg,#25407e 0%,${BRAND.navyDeep} 100%);padding:30px 28px 26px;text-align:center;">
    <img src="${BRAND_LOGO_URL}" width="60" height="60" alt="PennSync" style="display:inline-block;width:60px;height:60px;border-radius:14px;border:0;" />
    <div style="margin-top:12px;font-size:25px;font-weight:800;letter-spacing:-.3px;color:#ffffff;">Penn<span style="color:${BRAND.gold};">Sync</span></div>
    <div style="margin-top:5px;font-size:11px;font-weight:600;letter-spacing:4px;text-transform:uppercase;color:#b6c9ee;">by CareMetric</div>
    <div style="width:64px;height:4px;border-radius:3px;background:${BRAND.gold};margin:16px auto 0;"></div>
  </td></tr>

  <!-- Greeting -->
  <tr><td style="padding:30px 32px 6px;">
    <h1 style="margin:0;font-size:22px;font-weight:800;color:${BRAND.navy};">Welcome to PennSync, ${safeName}!</h1>
    <p style="margin:8px 0 0;font-size:12px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:${BRAND.gold};">${escapeHtml(manual.audience)} account</p>
    <p style="margin:16px 0 0;font-size:15px;line-height:1.62;color:${BRAND.slate};">
      Your PennSync account has been set up by your administrator. This guide walks you through signing in, installing the app, and downloading the reference manual for your role. Everything you need to get started is below.
    </p>
  </td></tr>

  <!-- Step 1: Sign in -->
  <tr><td style="padding:24px 32px 0;">
    <h2 style="margin:0 0 8px;font-size:16px;font-weight:800;color:${BRAND.ink};">1 &middot; Sign in to PennSync</h2>
    <p style="margin:0 0 14px;font-size:14.5px;line-height:1.6;color:${BRAND.slate};">
      You'll receive a separate secure invitation email to confirm your address and set your password. Once that's done, sign in any time with your email:
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;background:#f5f8fd;border:1px solid ${BRAND.line};border-radius:10px;">
      <tr><td style="padding:12px 16px;font-size:14px;color:${BRAND.ink};">
        <span style="color:${BRAND.muted};">Your login email:</span> <strong>${safeEmail}</strong>
      </td></tr>
    </table>
    ${login ? `<div style="margin:2px 0 4px;">${emailButton(login, 'Go to PennSync &rarr;')}</div>` : ''}
    <p style="margin:12px 0 0;font-size:12.5px;line-height:1.55;color:${BRAND.muted};">
      For your security, please change your password on first sign-in and never share your credentials.
    </p>
  </td></tr>

  <tr><td style="padding:22px 32px 0;"><div style="height:1px;background:${BRAND.line};"></div></td></tr>

  <!-- Step 2: Install the app -->
  <tr><td style="padding:22px 32px 0;">
    <h2 style="margin:0 0 8px;font-size:16px;font-weight:800;color:${BRAND.ink};">2 &middot; Install the PennSync app</h2>
    <p style="margin:0 0 6px;font-size:14.5px;line-height:1.6;color:${BRAND.slate};">
      PennSync works in any browser and installs as an app on your phone or tablet for one-tap access, offline documentation, and notifications.
    </p>
    ${badgeRow}
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 2px;background:#f5f8fd;border:1px solid ${BRAND.line};border-radius:10px;">
      <tr><td style="padding:14px 18px;font-size:13.5px;line-height:1.6;color:${BRAND.slate};">
        <strong style="color:${BRAND.navy};">Add to your Home Screen</strong><br/>
        <span style="color:${BRAND.muted};">iPhone / iPad (Safari):</span> tap <strong>Share</strong> &rarr; <strong>Add to Home Screen</strong>.<br/>
        <span style="color:${BRAND.muted};">Android (Chrome):</span> tap the <strong>&#8942; menu</strong> &rarr; <strong>Install app</strong> / <strong>Add to Home screen</strong>.
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:22px 32px 0;"><div style="height:1px;background:${BRAND.line};"></div></td></tr>

  <!-- Step 3: Role-matched manual -->
  <tr><td style="padding:22px 32px 0;">
    <h2 style="margin:0 0 8px;font-size:16px;font-weight:800;color:${BRAND.ink};">3 &middot; Your ${escapeHtml(manual.title)}</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.goldSoft};border:1px solid #ecdca6;border-radius:12px;">
      <tr><td style="padding:18px 20px;">
        <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${BRAND.gold};">Reference guide for your role</p>
        <p style="margin:0 0 12px;font-size:15px;font-weight:800;color:${BRAND.navy};">${escapeHtml(manual.title)}</p>
        <p style="margin:0 0 16px;font-size:13.5px;line-height:1.6;color:${BRAND.slate};">${escapeHtml(manual.blurb)}</p>
        ${emailButton(manualUrl, 'Download the manual (PDF)', { bg: BRAND.gold, fg: '#1a1204', border: '#a8741a' })}
      </td></tr>
    </table>
    <p style="margin:12px 0 0;font-size:12.5px;line-height:1.55;color:${BRAND.muted};">
      You can also open this manual any time in the app under <strong>Help &rarr; PennSync Manuals</strong>.
    </p>
  </td></tr>

  <!-- Support -->
  <tr><td style="padding:24px 32px 4px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f8fd;border:1px solid ${BRAND.line};border-radius:10px;">
      <tr><td style="padding:16px 18px;font-size:13.5px;line-height:1.6;color:${BRAND.slate};">
        <strong style="color:${BRAND.navy};">Need help?</strong> If you have any questions or didn't expect this account, please contact ${support}.
      </td></tr>
    </table>
  </td></tr>

  <!-- Footer -->
  <tr><td style="padding:22px 32px 30px;text-align:center;">
    <div style="height:1px;background:${BRAND.line};margin-bottom:16px;"></div>
    <div style="font-size:13px;font-weight:800;color:${BRAND.navy};">Penn<span style="color:${BRAND.gold};">Sync</span> <span style="font-weight:600;color:${BRAND.muted};">by CareMetric</span></div>
    <p style="margin:8px 0 0;font-size:11.5px;line-height:1.5;color:${BRAND.muted};">
      This is an automated message — please do not reply. Keep your login credentials confidential.
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, body };
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

    const user = await base44.auth.me();
    if (!user || (user.role !== 'admin' && user.account_type !== 'agency_admin' && user.account_type !== 'super_admin')) {
      return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
    }
    if (user.is_active === false) {
      return Response.json({ error: 'Unauthorized - account is deactivated' }, { status: 403 });
    }
    // Agency admins must have an agency_name so invites can be tenant-scoped.
    if (user.account_type === 'agency_admin' && !user.agency_name) {
      return Response.json({ error: 'Forbidden: agency_name is required to invite staff.' }, { status: 403 });
    }

    const payload = await req.json();
    const { email, full_name, role, care_scope, phone, credentials } = payload;

    if (!email || !full_name) {
      return Response.json({ error: 'Email and full name are required' }, { status: 400 });
    }

    const userRole = role || 'user';

    // Only 'admin' (facility admin) or 'user' (nurse) are assignable roles — super
    // admin is an account_type, not a role granted via invitation. Reject anything
    // else (e.g. 'super_admin') before it reaches the platform invite and the
    // UserInvitation.role enum (which is admin/user only), matching
    // userManagement.inviteUser.
    if (!['admin', 'user'].includes(String(userRole))) {
      return Response.json({ error: "role must be 'admin' (facility admin) or 'user' (nurse)" }, { status: 400 });
    }

    // Privilege-propagation guard: the gate above admits a plain facility `admin`,
    // but the requested role is applied verbatim to the new account (with
    // is_approved: true) by onUserSignup / autoApproveInvitedUser. Without this, any
    // admin could mint another admin. Only a super_admin may
    // invite a user into a privileged role — mirrors the guard in fixUserAccount.
    const callerIsSuperAdmin = user.account_type === 'super_admin';
    const PRIVILEGED_ROLES = ['admin', 'super_admin'];
    if (PRIVILEGED_ROLES.includes(String(userRole)) && !callerIsSuperAdmin) {
      return Response.json(
        { error: 'Only a super admin can invite a user with an admin role.' },
        { status: 403 }
      );
    }

    // Use the platform's built-in invite (handles email delivery natively)
    await base44.users.inviteUser(email, userRole);
    console.log('✓ Platform invite sent');

    // Store invitation record for onUserSignup auto-approval with extra metadata
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    await base44.asServiceRole.entities.UserInvitation.create({
      email,
      full_name,
      role: userRole,
      care_scope: care_scope || 'home_health',
      phone: phone || null,
      credentials: credentials || null,
      invited_by: user.email,
      agency_name: user.agency_name || null,
      status: 'pending',
      expires_at: expiresAt.toISOString(),
      last_sent_at: now.toISOString(),
      resend_count: 0
    });
    console.log('✓ Invitation record created');

    // Send the branded PennSync welcome email (best-effort). This complements the
    // platform's transactional invite with app-install instructions and the
    // role-matched reference manual. A failure here must NEVER fail the invite, so
    // it is fully wrapped. Manuals are served from the app's `/manuals/` path
    // (public/manuals/*, served at the app origin root); the builder derives the
    // manual link from the app origin.
    try {
      const appUrl = getAppBaseUrl();
      const { subject, body } = buildWelcomeEmail({
        fullName: full_name,
        email,
        role: userRole,
        appUrl,
        manualsBaseUrl: null,
        iosAppUrl: DEFAULT_IOS_APP_URL,
        androidAppUrl: DEFAULT_ANDROID_APP_URL,
        supportEmail: DEFAULT_SUPPORT_EMAIL,
      });
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: email,
        from_name: 'PennSync by CareMetric',
        subject,
        body,
      });
      console.log('✓ Branded welcome email sent');
    } catch (emailError) {
      console.error('Welcome email failed (invite still succeeded):', emailError?.message || emailError);
    }

    // Log activity
    try {
      await base44.asServiceRole.entities.UserActivity.create({
        user_email: user.email,
        user_name: user.full_name,
        action: 'user_invited',
        details: { invited_email: email, invited_name: full_name, role: userRole },
        page: 'UserManagement',
        entity_type: 'UserInvitation'
      });
    } catch (logError) {
      console.error('Failed to log activity:', logError.message);
    }

    return Response.json({
      success: true,
      message: 'Invitation sent successfully',
      user_email: email
    });

  } catch (error) {
    console.error('Error in createUserWithTempPassword:', error.message);
    return Response.json({
      error: 'Failed to send invitation',
      details: 'Internal server error'
    }, { status: 500 });
  }
});
