import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patient_id, limit = 50 } = await req.json();

    // Fetch all patients if not filtering by specific patient
    let patients = [];
    if (patient_id && patient_id !== 'all') {
      const p = await base44.entities.Patient.filter({ id: patient_id });
      patients = p;
    } else {
      patients = await base44.entities.Patient.list('-updated_date', limit);
    }

    // Fetch recent visits for all patients
    const visits = await base44.entities.Visit.list('-created_date', 5000);
    const alerts = await base44.entities.PatientAlert.list('-created_date', 2000);
    const carePlans = await base44.entities.CarePlan.list('-updated_date', 2000);

    // Calculate risk scores
    const riskAssessments = patients.map(patient => {
      let riskScore = 0;
      const riskFactors = [];

      // 1. Recent hospitalizations or ER visits
      const patientVisits = visits.filter(v => v.patient_id === patient.id);
      const recentHospitalizations = patientVisits.filter(v => {
        const visitDate = new Date(v.created_date);
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        return visitDate >= thirtyDaysAgo && (v.visit_type === 'ER' || v.visit_type === 'hospitalization');
      }).length;

      if (recentHospitalizations > 0) {
        riskScore += 25;
        riskFactors.push(`${recentHospitalizations} recent hospitalization(s) in past 30 days`);
      }

      // 2. Multiple comorbidities
      const comorbidCount = (patient.secondary_diagnoses || []).length;
      if (comorbidCount >= 3) {
        riskScore += 20;
        riskFactors.push(`Multiple comorbidities (${comorbidCount})`);
      }

      // 3. Active alerts
      const activeAlerts = alerts.filter(a => a.patient_id === patient.id && a.status === 'active');
      if (activeAlerts.length > 0) {
        riskScore += 15;
        riskFactors.push(`${activeAlerts.length} active clinical alert(s)`);
      }

      // 4. Medication complexity
      const medCount = (patient.current_medications || []).length;
      if (medCount >= 5) {
        riskScore += 10;
        riskFactors.push(`High medication complexity (${medCount} drugs)`);
      }

      // 5. Age over 75
      if (patient.date_of_birth) {
        const age = Math.floor((Date.now() - new Date(patient.date_of_birth).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
        if (age > 75) {
          riskScore += 15;
          riskFactors.push(`Advanced age (${age} years)`);
        }
      }

      // 6. Compliance issues
      const avgCompliance = patientVisits.length > 0
        ? patientVisits.reduce((sum, v) => sum + (v.compliance_score || 0), 0) / patientVisits.length
        : 100;
      if (avgCompliance < 70) {
        riskScore += 10;
        riskFactors.push(`Documentation compliance below target (${avgCompliance.toFixed(0)}%)`);
      }

      // 7. Care plan gaps
      const activePlans = carePlans.filter(cp => cp.patient_id === patient.id && cp.status === 'active');
      if (activePlans.length === 0 && patient.primary_diagnosis) {
        riskScore += 10;
        riskFactors.push('No active care plan documented');
      }

      // Cap risk score at 100
      riskScore = Math.min(100, riskScore);

      return {
        patient_id: patient.id,
        patient_name: `${patient.first_name} ${patient.last_name}`,
        primary_diagnosis: patient.primary_diagnosis,
        risk_score: riskScore,
        risk_level: riskScore >= 70 ? 'high' : riskScore >= 40 ? 'moderate' : 'low',
        risk_factors: riskFactors,
        recent_visits: patientVisits.length,
        last_visit: patientVisits.length > 0 ? patientVisits[0].created_date : null,
        active_alerts: activeAlerts.length
      };
    }).sort((a, b) => b.risk_score - a.risk_score);

    // Get high-risk patients for detailed analysis
    const highRiskPatients = riskAssessments.filter(p => p.risk_score >= 70).slice(0, 10);

    // AI-powered intervention recommendations
    const interventionPrompt = `Generate specific intervention recommendations for these high-risk readmission patients:

${highRiskPatients.slice(0, 5).map(p => `
${p.patient_name} (${p.primary_diagnosis}):
- Risk Score: ${p.risk_score}/100
- Risk Factors: ${p.risk_factors.join(', ')}
- Recent Visits: ${p.recent_visits}
- Active Alerts: ${p.active_alerts}
`).join('\n')}

For each patient group, provide specific, actionable interventions to reduce readmission risk.`;

    const interventions = await base44.integrations.Core.InvokeLLM({
      prompt: interventionPrompt
    });

    // Summary statistics
    const highRisk = riskAssessments.filter(p => p.risk_score >= 70).length;
    const moderateRisk = riskAssessments.filter(p => p.risk_score >= 40 && p.risk_score < 70).length;
    const lowRisk = riskAssessments.filter(p => p.risk_score < 40).length;

    return Response.json({
      total_patients_analyzed: riskAssessments.length,
      high_risk_count: highRisk,
      moderate_risk_count: moderateRisk,
      low_risk_count: lowRisk,
      avg_risk_score: (riskAssessments.reduce((sum, p) => sum + p.risk_score, 0) / riskAssessments.length).toFixed(1),
      high_risk_patients: highRiskPatients,
      risk_distribution: riskAssessments,
      recommended_interventions: interventions
    });
  } catch (error) {
    console.error('Readmission risk prediction error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});