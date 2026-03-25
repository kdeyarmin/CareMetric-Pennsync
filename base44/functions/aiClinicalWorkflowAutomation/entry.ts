import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { action, patient_id } = await req.json();

    if (!patient_id) {
      return Response.json({ error: 'patient_id is required' }, { status: 400 });
    }

    // Fetch patient data
    const patients = await base44.asServiceRole.entities.Patient.list();
    const patient = patients.find(p => p.id === patient_id);
    if (!patient) {
      return Response.json({ error: 'Patient not found' }, { status: 404 });
    }

    // Fetch recent visits
    const visits = await base44.asServiceRole.entities.Visit.filter(
      { patient_id }, '-visit_date', 10
    );

    // Fetch existing care plans
    const carePlans = await base44.asServiceRole.entities.CarePlan.filter({ patient_id });

    // Fetch existing alerts
    const alerts = await base44.asServiceRole.entities.PatientAlert.filter({ patient_id });
    const activeAlerts = alerts.filter(a => a.status === 'active');

    // Build patient context
    const recentNotes = visits
      .filter(v => v.nurse_notes && v.status === 'completed')
      .slice(0, 5)
      .map(v => `[${v.visit_date} - ${v.visit_type}]: ${v.nurse_notes.substring(0, 800)}`);

    const vitalsTrend = visits
      .filter(v => v.vital_signs)
      .slice(0, 5)
      .map(v => ({
        date: v.visit_date,
        bp: v.vital_signs.blood_pressure_systolic ? `${v.vital_signs.blood_pressure_systolic}/${v.vital_signs.blood_pressure_diastolic}` : null,
        hr: v.vital_signs.heart_rate,
        o2: v.vital_signs.oxygen_saturation,
        temp: v.vital_signs.temperature,
        pain: v.vital_signs.pain_level,
        weight: v.vital_signs.weight
      }));

    const patientContext = `
PATIENT: ${patient.first_name} ${patient.last_name}, DOB: ${patient.date_of_birth || 'unknown'}
PRIMARY DIAGNOSIS: ${patient.primary_diagnosis || 'Not specified'}
SECONDARY DIAGNOSES: ${(patient.secondary_diagnoses || []).join(', ') || 'None'}
CHRONIC CONDITIONS: ${(patient.chronic_conditions || []).map(c => `${c.condition} (${c.severity || 'unknown'} severity)`).join(', ') || 'None'}
MEDICATIONS: ${(patient.current_medications || []).map(m => `${m.name} ${m.dosage} ${m.frequency}`).join('; ') || 'None'}
ALLERGIES: ${patient.allergies || 'NKDA'}
FUNCTIONAL STATUS: ADL=${patient.functional_status?.adl_independence || 'unknown'}, Ambulation=${patient.functional_status?.ambulation || 'unknown'}, Fall Risk=${patient.functional_status?.fall_risk || 'unknown'}, Cognitive=${patient.functional_status?.cognitive_status || 'unknown'}
LIVING SITUATION: ${patient.social_history?.living_situation || 'unknown'}
RISK SCORE: ${patient.risk_assessment?.score || 'Not calculated'} (${patient.risk_assessment?.level || 'unknown'})
ACTIVE CARE PLANS: ${carePlans.filter(cp => cp.status === 'active').map(cp => cp.problem).join('; ') || 'None'}
ACTIVE ALERTS: ${activeAlerts.map(a => `${a.alert_type}: ${a.title}`).join('; ') || 'None'}

VITAL SIGNS TREND:
${JSON.stringify(vitalsTrend, null, 1)}

RECENT VISIT NOTES:
${recentNotes.join('\n\n')}`;

    let result;

    if (action === 'generate_oasis') {
      result = await generateOASIS(base44, patientContext, patient, visits);
    } else if (action === 'identify_followups') {
      result = await identifyFollowUps(base44, patientContext, patient, visits, activeAlerts);
    } else if (action === 'suggest_referrals') {
      result = await suggestReferrals(base44, patientContext, patient, carePlans, activeAlerts);
    } else if (action === 'auto_generate_tasks') {
      result = await autoGenerateTasks(base44, patientContext, patient, visits, carePlans, activeAlerts, user);
    } else if (action === 'create_followup_tasks') {
      result = await createFollowUpTasks(base44, patientContext, patient, visits, activeAlerts, user);
    } else if (action === 'create_referral_tasks') {
      result = await createReferralTasks(base44, patientContext, patient, carePlans, activeAlerts, user);
    } else if (action === 'create_alert_tasks') {
      result = await createAlertTasks(base44, patientContext, patient, activeAlerts, user);
    } else if (action === 'full_analysis') {
      const [oasis, followups, referrals, tasks] = await Promise.all([
        generateOASIS(base44, patientContext, patient, visits),
        identifyFollowUps(base44, patientContext, patient, visits, activeAlerts),
        suggestReferrals(base44, patientContext, patient, carePlans, activeAlerts),
        autoGenerateTasks(base44, patientContext, patient, visits, carePlans, activeAlerts, user),
      ]);
      result = { oasis, followups, referrals, tasks };
    } else if (action === 'proactive_task_sweep') {
      // Combines all three new task-generation workflows into one call
      const [followupTasks, referralTasks, alertTasks] = await Promise.all([
        createFollowUpTasks(base44, patientContext, patient, visits, activeAlerts, user),
        createReferralTasks(base44, patientContext, patient, carePlans, activeAlerts, user),
        createAlertTasks(base44, patientContext, patient, activeAlerts, user),
      ]);
      result = {
        followup_tasks: followupTasks,
        referral_tasks: referralTasks,
        alert_tasks: alertTasks,
        total_tasks_created: (followupTasks.tasks_created || 0) + (referralTasks.tasks_created || 0) + (alertTasks.tasks_created || 0),
      };
    } else {
      return Response.json({ error: 'Invalid action' }, { status: 400 });
    }

    return Response.json({ success: true, data: result });

  } catch (error) {
    console.error('AI Clinical Workflow error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

async function generateOASIS(base44, patientContext, patient, visits) {
  const res = await base44.integrations.Core.InvokeLLM({
    prompt: `You are a certified OASIS assessment specialist for CMS home health. Based on the following patient data, generate a comprehensive OASIS assessment draft.

${patientContext}

Generate OASIS field responses with clinical justification. Focus on the most important OASIS-E items that drive PDGM scoring and clinical decision-making.

Include: M-items (clinical), functional items, risk factors, special treatments, and therapy needs.`,
    response_json_schema: {
      type: "object",
      properties: {
        assessment_summary: { type: "string", description: "Overall clinical summary for OASIS" },
        timing_type: { type: "string", enum: ["SOC", "ROC", "Recertification", "Other Follow-up", "Discharge"] },
        clinical_grouping: { type: "string", description: "Suggested PDGM clinical grouping" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              item_number: { type: "string", description: "OASIS item number e.g. M1033" },
              item_name: { type: "string" },
              suggested_response: { type: "string" },
              clinical_justification: { type: "string" },
              confidence: { type: "string", enum: ["high", "medium", "low"] }
            }
          }
        },
        functional_scores: {
          type: "object",
          properties: {
            self_care: { type: "number", description: "0-5 score" },
            mobility: { type: "number" },
            cognitive: { type: "number" }
          }
        },
        risk_flags: { type: "array", items: { type: "string" } },
        documentation_gaps: { type: "array", items: { type: "string" } }
      }
    }
  });
  return res;
}

async function identifyFollowUps(base44, patientContext, patient, visits, activeAlerts) {
  const res = await base44.integrations.Core.InvokeLLM({
    prompt: `You are a home health clinical decision support AI. Analyze this patient and determine if follow-up is needed, what kind, and how urgently.

${patientContext}

Evaluate:
1. Vital sign trends that indicate deterioration
2. Compliance issues from notes (missed medications, missed visits, non-adherence)
3. New symptoms or worsening conditions mentioned in recent notes
4. Risk score changes or concerning patterns
5. Care plan goals that are not being met
6. Gaps in recent visit frequency

Categorize each follow-up by urgency and type.`,
    response_json_schema: {
      type: "object",
      properties: {
        needs_immediate_followup: { type: "boolean" },
        urgency_level: { type: "string", enum: ["critical", "high", "moderate", "low", "routine"] },
        overall_risk_summary: { type: "string" },
        followup_items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              category: { type: "string", enum: ["vital_signs", "compliance", "symptom_change", "care_gap", "risk_escalation", "goal_not_met"] },
              finding: { type: "string" },
              urgency: { type: "string", enum: ["critical", "high", "moderate", "low"] },
              recommended_action: { type: "string" },
              timeframe: { type: "string" },
              responsible_role: { type: "string" }
            }
          }
        },
        visit_recommendation: { type: "string", description: "When next visit should be" },
        physician_notification_needed: { type: "boolean" },
        physician_notification_reason: { type: "string" }
      }
    }
  });
  return res;
}

async function suggestReferrals(base44, patientContext, patient, carePlans, activeAlerts) {
  const res = await base44.integrations.Core.InvokeLLM({
    prompt: `You are a care coordination specialist. Analyze this patient and suggest appropriate referrals and care plan adjustments.

${patientContext}

Consider:
1. Does the patient need PT/OT/ST referrals based on functional status?
2. Are there mental health concerns needing social work or counseling referral?
3. Should the patient be referred to specialists based on diagnoses?
4. Are current care plans adequate or do they need revision?
5. Does the patient need wound care, nutrition, or DME referrals?
6. Is hospice evaluation appropriate based on clinical trajectory?
7. Are there community resource needs (meals on wheels, transportation, etc.)?`,
    response_json_schema: {
      type: "object",
      properties: {
        referral_suggestions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              referral_type: { type: "string" },
              specialty: { type: "string" },
              urgency: { type: "string", enum: ["urgent", "routine", "when_available"] },
              clinical_rationale: { type: "string" },
              expected_outcome: { type: "string" }
            }
          }
        },
        care_plan_adjustments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              current_problem: { type: "string" },
              suggested_change: { type: "string" },
              rationale: { type: "string" },
              type: { type: "string", enum: ["new_problem", "revise_goal", "add_intervention", "increase_frequency", "decrease_frequency", "discontinue"] }
            }
          }
        },
        community_resources: {
          type: "array",
          items: {
            type: "object",
            properties: {
              resource: { type: "string" },
              reason: { type: "string" }
            }
          }
        }
      }
    }
  });
  return res;
}

async function autoGenerateTasks(base44, patientContext, patient, visits, carePlans, activeAlerts, user) {
  const res = await base44.integrations.Core.InvokeLLM({
    prompt: `You are a clinical workflow automation system. Based on the patient data, generate specific actionable tasks for the care team.

${patientContext}

Generate tasks for:
1. Clinical follow-up actions based on recent visit findings
2. Compliance issues that need staff intervention
3. Care coordination actions (physician calls, specialist scheduling)
4. Documentation tasks (missing forms, overdue assessments)
5. Patient/caregiver education needs
6. Safety interventions (fall prevention, medication reconciliation)
7. Equipment or supply needs

Each task should be specific, actionable, and assigned to the appropriate role. Set realistic due dates relative to today (${new Date().toISOString().split('T')[0]}).`,
    response_json_schema: {
      type: "object",
      properties: {
        generated_tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              type: { type: "string", enum: ["call", "notify", "schedule", "order", "coordinate", "document", "safety", "followup", "other"] },
              priority: { type: "string", enum: ["critical", "high", "medium", "low"] },
              due_in_days: { type: "number" },
              target_role: { type: "string", description: "nurse, administrator, case_manager, physician" },
              ai_reason: { type: "string" }
            }
          }
        },
        task_summary: { type: "string" }
      }
    }
  });

  // Auto-create the generated tasks
  const createdTasks = [];
  if (res.generated_tasks) {
    for (const task of res.generated_tasks) {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + (task.due_in_days || 3));

      const created = await base44.entities.Task.create({
        patient_id: patient.id,
        title: task.title,
        description: task.description,
        type: task.type,
        priority: task.priority,
        status: 'pending',
        due_date: dueDate.toISOString().split('T')[0],
        source: 'ai_generated',
        ai_reason: task.ai_reason,
        assigned_to: user.email,
      });
      createdTasks.push(created);
    }
  }

  return {
    ...res,
    tasks_created: createdTasks.length,
  };
}

// ── New: Auto-create follow-up tasks from AI-identified issues ──

async function createFollowUpTasks(base44, patientContext, patient, visits, activeAlerts, user) {
  const res = await base44.integrations.Core.InvokeLLM({
    prompt: `You are a clinical follow-up task automation engine. Analyze this patient and create specific follow-up tasks for every issue requiring attention.

${patientContext}

For EACH issue found, generate a concrete task. Focus on:
1. Vital sign deterioration → schedule urgent re-assessment visit
2. Medication non-adherence → call patient/caregiver for education
3. Missed or overdue visits → schedule make-up visit
4. Worsening symptoms noted in recent notes → notify physician + schedule visit
5. Unmet care plan goals → create care plan review task
6. Lab/test results needed → order or follow up on pending labs

Today's date: ${new Date().toISOString().split('T')[0]}. Be very specific with task titles and due dates.`,
    response_json_schema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              type: { type: "string", enum: ["call", "notify", "schedule", "order", "coordinate", "document", "safety", "followup", "other"] },
              priority: { type: "string", enum: ["critical", "high", "medium", "low"] },
              due_in_days: { type: "number" },
              target_role: { type: "string" },
              trigger_category: { type: "string", enum: ["vital_deterioration", "medication_issue", "missed_visit", "symptom_change", "goal_not_met", "lab_needed", "compliance_gap"] },
              ai_reason: { type: "string" }
            }
          }
        }
      }
    }
  });

  const created = [];
  for (const task of (res.tasks || [])) {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + (task.due_in_days || 2));
    created.push(await base44.entities.Task.create({
      patient_id: patient.id,
      title: task.title,
      description: task.description,
      type: task.type,
      priority: task.priority,
      status: 'pending',
      due_date: dueDate.toISOString().split('T')[0],
      source: 'ai_generated',
      ai_reason: `[Follow-Up] ${task.trigger_category}: ${task.ai_reason}`,
      assigned_to: user.email,
    }));
  }
  return { ...res, tasks_created: created.length };
}

// ── New: Auto-create referral tasks from AI-detected needs ──

async function createReferralTasks(base44, patientContext, patient, carePlans, activeAlerts, user) {
  const res = await base44.integrations.Core.InvokeLLM({
    prompt: `You are a referral coordination engine. Analyze this patient and generate tasks to initiate every referral and care plan adjustment needed.

${patientContext}

For each referral or care plan change, create a specific actionable task:
1. PT/OT/ST referral → task to prepare and send referral order
2. Specialist referral → task to contact specialist office + send records
3. Mental health/social work → task to schedule evaluation
4. DME/supply order → task to submit order
5. Community resource → task to connect patient with resource
6. Care plan revision → task to update care plan in system
7. Physician notification → task to call/fax physician with update

Today's date: ${new Date().toISOString().split('T')[0]}.`,
    response_json_schema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              type: { type: "string", enum: ["call", "notify", "schedule", "order", "coordinate", "document", "safety", "followup", "other"] },
              priority: { type: "string", enum: ["critical", "high", "medium", "low"] },
              due_in_days: { type: "number" },
              target_role: { type: "string" },
              referral_type: { type: "string" },
              ai_reason: { type: "string" }
            }
          }
        }
      }
    }
  });

  const created = [];
  for (const task of (res.tasks || [])) {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + (task.due_in_days || 3));
    created.push(await base44.entities.Task.create({
      patient_id: patient.id,
      title: task.title,
      description: task.description,
      type: task.type || 'coordinate',
      priority: task.priority,
      status: 'pending',
      due_date: dueDate.toISOString().split('T')[0],
      source: 'ai_generated',
      ai_reason: `[Referral] ${task.referral_type}: ${task.ai_reason}`,
      assigned_to: user.email,
    }));
  }
  return { ...res, tasks_created: created.length };
}

// ── New: Auto-create tasks from critical alerts / deterioration predictions ──

async function createAlertTasks(base44, patientContext, patient, activeAlerts, user) {
  const alertSummary = activeAlerts.map(a =>
    `[${a.severity}] ${a.alert_type}: ${a.title} — ${a.message?.substring(0, 200)}`
  ).join('\n');

  const res = await base44.integrations.Core.InvokeLLM({
    prompt: `You are a clinical alert response automation engine. This patient has active alerts that require staff action. Create specific tasks for EVERY alert that needs intervention.

${patientContext}

ACTIVE ALERTS:
${alertSummary || 'No active alerts — analyze the patient data for any proactive tasks that should be created based on deterioration risk.'}

For EACH alert or risk, create a task:
1. Critical vital alert → task: immediate nurse callback or PRN visit
2. Fall risk alert → task: home safety evaluation + equipment check
3. Readmission risk → task: physician notification + care plan escalation
4. Infection risk → task: wound assessment + labs
5. Medication risk → task: medication reconciliation call
6. Caregiver burnout → task: social work referral
7. Symptom escalation → task: urgent visit scheduling
8. Care gap → task: documentation or assessment completion

Today's date: ${new Date().toISOString().split('T')[0]}.`,
    response_json_schema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              type: { type: "string", enum: ["call", "notify", "schedule", "order", "coordinate", "document", "safety", "followup", "other"] },
              priority: { type: "string", enum: ["critical", "high", "medium", "low"] },
              due_in_days: { type: "number" },
              target_role: { type: "string" },
              alert_type: { type: "string" },
              ai_reason: { type: "string" }
            }
          }
        }
      }
    }
  });

  const created = [];
  for (const task of (res.tasks || [])) {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + (task.due_in_days || 1));
    created.push(await base44.entities.Task.create({
      patient_id: patient.id,
      title: task.title,
      description: task.description,
      type: task.type || 'safety',
      priority: task.priority,
      status: 'pending',
      due_date: dueDate.toISOString().split('T')[0],
      source: 'ai_generated',
      ai_reason: `[Alert Response] ${task.alert_type}: ${task.ai_reason}`,
      assigned_to: user.email,
    }));
  }
  return { ...res, tasks_created: created.length };
}