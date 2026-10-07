import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Returns only the signed-in clinician's own upcoming telehealth sessions.
// Scoped server-side by the authenticated email; no caller input is trusted.
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const page = await base44.asServiceRole.entities.TelehealthSession.filter(
    {
      host_email: user.email,
      status: { $in: ['scheduled', 'active'] },
      scheduled_at: { $gte: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
    },
    { sort: 'scheduled_at', limit: 5, fields: ['patient_name', 'scheduled_at', 'status', 'visit_type'] },
  );

  return Response.json({ sessions: page.items || [] });
});