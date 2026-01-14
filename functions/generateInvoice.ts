import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { patientId, visitIds, insuranceProviderId, billingModel = "fee_for_service" } = await req.json();

        if (!patientId || !visitIds || visitIds.length === 0) {
            return Response.json({ error: 'Patient ID and visit IDs required' }, { status: 400 });
        }

        // Fetch patient and visits
        const [patient, visits, serviceCodes] = await Promise.all([
            base44.entities.Patient.filter({ id: patientId }),
            base44.entities.Visit.filter({ id: { $in: visitIds } }),
            base44.entities.ServiceCode.filter({ is_active: true })
        ]);

        if (!patient || patient.length === 0) {
            return Response.json({ error: 'Patient not found' }, { status: 404 });
        }

        // Generate invoice number
        const invoiceNumber = `INV-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
        const invoiceDate = new Date().toISOString().split('T')[0];
        const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        // Build line items from visits
        const lineItems = visits.map(visit => {
            const serviceCode = serviceCodes.find(s => s.code === (visit.visit_type || 'routine_visit'));
            const price = serviceCode ? serviceCode.default_price : 150;
            return {
                service_code_id: serviceCode?.id || '',
                description: `${visit.visit_type || 'Visit'} - ${visit.visit_date}`,
                quantity: 1,
                unit_price: price,
                amount: price
            };
        });

        const totalAmount = lineItems.reduce((sum, item) => sum + item.amount, 0);

        // Create invoice
        const invoice = await base44.entities.Invoice.create({
            patient_id: patientId,
            visit_ids: visitIds,
            invoice_number: invoiceNumber,
            invoice_date: invoiceDate,
            due_date: dueDate,
            total_amount: totalAmount,
            line_items: lineItems,
            status: 'pending',
            insurance_provider_id: insuranceProviderId || '',
            billing_model: billingModel
        });

        return Response.json({
            success: true,
            invoiceId: invoice.id,
            invoiceNumber: invoiceNumber,
            totalAmount: totalAmount,
            lineItems: lineItems
        });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});