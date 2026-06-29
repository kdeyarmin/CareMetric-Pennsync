import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Get all pending or in_progress packages (bounded so a large backlog can't
    // time the job out; the oldest are the ones needing reminders).
    const packages = await base44.entities.DocumentPackage.filter({
      status: { $in: ['pending', 'in_progress'] }
    }, '-created_date', 500);

    if (!packages || packages.length === 0) {
      return Response.json({ 
        success: true, 
        message: 'No pending packages to check',
        checked: 0,
        emailsSent: 0
      });
    }

    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const emailsSent = [];

    for (const pkg of packages) {
      const shouldSendReminder = 
        (pkg.due_date && new Date(pkg.due_date) < now) ||
        (pkg.created_date && new Date(pkg.created_date) < threeDaysAgo);

      if (!shouldSendReminder) continue;

      // Idempotency: don't re-email the caregiver on every cron tick. Skip if a
      // reminder for this package already went out in the last ~20h (allows a
      // daily cadence with jitter). Without this the same package was re-emailed
      // every run until signed.
      const lastSent = pkg.last_reminder_sent_at ? new Date(pkg.last_reminder_sent_at).getTime() : 0;
      if (lastSent && (now.getTime() - lastSent) < 20 * 60 * 60 * 1000) continue;

      // Get patient to retrieve caregiver email. Tolerate a deleted/invalid
      // patient_id: without the catch a single bad row throws and aborts the
      // whole reminder run, skipping every remaining package.
      const patient = await base44.entities.Patient.get(pkg.patient_id).catch(() => null);
      if (!patient?.caregiver_email) continue;

      // Get document count info
      const signatures = pkg.document_signatures?.length || 0;
      const allSignatures = await Promise.all(
        (pkg.document_signatures || []).map(id => 
          base44.entities.DocumentSignature.get(id).catch(() => null)
        )
      );
      const signedCount = allSignatures.filter(s => s?.status === 'completed').length;

      // Send follow-up email
      const daysOverdue = Math.floor((now - new Date(pkg.due_date)) / (24 * 60 * 60 * 1000));
      const daysPending = Math.floor((now - new Date(pkg.created_date)) / (24 * 60 * 60 * 1000));

      const subject = `Reminder: Signature Request Needed for ${patient.first_name} ${patient.last_name}`;
      const body = `
Hello ${patient.caregiver_name || 'Caregiver'},

This is a friendly reminder that a signature request for ${patient.first_name} ${patient.last_name} requires your attention.

Package: ${pkg.package_name}
Documents: ${signedCount} of ${signatures} signed
Days Pending: ${daysPending} days
${pkg.due_date ? `Due Date: ${new Date(pkg.due_date).toLocaleDateString()}` : ''}

Please complete the remaining signatures at your earliest convenience.

Thank you,
Care Team
      `.trim();

      await base44.integrations.Core.SendEmail({
        to: patient.caregiver_email,
        subject,
        body,
        from_name: 'Document Signing System'
      });

      // Record that a reminder went out so the next run skips it within the window.
      await base44.entities.DocumentPackage.update(pkg.id, {
        last_reminder_sent_at: now.toISOString()
      }).catch(() => {});

      emailsSent.push({
        packageId: pkg.id,
        caregiverEmail: patient.caregiver_email,
        daysPending
      });
    }

    return Response.json({
      success: true,
      message: `Daily signature check completed`,
      checked: packages.length,
      emailsSent: emailsSent.length,
      sentTo: emailsSent
    });
  } catch (error) {
    console.error('checkPendingSignatureRequests error:', error);
    return Response.json({ error: 'Failed to check pending signature requests' }, { status: 500 });
  }
});