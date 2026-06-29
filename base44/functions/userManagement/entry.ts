import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { action, ...params } = await req.json();

    // Verify admin for most actions
    const currentUser = await base44.auth.me();
    const isAdmin = currentUser?.role === 'admin';
    // Granting the privileged 'admin' (facility admin) role requires super admin,
    // matching the hardened sibling functions (createUserWithTempPassword,
    // fixUserAccount): a plain facility admin must not be able to mint another
    // facility admin without super-admin oversight.
    const SUPER_ADMIN_EMAIL = (Deno.env.get('SUPER_ADMIN_EMAIL') || '').trim().toLowerCase() || null;
    const callerIsSuperAdmin = currentUser?.account_type === 'super_admin'
      || String(currentUser?.email || '').trim().toLowerCase() === SUPER_ADMIN_EMAIL;

    switch (action) {
      case 'invite_user':
        return await inviteUser(base44, currentUser, params, isAdmin, callerIsSuperAdmin);

      case 'resend_invitation':
        return await resendInvitation(base44, currentUser, params, isAdmin);

      case 'reset_password':
        return await resetPassword(base44, currentUser, params, isAdmin);

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
    return Response.json({ 
      error: 'Internal server error', 
      details: error.message 
    }, { status: 500 });
  }
});

async function inviteUser(base44, currentUser, params, isAdmin, callerIsSuperAdmin) {
  if (!isAdmin) {
    return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
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
    status: 'pending',
    expires_at: expiresAt.toISOString(),
    last_sent_at: now.toISOString(),
    resend_count: 0
  });

  // Send invitation email
  try {
    const signupUrl = `${Deno.env.get('APP_URL') || 'https://app.base44.app'}`;
    await base44.asServiceRole.integrations.Core.SendEmail({
      to: email,
      subject: 'Invitation to Penn Sync',
      body: `Hello ${full_name},\n\nYou've been invited to join Penn Sync.\n\nEmail: ${email}\nRole: ${role || 'user'}\n\nPlease visit ${signupUrl} to create your account.\n\n⏰ This invitation expires in 7 days (${expiresAt.toLocaleDateString()}).\n\nWelcome to Penn Sync!`,
      from_name: 'Penn Sync'
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

  const invitations = await base44.asServiceRole.entities.UserInvitation.filter({ id: invitation_id });
  if (!invitations || invitations.length === 0) {
    return Response.json({ error: 'Invitation not found' }, { status: 404 });
  }

  const invitation = invitations[0];
  const now = new Date();
  const newExpiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  await base44.asServiceRole.entities.UserInvitation.update(invitation_id, {
    status: 'pending',
    expires_at: newExpiresAt.toISOString(),
    last_sent_at: now.toISOString(),
    resend_count: (invitation.resend_count || 0) + 1
  });

  // Resend email
  const signupUrl = `${Deno.env.get('APP_URL') || 'https://app.base44.app'}`;
  await base44.asServiceRole.integrations.Core.SendEmail({
    to: invitation.email,
    subject: 'Reminder: Invitation to Penn Sync',
    body: `Hello ${invitation.full_name},\n\nThis is a reminder that you've been invited to join Penn Sync.\n\nEmail: ${invitation.email}\nRole: ${invitation.role || 'user'}\n\nPlease visit ${signupUrl} to create your account.\n\n⏰ This invitation expires in 7 days (${newExpiresAt.toLocaleDateString()}).\n\nWelcome to Penn Sync!`,
    from_name: 'Penn Sync'
  });

  // Log activity
  await base44.asServiceRole.entities.UserActivity.create({
    user_email: currentUser.email,
    user_name: currentUser.full_name,
    action: 'invitation_resent',
    details: {
      invited_email: invitation.email,
      resend_count: (invitation.resend_count || 0) + 1,
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

async function resetPassword(base44, currentUser, params, isAdmin) {
  if (!isAdmin) {
    return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
  }

  const { userEmail } = params;
  if (!userEmail) {
    return Response.json({ error: 'User email is required' }, { status: 400 });
  }

  // Generate a temporary password from a CSPRNG with a guaranteed length and
  // character mix. `Math.random().toString(36).slice(-8)` is non-cryptographic
  // and can yield far fewer than 8 chars (e.g. when the fraction is short),
  // producing a weak, short credential.
  const tempPassword = generateTempPassword();

  const users = await base44.asServiceRole.entities.User.filter({ email: userEmail });
  if (!users || users.length === 0) {
    return Response.json({ error: 'User not found' }, { status: 404 });
  }

  const targetUser = users[0];

  // Update password
  await base44.asServiceRole.auth.updateUserPassword(userEmail, tempPassword);

  // Send email
  await base44.asServiceRole.integrations.Core.SendEmail({
    to: userEmail,
    subject: 'Your Password Has Been Reset',
    body: `Hello ${targetUser.full_name || 'User'},\n\nYour password has been reset by an administrator.\n\nYour temporary password is: ${tempPassword}\n\nPlease log in and change your password immediately for security purposes.\n\nIf you did not request this password reset, please contact your administrator immediately.\n\nBest regards,\nPenn Sync Team`
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

  const pendingInvitations = await base44.asServiceRole.entities.UserInvitation.filter({ 
    status: 'pending' 
  });

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
      expiringSoon.push(invitation);
    }
  }

  // Notify admins if needed
  if (expired.length > 0 || expiringSoon.length > 0) {
    const admins = await base44.asServiceRole.entities.User.filter({ role: 'admin' });

    for (const admin of admins) {
      let emailBody = `Hello ${admin.full_name},\n\nUser Invitation Status Update:\n\n`;

      if (expired.length > 0) {
        emailBody += `⚠️ EXPIRED INVITATIONS (${expired.length}):\n`;
        expired.forEach(inv => {
          emailBody += `  • ${inv.full_name} (${inv.email}) - Expired: ${new Date(inv.expires_at).toLocaleString()}\n`;
        });
        emailBody += '\n';
      }

      if (expiringSoon.length > 0) {
        emailBody += `⏰ EXPIRING SOON (within 24 hours) (${expiringSoon.length}):\n`;
        expiringSoon.forEach(inv => {
          emailBody += `  • ${inv.full_name} (${inv.email}) - Expires: ${new Date(inv.expires_at).toLocaleString()}\n`;
        });
        emailBody += '\n';
      }

      emailBody += 'Please consider resending these invitations from the User Management page.\n\nPenn Sync';

      try {
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: admin.email,
          subject: `📧 User Invitation Status - ${expired.length} Expired, ${expiringSoon.length} Expiring Soon`,
          body: emailBody,
          from_name: 'Penn Sync'
        });
      } catch (emailError) {
        console.error('Failed to send email to admin:', admin.email, emailError);
      }
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

  // Only include fields that were actually provided so we never wipe values.
  const updates = {};
  if (typeof full_name === 'string' && full_name.trim()) updates.full_name = full_name.trim();
  if (typeof phone === 'string') updates.phone = phone;
  if (typeof credential_type === 'string') updates.credential_type = credential_type;
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

  await base44.asServiceRole.entities.UserInvitation.delete(invitation_id);

  return Response.json({ 
    success: true, 
    message: 'Invitation cancelled successfully' 
  });
}