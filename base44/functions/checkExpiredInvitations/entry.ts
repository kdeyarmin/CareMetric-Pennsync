import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    console.log('=== checkExpiredInvitations started ===');
    const base44 = createClientFromRequest(req);

    // Authorization: this reads ALL pending invitations (PII), emails every admin,
    // and mutates invitation state, so it must never be triggerable by an
    // unauthenticated or non-admin caller. Opt-in lockdown (matches
    // issueCertificate): when INTERNAL_FN_SECRET is set, require an admin user OR
    // the internal secret (the trusted scheduler sends x-internal-secret) — this
    // closes the no-identity (me === null) path. When the secret is unset, the
    // no-identity cron path stays allowed (platform invocation restriction is the
    // control, see docs/SECURITY-RLS-CHECKLIST.md §4) but an authenticated
    // non-admin is still rejected.
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

    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // Get all pending invitations
    const pendingInvitations = await base44.asServiceRole.entities.UserInvitation.filter({ 
      status: 'pending' 
    });

    console.log('Found pending invitations:', pendingInvitations.length);

    const expired = [];
    const expiringSoon = [];

    for (const invitation of pendingInvitations) {
      const expiresAt = new Date(invitation.expires_at);

      // A missing/unparseable expiry would otherwise make both comparisons below
      // false, leaving the invitation pending forever. Fail closed: treat a
      // malformed expiry as expired so it can't remain actionable indefinitely.
      if (Number.isNaN(expiresAt.getTime())) {
        console.warn(`Invitation ${invitation.id} has invalid/missing expires_at; marking expired.`);
        expired.push(invitation);
        await base44.asServiceRole.entities.UserInvitation.update(invitation.id, { status: 'expired' });
        continue;
      }

      if (now > expiresAt) {
        // Already expired
        expired.push(invitation);
        
        // Mark as expired
        await base44.asServiceRole.entities.UserInvitation.update(invitation.id, {
          status: 'expired'
        });
      } else if (tomorrow > expiresAt) {
        // Expiring within 24 hours
        expiringSoon.push(invitation);
      }
    }

    console.log('Expired invitations:', expired.length);
    console.log('Expiring soon:', expiringSoon.length);

    // Get all admins
    const admins = await base44.asServiceRole.entities.User.filter({ role: 'admin' });

    // Send notifications if there are expired or expiring invitations
    if (expired.length > 0 || expiringSoon.length > 0) {
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
      expiring_soon: expiringSoon.length,
      notifications_sent: admins.length
    });

  } catch (error) {
    console.error('Error checking expired invitations:', error);
    return Response.json({ 
      error: 'Failed to check expired invitations', 
      details: error.message 
    }, { status: 500 });
  }
});