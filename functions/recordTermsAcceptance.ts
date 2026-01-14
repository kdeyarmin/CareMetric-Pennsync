import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { documents, acceptanceMethod } = await req.json();

    // Get IP address from request headers
    const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() 
      || req.headers.get('x-real-ip') 
      || 'unknown';

    // Get user agent
    const userAgent = req.headers.get('user-agent') || 'unknown';

    // Current timestamp in UTC
    const timestampUTC = new Date().toISOString();

    // Create audit records for each document
    const auditRecords = [];
    
    for (const doc of documents) {
      const auditLogEntry = `User ID ${user.id} accepted ${doc.name} (${doc.id} ${doc.version}) on ${new Date(timestampUTC).toUTCString()} from IP ${ipAddress}.`;
      
      const record = await base44.asServiceRole.entities.TermsAcceptanceAudit.create({
        user_id: user.id,
        user_email: user.email,
        organization_id: user.organization_id || null,
        document_name: doc.name,
        document_id: doc.id,
        document_version: doc.version,
        timestamp_utc: timestampUTC,
        ip_address: ipAddress,
        user_agent: userAgent,
        acceptance_method: acceptanceMethod || 'modal',
        accepted_documents: documents,
        audit_log_entry: auditLogEntry
      });
      
      auditRecords.push(record);
    }

    // Also log to UserActivity for backward compatibility
    await base44.asServiceRole.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: "terms_accepted",
      details: {
        documents: documents,
        acceptance_method: acceptanceMethod || 'modal',
        ip_address: ipAddress,
        timestamp_utc: timestampUTC
      },
      page: "signup_agreement"
    });

    return Response.json({
      success: true,
      audit_records: auditRecords,
      message: 'Terms acceptance recorded successfully'
    });

  } catch (error) {
    console.error('Error recording terms acceptance:', error);
    return Response.json(
      { error: 'Failed to record terms acceptance', details: error.message },
      { status: 500 }
    );
  }
});