import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { invoiceId, amount, method, transactionId, referenceNumber, notes } = await req.json();

        if (!invoiceId || !amount || !method) {
            return Response.json({ error: 'Invoice ID, amount, and payment method required' }, { status: 400 });
        }

        const invoice = await base44.entities.Invoice.get(invoiceId);
         if (!invoice) {
             return Response.json({ error: 'Invoice not found' }, { status: 404 });
         }

        // Create payment record
        const payment = await base44.entities.Payment.create({
            invoice_id: invoiceId,
            patient_id: invoice.patient_id,
            payment_date: new Date().toISOString().split('T')[0],
            amount: amount,
            method: method,
            transaction_id: transactionId || '',
            reference_number: referenceNumber || '',
            notes: notes || '',
            received_by: user.email
        });

        // Update invoice paid amount and status
        const newPaidAmount = (invoice.paid_amount || 0) + amount;
        let newStatus = invoice.status;

        if (newPaidAmount >= invoice.total_amount) {
            newStatus = 'paid';
        } else if (newPaidAmount > 0) {
            newStatus = 'partially_paid';
        }

        await base44.entities.Invoice.update(invoiceId, {
            paid_amount: newPaidAmount,
            status: newStatus,
            payment_notes: `${invoice.payment_notes || ''}\n${new Date().toISOString()}: Payment of $${amount.toFixed(2)} received via ${method}`
        });

        return Response.json({
            success: true,
            paymentId: payment.id,
            invoiceStatus: newStatus,
            remainingBalance: invoice.total_amount - newPaidAmount
        });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});