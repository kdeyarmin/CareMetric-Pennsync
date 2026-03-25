import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // This function is called by scheduled task, use service role
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get all sent/partial invoices past due date
    const allInvoices = await base44.asServiceRole.entities.Invoice.list('-created_date', 2000);
    
    const overdueInvoices = allInvoices.filter(invoice => {
      if (!['sent', 'partial'].includes(invoice.status)) return false;
      
      const dueDate = new Date(invoice.due_date);
      dueDate.setHours(0, 0, 0, 0);
      
      return dueDate < today;
    });

    console.log(`Found ${overdueInvoices.length} overdue invoices`);

    const results = [];

    for (const invoice of overdueInvoices) {
      try {
        // Get patient info
        const patients = await base44.asServiceRole.entities.Patient.filter({ id: invoice.patient_id });
        const patient = patients[0];

        if (!patient || !patient.email) {
          console.log(`Skipping invoice ${invoice.invoice_number} - no patient email`);
          continue;
        }

        // Get billing info if available
        const billingInfos = await base44.asServiceRole.entities.PatientBillingInfo.filter({ 
          patient_id: patient.id 
        });
        const billingInfo = billingInfos[0];
        const billingEmail = billingInfo?.billing_email || patient.email;

        // Calculate days overdue
        const daysOverdue = Math.floor((today - new Date(invoice.due_date)) / (1000 * 60 * 60 * 24));

        // Send reminder email
        const emailSubject = `Payment Reminder: Invoice ${invoice.invoice_number} - ${daysOverdue} Days Overdue`;
        const emailBody = `
Dear ${patient.first_name} ${patient.last_name},

This is a friendly reminder that your invoice is now ${daysOverdue} days overdue.

Invoice Details:
- Invoice Number: ${invoice.invoice_number}
- Original Due Date: ${new Date(invoice.due_date).toLocaleDateString()}
- Amount Due: $${invoice.balance_due.toFixed(2)}

Please submit payment at your earliest convenience. If you have already made payment, please disregard this notice.

If you have any questions or need to set up a payment plan, please contact us.

Thank you for your prompt attention to this matter.

Best regards,
Billing Department
        `;

        await base44.asServiceRole.integrations.Core.SendEmail({
          to: billingEmail,
          subject: emailSubject,
          body: emailBody
        });

        // Update invoice status to overdue if not already
        if (invoice.status !== 'overdue') {
          await base44.asServiceRole.entities.Invoice.update(invoice.id, {
            status: 'overdue'
          });
        }

        results.push({
          invoice_number: invoice.invoice_number,
          patient: `${patient.first_name} ${patient.last_name}`,
          email: billingEmail,
          days_overdue: daysOverdue,
          sent: true
        });

        console.log(`Sent reminder for invoice ${invoice.invoice_number} to ${billingEmail}`);

      } catch (error) {
        console.error(`Error processing invoice ${invoice.invoice_number}:`, error);
        results.push({
          invoice_number: invoice.invoice_number,
          error: error.message,
          sent: false
        });
      }
    }

    return Response.json({
      success: true,
      total_overdue: overdueInvoices.length,
      reminders_sent: results.filter(r => r.sent).length,
      results
    });

  } catch (error) {
    console.error('Error sending overdue reminders:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});