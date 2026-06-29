import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
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
    // admin could mint another admin. Only a super_admin (or the platform owner) may
    // invite a user into a privileged role — mirrors the guard in fixUserAccount.
    const SUPER_ADMIN_EMAIL = (Deno.env.get('SUPER_ADMIN_EMAIL') || '').trim().toLowerCase() || null;
    const callerIsSuperAdmin = user.account_type === 'super_admin'
      || String(user.email || '').trim().toLowerCase() === SUPER_ADMIN_EMAIL;
    const PRIVILEGED_ROLES = ['admin', 'super_admin'];
    if (PRIVILEGED_ROLES.includes(String(userRole)) && !callerIsSuperAdmin) {
      return Response.json(
        { error: 'Only a super admin can invite a user with an admin role.' },
        { status: 403 }
      );
    }

    // Use the platform's built-in invite (handles email delivery natively)
    await base44.users.inviteUser(email, userRole);
    console.log('✓ Platform invite sent to:', email);

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
      status: 'pending',
      expires_at: expiresAt.toISOString(),
      last_sent_at: now.toISOString(),
      resend_count: 0
    });
    console.log('✓ Invitation record created');

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
      details: error.message 
    }, { status: 500 });
  }
});