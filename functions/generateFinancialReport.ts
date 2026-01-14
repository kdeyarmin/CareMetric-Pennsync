import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user || user.role !== 'admin') {
            return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
        }

        const { startDate, endDate } = await req.json();

        // Fetch invoices within date range
        const invoices = await base44.entities.Invoice.list();
        const filteredInvoices = invoices.filter(inv => {
            const invDate = new Date(inv.invoice_date);
            return invDate >= new Date(startDate) && invDate <= new Date(endDate);
        });

        // Calculate metrics
        const totalRevenue = filteredInvoices.reduce((sum, inv) => sum + inv.total_amount, 0);
        const totalPaid = filteredInvoices.reduce((sum, inv) => sum + (inv.paid_amount || 0), 0);
        const outstandingBalance = totalRevenue - totalPaid;
        const paidInvoices = filteredInvoices.filter(inv => inv.status === 'paid').length;
        const partiallyPaidInvoices = filteredInvoices.filter(inv => inv.status === 'partially_paid').length;
        const pendingInvoices = filteredInvoices.filter(inv => inv.status === 'pending' || inv.status === 'sent').length;
        const overdueInvoices = filteredInvoices.filter(inv => new Date(inv.due_date) < new Date() && inv.status !== 'paid').length;

        // Revenue by insurance provider
        const revenueByProvider = {};
        filteredInvoices.forEach(inv => {
            const provider = inv.insurance_provider_id || 'Self-Pay';
            revenueByProvider[provider] = (revenueByProvider[provider] || 0) + inv.total_amount;
        });

        // Revenue by billing model
        const revenueByModel = {};
        filteredInvoices.forEach(inv => {
            const model = inv.billing_model || 'fee_for_service';
            revenueByModel[model] = (revenueByModel[model] || 0) + inv.total_amount;
        });

        return Response.json({
            period: { startDate, endDate },
            summary: {
                totalInvoices: filteredInvoices.length,
                totalRevenue: totalRevenue.toFixed(2),
                totalPaid: totalPaid.toFixed(2),
                outstandingBalance: outstandingBalance.toFixed(2),
                collectionRate: totalRevenue > 0 ? ((totalPaid / totalRevenue) * 100).toFixed(2) + '%' : '0%'
            },
            invoiceStatus: {
                paid: paidInvoices,
                partiallyPaid: partiallyPaidInvoices,
                pending: pendingInvoices,
                overdue: overdueInvoices
            },
            revenueByProvider,
            revenueByModel
        });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});