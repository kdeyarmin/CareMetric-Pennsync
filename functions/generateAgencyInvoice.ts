import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { format, startOfMonth, endOfMonth, addDays } from 'npm:date-fns@3.6.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized - Admin only' }, { status: 403 });
    }

    const { agency_id, billing_date } = await req.json();

    if (!agency_id) {
      return Response.json({ error: 'agency_id required' }, { status: 400 });
    }

    // Get agency
    const agency = await base44.asServiceRole.entities.Agency.get(agency_id);
    if (!agency) {
      return Response.json({ error: 'Agency not found' }, { status: 404 });
    }

    // Determine billing period
    const periodDate = billing_date ? new Date(billing_date) : new Date();
    const periodStart = startOfMonth(periodDate);
    const periodEnd = endOfMonth(periodDate);

    // Get all users in agency during this period
    const allUsers = await base44.asServiceRole.entities.User.list();
    const agencyUsers = allUsers.filter(u => u.agency_code === agency.agency_code);
    const userCount = agencyUsers.length;

    // Calculate amounts
    const pricePerUser = agency.price_per_user || 29.99;
    const subtotal = userCount * pricePerUser;
    const taxAmount = 0; // Add tax calculation if needed
    const totalAmount = subtotal + taxAmount;

    // Generate unique invoice number
    const invoiceNumber = `INV-${agency.agency_code}-${format(periodDate, 'yyyyMM')}-${Date.now().toString().slice(-4)}`;

    // Build line items
    const lineItems = [
      {
        description: `${agency.package_name || 'CareMetric AI'} Subscription`,
        quantity: userCount,
        unit_price: pricePerUser,
        total: subtotal
      }
    ];

    // Add feature breakdown if available
    if (agency.enabled_features && agency.enabled_features.length > 0) {
      lineItems.push({
        description: `Features Included: ${agency.enabled_features.join(', ')}`,
        quantity: 1,
        unit_price: 0,
        total: 0
      });
    }

    // Create invoice
    const invoice = await base44.asServiceRole.entities.AgencyInvoice.create({
      agency_code: agency.agency_code,
      invoice_number: invoiceNumber,
      billing_period_start: format(periodStart, 'yyyy-MM-dd'),
      billing_period_end: format(periodEnd, 'yyyy-MM-dd'),
      user_count: userCount,
      package_name: agency.package_name || 'Custom Package',
      price_per_user: pricePerUser,
      line_items: lineItems,
      subtotal: subtotal,
      tax_amount: taxAmount,
      total_amount: totalAmount,
      status: 'draft',
      due_date: format(addDays(periodEnd, 15), 'yyyy-MM-dd'),
      notes: `Billing period: ${format(periodStart, 'MMM d')} - ${format(periodEnd, 'MMM d, yyyy')}`
    });

    console.log('Generated invoice:', {
      invoice_number: invoiceNumber,
      agency: agency.agency_name,
      amount: totalAmount
    });

    return Response.json({
      success: true,
      invoice: invoice,
      summary: {
        invoice_number: invoiceNumber,
        agency_name: agency.agency_name,
        billing_period: `${format(periodStart, 'MMM d')} - ${format(periodEnd, 'MMM d, yyyy')}`,
        user_count: userCount,
        price_per_user: pricePerUser,
        total_amount: totalAmount
      }
    });

  } catch (error) {
    console.error('Generate invoice error:', error);
    return Response.json({ 
      error: error.message 
    }, { status: 500 });
  }
});