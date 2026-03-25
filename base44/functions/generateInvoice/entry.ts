import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { jsPDF } from 'npm:jspdf@2.5.2';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { billing_id } = await req.json();

    if (!billing_id) {
      return Response.json({ 
        success: false, 
        error: 'Billing ID required' 
      }, { status: 400 });
    }

    // Get billing record
    const billing = await base44.entities.Billing.get(billing_id);
    const patient = await base44.entities.Patient.get(billing.patient_id);

    // Get agency settings
    let agencyInfo = {
      name: 'CareMetric AI Home Health',
      address: '123 Healthcare Ave',
      phone: '(555) 123-4567',
      tax_id: 'XX-XXXXXXX'
    };

    try {
      const settings = await base44.asServiceRole.entities.AgencySettings.filter({});
      if (settings[0]) {
        agencyInfo = {
          name: settings[0].agency_name || agencyInfo.name,
          address: settings[0].agency_address || agencyInfo.address,
          phone: settings[0].agency_phone || agencyInfo.phone,
          tax_id: settings[0].tax_id || agencyInfo.tax_id
        };
      }
    } catch (err) {
      console.log('Using default agency info');
    }

    // Create PDF
    const doc = new jsPDF();

    // Header
    doc.setFontSize(20);
    doc.text(agencyInfo.name, 20, 20);
    doc.setFontSize(10);
    doc.text(agencyInfo.address, 20, 28);
    doc.text(agencyInfo.phone, 20, 33);
    doc.text(`Tax ID: ${agencyInfo.tax_id}`, 20, 38);

    // Invoice title
    doc.setFontSize(16);
    doc.text('INVOICE', 150, 20);
    doc.setFontSize(10);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 150, 28);
    if (billing.claim_number) {
      doc.text(`Claim #: ${billing.claim_number}`, 150, 33);
    }

    // Patient info
    doc.setFontSize(12);
    doc.text('Bill To:', 20, 55);
    doc.setFontSize(10);
    doc.text(patient.full_name || 'N/A', 20, 62);
    if (patient.address) doc.text(patient.address, 20, 67);
    if (patient.phone) doc.text(patient.phone, 20, 72);

    // Service period
    doc.text(`Service Period: ${new Date(billing.billing_period_start).toLocaleDateString()} - ${new Date(billing.billing_period_end).toLocaleDateString()}`, 20, 85);

    // Table header
    let y = 100;
    doc.setFillColor(59, 130, 246);
    doc.rect(20, y, 170, 10, 'F');
    doc.setTextColor(255, 255, 255);
    doc.text('Service', 25, y + 7);
    doc.text('Visits', 100, y + 7);
    doc.text('Rate', 130, y + 7);
    doc.text('Amount', 160, y + 7);

    // Table rows
    doc.setTextColor(0, 0, 0);
    y += 15;

    const services = [
      { name: 'RN Visits', visits: billing.rn_visits || 0 },
      { name: 'LPN Visits', visits: billing.lpn_visits || 0 },
      { name: 'PT Visits', visits: billing.pt_visits || 0 },
      { name: 'OT Visits', visits: billing.ot_visits || 0 },
      { name: 'ST Visits', visits: billing.st_visits || 0 },
      { name: 'HHA Visits', visits: billing.hha_visits || 0 },
      { name: 'MSW Visits', visits: billing.msw_visits || 0 }
    ];

    const rate = billing.revenue_per_visit || 175;
    let subtotal = 0;

    services.forEach(service => {
      if (service.visits > 0) {
        const amount = service.visits * rate;
        subtotal += amount;
        
        doc.text(service.name, 25, y);
        doc.text(service.visits.toString(), 100, y);
        doc.text(`$${rate.toFixed(2)}`, 130, y);
        doc.text(`$${amount.toFixed(2)}`, 160, y);
        y += 7;
      }
    });

    // Totals
    y += 10;
    doc.setDrawColor(200, 200, 200);
    doc.line(20, y, 190, y);
    y += 7;

    doc.text('Subtotal:', 130, y);
    doc.text(`$${subtotal.toFixed(2)}`, 160, y);
    y += 7;

    if (billing.adjustments && billing.adjustments.length > 0) {
      billing.adjustments.forEach(adj => {
        doc.text(`${adj.type}:`, 130, y);
        doc.text(`$${adj.amount.toFixed(2)}`, 160, y);
        y += 7;
      });
    }

    y += 3;
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text('Total:', 130, y);
    doc.text(`$${(billing.total_billed || subtotal).toFixed(2)}`, 160, y);

    // Payment info
    y += 15;
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    
    if (billing.total_paid > 0) {
      doc.text(`Amount Paid: $${billing.total_paid.toFixed(2)}`, 20, y);
      y += 7;
      doc.text(`Outstanding Balance: $${(billing.outstanding_balance || 0).toFixed(2)}`, 20, y);
    }

    // Footer
    doc.setFontSize(8);
    doc.text('Thank you for your business!', 20, 280);
    doc.text('Please remit payment within 30 days.', 20, 285);

    // Convert to blob
    const pdfBlob = doc.output('blob');
    const arrayBuffer = await pdfBlob.arrayBuffer();

    return new Response(arrayBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename=invoice_${billing_id}.pdf`
      }
    });

  } catch (error) {
    console.error('Generate invoice error:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});