import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { invoiceId, sendToPatient = true, sendToInsurance = false } = await req.json();

        if (!invoiceId) {
            return Response.json({ error: 'Invoice ID required' }, { status: 400 });
        }

        const invoices = await base44.entities.Invoice.filter({ id: invoiceId });
        if (!invoices || invoices.length === 0) {
            return Response.json({ error: 'Invoice not found' }, { status: 404 });
        }

        const invoice = invoices[0];
        const patients = await base44.entities.Patient.filter({ id: invoice.patient_id });
        const patient = patients[0];

        // Send to patient
        if (sendToPatient && patient?.email) {
            await base44.integrations.Core.SendEmail({
                to: patient.email,
                subject: `Invoice ${invoice.invoice_number} - Payment Due ${invoice.due_date}`,
                body: `Dear ${patient.first_name},\n\nPlease find your invoice below:\n\nInvoice Number: ${invoice.invoice_number}\nInvoice Date: ${invoice.invoice_date}\nDue Date: ${invoice.due_date}\nTotal Amount Due: $${invoice.total_amount.toFixed(2)}\n\nPlease remit payment by the due date.\n\nThank you for your business.`
            });

            await base44.entities.Invoice.update(invoiceId, {
                patient_email_sent: true,
                patient_email_sent_date: new Date().toISOString(),
                status: 'sent'
            });
        }

        // Send to insurance
        if (sendToInsurance && invoice.insurance_provider_id) {
            const insurers = await base44.entities.InsuranceProvider.filter({ id: invoice.insurance_provider_id });
            const insurer = insurers[0];

            if (insurer?.billing_contact_email) {
                await base44.integrations.Core.SendEmail({
                    to: insurer.billing_contact_email,
                    subject: `Claim Submission - ${patient.first_name} ${patient.last_name} - Invoice ${invoice.invoice_number}`,
                    body: `Claim Details:\n\nPatient: ${patient.first_name} ${patient.last_name}\nInvoice Number: ${invoice.invoice_number}\nTotal Amount: $${invoice.total_amount.toFixed(2)}\nServices Rendered: ${invoice.line_items.map(item => item.description).join('; ')}`
                });

                await base44.entities.Invoice.update(invoiceId, {
                    insurance_billed: true,
                    insurance_submitted_date: new Date().toISOString()
                });
            }
        }

        return Response.json({ success: true, message: 'Invoices sent successfully' });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});