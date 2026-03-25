import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized - Admin only' }, { status: 403 });
    }

    // Get all agencies
    const agencies = await base44.asServiceRole.entities.Agency.list();
    const allUsers = await base44.asServiceRole.entities.User.list();

    const updates = [];

    for (const agency of agencies) {
      const agencyUsers = allUsers.filter(u => u.agency_code === agency.agency_code);
      
      await base44.asServiceRole.entities.Agency.update(agency.id, {
        current_user_count: agencyUsers.length
      });

      updates.push({
        agency: agency.agency_name,
        code: agency.agency_code,
        users: agencyUsers.length,
        monthly_bill: agencyUsers.length * (agency.price_per_user || 29.99)
      });
    }

    return Response.json({
      success: true,
      message: `Updated ${agencies.length} agencies`,
      updates
    });

  } catch (error) {
    console.error('Update agency counts error:', error);
    return Response.json({ 
      error: error.message 
    }, { status: 500 });
  }
});