import { base44 } from "@/api/base44Client";

/**
 * Comprehensive Patient History Analyzer
 * Aggregates and analyzes patient history for AI context enrichment
 */

export async function buildComprehensivePatientHistory(patientId) {
  try {
    const [patient, visits, carePlans, incidents, alerts, tasks] = await Promise.all([
      base44.entities.Patient.filter({ id: patientId }).then(data => data[0]),
      base44.entities.Visit.filter({ patient_id: patientId }, '-visit_date', 20),
      base44.entities.CarePlan.filter({ patient_id: patientId }),
      base44.entities.Incident.filter({ patient_id: patientId }, '-incident_date', 10),
      base44.entities.PatientAlert.filter({ patient_id: patientId, status: 'active' }),
      base44.entities.Task.filter({ patient_id: patientId, status: { $ne: 'completed' } })
    ]);

    return {
      patient,
      visits,
      carePlans,
      incidents,
      alerts,
      tasks,
      trends: analyzePatientTrends(patient, visits, carePlans),
      continuityInsights: generateContinuityInsights(visits, carePlans, incidents)
    };
  } catch (error) {
    console.error('Error building patient history:', error);
    return null;
  }
}

/**
 * Analyze trends in patient data over time
 */
function analyzePatientTrends(patient, visits, carePlans) {
  const trends = {
    vital_trends: {},
    visit_frequency: {},
    care_plan_progress: {},
    clinical_changes: []
  };

  // Vital signs trends
  if (visits?.length > 0) {
    const vitalsOverTime = visits
      .filter(v => v.vital_signs)
      .map(v => ({
        date: v.visit_date,
        vitals: v.vital_signs
      }));

    if (vitalsOverTime.length >= 2) {
      const latest = vitalsOverTime[0]?.vitals;
      const baseline = patient.baseline_vitals;
      
      // Compare latest to baseline
      if (latest && baseline) {
        if (latest.blood_pressure_systolic && baseline.blood_pressure_systolic) {
          const bpChange = latest.blood_pressure_systolic - baseline.blood_pressure_systolic;
          trends.vital_trends.blood_pressure = {
            trend: bpChange > 10 ? 'increasing' : bpChange < -10 ? 'decreasing' : 'stable',
            change: bpChange,
            concern: Math.abs(bpChange) > 20
          };
        }
        
        if (latest.heart_rate && baseline.heart_rate) {
          const hrChange = latest.heart_rate - baseline.heart_rate;
          trends.vital_trends.heart_rate = {
            trend: hrChange > 10 ? 'increasing' : hrChange < -10 ? 'decreasing' : 'stable',
            change: hrChange,
            concern: Math.abs(hrChange) > 15
          };
        }

        if (latest.oxygen_saturation && baseline.oxygen_saturation) {
          const o2Change = latest.oxygen_saturation - baseline.oxygen_saturation;
          trends.vital_trends.oxygen_saturation = {
            trend: o2Change < -3 ? 'declining' : o2Change > 3 ? 'improving' : 'stable',
            change: o2Change,
            concern: o2Change < -5
          };
        }
      }
    }

    // Visit frequency analysis
    const recentVisits = visits.slice(0, 5);
    if (recentVisits.length >= 2) {
      const dates = recentVisits.map(v => new Date(v.visit_date));
      const intervals = [];
      for (let i = 0; i < dates.length - 1; i++) {
        const daysBetween = Math.floor((dates[i] - dates[i + 1]) / (1000 * 60 * 60 * 24));
        intervals.push(daysBetween);
      }
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      trends.visit_frequency = {
        average_days_between: Math.round(avgInterval),
        consistency: intervals.every(i => Math.abs(i - avgInterval) < 3) ? 'consistent' : 'variable'
      };
    }
  }

  // Care plan progress
  if (carePlans?.length > 0) {
    const activeCarePlans = carePlans.filter(cp => cp.status === 'active');
    const metCarePlans = carePlans.filter(cp => cp.status === 'met');
    const notMetCarePlans = carePlans.filter(cp => cp.status === 'not_met');

    trends.care_plan_progress = {
      total: carePlans.length,
      active: activeCarePlans.length,
      met: metCarePlans.length,
      not_met: notMetCarePlans.length,
      success_rate: carePlans.length > 0 ? Math.round((metCarePlans.length / carePlans.length) * 100) : 0
    };
  }

  // Clinical changes detection
  if (visits?.length >= 2) {
    const latestNote = visits[0]?.nurse_notes || '';
    const _previousNote = visits[1]?.nurse_notes || '';
    
    // Detect mentions of changes
    const changeKeywords = ['worse', 'better', 'improved', 'deteriorat', 'decline', 'increase', 'decrease', 'new onset'];
    const hasChangeMentions = changeKeywords.some(kw => latestNote.toLowerCase().includes(kw));
    
    if (hasChangeMentions) {
      trends.clinical_changes.push({
        detected_at: visits[0].visit_date,
        note: 'Clinical status changes noted in recent documentation'
      });
    }
  }

  return trends;
}

/**
 * Generate continuity of care insights
 */
function generateContinuityInsights(visits, carePlans, incidents) {
  const insights = {
    documentation_consistency: 'unknown',
    care_plan_alignment: 'unknown',
    incident_patterns: [],
    follow_up_items: [],
    unresolved_issues: []
  };

  // Documentation consistency
  if (visits?.length >= 3) {
    const recentVisits = visits.slice(0, 3);
    const allHaveNotes = recentVisits.every(v => v.nurse_notes && v.nurse_notes.length > 100);
    const allHaveVitals = recentVisits.every(v => v.vital_signs);
    
    insights.documentation_consistency = allHaveNotes && allHaveVitals ? 'consistent' : 'gaps_detected';
  }

  // Care plan alignment
  if (visits?.length > 0 && carePlans?.length > 0) {
    const latestNote = visits[0]?.nurse_notes?.toLowerCase() || '';
    const carePlanProblems = carePlans
      .map(cp => (cp.problem || '').toLowerCase())
      .filter(Boolean);

    const mentionedProblems = carePlanProblems.filter(problem =>
      latestNote.includes(problem.split(' ')[0])
    );

    // Guard against divide-by-zero when no care plan has a usable problem string.
    const alignmentRate = carePlanProblems.length
      ? mentionedProblems.length / carePlanProblems.length
      : 0;
    insights.care_plan_alignment = alignmentRate >= 0.7 ? 'aligned' : 'partial_alignment';
  }

  // Incident patterns
  if (incidents?.length >= 2) {
    const incidentTypes = incidents.reduce((acc, inc) => {
      acc[inc.incident_type] = (acc[inc.incident_type] || 0) + 1;
      return acc;
    }, {});
    
    Object.entries(incidentTypes).forEach(([type, count]) => {
      if (count >= 2) {
        insights.incident_patterns.push({
          type,
          frequency: count,
          concern_level: count >= 3 ? 'high' : 'medium',
          message: `Recurring ${type} incidents (${count} times) - needs intervention review`
        });
      }
    });
  }

  // Unresolved issues from previous visits
  if (visits?.length >= 2) {
    const previousNote = visits[1]?.nurse_notes || '';
    const latestNote = visits[0]?.nurse_notes || '';
    
    // Simple detection of unresolved mentions
    const concernKeywords = ['continue to monitor', 'follow up', 'pending', 'unresolved', 'ongoing'];
    concernKeywords.forEach(keyword => {
      if (previousNote.toLowerCase().includes(keyword)) {
        const concernContext = previousNote.match(new RegExp(`.{0,50}${keyword}.{0,50}`, 'i'));
        if (concernContext && !latestNote.toLowerCase().includes(keyword)) {
          insights.unresolved_issues.push({
            from_visit: visits[1].visit_date,
            issue: concernContext[0],
            status: 'not_addressed_in_latest_visit'
          });
        }
      }
    });
  }

  return insights;
}

/**
 * Format patient history for AI prompt injection
 */
export function formatHistoryForAI(history) {
  if (!history) return "";

  const { patient, visits, carePlans, incidents, trends, continuityInsights } = history;

  return `
COMPREHENSIVE PATIENT HISTORY & TRENDS:

Patient Overview:
- Name: ${patient?.first_name} ${patient?.last_name}
- Age: ${patient?.date_of_birth ? new Date().getFullYear() - new Date(patient.date_of_birth).getFullYear() : 'Unknown'}
- Length of Care: ${patient?.admission_date ? Math.floor((new Date() - new Date(patient.admission_date)) / (1000 * 60 * 60 * 24)) : 'Unknown'} days
- Status: ${patient?.status}

CLINICAL TRENDS ANALYSIS:
${trends?.vital_trends?.blood_pressure ? `
• Blood Pressure: ${trends.vital_trends.blood_pressure.trend} (${trends.vital_trends.blood_pressure.change > 0 ? '+' : ''}${trends.vital_trends.blood_pressure.change} mmHg from baseline)
  ${trends.vital_trends.blood_pressure.concern ? '⚠️ CONCERNING TREND - Significant deviation from baseline' : ''}
` : ''}
${trends?.vital_trends?.heart_rate ? `
• Heart Rate: ${trends.vital_trends.heart_rate.trend} (${trends.vital_trends.heart_rate.change > 0 ? '+' : ''}${trends.vital_trends.heart_rate.change} bpm from baseline)
  ${trends.vital_trends.heart_rate.concern ? '⚠️ CONCERNING TREND' : ''}
` : ''}
${trends?.vital_trends?.oxygen_saturation ? `
• Oxygen Saturation: ${trends.vital_trends.oxygen_saturation.trend} (${trends.vital_trends.oxygen_saturation.change > 0 ? '+' : ''}${trends.vital_trends.oxygen_saturation.change}% from baseline)
  ${trends.vital_trends.oxygen_saturation.concern ? '⚠️ CONCERNING TREND - Declining oxygenation' : ''}
` : ''}

Visit Pattern:
${trends?.visit_frequency?.average_days_between ? `- Average ${trends.visit_frequency.average_days_between} days between visits (${trends.visit_frequency.consistency})` : '- Visit frequency data unavailable'}

Care Plan Progress:
${trends?.care_plan_progress ? `
- ${trends.care_plan_progress.active} active care plans
- ${trends.care_plan_progress.met} goals met, ${trends.care_plan_progress.not_met} not met
- ${trends.care_plan_progress.success_rate}% success rate
` : '- No care plan data available'}

CONTINUITY OF CARE INSIGHTS:
- Documentation Consistency: ${continuityInsights?.documentation_consistency}
- Care Plan Alignment: ${continuityInsights?.care_plan_alignment}
${continuityInsights?.incident_patterns?.length > 0 ? `
- Incident Patterns Detected:
${continuityInsights.incident_patterns.map(p => `  • ${p.message}`).join('\n')}
` : ''}
${continuityInsights?.unresolved_issues?.length > 0 ? `
- Unresolved Issues from Previous Visits:
${continuityInsights.unresolved_issues.map(u => `  • ${u.issue} (from ${u.from_visit})`).join('\n')}
` : ''}

RECENT VISIT HISTORY (Last ${Math.min(visits?.length || 0, 5)} visits):
${visits?.slice(0, 5).map((v, idx) => `
Visit ${idx + 1} - ${v.visit_date}:
- Type: ${v.visit_type}
- Vitals: ${v.vital_signs ? `BP ${v.vital_signs.blood_pressure_systolic}/${v.vital_signs.blood_pressure_diastolic}, HR ${v.vital_signs.heart_rate}, O2 ${v.vital_signs.oxygen_saturation}%` : 'Not recorded'}
- Key Observations: ${v.nurse_notes ? v.nurse_notes.substring(0, 200) + '...' : 'No notes'}
`).join('\n') || 'No visit history available'}

ACTIVE CARE PLANS:
${carePlans?.filter(cp => cp.status === 'active').map(cp => `
- Problem: ${cp.problem}
  Goal: ${cp.goal}
  Interventions: ${cp.interventions?.join(', ') || 'None specified'}
  Target Date: ${cp.target_date}
`).join('\n') || 'No active care plans'}

RECENT INCIDENTS/CONCERNS:
${incidents?.slice(0, 3).map(inc => `
- ${inc.incident_date}: ${inc.incident_type} (${inc.severity} severity)
  ${inc.details ? `Details: ${JSON.stringify(inc.details).substring(0, 100)}` : ''}
`).join('\n') || 'No recent incidents'}

CRITICAL: Use this historical context to:
1. Identify trends and changes from baseline
2. Ensure continuity with previous documentation
3. Address unresolved issues from prior visits
4. Reference patient's response patterns to interventions
5. Provide context-aware, personalized recommendations`;
}

/**
 * Extract key historical insights for quick reference
 */
export function extractKeyInsights(history) {
  if (!history) return [];

  const insights = [];
  const { trends, continuityInsights, _visits, _incidents } = history;

  // Trending vital signs
  if (trends?.vital_trends) {
    Object.entries(trends.vital_trends).forEach(([vital, data]) => {
      if (data.concern) {
        insights.push({
          type: 'trending_concern',
          priority: 'high',
          message: `${vital.replace(/_/g, ' ')} showing ${data.trend} trend (${data.change > 0 ? '+' : ''}${data.change})`,
          action: `Monitor closely and document comparison to baseline in current visit`
        });
      }
    });
  }

  // Incident patterns
  if (continuityInsights?.incident_patterns?.length > 0) {
    continuityInsights.incident_patterns.forEach(pattern => {
      insights.push({
        type: 'incident_pattern',
        priority: pattern.concern_level === 'high' ? 'high' : 'medium',
        message: pattern.message,
        action: 'Document interventions to address recurring pattern'
      });
    });
  }

  // Unresolved issues
  if (continuityInsights?.unresolved_issues?.length > 0) {
    insights.push({
      type: 'continuity_gap',
      priority: 'medium',
      message: `${continuityInsights.unresolved_issues.length} unresolved issue(s) from previous visit`,
      action: 'Address or document status of previously noted concerns'
    });
  }

  // Care plan alignment issues
  if (continuityInsights?.care_plan_alignment === 'partial_alignment') {
    insights.push({
      type: 'care_plan_gap',
      priority: 'medium',
      message: 'Not all active care plans addressed in recent documentation',
      action: 'Ensure all active care plan problems are assessed and documented'
    });
  }

  return insights;
}

export default {
  buildComprehensivePatientHistory,
  formatHistoryForAI,
  extractKeyInsights
};