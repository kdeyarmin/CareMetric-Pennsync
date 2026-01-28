import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { visit_id } = await req.json();

    if (!visit_id) {
      return Response.json({ error: 'Visit ID is required' }, { status: 400 });
    }

    // Get visit details
    const visit = await base44.entities.Visit.get(visit_id);

    if (!visit) {
      return Response.json({ error: 'Visit not found' }, { status: 404 });
    }

    // Get patient
    const patient = await base44.entities.Patient.get(visit.patient_id);

    // Use AI to generate invoice line items based on visit
    const prompt = `Based on the following home health visit, generate appropriate invoice line items with service codes and pricing:

Visit Type: ${visit.visit_type}
Visit Date: ${visit.visit_date}
Visit Notes: ${visit.nurse_notes || 'N/A'}
Vital Signs: ${JSON.stringify(visit.vital_signs || {})}

Generate 1-3 line items with:
- Description (specific service provided)
- Service Code (CPT code if applicable, e.g., 99345 for home visit)
- Quantity (typically 1)
- Unit Price (reasonable market rate for home health services)

Return JSON array of line items.`;

    const aiResponse = await base44.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: "object",
        properties: {
          line_items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                description: { type: "string" },
                service_code: { type: "string" },
                quantity: { type: "number" },
                unit_price: { type: "number" }
              }
            }
          }
        }
      }
    });

    const lineItems = aiResponse.line_items.map(item => ({
      ...item,
      total: item.quantity * item.unit_price
    }));

    const subtotal = lineItems.reduce((sum, item) => sum + item.total, 0);
    const tax_rate = 0; // Adjust based on jurisdiction
    const tax_amount = subtotal * (tax_rate / 100);
    const total_amount = subtotal + tax_amount;

    // Generate invoice number
    const invoice_number = `INV-${Date.now()}`;

    // Set due date (30 days from now)
    const due_date = new Date();
    due_date.setDate(due_date.getDate() + 30);

    // Create invoice
    const invoice = await base44.entities.Invoice.create({
      invoice_number,
      patient_id: visit.patient_id,
      provider_email: visit.created_by || user.email,
      invoice_date: new Date().toISOString().split('T')[0],
      due_date: due_date.toISOString().split('T')[0],
      service_date: visit.visit_date,
      line_items: lineItems,
      subtotal,
      tax_rate,
      tax_amount,
      total_amount,
      balance_due: total_amount,
      status: 'draft',
      payment_terms: 'Net 30',
      notes: `Auto-generated from visit on ${visit.visit_date}`
    });

    return Response.json({
      success: true,
      invoice,
      message: 'Invoice generated successfully'
    });

  } catch (error) {
    console.error('Error generating invoice:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});