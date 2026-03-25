import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Fetch audit data
    const allAudits = await base44.entities.ComplianceAudit.list('-audit_date', 200);
    
    // Fetch incident data
    const allIncidents = await base44.entities.Incident.list('-incident_date', 200);

    // Fetch alerts
    const allAlerts = await base44.entities.PatientAlert.list('-created_date', 100);

    // Analyze patterns
    const riskAnalysis = {
      audit_summary: {
        total_audits: allAudits.length,
        flagged_audits: allAudits.filter(a => a.status === 'flagged' || a.status === 'critical').length,
        critical_audits: allAudits.filter(a => a.status === 'critical').length,
        average_compliance_score: allAudits.filter(a => a.compliance_score).length > 0
          ? (allAudits.filter(a => a.compliance_score).reduce((sum, a) => sum + a.compliance_score, 0) / allAudits.filter(a => a.compliance_score).length).toFixed(1)
          : 'N/A',
        trend: allAudits.length >= 2
          ? ((allAudits.slice(0, 5).reduce((sum, a) => sum + (a.compliance_score || 0), 0) / 5) -
             (allAudits.slice(5, 10).reduce((sum, a) => sum + (a.compliance_score || 0), 0) / Math.min(5, allAudits.slice(5, 10).length)) > 0 ? 'improving' : 'declining')
          : 'insufficient_data',
        common_issues: Object.entries(
          allAudits.filter(a => a.flagged_issues).reduce((acc, a) => {
            (a.flagged_issues || []).forEach(issue => {
              acc[issue] = (acc[issue] || 0) + 1;
            });
            return acc;
          }, {})
        ).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([issue, count]) => ({ issue, count }))
      },
      incident_summary: {
        total_incidents: allIncidents.length,
        high_severity: allIncidents.filter(i => i.severity === 'high').length,
        medium_severity: allIncidents.filter(i => i.severity === 'medium').length,
        incident_types: Object.entries(
          allIncidents.reduce((acc, i) => {
            acc[i.incident_type] = (acc[i.incident_type] || 0) + 1;
            return acc;
          }, {})
        ).map(([type, count]) => ({ type, count })),
        recent_incidents: allIncidents.slice(0, 5).map(i => ({
          type: i.incident_type,
          severity: i.severity,
          date: i.incident_date,
          status: i.status
        }))
      },
      alert_summary: {
        total_active_alerts: allAlerts.filter(a => a.status === 'active').length,
        critical_alerts: allAlerts.filter(a => a.status === 'active' && a.severity === 'critical').length,
        high_alerts: allAlerts.filter(a => a.status === 'active' && a.severity === 'high').length,
        alert_types: Object.entries(
          allAlerts.reduce((acc, a) => {
            acc[a.alert_type] = (acc[a.alert_type] || 0) + 1;
            return acc;
          }, {})
        ).map(([type, count]) => ({ type, count }))
      }
    };

    // Use AI to identify risks and patterns
    const response = await base44.integrations.Core.InvokeLLM({
      prompt: `Analyze this compliance and incident data to identify risks, patterns, and critical areas needing attention:

${JSON.stringify(riskAnalysis, null, 2)}

Based on this analysis, provide:
1. Critical compliance risks requiring immediate action
2. Recurring patterns or systemic issues
3. Areas with declining performance
4. High-risk incident categories
5. Recommendations to prevent future incidents
6. Priority areas for staff training or policy changes
7. Risk severity assessment

Format as JSON with keys: critical_risks, recurring_patterns, declining_areas, high_risk_categories, prevention_recommendations, training_priorities, risk_severity, action_items`,
      response_json_schema: {
        type: 'object',
        properties: {
          critical_risks: { type: 'array', items: { type: 'string' } },
          recurring_patterns: { type: 'array', items: { type: 'string' } },
          declining_areas: { type: 'array', items: { type: 'string' } },
          high_risk_categories: { type: 'array', items: { type: 'string' } },
          prevention_recommendations: { type: 'array', items: { type: 'string' } },
          training_priorities: { type: 'array', items: { type: 'string' } },
          risk_severity: {
            type: 'object',
            properties: {
              overall: { type: 'string' },
              compliance: { type: 'string' },
              incidents: { type: 'string' },
              alerts: { type: 'string' }
            }
          },
          action_items: { type: 'array', items: { type: 'string' } }
        }
      }
    });

    return Response.json({
      analysis: riskAnalysis,
      ai_insights: response,
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error detecting compliance risks:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});