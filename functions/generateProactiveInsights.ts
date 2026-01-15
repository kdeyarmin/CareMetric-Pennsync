import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Fetch user's recent data for insights
    const [patients, visits, alerts] = await Promise.all([
      base44.entities.Patient.filter({ created_by: user.email }, '-updated_date', 10),
      base44.entities.Visit.filter({ created_by: user.email }, '-visit_date', 20),
      base44.entities.PatientAlert.filter({ created_by: user.email }, '-created_date', 10)
    ]);

    const insights = [];

    // Insight 1: Active alerts
    const activeAlerts = alerts.filter(a => a.status === 'active' || a.status === 'acknowledged');
    if (activeAlerts.length > 0) {
      insights.push({
        type: 'warning',
        title: `${activeAlerts.length} Active Alerts`,
        description: `You have ${activeAlerts.length} patient alert(s) requiring attention. Review them to ensure timely interventions.`
      });
    }

    // Insight 2: Documentation activity
    const recentVisits = visits.filter(v => {
      const visitDate = new Date(v.visit_date);
      const dayAgo = new Date();
      dayAgo.setDate(dayAgo.getDate() - 1);
      return visitDate > dayAgo;
    });
    if (recentVisits.length > 0) {
      insights.push({
        type: 'trending',
        title: 'Recent Documentation Activity',
        description: `You've documented ${recentVisits.length} visit(s) in the last 24 hours. Great job staying current!`
      });
    }

    // Insight 3: Patient roster
    if (patients.length > 0) {
      const avgVisitsPerPatient = visits.length / patients.length;
      insights.push({
        type: 'clinical',
        title: 'Patient Overview',
        description: `Managing ${patients.length} patient(s) with an average of ${avgVisitsPerPatient.toFixed(1)} visit(s) per patient.`
      });
    }

    // Insight 4: Upcoming opportunities
    if (visits.length < 5) {
      insights.push({
        type: 'trending',
        title: 'Documentation Opportunities',
        description: 'You have less documentation this week. Consider using AI assistance to streamline your workflow.'
      });
    }

    return new Response(
      JSON.stringify({ insights }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error generating insights:', error);
    return new Response(
      JSON.stringify({ error: error.message, insights: [] }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});