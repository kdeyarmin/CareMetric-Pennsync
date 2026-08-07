import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// Tolerant JSON extractor: we ask for strict JSON in-prompt instead of passing
// response_json_schema, because the provider rejects deeply-nested object
// schemas that lack an explicit `required` array at every level.
function parseLLMJson(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  const text = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    const { nurse_email, date_range_days = 30 } = await req.json();

    // Admins can view another nurse; nurses can only view themselves.
    // Facility admins with an agency are agency-scoped (parity with
    // generatePersonalizedLearningPath); only super_admin / admin-without-agency
    // stay platform-wide.
    const isSuperAdmin = user.account_type === 'super_admin';
    const isAgencyScopedAdmin =
      user.account_type === 'agency_admin'
      || (user.role === 'admin' && !!user.agency_name && !isSuperAdmin);
    const isPlatformAdmin = isSuperAdmin || (user.role === 'admin' && !user.agency_name);
    let targetEmail = user.email;
    if (nurse_email && nurse_email !== user.email && (isPlatformAdmin || isAgencyScopedAdmin)) {
      if (isPlatformAdmin) {
        targetEmail = nurse_email;
      } else {
        const [target] = await base44.asServiceRole.entities.User.filter({ email: nurse_email }, '-created_date', 1);
        if (!target || !user.agency_name || target.agency_name !== user.agency_name) {
          return Response.json({ error: 'Forbidden' }, { status: 403 });
        }
        targetEmail = nurse_email;
      }
    }
    
    const dateThreshold = new Date();
    dateThreshold.setDate(dateThreshold.getDate() - date_range_days);

    // Fetch all relevant data
    // Note: patient counts are derived from this nurse's visits below, so we do
    // NOT bulk-read the whole Patient table (a needless 5000-record PHI fetch
    // that was fetched and never used).
    const [activities, recommendations, audits, visits, incidents] = await Promise.all([
      base44.asServiceRole.entities.UserActivity.filter({ user_email: targetEmail }, '-created_date', 5000),
      base44.asServiceRole.entities.TrainingRecommendation.filter({ nurse_email: targetEmail }, '-created_date', 5000),
      base44.asServiceRole.entities.ComplianceAudit.filter({ nurse_email: targetEmail }, '-created_date', 5000),
      base44.asServiceRole.entities.Visit.filter({ created_by: targetEmail }, '-created_date', 5000),
      base44.asServiceRole.entities.Incident.list('-created_date', 5000)
    ]);

    // Calculate metrics
    const metrics = {
      // Overall activity
      total_activities: activities.length,
      activities_last_30_days: activities.filter(a => new Date(a.created_date) >= dateThreshold).length,
      
      // Visit metrics
      total_visits: visits.length,
      completed_visits: visits.filter(v => v.status === 'completed').length,
      avg_visit_duration: 0,
      visits_by_type: {},
      
      // Documentation metrics
      template_usage: activities.filter(a => a.action === 'template_generated').length,
      voice_command_usage: activities.filter(a => a.action === 'voice_command_used').length,
      ai_scribe_usage: activities.filter(a => a.action === 'ai_scribe_used').length,
      avg_documentation_time: 0,
      avg_word_count: 0,
      
      // AI assistance metrics
      total_suggestions_received: recommendations.length,
      suggestions_applied: recommendations.filter(r => r.addressed).length,
      suggestion_acceptance_rate: 0,
      suggestions_by_source: {},
      suggestions_by_type: {},
      
      // Compliance metrics
      total_audits: audits.length,
      avg_compliance_score: 0,
      passed_audits: audits.filter(a => a.status === 'passed').length,
      flagged_audits: audits.filter(a => a.status === 'flagged').length,
      critical_audits: audits.filter(a => a.status === 'critical').length,
      
      // Quality trends
      compliance_trend: [],
      productivity_trend: [],
      ai_adoption_trend: []
    };

    // Calculate visit duration
    const visitsWithDuration = visits.filter(v => v.start_time && v.end_time);
    if (visitsWithDuration.length > 0) {
      const totalMinutes = visitsWithDuration.reduce((sum, v) => {
        const start = new Date(`2000-01-01T${v.start_time}`);
        const end = new Date(`2000-01-01T${v.end_time}`);
        let minutes = (end - start) / (1000 * 60);
        // An overnight visit (e.g. 22:00 → 01:00) would otherwise contribute a
        // large negative duration and drag the average below zero. Wrap past
        // midnight rather than counting it as negative time.
        if (minutes < 0) minutes += 24 * 60;
        return sum + minutes;
      }, 0);
      metrics.avg_visit_duration = Math.round(totalMinutes / visitsWithDuration.length);
    }

    // Visits by type
    visits.forEach(v => {
      metrics.visits_by_type[v.visit_type] = (metrics.visits_by_type[v.visit_type] || 0) + 1;
    });

    // Documentation time - calculate from visit start_time and end_time for completed visits
    const completedVisitsWithTime = visits.filter(v => 
      v.status === 'completed' && v.start_time && v.end_time
    );
    
    if (completedVisitsWithTime.length > 0) {
      const totalDocMinutes = completedVisitsWithTime.reduce((sum, v) => {
        try {
          const start = new Date(`2000-01-01T${v.start_time}`);
          const end = new Date(`2000-01-01T${v.end_time}`);
          const minutes = (end - start) / (1000 * 60);
          return sum + (minutes > 0 ? minutes : 0);
        } catch (e) {
          return sum;
        }
      }, 0);
      metrics.avg_documentation_time = Math.round(totalDocMinutes / completedVisitsWithTime.length);
    }
    
    // Also check activities for documentation time if available
    const docActivities = activities.filter(a => a.action === 'visit_completed' && a.details?.documentation_time_minutes);
    if (docActivities.length > 0 && metrics.avg_documentation_time === 0) {
      metrics.avg_documentation_time = Math.round(
        docActivities.reduce((sum, a) => sum + (a.details.documentation_time_minutes || 0), 0) / docActivities.length
      );
    }
    
    // Word count from activities
    if (docActivities.length > 0) {
      metrics.avg_word_count = Math.round(
        docActivities.reduce((sum, a) => sum + (a.details.word_count || 0), 0) / docActivities.length
      );
    }

    // Suggestion acceptance rate
    if (recommendations.length > 0) {
      metrics.suggestion_acceptance_rate = Math.round((metrics.suggestions_applied / recommendations.length) * 100);
    }

    // Suggestions by source and type
    recommendations.forEach(r => {
      metrics.suggestions_by_source[r.source] = (metrics.suggestions_by_source[r.source] || 0) + 1;
      metrics.suggestions_by_type[r.recommendation_type] = (metrics.suggestions_by_type[r.recommendation_type] || 0) + 1;
    });

    // Compliance score
    if (audits.length > 0) {
      metrics.avg_compliance_score = Math.round(
        audits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / audits.length
      );
    }

    // Trends (last 30 days, grouped by week)
    const weeks = 4;
    for (let i = 0; i < weeks; i++) {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - ((i + 1) * 7));
      const weekEnd = new Date();
      weekEnd.setDate(weekEnd.getDate() - (i * 7));

      const weekAudits = audits.filter(a => {
        const date = new Date(a.created_date);
        return date >= weekStart && date < weekEnd;
      });

      const weekActivities = activities.filter(a => {
        const date = new Date(a.created_date);
        return date >= weekStart && date < weekEnd;
      });

      metrics.compliance_trend.unshift({
        week: `Week ${weeks - i}`,
        score: weekAudits.length > 0 
          ? Math.round(weekAudits.reduce((s, a) => s + (a.compliance_score || 0), 0) / weekAudits.length)
          : 0
      });

      metrics.productivity_trend.unshift({
        week: `Week ${weeks - i}`,
        visits: weekActivities.filter(a => a.action === 'visit_completed').length
      });

      metrics.ai_adoption_trend.unshift({
        week: `Week ${weeks - i}`,
        usage: weekActivities.filter(a => 
          a.action === 'ai_scribe_used' || 
          a.action === 'template_generated' ||
          a.action === 'voice_command_used'
        ).length
      });
    }

    // AI-generated insights and recommendations
    const analysisPrompt = `You are a nursing performance analyst. Analyze the following performance data for nurse ${targetEmail} and provide:

1. Key Strengths (2-3 specific strengths based on data)
2. Areas for Improvement (2-3 specific areas with concrete suggestions)
3. Personalized Training Recommendations (3-5 specific training topics)
4. Risk Factors (any concerning patterns)
5. Overall Performance Summary (2-3 sentences)

DATA:
- Total Visits: ${metrics.total_visits} (${metrics.completed_visits} completed)
- Avg Compliance Score: ${metrics.avg_compliance_score}%
- AI Suggestion Acceptance Rate: ${metrics.suggestion_acceptance_rate}%
- Suggestions Received: ${metrics.total_suggestions_received}
- Compliance Issues: ${metrics.flagged_audits} flagged, ${metrics.critical_audits} critical
- Template Usage: ${metrics.template_usage} times
- AI Scribe Usage: ${metrics.ai_scribe_usage} times
- Voice Commands: ${metrics.voice_command_usage} times
- Avg Documentation Time: ${metrics.avg_documentation_time} minutes
- Visit Types: ${JSON.stringify(metrics.visits_by_type)}

SUGGESTION BREAKDOWN BY SOURCE:
${JSON.stringify(metrics.suggestions_by_source, null, 2)}

SUGGESTION BREAKDOWN BY TYPE:
${JSON.stringify(metrics.suggestions_by_type, null, 2)}

Recent Unaddressed Recommendations (sample):
${recommendations.filter(r => !r.addressed).slice(0, 5).map(r => `- ${r.recommendation_type}: ${r.recommendation_text.substring(0, 100)}`).join('\n')}

Provide actionable, specific insights. Be constructive and focus on growth opportunities.

Return ONLY valid JSON, no prose or code fences, with this shape:
{"strengths":[""],"areas_for_improvement":[{"area":"","suggestion":"","priority":""}],"training_recommendations":[{"topic":"","reason":"","urgency":""}],"risk_factors":[""],"overall_summary":"","performance_grade":""}`;

    const insights = parseLLMJson(await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: analysisPrompt
    })) || {};

    // Calculate skill gaps
    const skillGaps = [];
    
    // Low compliance = documentation training needed
    if (metrics.avg_compliance_score < 85) {
      skillGaps.push({
        skill: 'Medicare Documentation Compliance',
        current_level: 'needs_improvement',
        gap_severity: 'high',
        recommendation: 'Complete Medicare documentation training modules'
      });
    }

    // Low suggestion acceptance = may not understand best practices
    if (metrics.suggestion_acceptance_rate < 50 && recommendations.length > 10) {
      skillGaps.push({
        skill: 'AI-Assisted Documentation',
        current_level: 'needs_improvement',
        gap_severity: 'medium',
        recommendation: 'Review AI suggestions more carefully and leverage tools'
      });
    }

    // Low template usage = efficiency opportunity
    if (metrics.template_usage < metrics.completed_visits * 0.3 && metrics.completed_visits > 5) {
      skillGaps.push({
        skill: 'Documentation Efficiency',
        current_level: 'needs_improvement',
        gap_severity: 'medium',
        recommendation: 'Use smart templates to improve efficiency'
      });
    }

    // High documentation time = efficiency issue
    if (metrics.avg_documentation_time > 30) {
      skillGaps.push({
        skill: 'Time Management',
        current_level: 'needs_improvement',
        gap_severity: 'medium',
        recommendation: 'Use voice dictation and AI scribe to reduce documentation time'
      });
    }

    // Calculate documentation quality metrics
    const docQualityMetrics = {
      total_notes: visits.filter(v => v.nurse_notes).length,
      avg_note_length: 0,
      notes_with_vitals: visits.filter(v => v.vital_signs && Object.keys(v.vital_signs).length > 0).length,
      notes_with_tags: visits.filter(v => v.ai_tags && v.ai_tags.length > 0).length,
      critical_issues: audits.filter(a => a.status === 'critical').length,
      flagged_issues: audits.filter(a => a.status === 'flagged').length
    };

    const notesWithContent = visits.filter(v => v.nurse_notes);
    if (notesWithContent.length > 0) {
      docQualityMetrics.avg_note_length = Math.round(
        notesWithContent.reduce((sum, v) => sum + (v.nurse_notes?.length || 0), 0) / notesWithContent.length
      );
    }

    // Calculate patient outcomes
    const nursePatientIds = [...new Set(visits.map(v => v.patient_id))];

    // "incidents_reported" = incidents this nurse actually reported. The old
    // visit_id join was always empty (writers don't set visit_id); attribute by
    // created_by (the reporter) — NOT by patient, which would count every incident
    // on a shared patient against every nurse who ever visited them.
    const nurseIncidents = incidents.filter(i =>
      i.created_by === targetEmail ||
      (i.visit_id && visits.some(v => v.id === i.visit_id))
    );

    const patientOutcomes = {
      total_patients: nursePatientIds.length,
      incidents_reported: nurseIncidents.length,
      high_severity_incidents: nurseIncidents.filter(i => i.severity === 'high').length
    };

    // Calculate utilization rates
    const last30DaysDate = new Date(dateThreshold);
    const recentVisits = visits.filter(v => new Date(v.visit_date) >= last30DaysDate);
    const workingDays = 22; // Approximate working days in 30 days
    const avgVisitsPerDay = recentVisits.length / workingDays;
    
    const utilizationMetrics = {
      visits_last_30_days: recentVisits.length,
      avg_visits_per_day: Math.round(avgVisitsPerDay * 10) / 10,
      productive_hours: Math.round((visitsWithDuration.length * metrics.avg_visit_duration) / 60),
      patients_managed: nursePatientIds.length,
      utilization_rate: Math.min(Math.round((avgVisitsPerDay / 6) * 100), 100) // Assuming 6 visits/day is 100%
    };

    // Predict burnout risk using AI
    const burnoutPrompt = `Analyze the following nurse workload and performance data to assess burnout risk:

WORKLOAD DATA (Last ${date_range_days} days):
- Total Visits: ${metrics.total_visits}
- Avg Visits/Day: ${utilizationMetrics.avg_visits_per_day}
- Documentation Time: ${metrics.avg_documentation_time} min/visit
- After-hours Activity: ${activities.filter(a => {
  const hour = new Date(a.created_date).getHours();
  return hour < 7 || hour > 19;
}).length} actions

PERFORMANCE TRENDS:
- Compliance Score: ${metrics.avg_compliance_score}%
- Documentation Issues: ${docQualityMetrics.critical_issues} critical, ${docQualityMetrics.flagged_issues} flagged
- Incidents: ${patientOutcomes.incidents_reported} (${patientOutcomes.high_severity_incidents} high severity)
- AI Tool Usage: ${metrics.suggestion_acceptance_rate}% acceptance rate

QUALITY INDICATORS:
- Template Usage: ${metrics.template_usage} times
- Unaddressed Recommendations: ${recommendations.filter(r => !r.addressed).length}

Assess burnout risk (low/moderate/high) and provide specific warning signs and recommendations.

Return ONLY valid JSON, no prose or code fences, with this shape:
{"risk_level":"low|moderate|high|critical","risk_score":0,"warning_signs":[""],"contributing_factors":[""],"recommendations":[""],"positive_indicators":[""]}`;

    const burnoutAnalysis = parseLLMJson(await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: burnoutPrompt
    })) || {};

    return Response.json({
      success: true,
      nurse_email: targetEmail,
      metrics,
      insights,
      skill_gaps: skillGaps,
      recent_recommendations: recommendations.filter(r => !r.addressed).slice(0, 10),
      recent_activities: activities.slice(0, 20),
      documentation_quality: docQualityMetrics,
      patient_outcomes: patientOutcomes,
      utilization: utilizationMetrics,
      burnout_risk: burnoutAnalysis
    });

  } catch (error) {
    console.error('Error analyzing nurse performance:', error);
    return Response.json({ 
      error: 'Internal server error',
    }, { status: 500 });
  }
});