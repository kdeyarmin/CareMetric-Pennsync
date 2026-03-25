import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { 
      workflow_id, 
      signer_email, 
      signature_data, 
      verification_method 
    } = await req.json();

    if (!workflow_id || !signer_email || !signature_data) {
      return Response.json({ 
        success: false, 
        error: 'Workflow ID, signer email, and signature data required' 
      }, { status: 400 });
    }

    // Get workflow
    const workflow = await base44.entities.DocumentSignature.get(workflow_id);

    if (!workflow) {
      return Response.json({ 
        success: false, 
        error: 'Workflow not found' 
      }, { status: 404 });
    }

    // Check expiration
    if (new Date(workflow.expiration_date) < new Date()) {
      return Response.json({ 
        success: false, 
        error: 'Signature workflow has expired' 
      }, { status: 400 });
    }

    // Find signer
    const signerIndex = workflow.signers.findIndex(s => s.email === signer_email);
    if (signerIndex === -1) {
      return Response.json({ 
        success: false, 
        error: 'Signer not found in workflow' 
      }, { status: 404 });
    }

    // Get IP and device info
    const ipAddress = req.headers.get('x-forwarded-for') || 'unknown';
    const deviceInfo = req.headers.get('user-agent') || 'unknown';

    // Update signer
    const updatedSigners = [...workflow.signers];
    updatedSigners[signerIndex] = {
      ...updatedSigners[signerIndex],
      signature_data,
      signed_at: new Date().toISOString(),
      ip_address: ipAddress,
      device_info: deviceInfo,
      verification_method: verification_method || 'drawn'
    };

    // Check if all signed
    const allSigned = updatedSigners.every(s => s.signed_at !== null);
    const newStatus = allSigned ? 'completed' : 
                      updatedSigners.some(s => s.signed_at !== null) ? 'partial' : 'pending';

    // Update audit trail
    const updatedAuditTrail = [
      ...(workflow.audit_trail || []),
      {
        action: 'signature_added',
        user: signer_email,
        timestamp: new Date().toISOString(),
        details: `${updatedSigners[signerIndex].signer_name} signed the document`
      }
    ];

    if (allSigned) {
      updatedAuditTrail.push({
        action: 'workflow_completed',
        user: 'system',
        timestamp: new Date().toISOString(),
        details: 'All signatures collected'
      });
    }

    // Update workflow
    await base44.asServiceRole.entities.DocumentSignature.update(workflow_id, {
      signers: updatedSigners,
      workflow_status: newStatus,
      completed_at: allSigned ? new Date().toISOString() : null,
      audit_trail: updatedAuditTrail
    });

    return Response.json({
      success: true,
      workflow_status: newStatus,
      all_signed: allSigned
    });

  } catch (error) {
    console.error('Submit signature error:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});