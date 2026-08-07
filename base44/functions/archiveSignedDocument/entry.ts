import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// <<<BEGIN SHARED HELPER: requireAgencyAdminAgency — generated, edit base44/_shared/backendHelpers.mjs>>>
function agencyAdminMissingAgencyResponse(user) {
  if (user && user.account_type === 'agency_admin' && !String(user.agency_name || '').trim()) {
    return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
  }
  return null;
}
// <<<END SHARED HELPER: requireAgencyAdminAgency>>>


Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    {
      const _agencyAdminGate = agencyAdminMissingAgencyResponse(user);
      if (_agencyAdminGate) return _agencyAdminGate;
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
    const docs = await base44.entities.DocumentSignature.filter({ id: document_id }, undefined, 5000);
    if (!docs || docs.length === 0) {
      return Response.json({ error: 'Document not found' }, { status: 404 });
    }

    const document = docs[0];

    // Agency-scoped admins (agency_admin OR facility admin with agency_name)
    // may only archive documents for patients in their agency.
    const isAgencyScopedAdmin = user.account_type !== 'super_admin'
      && user.agency_name
      && (user.account_type === 'agency_admin' || user.role === 'admin');
    if (isAgencyScopedAdmin) {
      if (!document.patient_id) {
        return Response.json({ error: 'Forbidden: document is outside your agency.' }, { status: 403 });
      }
      const agencyUsers = await base44.asServiceRole.entities.User.list('-created_date', 5000).catch(() => []);
      const agencyEmails = new Set(
        (agencyUsers || [])
          .filter((u) => u.agency_name === user.agency_name && u.email)
          .map((u) => u.email),
      );
      const patients = await base44.asServiceRole.entities.Patient
        .filter({ id: document.patient_id }, undefined, 5)
        .catch(() => []);
      const patient = patients?.[0];
      const inAgency = patient && (
        (patient.created_by && agencyEmails.has(patient.created_by))
        || (Array.isArray(patient.assigned_nurses) && patient.assigned_nurses.some((e) => agencyEmails.has(e)))
      );
      if (!inAgency) {
        return Response.json({ error: 'Forbidden: document is outside your agency.' }, { status: 403 });
      }
    }

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
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});