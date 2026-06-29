import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Operational logs are gated behind FUNCTIONS_DEBUG so they don't run in
// production by default. console.error/warn remain ungated for visibility.
const DEBUG = !!Deno.env.get('FUNCTIONS_DEBUG');
const debugLog = (...args) => { if (DEBUG) console.log(...args); };

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

    // Opt-in webhook-secret gate: if SIGNUP_WEBHOOK_SECRET is set, require it so
    // arbitrary HTTP callers can't forge signups / role escalation. Unset => no
    // enforcement (so the platform trigger keeps working).
    const signupSecret = Deno.env.get('SIGNUP_WEBHOOK_SECRET');
    if (signupSecret && req.headers.get('x-webhook-secret') !== signupSecret) {
      return Response.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // Check if user was invited. Match the invitation email case-insensitively:
    // the invitation casing may differ from the signup payload (e.g. an admin
    // invites Jane.Doe@Example.com but the auth event sends jane.doe@example.com).
    // A case-sensitive match would misclassify a genuinely invited user as an
    // uninvited signup — and with invite-only there is no manual-approval rescue.
    debugLog('Checking for invitation...');
    const normalizedEmail = (user.email || '').trim().toLowerCase();
    const pendingInvitations = await base44.asServiceRole.entities.UserInvitation.filter({
      status: 'pending'
    });
    const invitations = (pendingInvitations || []).filter(
      (inv) => (inv.email || '').trim().toLowerCase() === normalizedEmail
    );
    debugLog('Found invitations:', invitations.length);

    if (invitations && invitations.length > 0) {
      const invitation = invitations[0];

      // Don't trust the body's user.id<->email pairing: confirm the id resolves
      // to the invited email before granting role/approval.
      const actualUsers = await base44.asServiceRole.entities.User.filter({ id: user.id });
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
          await base44.asServiceRole.entities.UserInvitation.delete(invitation.id);
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
    console.warn('Blocked uninvited sign-up (invite-only app):', user.email);

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
      const blockedUsers = await base44.asServiceRole.entities.User.filter({ id: user.id });
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
    const admins = await base44.asServiceRole.entities.User.filter({ role: 'admin' });
    debugLog('Found admins:', admins.length);

    const emailBody = `
    Hello,

    A sign-up attempt was BLOCKED on Penn Sync because the account was not invited.

    Penn Sync is invite-only — there is no public sign-up. This account has NOT
    been granted access and cannot be approved manually.

    👤 Name: ${user.full_name || 'Not provided'}
    📧 Email: ${user.email}
    📅 Attempt Date: ${new Date().toLocaleString()}

    If this person should have access, send them an invitation:
    ➡️ Admin Dashboard > User Management

    No other action is required — they remain blocked until invited.

    Best regards,
    Penn Sync Security
    `.trim();

    // Send a security alert to all admins
    const emailPromises = admins.map(admin =>
      base44.asServiceRole.integrations.Core.SendEmail({
        to: admin.email,
        subject: `🚫 Blocked Uninvited Sign-up - Penn Sync`,
        from_name: 'Penn Sync Security',
        body: `Hello ${admin.full_name || 'Admin'},\n\n${emailBody}`
      })
    );

    // Optionally also alert an additional security contact, configurable per
    // deployment via SECURITY_ALERT_EMAIL (admins are always alerted above).
    const extraAlertEmail = Deno.env.get('SECURITY_ALERT_EMAIL');
    if (extraAlertEmail) {
      emailPromises.push(
        base44.asServiceRole.integrations.Core.SendEmail({
          to: extraAlertEmail,
          subject: `🚫 Blocked Uninvited Sign-up - Penn Sync`,
          from_name: 'Penn Sync Security',
          body: `Hello,\n\n${emailBody}`
        })
      );
    }

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
      error: error.message 
    });
  }
});

async function verifyInvitedUser(base44, email) {
  try {
    const config = base44.getConfig();
    let users = await base44.asServiceRole.entities.User.filter({ email });
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

      users = await base44.asServiceRole.entities.User.filter({ email });
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