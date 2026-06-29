import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Scheduled every 10 minutes.
// Finds any users who are NOT approved but have a pending UserInvitation,
// then auto-approves them and sends a welcome email.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Authorization: this approves accounts and assigns roles under service role,
    // so it must never be triggerable by an unauthenticated or non-admin caller.
    // Opt-in lockdown (matches issueCertificate): when INTERNAL_FN_SECRET is set,
    // require an admin user OR the internal secret (the trusted scheduler sends
    // x-internal-secret) — this closes the no-identity (me === null) path. When
    // the secret is unset, the no-identity cron path stays allowed (platform
    // invocation restriction is the control, see docs/SECURITY-RLS-CHECKLIST.md
    // §4) but an authenticated non-admin is still rejected.
    const me = await base44.auth.me().catch(() => null);
    const isAdmin = me?.role === 'admin';
    const internalSecret = Deno.env.get('INTERNAL_FN_SECRET');
    if (internalSecret) {
      if (!isAdmin && req.headers.get('x-internal-secret') !== internalSecret) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
    } else if (me && !isAdmin) {
      return Response.json({ error: 'Forbidden: admin access required' }, { status: 403 });
    }

    // Get all pending invitations with a reasonable limit
    const invitations = await base44.asServiceRole.entities.UserInvitation.filter(
      { status: 'pending' },
      '-created_date',
      20 // Process in batches to avoid timeout
    );
    
    if (!invitations || invitations.length === 0) {
      return Response.json({ success: true, message: 'No pending invitations found' });
    }

    const appUrl = 'https://hub.base44.app/apps/68ee80d98929370f9e8f2932';
    let approvedCount = 0;
    let skippedCount = 0;

    // Process invitations sequentially with early exits
    for (const invitation of invitations) {
      try {
        // Find the registered user
        const matchingUsers = await base44.asServiceRole.entities.User.filter({ email: invitation.email });
        if (!matchingUsers || matchingUsers.length === 0) {
          skippedCount++;
          continue;
        }

        const user = matchingUsers[0];

        // If already approved and verified, just mark invitation as accepted
        if (user.is_approved && user.is_verified) {
          await base44.asServiceRole.entities.UserInvitation.update(invitation.id, {
            status: 'accepted',
            accepted_at: new Date().toISOString()
          });
          skippedCount++;
          continue;
        }

        // Approve the user
        if (!user.is_approved) {
          await base44.asServiceRole.entities.User.update(user.id, {
            is_approved: true,
            role: invitation.role || 'user',
            care_scope: invitation.care_scope || 'home_health',
            ...(invitation.phone && { phone: invitation.phone }),
            ...(invitation.credentials && { credentials: invitation.credentials })
          });
        }

        // Mark invitation as accepted
        await base44.asServiceRole.entities.UserInvitation.update(invitation.id, {
          status: 'accepted',
          accepted_at: new Date().toISOString()
        });

        // Send welcome email (fire and forget to reduce timeout risk)
        base44.asServiceRole.integrations.Core.SendEmail({
          to: user.email,
          from_name: 'Penn Sync',
          subject: 'Welcome to Penn Sync — Your Account is Active',
          body: `Hello ${invitation.full_name || user.email},

Your Penn Sync account has been activated and is ready to use.

🔗 Login: ${appUrl}
👤 Email: ${user.email}

If you have any questions, please reach out to your administrator.

Best regards,
Penn Sync Team`
        }).catch(err => console.error('Email failed for', user.email, err));

        approvedCount++;
        console.log('✓ Auto-approved:', user.email);
      } catch (itemError) {
        console.error('Error processing invitation:', itemError.message);
        skippedCount++;
      }
    }

    return Response.json({ 
      success: true, 
      approved: approvedCount,
      skipped: skippedCount,
      total: invitations.length
    });

  } catch (error) {
    console.error('autoApproveInvitedUser error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});