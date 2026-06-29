import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { signature_id } = await req.json();

    if (!signature_id) {
      return Response.json({ error: 'signature_id is required' }, { status: 400 });
    }

    // Get signature details
    const signature = await base44.asServiceRole.entities.DocumentSignature.filter({ id: signature_id });

    if (!signature || signature.length === 0) {
      return Response.json({ error: 'Signature not found' }, { status: 404 });
    }

    const sig = signature[0];

    // Get patient details
    const patients = await base44.asServiceRole.entities.Patient.filter({ id: sig.patient_id });
    const patient = patients[0];

    if (!patient || !patient.email) {
      return Response.json({ error: 'Patient email not found' }, { status: 404 });
    }

    // Authorization: any authenticated user must NOT be able to email any patient
    // for any signature request. Allow only:
    //   - admins / clinical roles, OR
    //   - the caller who created/owns the signature request, OR
    //   - a nurse assigned to (or creator of) the patient.
    // (Mirrors the assignment model used in getScopedPatientAlerts.)
    const role = user.role;
    const privilegedRole = role === 'admin' || role === 'clinician' || role === 'nurse_manager';
    const ownsSignature = sig.created_by === user.email
      || sig.requested_by === user.email
      || sig.sender_email === user.email;
    const assignedToPatient = patient.created_by === user.email
      || (Array.isArray(patient.assigned_nurses) && patient.assigned_nurses.includes(user.email));

    if (!privilegedRole && !ownsSignature && !assignedToPatient) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Send reminder email
    const documentName = sig.document_name || sig.document_title || sig.document_type || 'Document';
    const dueDate = sig.due_date || sig.expires_at;
    const dueText = dueDate
      ? `This document is due by ${new Date(dueDate).toLocaleDateString()}.`
      : '';

    await base44.asServiceRole.integrations.Core.SendEmail({
      to: patient.email,
      subject: `Reminder: Document Signature Required - ${documentName}`,
      body: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1e40af;">Document Signature Required</h2>
          <p>Hello ${patient.first_name},</p>
          <p>This is a friendly reminder that you have a document pending signature:</p>
          <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin: 0 0 10px 0; color: #374151;">${documentName}</h3>
            <p style="margin: 0; color: #6b7280;">Status: <strong style="color: #f59e0b;">Pending Signature</strong></p>
            ${dueText ? `<p style="margin: 10px 0 0 0; color: #6b7280;">${dueText}</p>` : ''}
          </div>
          <p>Please sign this document at your earliest convenience through your patient portal.</p>
          <p style="margin-top: 30px; color: #6b7280; font-size: 14px;">
            If you have any questions, please contact your healthcare provider.
          </p>
        </div>
      `
    });

    // Create notification
    await base44.asServiceRole.entities.Notification.create({
      user_email: patient.email,
      title: 'Document Signature Reminder',
      message: `Reminder: Please sign "${documentName}"`,
      type: 'task_assigned',
      priority: dueDate && new Date(dueDate) < new Date() ? 'high' : 'medium',
      metadata: {
        signature_id: sig.id,
        patient_id: patient.id,
        document_name: documentName
      }
    });

    return Response.json({
      success: true,
      message: 'Reminder sent successfully'
    });

  } catch (error) {
    console.error('Error sending signature reminder:', error);
    return Response.json({
      error: error.message || 'Failed to send reminder'
    }, { status: 500 });
  }
});