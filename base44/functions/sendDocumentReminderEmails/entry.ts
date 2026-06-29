import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    // Only admins can trigger reminders
    if (user?.role !== 'admin') {
      return Response.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 }
      );
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Fetch all pending document packages
    const pendingPackages = await base44.entities.DocumentPackage.filter({
      status: 'pending',
      auto_reminder_enabled: true,
    });

    let sentCount = 0;
    let failureCount = 0;
    const results = [];

    for (const pkg of pendingPackages) {
      try {
        // Skip if no due date
        if (!pkg.due_date) continue;

        const dueDate = new Date(pkg.due_date);
        dueDate.setHours(0, 0, 0, 0);

        // Calculate days until due
        const daysUntilDue = Math.floor(
          (dueDate - today) / (1000 * 60 * 60 * 24)
        );

        // Skip if already sent a reminder recently
        if (pkg.last_reminder_sent_at) {
          const lastSent = new Date(pkg.last_reminder_sent_at);
          const daysSinceReminder = Math.floor(
            (today - lastSent) / (1000 * 60 * 60 * 24)
          );
          if (daysSinceReminder < 1) {
            continue; // Already sent today
          }
        }

        // Determine reminder type based on days remaining
        const reminderDaysBuffer = pkg.reminder_days_before || 3;
        let reminderType = null;

        if (daysUntilDue === 0) {
          reminderType = 'due_today';
        } else if (daysUntilDue < 0) {
          reminderType = 'overdue';
        } else if (daysUntilDue <= reminderDaysBuffer) {
          reminderType = 'pre_due';
        }

        // Skip if not in reminder window
        if (!reminderType) continue;

        // Skip if no signer email
        if (!pkg.signer_email) continue;

        // Get signature details (guard against a package with no
        // document_signatures array so a single bad row doesn't 500 the reminder)
        const signatureIds = Array.isArray(pkg.document_signatures)
          ? pkg.document_signatures
          : [];
        const signatures = await Promise.all(
          signatureIds.map((id) =>
            base44.entities.DocumentSignature.get(id).catch(() => null)
          )
        );

        const validSignatures = signatures.filter((s) => s !== null);
        const signedCount = validSignatures.filter(
          (s) => s.status === 'completed'
        ).length;
        const pendingCount = validSignatures.length - signedCount;

        // Build personalized email
        const reminderSubject = getReminderSubject(reminderType, pkg.package_name);
        const reminderBody = getReminderBody(
          pkg.signer_name || 'Signer',
          pkg.package_name,
          daysUntilDue,
          reminderType,
          signedCount,
          validSignatures.length
        );

        // Send email
        await base44.integrations.Core.SendEmail({
          to: pkg.signer_email,
          subject: reminderSubject,
          body: reminderBody,
        });

        // Log the reminder
        await base44.entities.ReminderLog.create({
          package_id: pkg.id,
          package_name: pkg.package_name,
          signer_email: pkg.signer_email,
          signer_name: pkg.signer_name,
          reminder_type: reminderType,
          days_until_due: daysUntilDue,
          sent_at: new Date().toISOString(),
          status: 'sent',
          document_count: validSignatures.length,
          documents_signed: signedCount,
          documents_pending: pendingCount,
        });

        // Update last reminder sent timestamp
        await base44.entities.DocumentPackage.update(pkg.id, {
          last_reminder_sent_at: new Date().toISOString(),
        });

        sentCount++;
        results.push({
          packageId: pkg.id,
          status: 'success',
          reminderType,
          email: pkg.signer_email,
        });
      } catch (error) {
        failureCount++;
        results.push({
          packageId: pkg.id,
          status: 'failed',
          error: error.message,
        });
      }
    }

    return Response.json({
      success: true,
      summary: {
        total_packages_checked: pendingPackages.length,
        reminders_sent: sentCount,
        failures: failureCount,
        results,
      },
    });
  } catch (error) {
    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }
});

function getReminderSubject(reminderType, packageName) {
  switch (reminderType) {
    case 'due_today':
      return `URGENT: Document signatures due today - ${packageName}`;
    case 'overdue':
      return `OVERDUE: Document signatures past due - ${packageName}`;
    case 'pre_due':
      return `Reminder: Document signatures needed for ${packageName}`;
    default:
      return `Document signature reminder - ${packageName}`;
  }
}

function getReminderBody(
  signerName,
  packageName,
  daysUntilDue,
  reminderType,
  signedCount,
  totalCount
) {
  let greeting = `Hello ${signerName},`;
  let urgency = '';
  let timeframe = '';

  if (reminderType === 'due_today') {
    urgency = 'Your document signatures are due TODAY.';
    timeframe = 'Please complete this immediately to avoid delays.';
  } else if (reminderType === 'overdue') {
    urgency = 'Your document signatures are OVERDUE.';
    timeframe = `They were due ${Math.abs(daysUntilDue)} days ago. Please complete them as soon as possible.`;
  } else {
    urgency = `Your document signatures are due in ${daysUntilDue} days.`;
    timeframe = `Please review and sign the documents at your earliest convenience to ensure timely completion.`;
  }

  const progressLine = signedCount > 0
    ? `Progress: ${signedCount} of ${totalCount} documents signed`
    : `All ${totalCount} document(s) are awaiting your signature`;

  return `${greeting}

This is a reminder regarding the "${packageName}" package.

${urgency} ${timeframe}

${progressLine}

Please review and sign the required documents as soon as possible. If you have any questions or need assistance, please contact support.

Thank you,
Document Management System`;
}