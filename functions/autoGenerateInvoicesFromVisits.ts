import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user || user.role !== 'admin') {
            return Response.json({ error: 'Admin access required' }, { status: 403 });
        }

        // Get all completed visits that don't have an associated invoice
        const visits = await base44.entities.Visit.list();
        const invoices = await base44.entities.Invoice.list();
        const serviceCodes = await base44.entities.ServiceCode.list();

        const visitIds = new Set(invoices.flatMap(inv => inv.visit_ids));
        const completedVisitsNeedingInvoice = visits.filter(v => 
            v.status === 'completed' && !visitIds.has(v.id)
        );

        let invoicesGenerated = 0;

        for (const visit of completedVisitsNeedingInvoice) {
             // Get patient data
             const patient = await base44.entities.Patient.get(visit.patient_id);

             if (!patient) continue;

            // Determine service code from visit type or tags
            const serviceCode = serviceCodes.find(sc => 
                sc.is_active && (
                    sc.code.includes(visit.visit_type) || 
                    visit.ai_tags?.includes(`service_code_${sc.id}`)
                )
            ) || serviceCodes.find(sc => sc.is_active && sc.billing_category === 'evaluation_management');

            if (!serviceCode) continue;

            // Create invoice
            const invoiceNumber = `INV-${Date.now()}`;
            const invoiceDate = new Date().toISOString().split('T')[0];
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() + 30);

            const lineItem = {
                service_code_id: serviceCode.id,
                description: `${visit.visit_type} - ${serviceCode.name}`,
                quantity: 1,
                unit_price: serviceCode.default_price,
                amount: serviceCode.default_price
            };

            await base44.entities.Invoice.create({
                patient_id: visit.patient_id,
                visit_ids: [visit.id],
                invoice_number: invoiceNumber,
                invoice_date: invoiceDate,
                due_date: dueDate.toISOString().split('T')[0],
                total_amount: serviceCode.default_price,
                line_items: [lineItem],
                status: 'pending'
            });

            invoicesGenerated++;
        }

        return Response.json({
            success: true,
            invoices_generated: invoicesGenerated,
            visits_processed: completedVisitsNeedingInvoice.length
        });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});