import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user || user.role !== 'admin') {
            return Response.json({ error: 'Unauthorized' }, { status: 403 });
        }

        // Fetch all overdue unpaid invoices
        const invoices = await base44.entities.Invoice.list();
        const overdueInvoices = invoices.filter(inv => {
            const isDue = new Date(inv.due_date) < new Date();
            const isUnpaid = inv.status === 'pending' || inv.status === 'sent' || inv.status === 'partially_paid' || inv.status === 'overdue';
            return isDue && isUnpaid;
        });

        let remindersSent = 0;

        for (const invoice of overdueInvoices) {
            const patients = await base44.entities.Patient.filter({ id: invoice.patient_id });
            const patient = patients[0];

            if (patient?.email) {
                const daysOverdue = Math.floor((Date.now() - new Date(invoice.due_date)) / (1000 * 60 * 60 * 24));
                const remainingBalance = (invoice.total_amount - (invoice.paid_amount || 0)).toFixed(2);

                await base44.integrations.Core.SendEmail({
                    to: patient.email,
                    subject: `Payment Reminder: Invoice ${invoice.invoice_number} is ${daysOverdue} days overdue`,
                    body: `Dear ${patient.first_name},\n\nThis is a friendly reminder that your invoice ${invoice.invoice_number} is ${daysOverdue} days overdue.\n\nOutstanding Balance: $${remainingBalance}\nOriginal Due Date: ${invoice.due_date}\n\nPlease submit payment at your earliest convenience.\n\nThank you.`
                });

                await base44.entities.Invoice.update(invoice.id, {
                    reminders_sent: (invoice.reminders_sent || 0) + 1,
                    last_reminder_sent: new Date().toISOString(),
                    status: 'overdue'
                });

                remindersSent++;
            }
        }

        return Response.json({
            success: true,
            remindersSent: remindersSent,
            overdueInvoicesFound: overdueInvoices.length
        });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});