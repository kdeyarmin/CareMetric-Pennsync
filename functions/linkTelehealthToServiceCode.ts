import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { visitId, serviceCodeId, quantity = 1 } = await req.json();

        if (!visitId || !serviceCodeId) {
            return Response.json({ error: 'Visit ID and service code ID required' }, { status: 400 });
        }

        // Fetch visit and service code
        const [visits, serviceCodes] = await Promise.all([
            base44.entities.Visit.filter({ id: visitId }),
            base44.entities.ServiceCode.filter({ id: serviceCodeId })
        ]);

        const visit = visits[0];
        const serviceCode = serviceCodes[0];

        if (!visit || !serviceCode) {
            return Response.json({ error: 'Visit or service code not found' }, { status: 404 });
        }

        // Create invoice line item for this telehealth visit
        const invoiceLineItem = {
            service_code_id: serviceCodeId,
            description: `Telehealth Visit - ${serviceCode.name}`,
            quantity: quantity,
            unit_price: serviceCode.default_price,
            amount: serviceCode.default_price * quantity
        };

        // Update visit with service code reference
        const updatedVisit = {
            ...visit,
            ai_tags: [...(visit.ai_tags || []), 'telehealth', `service_code_${serviceCodeId}`]
        };

        await base44.entities.Visit.update(visitId, updatedVisit);

        return Response.json({
            success: true,
            lineItem: invoiceLineItem,
            message: 'Service code linked to telehealth visit'
        });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});