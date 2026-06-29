import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    // Admin-only function for scheduled task
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    console.log('Starting automated signature reminders...');

    // Get all pending signatures
    const pendingSignatures = await base44.asServiceRole.entities.DocumentSignature.filter({ 
      status: 'pending' 
    });

    console.log(`Found ${pendingSignatures.length} pending signatures`);

    let remindersSent = 0;
    let errors = 0;
    const results = [];

    for (const sig of pendingSignatures) {
      try {
        // Check if reminder is needed
        const shouldSendReminder = shouldSendReminderLogic(sig);
        
        if (!shouldSendReminder) {
          continue;
        }

        // Idempotency: don't re-email the same pending signature on every cron
        // tick. Skip if a reminder already went out in the last ~20h. Without
        // this, an overdue document re-emailed the patient (and re-created a
        // 'critical' notification) on every run until signed.
        const lastSent = sig.last_reminder_sent_at ? new Date(sig.last_reminder_sent_at).getTime() : 0;
        if (lastSent && (Date.now() - lastSent) < 20 * 60 * 60 * 1000) {
          continue;
        }

        // Get patient details
        const patients = await base44.asServiceRole.entities.Patient.filter({ id: sig.patient_id });
        const patient = patients[0];

        if (!patient || !patient.email) {
          console.log(`Skipping signature ${sig.id}: Patient email not found`);
          continue;
        }

        // Send reminder
        const documentName = sig.document_name || sig.document_title || sig.document_type || 'Document';
        const dueDate = sig.due_date || sig.expires_at;
        const dueText = dueDate
          ? `This document is due by ${new Date(dueDate).toLocaleDateString()}.`
          : '';

        const isOverdue = dueDate && new Date(dueDate) < new Date();

        await base44.asServiceRole.integrations.Core.SendEmail({
          to: patient.email,
          subject: isOverdue
            ? `URGENT: Overdue Document Signature - ${documentName}`
            : `Reminder: Document Signature Required - ${documentName}`,
          body: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              ${isOverdue ? '<div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 15px; margin-bottom: 20px;"><p style="margin: 0; color: #dc2626; font-weight: bold;">⚠️ OVERDUE DOCUMENT</p></div>' : ''}
              <h2 style="color: #1e40af;">Document Signature ${isOverdue ? 'OVERDUE' : 'Required'}</h2>
              <p>Hello ${patient.first_name},</p>
              <p>${isOverdue ? 'This is an urgent reminder' : 'This is a reminder'} that you have a document pending signature:</p>
              <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
                <h3 style="margin: 0 0 10px 0; color: #374151;">${documentName}</h3>
                <p style="margin: 0; color: #6b7280;">Status: <strong style="color: ${isOverdue ? '#dc2626' : '#f59e0b'};">${isOverdue ? 'OVERDUE' : 'Pending Signature'}</strong></p>
                ${dueText ? `<p style="margin: 10px 0 0 0; color: #6b7280;">${dueText}</p>` : ''}
              </div>
              <p>Please sign this document ${isOverdue ? 'immediately' : 'at your earliest convenience'} through your patient portal.</p>
              <p style="margin-top: 30px; color: #6b7280; font-size: 14px;">
                If you have any questions, please contact your healthcare provider.
              </p>
            </div>
          `
        });

        // Create notification
        await base44.asServiceRole.entities.Notification.create({
          user_email: patient.email,
          title: isOverdue ? 'OVERDUE: Document Signature Required' : 'Document Signature Reminder',
          message: `${isOverdue ? 'OVERDUE - ' : ''}Please sign "${documentName}"`,
          type: 'task_due_soon',
          priority: isOverdue ? 'critical' : 'medium',
          metadata: {
            signature_id: sig.id,
            patient_id: patient.id,
            document_name: documentName,
            is_overdue: isOverdue
          }
        });

        // Record that a reminder went out so the next run skips it within the window.
        await base44.asServiceRole.entities.DocumentSignature.update(sig.id, {
          last_reminder_sent_at: new Date().toISOString()
        }).catch(() => {});

        remindersSent++;
        results.push({
          signature_id: sig.id,
          patient_email: patient.email,
          status: 'sent'
        });

        console.log(`Reminder sent for signature ${sig.id} to ${patient.email}`);

      } catch (error) {
        errors++;
        results.push({
          signature_id: sig.id,
          status: 'error',
          error: error.message
        });
        console.error(`Error sending reminder for signature ${sig.id}:`, error);
      }
    }

    return Response.json({ 
      success: true,
      reminders_sent: remindersSent,
      errors: errors,
      total_pending: pendingSignatures.length,
      results: results
    });

  } catch (error) {
    console.error('Error in automated signature reminders:', error);
    return Response.json({
      error: 'Failed to send automated reminders'
    }, { status: 500 });
  }
});

// Helper function to determine if reminder should be sent
function shouldSendReminderLogic(signature) {
  const now = new Date();
  const createdDate = new Date(signature.created_date);
  const daysOld = (now - createdDate) / (1000 * 60 * 60 * 24);

  // Send reminder if:
  // 1. Document is overdue
  const dueDate = signature.due_date || signature.expires_at;

  if (dueDate && new Date(dueDate) < now) {
    return true;
  }

  // 2. Document is 3+ days old with no due date
  if (!dueDate && daysOld >= 3) {
    return true;
  }

  // 3. Document due within 24 hours
  if (dueDate) {
    const deadline = new Date(dueDate);
    const hoursUntilDue = (deadline - now) / (1000 * 60 * 60);
    if (hoursUntilDue <= 24 && hoursUntilDue > 0) {
      return true;
    }
  }

  return false;
}