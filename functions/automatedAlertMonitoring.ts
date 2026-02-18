import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Admin-only function for automated monitoring
    if (user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json();
    const { patient_id, force_check = false } = body;

    console.log(`[Alert Monitor] Starting automated alert check${patient_id ? ` for patient ${patient_id}` : ' for all patients'}`);

    // Get active alert rules
    const alertRules = await base44.asServiceRole.entities.AlertTriggerRule.filter({ is_active: true });
    console.log(`[Alert Monitor] Found ${alertRules.length} active alert rules`);

    // Get patients to monitor
    const patients = patient_id 
      ? [await base44.asServiceRole.entities.Patient.list().then(list => list.find(p => p.id === patient_id))]
      : await base44.asServiceRole.entities.Patient.list();

    const validPatients = patients.filter(Boolean);
    console.log(`[Alert Monitor] Monitoring ${validPatients.length} patients`);

    const alertsCreated = [];
    const now = new Date();

    for (const patient of validPatients) {
      try {
        for (const rule of alertRules) {
          // Check if rule applies to this patient
          if (!shouldApplyRule(rule, patient)) continue;

          // Check cooldown period
          if (!force_check && rule.last_triggered) {
            const hoursSinceLastTrigger = (now - new Date(rule.last_triggered)) / (1000 * 60 * 60);
            if (hoursSinceLastTrigger < (rule.cooldown_hours || 24)) {
              continue;
            }
          }

          // Check if alert already exists
          const existingAlerts = await base44.asServiceRole.entities.PatientAlert.filter({
            patient_id: patient.id,
            alert_type: rule.rule_type,
            status: 'active'
          });

          if (existingAlerts.length > 0 && !force_check) {
            continue; // Alert already active
          }

          // Evaluate trigger condition
          const triggerResult = await evaluateTrigger(base44, patient, rule);

          if (triggerResult.triggered) {
            console.log(`[Alert Monitor] Rule "${rule.rule_name}" triggered for patient ${patient.first_name} ${patient.last_name}`);

            // Create alert
            const alert = await base44.asServiceRole.entities.PatientAlert.create({
              patient_id: patient.id,
              alert_type: rule.rule_type,
              severity: rule.alert_severity,
              title: interpolateTemplate(rule.alert_title_template, {
                patient_name: `${patient.first_name} ${patient.last_name}`,
                value: triggerResult.value,
                threshold: triggerResult.threshold,
                parameter: rule.trigger_condition.parameter
              }),
              description: interpolateTemplate(rule.alert_description_template, {
                patient_name: `${patient.first_name} ${patient.last_name}`,
                value: triggerResult.value,
                threshold: triggerResult.threshold,
                parameter: rule.trigger_condition.parameter,
                details: triggerResult.details
              }),
              status: 'active',
              recommended_actions: rule.recommended_actions || [],
              triggered_by_rule_id: rule.id,
              triggered_data: triggerResult.data,
              detected_date: now.toISOString()
            });

            alertsCreated.push(alert);

            // Update rule trigger count
            await base44.asServiceRole.entities.AlertTriggerRule.update(rule.id, {
              trigger_count: (rule.trigger_count || 0) + 1,
              last_triggered: now.toISOString()
            });

            // Send notifications
            if (rule.notification_channels && rule.notification_channels.length > 0) {
              await sendNotifications(base44, alert, patient, rule);
            }
          }
        }
      } catch (error) {
        console.error(`[Alert Monitor] Error processing patient ${patient.id}:`, error);
      }
    }

    console.log(`[Alert Monitor] Completed. Created ${alertsCreated.length} new alerts`);

    return Response.json({
      success: true,
      alerts_created: alertsCreated.length,
      alerts: alertsCreated.map(a => ({
        id: a.id,
        patient_id: a.patient_id,
        type: a.alert_type,
        severity: a.severity,
        title: a.title
      }))
    });

  } catch (error) {
    console.error('[Alert Monitor] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

function shouldApplyRule(rule, patient) {
  if (rule.applies_to_patients === 'all') return true;

  if (rule.applies_to_patients === 'high_risk_only') {
    const riskLevel = patient.risk_assessment?.level;
    return riskLevel === 'high' || riskLevel === 'critical';
  }

  if (rule.applies_to_patients === 'specific_diagnoses' && rule.diagnosis_filter) {
    const patientDiagnoses = [
      patient.primary_diagnosis,
      ...(patient.secondary_diagnoses || []),
      ...(patient.chronic_conditions || []).map(c => c.condition)
    ].filter(Boolean).map(d => d.toLowerCase());

    return rule.diagnosis_filter.some(diagFilter => 
      patientDiagnoses.some(pd => pd.includes(diagFilter.toLowerCase()))
    );
  }

  return true;
}

async function evaluateTrigger(base44, patient, rule) {
  const { rule_type, trigger_condition } = rule;

  try {
    switch (rule_type) {
      case 'vital_sign_threshold':
        return await evaluateVitalSignThreshold(base44, patient, trigger_condition);
      
      case 'weight_change':
        return await evaluateWeightChange(base44, patient, trigger_condition);
      
      case 'missed_visit':
        return await evaluateMissedVisit(base44, patient, trigger_condition);
      
      case 'lab_result_critical':
        return await evaluateLabResult(base44, patient, trigger_condition);
      
      case 'medication_adherence':
        return await evaluateMedicationAdherence(base44, patient, trigger_condition);
      
      case 'care_plan_stalled':
        return await evaluateCarePlanProgress(base44, patient, trigger_condition);
      
      case 'overdue_task':
        return await evaluateOverdueTasks(base44, patient, trigger_condition);
      
      case 'pain_level':
        return await evaluatePainLevel(base44, patient, trigger_condition);
      
      case 'functional_decline':
        return await evaluateFunctionalDecline(base44, patient, trigger_condition);

      case 'predictive_risk':
        return await evaluatePredictiveRisk(base44, patient, trigger_condition);

      default:
        return { triggered: false };
    }
  } catch (error) {
    console.error(`[Alert Monitor] Error evaluating ${rule_type}:`, error);
    return { triggered: false };
  }
}

async function evaluateVitalSignThreshold(base44, patient, condition) {
  const visits = await base44.asServiceRole.entities.Visit.filter(
    { patient_id: patient.id },
    '-visit_date',
    condition.timeframe_hours ? Math.ceil(condition.timeframe_hours / 24) : 5
  );

  const recentVitals = visits
    .filter(v => v.vital_signs && v.status === 'completed')
    .filter(v => {
      if (!condition.timeframe_hours) return true;
      const hoursDiff = (Date.now() - new Date(v.visit_date).getTime()) / (1000 * 60 * 60);
      return hoursDiff <= condition.timeframe_hours;
    });

  if (recentVitals.length === 0) return { triggered: false };

  const latestVital = recentVitals[0].vital_signs;
  const parameter = condition.parameter;
  const value = latestVital[parameter];

  if (value === undefined || value === null) return { triggered: false };

  const triggered = checkThreshold(value, condition);

  if (triggered) {
    return {
      triggered: true,
      value,
      threshold: condition.threshold_value || `${condition.threshold_min}-${condition.threshold_max}`,
      data: { vital_signs: latestVital, visit_date: recentVitals[0].visit_date },
      details: `${parameter}: ${value} (recorded on ${recentVitals[0].visit_date})`
    };
  }

  return { triggered: false };
}

async function evaluateWeightChange(base44, patient, condition) {
  const visits = await base44.asServiceRole.entities.Visit.filter(
    { patient_id: patient.id },
    '-visit_date',
    10
  );

  const weightsWithDates = visits
    .filter(v => v.vital_signs?.weight)
    .map(v => ({ weight: v.vital_signs.weight, date: v.visit_date }))
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  if (weightsWithDates.length < 2) return { triggered: false };

  const latestWeight = weightsWithDates[0].weight;
  const previousWeight = weightsWithDates[1].weight;
  const changePercentage = ((latestWeight - previousWeight) / previousWeight) * 100;

  const triggered = condition.operator === 'change_percentage' 
    ? Math.abs(changePercentage) >= condition.threshold_value
    : checkThreshold(changePercentage, condition);

  if (triggered) {
    return {
      triggered: true,
      value: `${changePercentage.toFixed(1)}%`,
      threshold: condition.threshold_value,
      data: { current: latestWeight, previous: previousWeight, change_percentage: changePercentage },
      details: `Weight changed from ${previousWeight} lbs to ${latestWeight} lbs (${changePercentage > 0 ? '+' : ''}${changePercentage.toFixed(1)}%)`
    };
  }

  return { triggered: false };
}

async function evaluateMissedVisit(base44, patient, condition) {
  const visits = await base44.asServiceRole.entities.Visit.filter(
    { patient_id: patient.id, status: 'missed' },
    '-visit_date',
    5
  );

  const recentMissedVisits = visits.filter(v => {
    const daysSince = (Date.now() - new Date(v.visit_date).getTime()) / (1000 * 60 * 60 * 24);
    return daysSince <= (condition.timeframe_hours || 168) / 24;
  });

  if (recentMissedVisits.length > 0) {
    return {
      triggered: true,
      value: recentMissedVisits.length,
      threshold: 1,
      data: { missed_visits: recentMissedVisits.map(v => ({ date: v.visit_date, type: v.visit_type })) },
      details: `${recentMissedVisits.length} missed visit(s) in recent period`
    };
  }

  return { triggered: false };
}

async function evaluateLabResult(base44, patient, condition) {
  const documents = await base44.asServiceRole.entities.PatientDocument.filter(
    { patient_id: patient.id, document_category: 'lab_result' },
    '-created_date',
    3
  );

  if (documents.length === 0) return { triggered: false };

  const latestLab = documents[0];
  
  // Check if AI flagged as critical or if specific parameter is out of range
  if (latestLab.extracted_data?.key_findings) {
    const findings = latestLab.extracted_data.key_findings.toLowerCase();
    const criticalKeywords = ['critical', 'abnormal', 'urgent', 'high risk', 'elevated'];
    
    if (criticalKeywords.some(keyword => findings.includes(keyword))) {
      return {
        triggered: true,
        value: 'Critical findings detected',
        threshold: 'Clinical review',
        data: { document: latestLab.file_name, findings: latestLab.extracted_data.key_findings },
        details: `Critical lab result: ${latestLab.file_name} - ${findings.substring(0, 200)}`
      };
    }
  }

  return { triggered: false };
}

async function evaluateMedicationAdherence(base44, patient, condition) {
  const visits = await base44.asServiceRole.entities.Visit.filter(
    { patient_id: patient.id },
    '-visit_date',
    5
  );

  const adherenceConcerns = visits
    .filter(v => v.nurse_notes)
    .filter(v => {
      const notes = v.nurse_notes.toLowerCase();
      return notes.includes('non-adherent') || 
             notes.includes('not taking') || 
             notes.includes('missed doses') ||
             notes.includes('medication non-compliance');
    });

  if (adherenceConcerns.length > 0) {
    return {
      triggered: true,
      value: adherenceConcerns.length,
      threshold: 1,
      data: { visits_with_concerns: adherenceConcerns.map(v => v.visit_date) },
      details: `Medication adherence concerns noted in ${adherenceConcerns.length} recent visit(s)`
    };
  }

  return { triggered: false };
}

async function evaluateCarePlanProgress(base44, patient, condition) {
  const carePlans = await base44.asServiceRole.entities.CarePlan.filter({
    patient_id: patient.id,
    status: 'active'
  });

  const stalledPlans = carePlans.filter(cp => {
    const progress = cp.progress_percentage || 0;
    const daysSinceUpdate = cp.updated_date 
      ? (Date.now() - new Date(cp.updated_date).getTime()) / (1000 * 60 * 60 * 24)
      : 999;
    
    return progress < 25 && daysSinceUpdate > 14;
  });

  if (stalledPlans.length > 0) {
    return {
      triggered: true,
      value: stalledPlans.length,
      threshold: 1,
      data: { stalled_plans: stalledPlans.map(p => ({ problem: p.problem, progress: p.progress_percentage })) },
      details: `${stalledPlans.length} care plan(s) showing minimal progress`
    };
  }

  return { triggered: false };
}

async function evaluateOverdueTasks(base44, patient, condition) {
  const tasks = await base44.asServiceRole.entities.Task.filter({
    patient_id: patient.id,
    status: { $ne: 'completed' }
  });

  const overdueTasks = tasks.filter(t => {
    if (!t.due_date) return false;
    return new Date(t.due_date) < new Date();
  });

  if (overdueTasks.length >= (condition.threshold_value || 1)) {
    return {
      triggered: true,
      value: overdueTasks.length,
      threshold: condition.threshold_value || 1,
      data: { overdue_tasks: overdueTasks.map(t => ({ title: t.title, due_date: t.due_date })) },
      details: `${overdueTasks.length} overdue task(s)`
    };
  }

  return { triggered: false };
}

async function evaluatePainLevel(base44, patient, condition) {
  const visits = await base44.asServiceRole.entities.Visit.filter(
    { patient_id: patient.id },
    '-visit_date',
    3
  );

  const recentPainLevels = visits
    .filter(v => v.vital_signs?.pain_level !== undefined && v.vital_signs?.pain_level !== null)
    .map(v => ({ pain: v.vital_signs.pain_level, date: v.visit_date }));

  if (recentPainLevels.length === 0) return { triggered: false };

  const latestPain = recentPainLevels[0].pain;
  const triggered = checkThreshold(latestPain, condition);

  if (triggered) {
    return {
      triggered: true,
      value: latestPain,
      threshold: condition.threshold_value,
      data: { pain_levels: recentPainLevels },
      details: `Pain level ${latestPain}/10 on ${recentPainLevels[0].date}`
    };
  }

  return { triggered: false };
}

async function evaluateFunctionalDecline(base44, patient, condition) {
  const visits = await base44.asServiceRole.entities.Visit.filter(
    { patient_id: patient.id },
    '-visit_date',
    10
  );

  const functionalAssessments = visits
    .filter(v => v.nurse_notes)
    .filter(v => {
      const notes = v.nurse_notes.toLowerCase();
      return notes.includes('decline') || 
             notes.includes('deteriorat') || 
             notes.includes('worsening') ||
             notes.includes('decreased independence');
    });

  if (functionalAssessments.length >= 2) {
    return {
      triggered: true,
      value: 'Functional decline pattern detected',
      threshold: 'Clinical assessment',
      data: { visits_noting_decline: functionalAssessments.map(v => v.visit_date) },
      details: `Functional decline noted in ${functionalAssessments.length} recent visits`
    };
  }

  return { triggered: false };
}

async function evaluatePredictiveRisk(base44, patient, condition) {
  const riskAnalyses = await base44.asServiceRole.entities.RiskAnalysis.filter(
    { patient_id: patient.id },
    '-created_date',
    1
  );

  if (riskAnalyses.length === 0) return { triggered: false };

  const latestRisk = riskAnalyses[0];
  const riskScore = latestRisk.risk_score || 0;

  if (riskScore >= (condition.threshold_value || 70)) {
    return {
      triggered: true,
      value: riskScore,
      threshold: condition.threshold_value,
      data: { risk_analysis: latestRisk },
      details: `Predictive risk score ${riskScore} indicates high probability of adverse event`
    };
  }

  return { triggered: false };
}

function checkThreshold(value, condition) {
  switch (condition.operator) {
    case 'greater_than':
      return value > condition.threshold_value;
    case 'less_than':
      return value < condition.threshold_value;
    case 'equals':
      return value === condition.threshold_value;
    case 'not_equals':
      return value !== condition.threshold_value;
    case 'between':
      return value >= condition.threshold_min && value <= condition.threshold_max;
    case 'outside_range':
      return value < condition.threshold_min || value > condition.threshold_max;
    default:
      return false;
  }
}

function interpolateTemplate(template, data) {
  if (!template) return '';
  let result = template;
  for (const [key, value] of Object.entries(data)) {
    result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }
  return result;
}

async function sendNotifications(base44, alert, patient, rule) {
  try {
    if (rule.notification_channels.includes('email')) {
      // Get users to notify based on roles
      const users = await base44.asServiceRole.entities.User.list();
      const usersToNotify = rule.notify_roles && rule.notify_roles.length > 0
        ? users.filter(u => rule.notify_roles.includes(u.role))
        : users.filter(u => u.role === 'admin');

      for (const user of usersToNotify) {
        try {
          await base44.integrations.Core.SendEmail({
            to: user.email,
            subject: `Patient Alert: ${alert.title}`,
            body: `
<h2>Patient Alert</h2>
<p><strong>Patient:</strong> ${patient.first_name} ${patient.last_name}</p>
<p><strong>Severity:</strong> ${alert.severity.toUpperCase()}</p>
<p><strong>Alert:</strong> ${alert.title}</p>
<p><strong>Description:</strong> ${alert.description}</p>

<h3>Recommended Actions:</h3>
<ul>
${(alert.recommended_actions || []).map(action => `<li>${action}</li>`).join('\n')}
</ul>

<p>Please review this alert in the CareMetric AI system.</p>
            `
          });
        } catch (emailError) {
          console.error(`[Alert Monitor] Error sending email to ${user.email}:`, emailError);
        }
      }
    }
  } catch (error) {
    console.error('[Alert Monitor] Error sending notifications:', error);
  }
}