import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { 
      document_id, 
      patient_id, 
      document_type, 
      signers,
      expiration_hours 
    } = await req.json();

    if (!document_id || !patient_id || !document_type || !signers || signers.length === 0) {
      return Response.json({ 
        success: false, 
        error: 'Document ID, patient ID, document type, and signers required' 
      }, { status: 400 });
    }

    // Calculate expiration
    const expirationDate = new Date();
    expirationDate.setHours(expirationDate.getHours() + (expiration_hours || 168)); // Default 7 days

    // Create signature workflow
    const workflow = await base44.asServiceRole.entities.DocumentSignature.create({
      document_id,
      patient_id,
      document_type,
      signers: signers.map(s => ({
        signer_name: s.signer_name,
        signer_role: s.signer_role,
        email: s.email,
        signature_data: null,
        signed_at: null,
        ip_address: null,
        device_info: null,
        verification_method: null
      })),
      workflow_status: 'pending',
      created_by: user.email,
      expiration_date: expirationDate.toISOString(),
      reminder_sent_count: 0,
      audit_trail: [{
        action: 'workflow_created',
        user: user.email,
        timestamp: new Date().toISOString(),
        details: `Signature workflow created for ${document_type}`
      }]
    });

    // Send email notifications to signers
    for (const signer of signers) {
      if (signer.email) {
        try {
          await base44.integrations.Core.SendEmail({
            to: signer.email,
            subject: `Signature Required: ${document_type}`,
            body: `
              <p>Hello ${signer.signer_name},</p>
              <p>A document requires your signature:</p>
              <ul>
                <li><strong>Document Type:</strong> ${document_type}</li>
                <li><strong>Role:</strong> ${signer.signer_role}</li>
                <li><strong>Expires:</strong> ${expirationDate.toLocaleDateString()}</li>
              </ul>
              <p>Please log in to CareMetric AI to review and sign this document.</p>
              <p>Thank you,<br/>CareMetric AI Team</p>
            `
          });
        } catch (emailError) {
          console.error('Failed to send email to', signer.email, emailError);
        }
      }
    }

    return Response.json({
      success: true,
      workflow_id: workflow.id,
      workflow
    });

  } catch (error) {
    console.error('Document signature workflow error:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});