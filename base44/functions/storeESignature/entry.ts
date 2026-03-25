import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();
    const {
      document_type,
      document_id,
      signature_data,
      consent_text,
      signature_method = 'drawn',
      metadata = {}
    } = payload;

    // Validate required fields
    if (!document_type || !signature_data || !consent_text) {
      return Response.json({
        error: 'Missing required fields: document_type, signature_data, consent_text'
      }, { status: 400 });
    }

    // Validate signature data format (should be base64)
    if (!signature_data.startsWith('data:image/')) {
      return Response.json({
        error: 'Invalid signature format. Must be base64 encoded image.'
      }, { status: 400 });
    }

    // Get client information for compliance
    const ip_address = req.headers.get('x-forwarded-for') || 
                       req.headers.get('x-real-ip') || 
                       'unknown';
    const user_agent = req.headers.get('user-agent') || 'unknown';

    // Create audit trail entry
    const audit_trail = [{
      timestamp: new Date().toISOString(),
      action: 'signature_created',
      user: user.email,
      ip_address: ip_address,
      user_agent: user_agent
    }];

    // Store signature in database
    const signature = await base44.asServiceRole.entities.DigitalSignature.create({
      signer_email: user.email,
      signer_name: user.full_name,
      document_type,
      document_id: document_id || null,
      signature_data,
      ip_address,
      user_agent,
      consent_text,
      signature_method,
      verification_status: 'verified',
      metadata: {
        ...metadata,
        signed_at: new Date().toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      },
      audit_trail
    });

    // Log security event
    await base44.asServiceRole.entities.SecurityLog.create({
      timestamp: new Date().toISOString(),
      user_email: user.email,
      user_role: user.role,
      action: 'e_signature_captured',
      details: {
        document_type,
        document_id,
        signature_method,
        ip_address
      },
      ip_address,
      user_agent
    }).catch(err => console.error('Failed to log security event:', err));

    return Response.json({
      success: true,
      signature_id: signature.id,
      timestamp: new Date().toISOString(),
      message: 'Signature captured and stored securely'
    });

  } catch (error) {
    console.error('Error storing e-signature:', error);
    return Response.json({
      error: 'Failed to store signature',
      details: error.message
    }, { status: 500 });
  }
});