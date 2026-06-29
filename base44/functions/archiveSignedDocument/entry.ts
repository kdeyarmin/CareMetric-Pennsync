import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Archiving retires a patient's signed clinical/legal document, so restrict
    // it to administrators rather than any authenticated user.
    const isAdminLike =
      user.role === 'admin' ||
      user.account_type === 'agency_admin' ||
      user.account_type === 'super_admin';
    if (!isAdminLike) {
      return Response.json({ error: 'Forbidden: admin access required' }, { status: 403 });
    }

    const { document_id, archive_notes } = await req.json();

    if (!document_id) {
      return Response.json({ error: 'Missing document_id' }, { status: 400 });
    }

    // Fetch the document
    const docs = await base44.entities.DocumentSignature.filter({ id: document_id });
    if (!docs || docs.length === 0) {
      return Response.json({ error: 'Document not found' }, { status: 404 });
    }

    const document = docs[0];

    // Add archive entry to audit trail
    const updatedAuditTrail = document.audit_trail || [];
    updatedAuditTrail.push({
      action: 'archived',
      timestamp: new Date().toISOString(),
      signer_id: null,
      notes: `Document archived by ${user.full_name}. ${archive_notes || ''}`
    });

    // Mark the document archived via the dedicated `archived` flag and keep the
    // audit trail. 'archived' is NOT a member of the status enum
    // (pending/in_progress/completed/rejected), so writing it as a status would
    // be silently dropped; the boolean is the schema-correct marker.
    await base44.asServiceRole.entities.DocumentSignature.update(document_id, {
      archived: true,
      audit_trail: updatedAuditTrail
    });

    // Create archive log entry for compliance. SystemLog's schema fields are
    // job_name/job_type/status/message (all required) + a free-form details object;
    // the previous action/user_email keys were silently dropped and the missing
    // required fields meant no audit row was written at all.
    await base44.asServiceRole.entities.SystemLog.create({
      job_name: 'Document Archived',
      job_type: 'other',
      status: 'success',
      message: `Document ${document_id} archived by ${user.email}`,
      details: {
        document_id,
        document_type: document.document_type,
        patient_id: document.patient_id,
        archived_by: user.email,
        archive_date: new Date().toISOString(),
        total_signers: document.signers?.length || 0,
        archive_notes
      }
    });

    return Response.json({ 
      success: true, 
      message: 'Document archived successfully',
      archived_at: new Date().toISOString(),
      audit_trail_entries: updatedAuditTrail.length
    });
  } catch (error) {
    console.error('Error archiving document:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});