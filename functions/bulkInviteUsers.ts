import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { Resend } from 'npm:resend@4.0.0';

Deno.serve(async (req) => {
  try {
    console.log('=== Bulk invite users started ===');
    const base44 = createClientFromRequest(req);
    
    // Verify admin user
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
    }

    const { invitations } = await req.json();
    
    if (!invitations || !Array.isArray(invitations) || invitations.length === 0) {
      return Response.json({ error: 'invitations array is required' }, { status: 400 });
    }

    console.log(`Processing ${invitations.length} invitations...`);
    
    const results = {
      created: [],
      updated: [],
      failed: [],
      emailsFailed: []
    };

    const resend = new Resend(Deno.env.get('RESEND_API_KEY'));
    const signupUrl = 'https://www.caremetricai.com';

    for (const invite of invitations) {
      try {
        const { email, full_name, role, care_scope, phone, credentials } = invite;
        
        if (!email || !full_name) {
          results.failed.push({ email: email || 'unknown', reason: 'Missing email or full_name' });
          continue;
        }

        // Check for existing invitation
        const existingInvitations = await base44.asServiceRole.entities.UserInvitation.filter({ 
          email: email.toLowerCase() 
        });
        
        const pendingInvitation = existingInvitations.find(inv => 
          inv.status === 'pending' || (inv.status !== 'revoked' && new Date(inv.expires_at) > new Date())
        );

        const now = new Date();
        const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        let invitationId;
        let isUpdate = false;

        if (pendingInvitation) {
          // Update existing
          await base44.asServiceRole.entities.UserInvitation.update(pendingInvitation.id, {
            full_name,
            role: role || 'user',
            care_scope: care_scope || 'home_health',
            phone: phone || null,
            credentials: credentials || null,
            expires_at: expiresAt.toISOString(),
            last_sent_at: now.toISOString(),
            resend_count: (pendingInvitation.resend_count || 0) + 1,
            status: 'pending'
          });
          invitationId = pendingInvitation.id;
          isUpdate = true;
        } else {
          // Create new
          const newInvitation = await base44.asServiceRole.entities.UserInvitation.create({
            email,
            full_name,
            role: role || 'user',
            care_scope: care_scope || 'home_health',
            phone: phone || null,
            credentials: credentials || null,
            invited_by: user.email,
            status: 'pending',
            expires_at: expiresAt.toISOString(),
            last_sent_at: now.toISOString(),
            resend_count: 0
          });
          invitationId = newInvitation.id;
        }

        // Send email
        try {
          await resend.emails.send({
            from: 'CareMetric AI <onboarding@caremetricai.com>',
            to: email,
            subject: 'You\'re Invited to CareMetric AI! 🎉',
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2>Hello ${full_name},</h2>
                
                <p>You've been invited to join <strong>CareMetric AI</strong> - the intelligent healthcare documentation platform.</p>
                
                <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
                  <p style="margin: 5px 0;"><strong>📧 Your Email:</strong> ${email}</p>
                  <p style="margin: 5px 0;"><strong>🎭 Role:</strong> ${role || 'user'}</p>
                  <p style="margin: 5px 0;"><strong>🏥 Care Scope:</strong> ${care_scope || 'home_health'}</p>
                </div>
                
                <h3>Get started:</h3>
                <ol>
                  <li>Visit <a href="${signupUrl}">${signupUrl}</a></li>
                  <li>Sign up using this email address</li>
                  <li>Complete onboarding</li>
                  <li>Start with a 14-day free trial!</li>
                </ol>
                
                <p><strong>⏰ This invitation expires in 7 days</strong> (${expiresAt.toLocaleDateString()}).</p>
                
                <p>Best regards,<br>The CareMetric AI Team</p>
              </div>
            `
          });

          if (isUpdate) {
            results.updated.push({ email, id: invitationId });
          } else {
            results.created.push({ email, id: invitationId });
          }
        } catch (emailError) {
          console.error(`Email failed for ${email}:`, emailError);
          results.emailsFailed.push({ email, reason: emailError.message });
          if (isUpdate) {
            results.updated.push({ email, id: invitationId });
          } else {
            results.created.push({ email, id: invitationId });
          }
        }

      } catch (error) {
        console.error(`Failed to process ${invite.email}:`, error);
        results.failed.push({ email: invite.email, reason: error.message });
      }
    }

    console.log('Bulk invite results:', results);

    return Response.json({ 
      success: true,
      results
    });

  } catch (error) {
    console.error('Error in bulkInviteUsers:', error);
    return Response.json({ 
      error: error.message 
    }, { status: 500 });
  }
});